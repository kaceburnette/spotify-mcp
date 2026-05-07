# spotify-mcp

Most Spotify MCPs are remote controls. This one reads your session and sets the mood automatically.

Built for Claude Code. Drop it in and it watches what you're working on — the files open, what you type, the time of day — and keeps the right energy going without you touching it.

---

## What it does

- **Auto vibe detection** — Claude reads your session context and picks the mood. Say "deep focus" or "I just shipped" and it switches instantly. Or say nothing and it figures it out.
- **16 moods** — from `grind` and `lock_in` to `wind_down` and `in_my_feels`. Each maps to real genre keywords that search live playlists.
- **Persistent session** — mood and seen-tracks state survive server restarts. Your grind session doesn't reset because you closed a tab.
- **Smart queue** — never runs out, never repeats. Pulls from your top tracks, artist catalogs, and mood-matched playlists.
- **Full Spotify control** — search, playlists, queue, volume, liked songs, top artists, everything. Natural language, no UI switching.
- **No deprecated APIs** — rebuilt after Spotify killed `/recommendations` in Nov 2024.

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

Restart Claude Code.

---

## Configure your setup

Copy the example file and edit it:

```bash
cp spotify-prefs.example.json .spotify-prefs.json
```

```json
{
  "startup_song": null,
  "startup_mood": "grind",
  "mood_overrides": {
    "grind": {
      "keywords": ["dark techno focus", "coding beats instrumental"]
    }
  },
  "custom_moods": {
    "deep_house": {
      "energy": "medium",
      "keywords": ["deep house focus work", "minimal tech house instrumental"],
      "triggers": ["deep house", "house vibes"]
    }
  },
  "blacklist_artists": ["Artist Name Here"],
  "blacklist_tracks": []
}
```

| Field | What it does | Default |
|---|---|---|
| `startup_song` | Track URI played every time the server starts. Set to `null` to disable. | `null` |
| `startup_mood` | Mood applied on boot | `grind` |
| `mood_overrides` | Override playlist search keywords for any built-in mood | `{}` |
| `custom_moods` | Add entirely new moods with custom keywords and auto-detection triggers | `{}` |
| `blacklist_artists` | These artists never get queued (substring match) | `[]` |
| `blacklist_tracks` | These track IDs never get queued | `[]` |

Changes take effect on next MCP reconnect.

You can also manage everything by talking to Claude:
- *"add a custom mood called lo-fi rap with chill trap beats"*
- *"blacklist [artist name]"*
- *"set my startup mood to focus"*
- *"turn off the startup song"*

You can also update config by telling Claude:
- *"blacklist [artist name]"*
- *"set my startup mood to focus"*
- *"change my startup song to [song]"*
- *"turn off the startup song"*

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
| `workout` | max | phonk, hard trap, drill |
| `confident` | high | power rap, walk like a badass energy |
| `creative` | medium | Jon Hopkins, film scores, flow state ambient |
| `chill` | low | coffeehouse jazz, chillhop, peaceful piano |
| `relax` | low | Nils Frahm, Ólafur Arnalds, soft ambient |
| `wind_down` | min | ambient, soft piano |
| `background` | min | classical, quiet instrumental, cafe ambient |
| `night_drive` | medium | darksynth, cyberpunk, chillsynth |
| `in_my_feels` | low | emotional R&B, indie |
| `sad` | low | sad indie, heartbreak |
| `angry` | max | metal, hard rap, drill |

---

## Auto-detection setup (recommended)

Add this to `~/.claude/CLAUDE.md` so Claude reads your session and sets the vibe automatically — no prompting needed:

```markdown
# Spotify — Auto Vibe
- At the start of every session, call `detect_vibe` with rich context: what project is open, what files are being worked on, what the user just said, what task is happening (debugging, building, shipping, reviewing, on a call), the user's apparent energy (frustrated, focused, hyped, tired, casual), and the current time.
- When the task or energy shifts significantly (debugging → shipped, coding → call, grinding → winding down), call `detect_vibe` again.
- Never ask permission to set the mood — read the context and do it.

# Spotify — DJ Thinking
- When the user describes a scene, energy, or vibe, think like a DJ: which specific artists or tracks fit that energy? Search by name, not by vague phrases.
- "Afterlife / Ibiza energy" → Anyma, Tale Of Us, Massano. "dark techno" → Blawan, Surgeon. "hype" → Travis Scott, Don Toliver. "late night synthwave" → Perturbator, Carpenter Brut.
- When the user names a specific venue or scene ("DJ at a college bar", "headlining Ushuaïa", "rooftop Brooklyn"), step into that perspective. You know the crowd, the time, the energy. Just pick the music and play it.
- Use `search` with artist/track names → `play`. Don't ask for clarification.
```

Or just tell Claude: *"follow the spotify-mcp instructions from the README"* — it'll figure it out.

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

**"No active device found"** — The Spotify API requires a track to have been played on the device recently. Open Spotify, press play on anything for a second, then pause it. That wakes the device up. After that Claude can take over.

**"No tokens found"** — Run `node auth-setup.js` to re-authenticate.

**Music not switching on vibe change** — Make sure Spotify is open and has been played on recently (see above).

**Want to reset the vibe** — Tell Claude `"clear session"` to wipe seen tracks and start discovery fresh.

---

## License

MIT
