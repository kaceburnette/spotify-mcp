#!/usr/bin/env node

const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const fs = require('fs');
const path = require('path');

const TOKEN_PATH = path.join(__dirname, '.spotify-tokens.json');
const CONFIG_PATH = path.join(__dirname, '.spotify-config.json');

// Check for config
if (!fs.existsSync(CONFIG_PATH)) {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                  Spotify MCP — First-Time Setup             ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  1. Go to https://developer.spotify.com/dashboard           ║
║  2. Create a new app                                         ║
║  3. Set Redirect URI to: http://localhost:8888/callback      ║
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

const spotifyApi = new SpotifyWebApi({
  clientId: config.clientId,
  clientSecret: config.clientSecret,
  redirectUri: 'http://127.0.0.1:8888/callback',
});

const scopes = [
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
];

const app = express();

app.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    res.send('Error: No authorization code received');
    return;
  }

  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    const tokens = {
      accessToken: data.body.access_token,
      refreshToken: data.body.refresh_token,
      expiresAt: Date.now() + data.body.expires_in * 1000,
    };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    res.send(`
      <html><body style="background:#1a1a2e;color:#e0e0e0;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div style="text-align:center">
          <h1 style="color:#1DB954">&#10003; Spotify Connected!</h1>
          <p>Tokens saved. You can close this tab and stop the server.</p>
        </div>
      </body></html>
    `);
    console.log('\n✓ Tokens saved to .spotify-tokens.json');
    console.log('✓ You can now use the Spotify MCP server.');
    console.log('\nPress Ctrl+C to stop this server.\n');
  } catch (err) {
    console.error('Auth error:', err.message);
    res.send('Error during authentication: ' + err.message);
  }
});

const server = app.listen(8888, async () => {
  const authUrl = spotifyApi.createAuthorizeURL(scopes, 'spotify-mcp');
  console.log('\nOpening Spotify authorization in your browser...\n');
  console.log('If it doesn\'t open, visit:\n' + authUrl + '\n');
  const open = (await import('open')).default;
  open(authUrl);
});
