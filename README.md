# spotify-mcp

Spotify MCP server for Claude Code. Detects your vibe from session context, keeps a mood-matched queue running, and controls everything through natural language.

Every Claude Code session starts with **Back in Black**. You can change it.

---

## What it does

- **Vibe detection** — Claude reads what you're working on and auto-picks the right music. Say "deep focus coding vibes" or "I just shipped" and it switches playlists immediately.
- **Persistent mood** — mood and session state survive server restarts. Your grind session doesn't reset because you closed a tab.
- **Smart queue** — never runs out. Pulls from your top tracks, artist catalogs, and mood-matched playlists. Same song never plays twice in a session.
- **Fully configurable** — startup song, startup mood, per-mood playlist keywords, artist/track blacklist. All in `.spotify-prefs.json`.
- **No deprecated APIs** — rebuilt after Spotify killed `/recommendations` in Nov 2024. Uses top tracks, artist catalogs, and playlist search only.

---

## Requirements

- Node.js 18+
- Spotify Premium account
- Spotify Developer app (free, 2 minutes to create)

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
3. Add Redirect URI: `http://127.0.0.1:8888/callback`
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

Browser opens, you click Agree, done. Tokens saved to `.spotify-tokens.json` and auto-refresh forever. One-time setup.

### 5. Add to Claude Code

```bash
claude mcp add spotify -- node /absolute/path/to/spotify-mcp/server.js
```

Or add manually to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "spotify": {
      "command": "node",
      "args": ["/absolute/path/to/spotify-mcp/server.js"]
    }
  }
}
```

Restart Claude Code. Back in Black plays. You're in.

---

## Configure your setup

Copy the example file and edit it:

```bash
cp spotify-prefs.example.json .spotify-prefs.json
```

```json
{
  "startup_song": "spotify:track:08mG3Y1vljYA6bvDt4Wqkj",
  "startup_mood": "grind",
  "mood_overrides": {
    "grind": {
      "keywords": ["dark techno focus", "coding beats instrumental"]
    }
  },
  "blacklist_artists": ["Artist Name Here"],
  "blacklist_tracks": []
}
```

| Field | What it does | Default |
|---|---|---|
| `startup_song` | Track URI played every time the server starts | Back in Black — AC/DC |
| `startup_mood` | Mood applied on boot | `grind` |
| `mood_overrides` | Custom playlist search keywords per mood | See example file |
| `blacklist_artists` | These artists never get queued (substring match) | `[]` |
| `blacklist_tracks` | These track IDs never get queued | `[]` |

Changes take effect on next MCP reconnect.

You can also update config by telling Claude:
- *"blacklist [artist name]"*
- *"set my startup mood to focus"*
- *"change my startup song to [song]"*

---

## Vibe detection

Claude reads your session — open files, what you're building, recent commits, what you said — and calls `detect_vibe` automatically. It scores keywords, applies time-of-day signals, picks a mood, searches for a matching playlist, and plays it. One call does everything.

**Explicit phrases always win:**

| Say this | Gets this |
|---|---|
| "deep code focus work vibes" | `focus` — lo-fi instrumental |
| "lock in" / "locked in" | `lock_in` — dark techno |
| "I just shipped" / "just merged" | `hype` — rap/trap |
| "CEO energy" / "boss vibes" | `confident` — power hip hop |
| "night drive vibes" | `night_drive` — synthwave |
| "chill out" | `chill` — R&B/soul |
| "I'm debugging a prod issue" | `lock_in` — auto-detected |
| "wrapping up for the day" | `wind_down` — ambient |

---

## Moods

| Mood | Energy | Sounds like |
|---|---|---|
| `grind` | high | dark electronic, coding beats |
| `focus` | medium | lo-fi, ambient instrumental, deep work |
| `lock_in` | high | techno, drum & bass, industrial |
| `hype` | high | rap, trap, high energy hip hop |
| `pump_up` | high | motivational hip hop |
| `workout` | max | gym rap, EDM, intense |
| `confident` | high | boss rap, power R&B |
| `creative` | medium | jazz, indie, alternative |
| `chill` | low | R&B, soul, laid back hip hop |
| `relax` | low | acoustic, mellow, soft |
| `wind_down` | min | ambient, soft piano |
| `background` | min | classical, ambient, cafe |
| `night_drive` | medium | synthwave, dark electronic |
| `in_my_feels` | low | emotional R&B, indie |
| `sad` | low | sad indie, heartbreak |
| `angry` | max | metal, hard rock, punk |

---

## Auto-detection setup (recommended)

Add this to `~/.claude/CLAUDE.md` so Claude reads your session and sets the vibe automatically — no prompting needed:

```markdown
# Spotify — Auto Vibe
- At the start of every session, call `detect_vibe` with context about what the user is working on, their energy, and time of day. Let it auto-apply the mood.
- When the task or energy shifts significantly (debugging → shipped, coding → meeting), call `detect_vibe` again.
- Never ask permission to set the mood — read the context and do it.
```

---

## All tools

| Tool | What it does |
|---|---|
| `detect_vibe` | Read session context → pick mood → find playlist → play it |
| `set_mood` | Manually set mood by name |
| `get_mood` | Current mood, queue depth, session stats |
| `clear_session` | Reset seen tracks, start discovery fresh |
| `get_prefs` | View current preferences |
| `update_prefs` | Change startup song, startup mood, blacklists |
| `play` | Play/resume. Pass a URI or leave empty to resume |
| `pause` | Pause |
| `next_track` | Skip. Auto-refills queue |
| `previous_track` | Go back |
| `set_volume` | 0–100 |
| `toggle_shuffle` | On/off |
| `set_repeat` | off / track / context |
| `seek` | Jump to position in seconds |
| `get_current_track` | What's playing right now |
| `get_queue` | What's coming up |
| `get_devices` | Available playback devices |
| `transfer_playback` | Switch to a different device |
| `search` | Search tracks, artists, albums, playlists |
| `get_playlists` | Your playlists |
| `get_playlist_tracks` | Tracks in a playlist |
| `create_playlist` | Make a new playlist |
| `add_to_playlist` | Add tracks to a playlist |
| `get_saved_tracks` | Your liked songs |
| `save_track` | Like a track |
| `remove_saved_track` | Unlike a track |
| `get_top_tracks` | Top tracks (short / medium / long term) |
| `get_top_artists` | Top artists |
| `get_recently_played` | Recent history |
| `get_artist` | Artist info + top tracks + albums |
| `get_album` | Album details + tracklist |
| `add_to_queue` | Queue a specific track URI |
| `dj_set` | Build a multi-phase DJ set (warm up → build → peak → outro) seeded from your top artists |
| `dj_transition` | Transition to the next track with a style: `fade`, `cut`, `stutter`, `echo`, `swell` |
| `cut_early` | Jump to the end of the current track and transition |

---

## DJ Mode

### `dj_set`

Builds and plays a full DJ set arc seeded from your actual top artists. Phases:

| Phase | Energy | Length |
|---|---|---|
| Warm up | Low → medium | ~4 tracks |
| Build | Medium → high | ~5 tracks |
| Peak | High → max | ~6 tracks |
| Outro | Medium | ~3 tracks (optional) |

Each phase searches for mood-matched playlists, pulls tracks, deduplicates against the full session, and queues them in order. Never shuffle — the arc is intentional.

Tell Claude: *"build me a DJ set"* or *"play a peak hour techno set"* and it picks the mood, seeds from your top artists, and runs the arc.

### `dj_transition`

Transition styles:

| Style | What it sounds like |
|---|---|
| `fade` | 3-second fade out, skip, 3-second fade in |
| `cut` | Hard drop to 0, instant skip, snap back to volume |
| `stutter` | Fader chop × 4, hard cut, 8-step fade in |
| `echo` | Reverb cascade (9 steps), skip, fade in |
| `swell` | Volume surges to peak, hard drop, skip, fade in |

Tell Claude: *"hit me with an echo transition"* or *"stutter cut to the next track"*.

---

## Files

| File | Purpose |
|---|---|
| `server.js` | MCP server |
| `auth-setup.js` | One-time OAuth setup |
| `.spotify-config.json` | Client ID + Secret (**gitignored**) |
| `.spotify-tokens.json` | Auth tokens, auto-managed (**gitignored**) |
| `.spotify-prefs.json` | Your personal config (**gitignored**) |
| `.spotify-state.json` | Mood + session state, persists across restarts (**gitignored**) |
| `spotify-prefs.example.json` | Config template — copy to `.spotify-prefs.json` |

---

## Troubleshooting

**"No active device found"** — Open Spotify on any device. The app needs to be running (even paused) for the API to see it.

**"No tokens found"** — Run `node auth-setup.js` to re-authenticate.

**Music not switching on vibe change** — Make sure Spotify is open on a device. The API can't play to a closed app.

**Want to reset the vibe** — Tell Claude `"clear session"` to wipe seen tracks and start discovery fresh.

---

## License

MIT
