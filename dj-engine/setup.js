#!/usr/bin/env node
'use strict';

// ── DJ Engine Setup ───────────────────────────────────────────────────────────
// Downloads the librespot binary for your platform, or guides you to install
// it via your system package manager if a pre-built binary isn't available.
//
// Run once: node dj-engine/setup.js

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { execSync } = require('child_process');

const BIN_DIR = path.join(__dirname, 'bin');
const VERSION = 'v0.5.0-dev';

// GitHub release asset names per platform/arch
// https://github.com/librespot-org/librespot/releases
const RELEASE_ASSETS = {
  'darwin-arm64':  'librespot-aarch64-apple-darwin.tar.gz',
  'darwin-x64':    'librespot-x86_64-apple-darwin.tar.gz',
  'linux-x64':     'librespot-x86_64-unknown-linux-gnu.tar.gz',
  'linux-arm64':   'librespot-aarch64-unknown-linux-gnu.tar.gz',
};

const PLATFORM_KEY = `${process.platform}-${process.arch}`;
const OUT_BIN      = path.join(BIN_DIR, `librespot-${process.platform}-${process.arch}`);

async function main() {
  console.log(`\nspotify-mcp DJ Engine — setup\n`);
  console.log(`Platform: ${PLATFORM_KEY}`);

  // Already installed?
  if (fs.existsSync(OUT_BIN)) {
    console.log(`✓ librespot already installed at ${OUT_BIN}`);
    return;
  }

  // Try system package manager first (more reliable than GitHub release binaries)
  if (await trySystemInstall()) return;

  // Fall back to GitHub release download
  if (await tryGitHubDownload()) return;

  // Give up gracefully with manual instructions
  printManualInstructions();
  process.exit(1);
}

async function trySystemInstall() {
  if (process.platform === 'darwin') {
    console.log('\nChecking Homebrew...');
    try {
      execSync('which brew', { stdio: 'ignore' });
      console.log('Installing librespot via Homebrew...');
      execSync('brew install librespot', { stdio: 'inherit' });
      console.log('\n✓ librespot installed via Homebrew.');
      console.log('  The engine will find it automatically via PATH.');
      return true;
    } catch (_) {
      console.log('Homebrew not available, trying direct download...');
      return false;
    }
  }

  if (process.platform === 'linux') {
    console.log('\nChecking apt...');
    try {
      execSync('which apt-get', { stdio: 'ignore' });
      console.log('Installing librespot via apt...');
      execSync('sudo apt-get install -y librespot', { stdio: 'inherit' });
      console.log('\n✓ librespot installed via apt.');
      return true;
    } catch (_) {
      console.log('apt not available, trying direct download...');
      return false;
    }
  }

  return false;
}

async function tryGitHubDownload() {
  const asset = RELEASE_ASSETS[PLATFORM_KEY];
  if (!asset) {
    console.log(`No pre-built binary available for ${PLATFORM_KEY}.`);
    return false;
  }

  // Try the official librespot releases, then the spotifyd project which
  // ships librespot as a component
  const urls = [
    `https://github.com/librespot-org/librespot/releases/download/${VERSION}/${asset}`,
  ];

  if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });

  for (const url of urls) {
    try {
      console.log(`\nDownloading from ${url}...`);
      const tarPath = OUT_BIN + '.tar.gz';
      await download(url, tarPath);
      execSync(`tar -xzf "${tarPath}" -C "${BIN_DIR}"`, { stdio: 'ignore' });
      fs.unlinkSync(tarPath);
      // Rename extracted binary to our naming convention
      const extracted = path.join(BIN_DIR, 'librespot');
      if (fs.existsSync(extracted)) {
        fs.renameSync(extracted, OUT_BIN);
        fs.chmodSync(OUT_BIN, 0o755);
        console.log(`✓ librespot installed at ${OUT_BIN}`);
        return true;
      }
    } catch (err) {
      console.log(`  Failed: ${err.message}`);
    }
  }

  return false;
}

function printManualInstructions() {
  console.log(`
Unable to install librespot automatically.

Manual install:

  macOS:   brew install librespot
  Linux:   sudo apt install librespot
           OR: cargo install librespot (requires Rust)
  Windows: Download from https://github.com/librespot-org/librespot/releases
           Place the .exe in dj-engine/bin/librespot-win32-x64.exe

After installing, run this script again to verify:
  node dj-engine/setup.js
`);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file    = fs.createWriteStream(dest);
    const proto   = url.startsWith('https') ? https : http;
    const request = proto.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlink(dest, () => {});
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      res.on('data', chunk => {
        received += chunk.length;
        if (total) process.stdout.write(`  ${Math.round(received/total*100)}%\r`);
      });
      res.pipe(file);
      file.on('finish', () => { file.close(); console.log(); resolve(); });
    });
    request.on('error', err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

main().catch(err => { console.error(err); process.exit(1); });
