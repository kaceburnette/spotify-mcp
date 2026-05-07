'use strict';

// ── DJ Engine — Entry point ───────────────────────────────────────────────────
// Spawns librespot with --backend pipe, pipes PCM through DJEngine DSP,
// outputs to system speakers via platform-native command.
//
// librespot announces itself as a Spotify Connect device. Select it once in the
// Spotify app (or Claude calls transfer_playback automatically) and all audio
// flows through this engine from that point on.

const { spawn }  = require('child_process');
const path       = require('path');
const fs         = require('fs');
const DJEngine   = require('./engine');

const BIN_DIR    = path.join(__dirname, 'bin');
const DEVICE_NAME = 'spotify-mcp DJ';

// Platform → output command that reads raw S16LE stereo 44100Hz from stdin
const OUTPUT_CMD = {
  darwin:  { cmd: 'afplay', args: ['-t', 'raw', '-f', 'LEI16@44100', '-c', '2', '-'] },
  linux:   { cmd: 'aplay',  args: ['-r', '44100', '-c', '2', '-f', 'S16_LE', '-t', 'raw'] },
  // win32: SoX `play` works if installed — documented in README
};

// Module-level singletons
let _librespot = null;
let _player    = null;
let _engine    = null;
let _active    = false;

/**
 * Start the DJ engine.
 * @param {string} [deviceName] - Spotify Connect device name shown in Spotify app
 * @returns {DJEngine} the live DSP engine instance
 */
async function start(deviceName = DEVICE_NAME) {
  if (_active) await stop();

  const outputCfg = OUTPUT_CMD[process.platform];
  if (!outputCfg) throw new Error(`Platform "${process.platform}" not yet supported. Supported: macOS, Linux.`);

  const librespotBin = _findLibrespot();

  _engine    = new DJEngine();
  _player    = spawn(outputCfg.cmd, outputCfg.args, { stdio: ['pipe', 'ignore', 'ignore'] });
  _librespot = spawn(librespotBin, [
    '--backend',  'pipe',
    '--name',     deviceName,
    '--bitrate',  '320',
    '--disable-audio-cache',
    '--quiet',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  _librespot.stdout.pipe(_engine).pipe(_player.stdin);
  _librespot.stderr.on('data', d => process.stderr.write('[librespot] ' + d));
  _librespot.on('exit', code => { if (_active) _active = false; });

  _active = true;
  return _engine;
}

/** Stop the engine and kill all child processes. */
async function stop() {
  _active = false;
  _librespot?.kill();
  _player?.kill();
  _librespot = null;
  _player    = null;
  _engine    = null;
}

/** Returns the running DJEngine instance, or null if not started. */
function getEngine() { return _active ? _engine : null; }

/** Is the engine currently running? */
function isActive() { return _active; }

// ── Internal ──────────────────────────────────────────────────────────────────

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
