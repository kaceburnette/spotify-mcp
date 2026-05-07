'use strict';

// ── DJ Engine — Entry point ───────────────────────────────────────────────────
// Spawns librespot with --backend pipe, pipes PCM through DJEngine DSP,
// outputs to system speakers via the `speaker` npm package (CoreAudio/ALSA).
//
// librespot announces itself as a Spotify Connect device. Select it once in the
// Spotify app (or Claude calls transfer_playback automatically) and all audio
// flows through this engine from that point on.

const { spawn }  = require('child_process');
const path       = require('path');
const fs         = require('fs');
const DJEngine   = require('./engine');

const BIN_DIR      = path.join(__dirname, 'bin');
const TOKENS_FILE  = path.join(__dirname, '..', '.spotify-tokens.json');
const DEVICE_NAME  = 'spotify-mcp DJ';

// Module-level singletons
let _librespot = null;
let _speaker   = null;
let _engine    = null;
let _active    = false;

/**
 * Start the DJ engine.
 * @param {string} [deviceName] - Spotify Connect device name shown in Spotify app
 * @returns {DJEngine} the live DSP engine instance
 */
async function start(deviceName = DEVICE_NAME) {
  if (_active) await stop();

  // Kill any orphaned processes from previous server runs
  try { require('child_process').execSync('pkill -f librespot 2>/dev/null; pkill -f "/opt/homebrew/bin/play" 2>/dev/null', { stdio: 'ignore' }); } catch (_) {}
  await new Promise(r => setTimeout(r, 300));

  if (process.platform === 'win32') {
    throw new Error('Windows not yet supported.');
  }

  const librespotBin = _findLibrespot();
  const accessToken  = _readAccessToken();
  const playBin      = _findPlay();

  const librespotArgs = [
    '--backend',  'pipe',
    '--name',     deviceName,
    '--bitrate',  '320',
    '--disable-audio-cache',
    '--quiet',
  ];
  if (accessToken) librespotArgs.push('--access-token', accessToken);

  // sox `play` reads raw S16LE stereo 44100Hz from stdin — stable, no native bindings
  const playArgs = ['-q', '-t', 'raw', '-r', '44100', '-e', 'signed-integer', '-b', '16', '-c', '2', '-L', '-'];

  _engine    = new DJEngine();
  _speaker   = spawn(playBin, playArgs, { stdio: ['pipe', 'ignore', 'ignore'] });
  _librespot = spawn(librespotBin, librespotArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  _engine.on('error',    err => process.stderr.write('[engine] '    + err.message + '\n'));
  _speaker.on('error',   err => process.stderr.write('[play] '      + err.message + '\n'));
  _librespot.on('error', err => process.stderr.write('[librespot] ' + err.message + '\n'));
  _librespot.stderr.on('data', d => process.stderr.write('[librespot] ' + d));
  _librespot.on('exit', () => { if (_active) _active = false; });

  _librespot.stdout.pipe(_engine).pipe(_speaker.stdin);

  _active = true;
  return _engine;
}

/** Stop the engine and kill all child processes. */
async function stop() {
  _active = false;
  try { _librespot?.stdout?.unpipe(); } catch (_) {}
  try { _engine?.unpipe(); }            catch (_) {}
  _librespot?.kill();
  _speaker?.kill();
  _librespot = null;
  _speaker   = null;
  _engine    = null;
}

/** Returns the running DJEngine instance, or null if not started. */
function getEngine() { return _active ? _engine : null; }

/** Is the engine currently running? */
function isActive() { return _active; }

// ── Internal ──────────────────────────────────────────────────────────────────

function _readAccessToken() {
  try {
    const data = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
    return data.accessToken || null;
  } catch (_) { return null; }
}

function _findPlay() {
  try {
    const { execSync } = require('child_process');
    const which = process.platform === 'win32' ? 'where' : 'which';
    const found = execSync(`${which} play`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (found) return found.split('\n')[0].trim();
  } catch (_) {}
  throw new Error('sox `play` not found. Install it: brew install sox (Mac) / apt install sox (Linux)');
}

function _findLibrespot() {
  // 1. Check our own bin/ directory (installed by setup.js)
  const localBin = path.join(BIN_DIR, `librespot-${process.platform}-${process.arch}`);
  if (fs.existsSync(localBin)) return localBin;

  // 2. Check system PATH (brew install librespot / apt install librespot)
  try {
    const { execSync } = require('child_process');
    const which = process.platform === 'win32' ? 'where' : 'which';
    const found = execSync(`${which} librespot`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (found) return found.split('\n')[0].trim();
  } catch (_) {}

  throw new Error(
    'librespot not found. Run: node dj-engine/setup.js\n' +
    'Or install manually: brew install librespot (Mac) / apt install librespot (Linux)'
  );
}

module.exports = { start, stop, getEngine, isActive };
