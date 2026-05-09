# spotify-mcp outreach kit

## Core angle

Most Spotify MCPs are remote controls. This one turns Claude Code into a session-aware music layer.

Claude can read the current work context, infer the vibe, switch Spotify, and keep the queue alive without manual UI switching.

## One-liners

- Spotify MCP for Claude Code that reads your coding session and sets the music automatically.
- A session-aware Spotify MCP: debugging, deep work, shipping, winding down -> the right music without touching Spotify.
- Claude Code as a music layer for your work session, not just pause/skip controls.

## Short public post

```text
I open-sourced a Spotify MCP for Claude Code.

Most Spotify MCPs are remote controls. This one reads your session and sets the mood automatically.

Debugging? lock_in.
Deep work? focus.
Just shipped? hype.
Wrapping up? wind_down.

It also handles queue refill, no-repeat session state, playlists, liked songs, top tracks/artists, devices, volume, and normal playback control.

Tested in Claude Code terminal. App behavior untested.

https://github.com/kaceburnette/spotify-mcp
```

## Builder DM

```text
hey - made this and thought you might appreciate it.

It's a Spotify MCP for Claude Code, but the part that surprised me is the session-aware vibe detection. Claude can look at what I'm doing, infer "debugging", "deep work", "just shipped", etc., then switch the music and keep the queue alive.

I've built a lot of random tools, but this one actually feels different in use.

https://github.com/kaceburnette/spotify-mcp
```

## Directory maintainer DM

```text
hey - saw you maintain an MCP directory/list.

I open-sourced spotify-mcp: a Claude Code-focused Spotify MCP with session-aware vibe detection, persistent mood state, smart queue refill, playlist management, liked songs, top artists/tracks, device transfer, volume, and playback tools.

The main difference from basic Spotify remote-control MCPs is that Claude can read the current work session and automatically set the music for debugging, deep work, shipping, winding down, etc.

Repo: https://github.com/kaceburnette/spotify-mcp

Worth adding?
```

## Reddit / community post

```text
I built a Spotify MCP for Claude Code that is more than playback controls.

The useful bit: Claude can read the session context and call detect_vibe automatically. If I'm debugging, it can switch into lock_in. If I'm doing deep work, focus. If I just shipped, hype. If I'm wrapping up, wind_down.

It keeps mood/session state across restarts, avoids repeating tracks, refills the queue from top tracks, artist catalogs, and mood-matched playlists, and still exposes the normal Spotify tools: search, play/pause, queue, playlists, saved tracks, top artists/tracks, devices, volume, etc.

Built for Claude Code. Tested in the terminal. I have not verified app behavior yet.

Repo: https://github.com/kaceburnette/spotify-mcp
```

## Target list

### Submit / PR targets

- appcypher/awesome-mcp-servers
  - Section: Social Media
  - Suggested row:
    `- <img src="https://cdn.simpleicons.org/spotify/1DB954" height="14"/> [Spotify MCP](https://github.com/kaceburnette/spotify-mcp) - Claude Code-focused Spotify MCP with session-aware vibe detection, smart queue refill, playlist management, and full playback control.`

- abordage/awesome-mcp
  - Section: Media Processing -> Audio & Music, or Social Media if they classify Spotify there.
  - Suggested row:
    `- [kaceburnette/spotify-mcp](https://github.com/kaceburnette/spotify-mcp) - Session-aware Spotify MCP for Claude Code with mood detection, smart queue refill, playlists, saved tracks, and playback control.`

- subinium/awesome-claude-code
  - Section: MCP Ecosystem
  - Suggested row:
    `| [kaceburnette/spotify-mcp](https://github.com/kaceburnette/spotify-mcp) | ![](https://img.shields.io/github/stars/kaceburnette/spotify-mcp?style=flat-square&logo=github) | Session-aware Spotify MCP for Claude Code that detects work vibe and manages playback, queue, playlists, and devices |`

### Web form targets

- https://mcpdrop.com/
- https://www.mcpserverspot.com/submit
- https://mcpserve.com/submit
- https://mcp.directory/
- https://www.topmcplist.com/
- https://skiln.co/browse

### Community targets

- r/mcp
- r/ClaudeCode
- r/ClaudeAI
- Threads/X posts from builders showing MCP servers, Claude Code workflows, or dev-environment setups

## Demo clip script

Record 30-45 seconds.

1. Start in Claude Code inside a real project.
2. Prompt:
   `detect the current vibe and set Spotify for this session`
3. Show Claude calling `detect_vibe`.
4. Show Spotify switching music.
5. Prompt:
   `I just shipped this, switch the vibe`
6. Show it move to hype / confident and refill queue.

Caption:

```text
Claude Code reading the session and controlling Spotify through MCP.

Not just pause/skip - it detects the work vibe and keeps the queue alive.
```

## Repo metadata recommendation

Current GitHub description undersells the project. Recommended replacement:

```text
Session-aware Spotify MCP for Claude Code: auto vibe detection, smart queue refill, playlists, liked songs, devices, and full playback control.
```

Recommended topics:

```text
spotify,mcp,claude-code,model-context-protocol,ai,music,productivity,developer-tools
```
