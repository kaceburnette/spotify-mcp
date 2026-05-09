# spotify-mcp

Tell Claude your vibe. It plays the music.

32 tools. Full playback control. Mood detection. Personal track queuing. Built for Claude Code.

---

## Quickstart

Tell Claude:

> *"Set up this repo for me: github.com/kaceburnette/spotify-mcp"*

Claude handles everything. The only manual step is creating a free Spotify developer app — Claude will tell you exactly what to do.

---

## What it does

- **Auto vibe detection** — Claude reads your session (what you're working on, energy, time of day) and sets the mood without you asking
- **Personal track queuing** — queues tracks from your actual listening history, not generic playlists
- **16 moods** — grind, focus, lock_in, hype, workout, chill, night_drive, and more
- **Full Spotify control** — play, pause, skip, volume, search, queue, liked songs, top tracks, everything
- **Persistent state** — mood and session survive restarts

---

## Requirements

- Node.js 18+
- Spotify Premium
- Spotify Developer app (free, 2 min)

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/kaceburnette/spotify-mcp.git
cd spotify-mcp
npm install
```

### 2. Create a Spotify app

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. Click **Create app**
3. Add redirect URI: `http://127.0.0.1:8888/callback`
4. Copy your **Client ID** and **Client Secret**

### 3. Add credentials

Create `.spotify-config.json` in the project root:

```json
{
  "clientId": "YOUR_CLIENT_ID",
  "clientSecret": "YOUR_CLIENT_SECRET"
}
```

### 4. Authenticate

```bash
node auth-setup.js
```

Browser opens → click Agree → done. One-time setup.

### 5. Add to Claude Code

```bash
claude mcp add spotify -- node /absolute/path/to/spotify-mcp/server.js
```

---

## Auto vibe setup

Add this to your `~/.claude/CLAUDE.md`:

```markdown
# Spotify
- At session start, call `detect_vibe` with context: what you're working on, energy level, time of day.
- When the vibe shifts significantly, call `detect_vibe` again.
- Never ask permission — just set the mood and play.
- When the user names an artist, venue, or scene, search by name and play. No narration.
```

---

## Moods

| Mood | Energy | Sounds like |
|---|---|---|
| `grind` | high | dark electronic, coding beats |
| `focus` | medium | lo-fi, ambient, deep work |
| `lock_in` | high | techno, drum & bass |
| `hype` | high | rap, trap, high energy |
| `workout` | max | phonk, hard trap |
| `confident` | high | power rap |
| `creative` | medium | film scores, flow state ambient |
| `chill` | low | jazz, chillhop |
| `relax` | low | soft piano, ambient |
| `wind_down` | min | ambient, soft piano |
| `night_drive` | medium | darksynth, cyberpunk |
| `in_my_feels` | low | emotional R&B, indie |
| `sad` | low | sad indie |
| `angry` | max | metal, hard rap |
| `background` | min | classical, cafe ambient |
| `pump_up` | high | motivational hip hop |

---

## All tools

| Tool | What it does |
|---|---|
| `detect_vibe` | Read session context → pick mood → queue tracks → play |
| `set_mood` | Manually set mood by name |
| `get_mood` | Current mood, queue depth, session stats |
| `clear_session` | Reset seen tracks, start fresh |
| `get_prefs` | View preferences |
| `update_prefs` | Change startup song, mood, blacklists |
| `play` | Play/resume. Pass a URI or leave empty to resume |
| `pause` | Pause |
| `next_track` | Skip. Auto-refills queue |
| `previous_track` | Go back |
| `set_volume` | 0–100 |
| `toggle_shuffle` | On/off |
| `set_repeat` | off / track / context |
| `seek` | Jump to position in seconds |
| `get_current_track` | What's playing |
| `get_queue` | What's coming up |
| `get_devices` | Available playback devices |
| `transfer_playback` | Switch device |
| `search` | Search tracks, artists, albums, playlists |
| `get_playlists` | Your playlists |
| `get_playlist_tracks` | Tracks in a playlist |
| `create_playlist` | Make a new playlist |
| `add_to_playlist` | Add tracks to a playlist |
| `get_saved_tracks` | Liked songs |
| `save_track` | Like a track |
| `remove_saved_track` | Unlike a track |
| `get_top_tracks` | Your top tracks |
| `get_top_artists` | Your top artists |
| `get_recently_played` | Recent history |
| `get_artist` | Artist info + top tracks + albums |
| `get_album` | Album details + tracklist |
| `add_to_queue` | Queue a specific track |

---

## Troubleshooting

**"No active device found"** — Open Spotify, play anything for a second, pause it. That wakes the device.

**"No tokens found"** — Run `node auth-setup.js` again.

**403 on playlist tools** — Go to [spotify.com/account/apps](https://www.spotify.com/account/apps), remove your app, re-run `node auth-setup.js`.

---

## License

MIT
