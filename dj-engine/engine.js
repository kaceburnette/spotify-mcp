'use strict';

// ── DJ Audio Engine ───────────────────────────────────────────────────────────
// Real-time DSP on Spotify's raw PCM stream via librespot.
// Processes S16LE stereo at 44100Hz — biquad filters, echo delay, volume ramps.
// Used by index.js which wires librespot → engine → speakers.

const { Transform } = require('stream');

const SAMPLE_RATE   = 44100;
const CHANNELS      = 2;
const BYTES_PER_S16 = 2;
const FRAME_BYTES   = CHANNELS * BYTES_PER_S16; // 4 bytes per stereo frame
const ECHO_BUF_FRAMES = SAMPLE_RATE * 3;        // 3s max echo delay

class DJEngine extends Transform {
  constructor() {
    super();
    this._remainder = Buffer.alloc(0);

    // Volume ramp
    this.volume       = 1.0;
    this._targetVol   = 1.0;
    this._rampFrames  = 0;
    this._rampStep    = 0;

    // Biquad filter (per channel state)
    this.filterOn     = false;
    this.filterType   = 'lowpass';   // 'lowpass' | 'highpass'
    this.filterFreq   = 20000;
    this._fState      = [
      { x1: 0, x2: 0, y1: 0, y2: 0 },
      { x1: 0, x2: 0, y1: 0, y2: 0 },
    ];
    this._fCoeffs     = null;         // recomputed when freq changes

    // Echo / delay line
    this.echoOn        = false;
    this.echoDelayMs   = 300;
    this.echoFeedback  = 0.40;
    this._echoBuf      = [new Float32Array(ECHO_BUF_FRAMES), new Float32Array(ECHO_BUF_FRAMES)];
    this._echoWr       = 0;

    // Sweep state (setTimeout-based — runs alongside stream)
    this._sweep        = null;
  }

  // ── Stream transform ──────────────────────────────────────────────────────

  _transform(chunk, _enc, cb) {
    const data   = Buffer.concat([this._remainder, chunk]);
    const frames = Math.floor(data.length / FRAME_BYTES);
    this._remainder = data.slice(frames * FRAME_BYTES);

    const out = Buffer.allocUnsafe(frames * FRAME_BYTES);

    for (let i = 0; i < frames; i++) {
      const off = i * FRAME_BYTES;
      let L = data.readInt16LE(off)     / 32768;
      let R = data.readInt16LE(off + 2) / 32768;

      // Filter
      if (this.filterOn) {
        if (!this._fCoeffs) this._fCoeffs = this._calcCoeffs();
        L = this._applyBiquad(L, this._fState[0], this._fCoeffs);
        R = this._applyBiquad(R, this._fState[1], this._fCoeffs);
      }

      // Echo
      if (this.echoOn) {
        const delaySamples = Math.floor((this.echoDelayMs / 1000) * SAMPLE_RATE);
        const rd = (this._echoWr - delaySamples + ECHO_BUF_FRAMES) % ECHO_BUF_FRAMES;
        const eL = this._echoBuf[0][rd];
        const eR = this._echoBuf[1][rd];
        this._echoBuf[0][this._echoWr] = L + eL * this.echoFeedback;
        this._echoBuf[1][this._echoWr] = eR + eR * this.echoFeedback;
        L += eL * 0.5;
        R += eR * 0.5;
        this._echoWr = (this._echoWr + 1) % ECHO_BUF_FRAMES;
      }

      // Volume ramp
      if (this._rampFrames > 0) {
        this.volume += this._rampStep;
        if (--this._rampFrames === 0) this.volume = this._targetVol;
      }
      L *= this.volume;
      R *= this.volume;

      // Write clamped S16LE
      out.writeInt16LE(_clamp16(L), off);
      out.writeInt16LE(_clamp16(R), off + 2);
    }

    cb(null, out);
  }

  _flush(cb) { cb(null, this._remainder); }

  // ── DSP helpers ───────────────────────────────────────────────────────────

  _calcCoeffs() {
    const f  = Math.max(20, Math.min(this.filterFreq, SAMPLE_RATE / 2 - 1));
    const Q  = 0.707;
    const w0 = 2 * Math.PI * f / SAMPLE_RATE;
    const al = Math.sin(w0) / (2 * Q);
    const cw = Math.cos(w0);
    if (this.filterType === 'lowpass') {
      return { b0: (1-cw)/2, b1: 1-cw, b2: (1-cw)/2, a0: 1+al, a1: -2*cw, a2: 1-al };
    }
    return { b0: (1+cw)/2, b1: -(1+cw), b2: (1+cw)/2, a0: 1+al, a1: -2*cw, a2: 1-al };
  }

  _applyBiquad(x, s, c) {
    const y = (c.b0/c.a0)*x + (c.b1/c.a0)*s.x1 + (c.b2/c.a0)*s.x2
                             - (c.a1/c.a0)*s.y1  - (c.a2/c.a0)*s.y2;
    s.x2 = s.x1; s.x1 = x;
    s.y2 = s.y1; s.y1 = y;
    return y;
  }

  // ── Public control API ────────────────────────────────────────────────────

  /** Ramp volume to target over rampMs milliseconds. */
  setVolume(vol, rampMs = 0) {
    this._targetVol = Math.max(0, Math.min(1, vol));
    if (rampMs > 0) {
      this._rampFrames = Math.floor((rampMs / 1000) * SAMPLE_RATE);
      this._rampStep   = (this._targetVol - this.volume) / this._rampFrames;
    } else {
      this.volume = this._targetVol;
    }
  }

  /** Instantly cut volume to 0. */
  cut() { this.setVolume(0, 0); }

  /** Enable a biquad filter at the given frequency. */
  enableFilter(type, freqHz) {
    this.filterType   = type;
    this.filterFreq   = freqHz;
    this.filterOn     = true;
    this._fCoeffs     = null;
    this._fState      = [{ x1:0,x2:0,y1:0,y2:0 }, { x1:0,x2:0,y1:0,y2:0 }];
  }

  disableFilter() { this.filterOn = false; }

  /**
   * Sweep the filter from startHz to endHz over durationMs.
   * Logarithmic sweep — sounds natural, like a real DJ filter knob.
   */
  sweepFilter(type, startHz, endHz, durationMs) {
    if (this._sweep) clearInterval(this._sweep);
    this.enableFilter(type, startHz);
    const steps    = 60;
    const interval = durationMs / steps;
    const ratio    = endHz / startHz;
    let   step     = 0;
    this._sweep = setInterval(() => {
      step++;
      this.filterFreq = startHz * Math.pow(ratio, step / steps);
      this._fCoeffs   = null;
      if (step >= steps) {
        clearInterval(this._sweep);
        this._sweep = null;
        this.filterFreq = endHz;
      }
    }, interval);
  }

  /** Enable echo with delay (ms) and feedback (0–1). */
  enableEcho(delayMs = 300, feedback = 0.4) {
    this.echoDelayMs  = Math.min(delayMs, 2900);
    this.echoFeedback = Math.min(feedback, 0.85);
    this.echoOn       = true;
    this._echoBuf[0].fill(0);
    this._echoBuf[1].fill(0);
    this._echoWr = 0;
  }

  disableEcho() { this.echoOn = false; }

  /** Stutter: rapid on/off volume chops. Returns a promise that resolves when done. */
  async stutter(chops = 4, chopMs = 80) {
    for (let i = 0; i < chops; i++) {
      this.setVolume(0);
      await _sleep(chopMs);
      this.setVolume(1);
      await _sleep(chopMs);
    }
  }

  /** Swell: push volume past max, then cut to 0 for a hard drop. */
  async swell(swellMs = 800, peakVol = 1.25) {
    this.setVolume(peakVol, swellMs);
    await _sleep(swellMs + 100);
    this.setVolume(0, 0);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _clamp16(f) {
  return Math.max(-32768, Math.min(32767, Math.round(f * 32768)));
}

function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = DJEngine;
