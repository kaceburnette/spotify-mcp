# spotify-mcp

Spotify MCP server for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Control your music through natural language — play tracks, search, manage playlists, get recommendations, and more.

> **Note:** Spotify must be open and active on at least one device (phone, desktop app, or web player) for playback commands to work. This is a Spotify API limitation, not a limitation of this server.

## What You Can Do

- **Playback** — play, pause, skip, seek, volume, shuffle, repeat
- **Search** — find tracks, artists, albums, playlists
- **Queue** — add tracks, view upcoming queue
- **Playlists** — create, browse, add tracks
- **Library** — liked songs, save/remove tracks
- **Discovery** — recommendations, top tracks/artists, recently played
- **Devices** — list devices, transfer playback

## Setup

### 1. Create a Spotify App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app
3. Set the **Redirect URI** to `http://127.0.0.1:8888/callback`
4. Copy your **Client ID** and **Client Secret**

### 2. Install

```bash
git clone https://github.com/kaceburnette/spotify-mcp.git
cd spotify-mcp
npm install
```

### 3. Configure Credentials

Create `.spotify-config.json` in the project root:

```json
{
  "clientId": "YOUR_CLIENT_ID",
  "clientSecret": "YOUR_CLIENT_SECRET"
}
```

### 4. Authenticate

```bash
npm run auth
```

This opens your browser for Spotify login. After authorizing, tokens are saved locally to `.spotify-tokens.json`. You only need to do this once — tokens auto-refresh.

### 5. Add to Claude Code

```bash
claude mcp add spotify -- node /path/to/spotify-mcp/server.js
```

Or add it manually to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "spotify": {
      "command": "node",
      "args": ["/path/to/spotify-mcp/server.js"]
    }
  }
}
```

Then restart Claude Code.

## Usage

Just talk to Claude naturally:

- "What's playing on Spotify?"
- "Play some Zach Bryan"
- "Skip this track"
- "Create a playlist called Road Trip and add the last 5 songs I played"
- "What are my top artists this month?"
- "Turn the volume down to 40"
- "Search for lo-fi playlists"

## Tools

| Tool | Description |
|------|-------------|
| `get_current_track` | Currently playing track |
| `play` | Resume or play a specific track/album/playlist |
| `pause` | Pause playback |
| `next_track` | Skip forward |
| `previous_track` | Skip back |
| `set_volume` | Set volume (0-100) |
| `toggle_shuffle` | Toggle shuffle on/off |
| `set_repeat` | Set repeat mode (off/track/context) |
| `seek` | Seek to position in track |
| `add_to_queue` | Add track to queue |
| `get_queue` | View playback queue |
| `get_devices` | List available devices |
| `transfer_playback` | Move playback to another device |
| `search` | Search tracks, artists, albums, playlists |
| `get_playlists` | Your playlists |
| `get_playlist_tracks` | Tracks in a playlist |
| `create_playlist` | Create a new playlist |
| `add_to_playlist` | Add tracks to a playlist |
| `get_saved_tracks` | Liked/saved tracks |
| `save_track` | Like a track |
| `remove_saved_track` | Unlike a track |
| `get_recommendations` | Get recommendations from seed tracks/artists/genres |
| `get_top_tracks` | Your most-played tracks |
| `get_top_artists` | Your most-played artists |
| `get_recently_played` | Recently played tracks |
| `get_artist` | Artist details + top tracks + albums |
| `get_album` | Album details + track listing |

## Troubleshooting

**"No active device found"**
Open Spotify on any device. The app needs to be running — even if paused — for the API to see it.

**"No tokens found"**
Run `npm run auth` to re-authenticate.

**Token expired**
Tokens auto-refresh. If something breaks, delete `.spotify-tokens.json` and run `npm run auth` again.

## License

MIT
