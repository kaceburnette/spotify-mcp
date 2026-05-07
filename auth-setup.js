#!/usr/bin/env node

const express = require('express');
const fs = require('fs');
const path = require('path');

const TOKEN_PATH = path.join(__dirname, '.spotify-tokens.json');
const CONFIG_PATH = path.join(__dirname, '.spotify-config.json');
const REDIRECT_URI = 'http://127.0.0.1:8888/callback';

const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'user-top-read',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
  'user-library-read',
  'user-library-modify',
  'user-read-private',
  'user-read-email',
  'streaming',
].join(' ');

if (!fs.existsSync(CONFIG_PATH)) {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║              Spotify MCP v3 — First-Time Setup              ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  1. Go to https://developer.spotify.com/dashboard           ║
║  2. Create a new app                                         ║
║  3. Add Redirect URI:  http://127.0.0.1:8888/callback        ║
║  4. Copy your Client ID and Client Secret                    ║
║  5. Create .spotify-config.json in this directory:           ║
║                                                              ║
║     {                                                        ║
║       "clientId": "YOUR_CLIENT_ID",                          ║
║       "clientSecret": "YOUR_CLIENT_SECRET"                   ║
║     }                                                        ║
║                                                              ║
║  Then run this script again.                                 ║
╚══════════════════════════════════════════════════════════════╝
`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
if (!config.clientId || !config.clientSecret) {
  console.error('Error: .spotify-config.json must have clientId and clientSecret');
  process.exit(1);
}

const authUrl = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
  client_id: config.clientId,
  response_type: 'code',
  redirect_uri: REDIRECT_URI,
  scope: SCOPES,
  state: 'spotify-mcp',
}).toString();

const app = express();

app.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error || !code) {
    res.send(`<html><body style="background:#1a1a2e;color:#e0e0e0;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="color:#e74c3c">&#x2717; Auth Error</h1><p>${error || 'No code received'}</p></div></body></html>`);
    return;
  }

  try {
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    const data = await tokenRes.json();
    if (!data.access_token) throw new Error(JSON.stringify(data));

    const tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));

    res.send(`<html><body style="background:#1a1a2e;color:#e0e0e0;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="color:#1DB954">&#10003; Spotify Connected!</h1><p>Tokens saved. Close this tab and stop the server (Ctrl+C).</p></div></body></html>`);
    console.log('\n✓ Tokens saved to .spotify-tokens.json');
    console.log('✓ Spotify MCP v3 is ready. Press Ctrl+C to stop this server.\n');
  } catch (err) {
    console.error('Auth error:', err.message);
    res.send('Auth error: ' + err.message);
  }
});

app.listen(8888, async () => {
  console.log('\nOpening Spotify authorization in your browser...');
  console.log('If it does not open, visit:\n' + authUrl + '\n');
  const open = (await import('open')).default;
  open(authUrl);
});
