#!/usr/bin/env node

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const fs = require('fs');
const path = require('path');

const TOKEN_PATH  = path.join(__dirname, '.spotify-tokens.json');
const CONFIG_PATH = path.join(__dirname, '.spotify-config.json');
const STATE_PATH  = path.join(__dirname, '.spotify-state.json');
const PREFS_PATH  = path.join(__dirname, '.spotify-prefs.json');

// --- Config + Token Management ---

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) throw new Error('Missing .spotify-config.json — run: node auth-setup.js');
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function loadTokens() {
  if (!fs.existsSync(TOKEN_PATH)) throw new Error('No tokens found — run: node auth-setup.js');
  return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
}

function saveTokens(t) { fs.writeFileSync(TOKEN_PATH, JSON.stringify(t, null, 2)); }

const config = loadConfig();
let _token = { accessToken: null, refreshToken: null, expiresAt: 0 };

async function ensureToken() {
  const saved = loadTokens();
  _token.refreshToken = saved.refreshToken;
  _token.accessToken  = saved.accessToken;
  _token.expiresAt    = saved.expiresAt;

  if (Date.now() > _token.expiresAt - 300_000) {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64'),
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: _token.refreshToken }),
    });
    const data = await res.json();
    if (!data.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(data));
    _token.accessToken = data.access_token;
    _token.expiresAt   = Date.now() + data.expires_in * 1000;
    if (data.refresh_token) _token.refreshToken = data.refresh_token;
    saveTokens({ accessToken: _token.accessToken, refreshToken: _token.refreshToken, expiresAt: _token.expiresAt });
  }
}

async function spotifyFetch(endpoint, { method = 'GET', body, query } = {}) {
  await ensureToken();
  let url = `https://api.spotify.com/v1${endpoint}`;
  if (query) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v != null) p.set(k, v);
    url += '?' + p.toString();
  }
  const opts = {
    method,
    headers: { Authorization: `Bearer ${_token.accessToken}`, 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  let res = await fetch(url, opts);
  if (res.status === 401) {
    _token.expiresAt = 0;
    await ensureToken();
    opts.headers.Authorization = `Bearer ${_token.accessToken}`;
    res = await fetch(url, opts);
  }
  if (res.status === 204 || res.status === 202) return null;
  if (!res.ok) { const msg = await res.text().catch(() => ''); throw new Error(`Spotify ${res.status}: ${msg}`); }
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// --- User Prefs ---
// .spotify-prefs.json is user-editable and sharable. Copy spotify-prefs.example.json to get started.

const DEFAULT_PREFS = {
  startup_mood: 'grind',
  startup_song: 'spotify:track:08mG3Y1vljYA6bvDt4Wqkj', // Back in Black — AC/DC. Override in .spotify-prefs.json
  mood_overrides: {},       // override keywords for any mood: { "grind": { "keywords": [...] } }
  blacklist_artists: [],    // artist names to never queue (case-insensitive substring match)
  blacklist_tracks: [],     // track IDs to never queue
};

function loadPrefs() {
  if (!fs.existsSync(PREFS_PATH)) return { ...DEFAULT_PREFS };
  try { return { ...DEFAULT_PREFS, ...JSON.parse(fs.readFileSync(PREFS_PATH, 'utf8')) }; }
  catch { return { ...DEFAULT_PREFS }; }
}

function savePrefs() { fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2)); }

const prefs = loadPrefs();

function isBlacklisted(t) {
  if (!t?.id) return true;
  if (prefs.blacklist_tracks?.includes(t.id)) return true;
  if (prefs.blacklist_artists?.length && t.artists?.some(a =>
    prefs.blacklist_artists.some(b => a.name.toLowerCase().includes(b.toLowerCase()))
  )) return true;
  return false;
}

// --- Mood Engine ---

const MOOD_PROFILES = {
  grind:       { energy: 'high',   keywords: ['dark electronic focus coding', 'deep work techno instrumental', 'coding electronic beats'] },
  focus:       { energy: 'medium', keywords: ['deep focus study concentration', 'lo-fi study beats', 'ambient focus instrumental'] },
  lock_in:     { energy: 'high',   keywords: ['techno focus dark intense', 'drum and bass focus work', 'industrial electronic grind'] },
  hype:        { energy: 'high',   keywords: ['hip hop hype energy 2024', 'trap bangers rap', 'high energy rap playlist'] },
  workout:     { energy: 'max',    keywords: ['gym workout motivation intense', 'hip hop gym playlist', 'edm workout hard'] },
  pump_up:     { energy: 'high',   keywords: ['pump up power motivation music', 'motivational hip hop rap', 'power workout playlist'] },
  chill:       { energy: 'low',    keywords: ['chill vibes r&b soul', 'smooth chill laid back', 'chill hip hop vibes'] },
  relax:       { energy: 'low',    keywords: ['relax calm peaceful instrumental', 'soft acoustic relax', 'mellow chill out'] },
  wind_down:   { energy: 'min',    keywords: ['sleep ambient calm wind down', 'peaceful instrumental sleep', 'soft piano calm'] },
  sad:         { energy: 'low',    keywords: ['sad indie emotional songs', 'heartbreak sad playlist', 'melancholy emotional music'] },
  in_my_feels: { energy: 'low',    keywords: ['r&b emotional feelings soul', 'indie emotional vibes', 'deep feelings r&b'] },
  angry:       { energy: 'max',    keywords: ['metal intense aggressive hard', 'hard rock angry heavy', 'punk heavy aggressive'] },
  night_drive: { energy: 'medium', keywords: ['synthwave night drive retro', 'night drive dark music', 'late night driving music'] },
  creative:    { energy: 'medium', keywords: ['creative flow jazz instrumental', 'indie creative vibes', 'alternative creative work'] },
  background:  { energy: 'min',    keywords: ['background ambient instrumental quiet', 'classical background study', 'piano background work cafe'] },
  confident:   { energy: 'high',   keywords: ['confident boss hip hop energy', 'power moves r&b rap', 'rap confidence swagger'] },
};

// Apply user overrides from prefs
for (const [mood, overrides] of Object.entries(prefs.mood_overrides || {})) {
  if (MOOD_PROFILES[mood]) Object.assign(MOOD_PROFILES[mood], overrides);
}

// --- Persistent State ---

const DEFAULT_STATE = { mood: null, moodSetAt: null, seedTrackIds: [], seedArtistIds: [], seenTrackIds: [], tracksQueued: 0 };

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { ...DEFAULT_STATE };
  try { return { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) }; }
  catch { return { ...DEFAULT_STATE }; }
}

const state = loadState();
state.seenTrackIds = new Set(state.seenTrackIds);

// Apply startup_mood from prefs if set and no mood is currently active
if (prefs.startup_mood && MOOD_PROFILES[prefs.startup_mood] && !state.mood) {
  state.mood = prefs.startup_mood;
  state.moodSetAt = new Date().toISOString();
}

function saveState() {
  fs.writeFileSync(STATE_PATH, JSON.stringify({
    mood: state.mood, moodSetAt: state.moodSetAt,
    seedTrackIds: state.seedTrackIds.slice(-20), seedArtistIds: state.seedArtistIds.slice(-20),
    seenTrackIds: [...state.seenTrackIds].slice(-500), tracksQueued: state.tracksQueued,
  }, null, 2));
}

// --- Discovery Engine ---
// No /recommendations (deprecated Nov 2024). Three sources:
// 1. Personal top tracks — what you actually listen to
// 2. Top artist catalogs — breadth from known taste
// 3. Mood-keyed playlist search — genuine discovery of new material

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function updateSeeds(tracks) {
  for (const t of tracks) {
    if (!t?.id) continue;
    if (!state.seedTrackIds.includes(t.id)) state.seedTrackIds.push(t.id);
    const aid = t.artists?.[0]?.id;
    if (aid && !state.seedArtistIds.includes(aid)) state.seedArtistIds.push(aid);
    state.seenTrackIds.add(t.id);
  }
  if (state.seedTrackIds.length > 20) state.seedTrackIds = state.seedTrackIds.slice(-20);
  if (state.seedArtistIds.length > 20) state.seedArtistIds = state.seedArtistIds.slice(-20);
  saveState();
}

async function discoverTracks(count = 15) {
  const candidates = new Map();

  const add = (tracks) => {
    for (const t of (tracks ?? [])) {
      if (t?.id && !state.seenTrackIds.has(t.id) && !candidates.has(t.id) && !isBlacklisted(t)) {
        candidates.set(t.id, t);
      }
    }
  };

  // Source 1: personal top tracks
  await Promise.allSettled([
    spotifyFetch('/me/top/tracks', { query: { time_range: 'short_term',  limit: 50 } }).then(r => add(r?.items)),
    spotifyFetch('/me/top/tracks', { query: { time_range: 'medium_term', limit: 50 } }).then(r => add(r?.items)),
  ]);

  // Source 2: top artist catalogs
  try {
    const r = await spotifyFetch('/me/top/artists', { query: { time_range: 'short_term', limit: 15 } });
    if (r?.items?.length) {
      await Promise.allSettled(
        shuffle([...r.items]).slice(0, 3).map(a =>
          spotifyFetch(`/artists/${a.id}/top-tracks`, { query: { market: 'US' } }).then(r => add(r?.tracks))
        )
      );
    }
  } catch (_) {}

  // Source 3: mood-keyed playlist search
  if (state.mood && MOOD_PROFILES[state.mood]) {
    const kws = shuffle([...MOOD_PROFILES[state.mood].keywords]).slice(0, 2);
    await Promise.allSettled(kws.map(async (kw) => {
      try {
        const sr = await spotifyFetch('/search', { query: { q: kw, type: 'playlist', limit: 5 } });
        const playlists = (sr?.playlists?.items ?? []).filter(p => p?.id);
        if (!playlists.length) return;
        const pl    = playlists[Math.floor(Math.random() * playlists.length)];
        const total = pl.tracks?.total ?? 100;
        const offset = Math.max(0, Math.floor(Math.random() * Math.max(1, total - 25)));
        const pr = await spotifyFetch(`/playlists/${pl.id}/tracks`, { query: { limit: 25, offset } });
        add((pr?.items ?? []).map(i => i?.track).filter(t => t?.id));
      } catch (_) {}
    }));
  }

  return shuffle([...candidates.values()]).slice(0, count);
}

// --- Queue Manager ---

const MIN_QUEUE_DEPTH   = 5;
const QUEUE_REFILL_COUNT = 15;

async function ensureQueueDepth() {
  try {
    const data  = await spotifyFetch('/me/player/queue');
    const depth = (data?.queue ?? []).length;
    if (depth >= MIN_QUEUE_DEPTH) return { refilled: false, depth };

    const tracks = await discoverTracks(QUEUE_REFILL_COUNT);
    let added = 0;
    for (const t of tracks) {
      try {
        await spotifyFetch('/me/player/queue', { method: 'POST', query: { uri: t.uri } });
        added++;
        state.tracksQueued++;
        updateSeeds([t]);
      } catch (_) {}
    }
    saveState();
    return { refilled: true, added, depth: depth + added };
  } catch (err) {
    return { refilled: false, error: err.message };
  }
}

// --- Vibe Detection ---
// Keyword scoring map for detect_vibe. Claude passes session context as text;
// this maps it to a mood using keyword frequency + time-of-day signals.

const VIBE_KEYWORDS = {
  lock_in:     ['debug', 'bug', 'prod', 'urgent', 'deadline', 'incident', 'down', 'broken', 'hotfix', 'outage'],
  grind:       ['code', 'coding', 'build', 'implement', 'feature', 'commit', 'refactor', 'sprint', 'pr', 'push', 'ship', 'shipping'],
  focus:       ['focus', 'deep focus', 'deep work', 'concentration', 'concentrate', 'zero distraction', 'instrumental', 'no lyrics', 'study', 'review', 'read', 'document', 'write', 'plan', 'think', 'research', 'draft', 'locked in'],
  hype:        ['shipped', 'merged', 'launched', 'released', 'done', 'finished', 'deployed', 'just pushed', 'celebrate'],
  confident:   ['meeting', 'demo', 'pitch', 'presentation', 'client', 'sales', 'investor', 'ceo', 'boss'],
  creative:    ['design', 'brainstorm', 'idea', 'concept', 'wireframe', 'figma', 'sketch', 'creative'],
  chill:       ['slow', 'easy', 'casual', 'friday', 'weekend', 'break', 'lunch', 'coffee'],
  night_drive: ['night', 'late', 'midnight', 'dark', '11pm', '12am', '1am', '2am', '3am'],
  wind_down:   ['tired', 'exhausted', 'wrapping up', 'calling it', 'done for the day', 'winding down'],
  background:  ['call', 'zoom', 'meeting', 'talking', 'phone', 'on a call'],
  workout:     ['gym', 'workout', 'run', 'lift', 'training', 'exercise'],
};

// Explicit mood name mentions get a big score boost — "I want focus vibes" → focus wins
const EXPLICIT_MOOD_TRIGGERS = {
  focus:       ['focus vibe', 'focus mode', 'deep focus', 'deep work', 'focus work', 'code focus', 'concentration'],
  grind:       ['grind vibe', 'grind mode', 'grind session', 'grind time'],
  lock_in:     ['lock in', 'lock-in', 'locked in vibe', 'tunnel vision'],
  hype:        ['hype vibe', 'hype mode', 'hype me up', 'energy vibe'],
  chill:       ['chill vibe', 'chill mode', 'chill out', 'laid back'],
  confident:   ['ceo vibe', 'boss vibe', 'confident vibe', 'power vibe'],
  night_drive: ['night drive', 'night vibe', 'late night vibe'],
  workout:     ['workout vibe', 'gym vibe', 'pump up vibe'],
  creative:    ['creative vibe', 'creative mode', 'creative flow'],
};

function detectMood(context) {
  const ctx  = context.toLowerCase();
  const hour = new Date().getHours();
  const scores = Object.fromEntries(Object.keys(VIBE_KEYWORDS).map(m => [m, 0]));

  for (const [mood, kws] of Object.entries(VIBE_KEYWORDS)) {
    scores[mood] = kws.filter(kw => ctx.includes(kw)).length;
  }

  // Explicit trigger phrases score +5 (override everything)
  for (const [mood, triggers] of Object.entries(EXPLICIT_MOOD_TRIGGERS)) {
    if (triggers.some(t => ctx.includes(t))) scores[mood] = (scores[mood] || 0) + 5;
  }

  // Time-of-day boosts
  if (hour >= 22 || hour < 5)  { scores.night_drive += 2; scores.lock_in  += 1; }
  if (hour >= 5  && hour < 10) { scores.grind       += 1; scores.confident += 1; }
  if (hour >= 14 && hour < 17) { scores.chill       += 1; }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return { recommended: sorted[0]?.[0] || 'grind', scores: Object.fromEntries(sorted.filter(([, v]) => v > 0)) };
}

// --- Formatters ---

const fmtMs = ms => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

function fmtTrack(t) {
  if (!t) return null;
  return { name: t.name, artist: t.artists?.map(a => a.name).join(', '), album: t.album?.name, duration: fmtMs(t.duration_ms), uri: t.uri, url: t.external_urls?.spotify, id: t.id };
}

function fmtPlayback(s) {
  if (!s?.item) return { playing: false, message: 'Nothing currently playing' };
  return {
    playing: s.is_playing,
    track:   fmtTrack(s.item),
    device:  s.device ? { name: s.device.name, type: s.device.type, volume: s.device.volume_percent } : null,
    shuffle: s.shuffle_state,
    repeat:  s.repeat_state,
    progress: fmtMs(s.progress_ms),
    mood:    state.mood ?? 'none',
  };
}

// --- MCP Server ---

const server = new McpServer({ name: 'spotify', version: '3.1.0' });

// ── Mood ─────────────────────────────────────────────────────────────────────

server.tool('set_mood',
  'Set the listening mood. Call this based on session context — what the user is doing, their energy, what they said. Mood persists across restarts. Available: grind, focus, lock_in, hype, workout, pump_up, chill, relax, wind_down, sad, in_my_feels, angry, night_drive, creative, background, confident.',
  { mood: z.enum(Object.keys(MOOD_PROFILES)).describe('Mood label') },
  async ({ mood }) => {
    state.mood = mood; state.moodSetAt = new Date().toISOString(); state.tracksQueued = 0;
    saveState();
    setImmediate(() => ensureQueueDepth().catch(() => {}));
    return { content: [{ type: 'text', text: JSON.stringify({ mood, energy: MOOD_PROFILES[mood].energy, keywords: MOOD_PROFILES[mood].keywords, setAt: state.moodSetAt }, null, 2) }] };
  }
);

server.tool('get_mood', 'Get current mood state and queue depth.', {}, async () => {
  let queueDepth = 0;
  try { queueDepth = ((await spotifyFetch('/me/player/queue'))?.queue ?? []).length; } catch (_) {}
  return { content: [{ type: 'text', text: JSON.stringify({ mood: state.mood ?? 'none', energy: state.mood ? MOOD_PROFILES[state.mood]?.energy : null, setAt: state.moodSetAt, tracksQueued: state.tracksQueued, queueDepth, seenTracks: state.seenTrackIds.size }, null, 2) }] };
});

server.tool('detect_vibe',
  'Analyze session context, set the mood, and start playing matching music. Call this at session start and whenever the vibe shifts. Always auto-applies and plays — no need to call set_mood or play separately.',
  {
    context:    z.string().describe('Description of current session: task, energy, time, what user said'),
    auto_apply: z.boolean().default(true).describe('Automatically apply mood and start playing (default true)'),
  },
  async ({ context, auto_apply }) => {
    const { recommended, scores } = detectMood(context);
    const previousMood = state.mood;

    if (auto_apply) {
      state.mood = recommended; state.moodSetAt = new Date().toISOString(); state.tracksQueued = 0;
      saveState();

      // Check if anything is currently playing
      let isPlaying = false;
      try {
        const current = await spotifyFetch('/me/player');
        isPlaying = current?.is_playing === true;
      } catch (_) {}

      // Always play when detect_vibe is called explicitly — user wants a vibe switch
      if (true || !isPlaying || previousMood !== recommended) {
        try {
          const profile  = MOOD_PROFILES[recommended];
          const keyword  = profile.keywords[Math.floor(Math.random() * profile.keywords.length)];
          const sr       = await spotifyFetch('/search', { query: { q: keyword, type: 'playlist', limit: 8 } });
          const lists    = (sr?.playlists?.items ?? []).filter(p => p?.uri);
          if (lists.length) {
            const pick = lists[Math.floor(Math.random() * Math.min(lists.length, 4))];
            await spotifyFetch('/me/player/play', { method: 'PUT', body: { context_uri: pick.uri } });
            await new Promise(r => setTimeout(r, 800));
            await spotifyFetch('/me/player/shuffle', { method: 'PUT', query: { state: true } }).catch(() => {});
            setImmediate(() => ensureQueueDepth().catch(() => {}));
            const current = await spotifyFetch('/me/player');
            return { content: [{ type: 'text', text: JSON.stringify({ recommended_mood: recommended, auto_applied: true, energy: MOOD_PROFILES[recommended]?.energy, now_playing: current?.item ? { name: current.item.name, artist: current.item.artists?.map(a => a.name).join(', ') } : null, playlist: pick.name, scores }, null, 2) }] };
          }
        } catch (_) {}
      }

      setImmediate(() => ensureQueueDepth().catch(() => {}));
    }

    return { content: [{ type: 'text', text: JSON.stringify({ recommended_mood: recommended, auto_applied: auto_apply, energy: MOOD_PROFILES[recommended]?.energy, scores, context_received: context }, null, 2) }] };
  }
);

server.tool('clear_session', 'Reset seen tracks and session state. Use when starting a fresh listen.', {}, async () => {
  state.seenTrackIds = new Set(); state.seedTrackIds = []; state.seedArtistIds = []; state.tracksQueued = 0;
  saveState();
  return { content: [{ type: 'text', text: 'Session cleared.' }] };
});

// ── Prefs ─────────────────────────────────────────────────────────────────────

server.tool('get_prefs', 'Get current user preferences from .spotify-prefs.json.', {}, async () => {
  return { content: [{ type: 'text', text: JSON.stringify(prefs, null, 2) }] };
});

server.tool('update_prefs',
  'Update user preferences. Saves to .spotify-prefs.json so they persist and can be shared.',
  {
    startup_mood:           z.string().optional().describe('Mood to apply when server starts (mood name or empty string to clear)'),
    startup_song:           z.string().optional().describe('Spotify track URI to play at startup'),
    add_blacklist_artist:   z.string().optional().describe('Artist name to never queue'),
    remove_blacklist_artist:z.string().optional().describe('Artist name to remove from blacklist'),
    add_blacklist_track:    z.string().optional().describe('Track ID to never queue'),
    remove_blacklist_track: z.string().optional().describe('Track ID to remove from blacklist'),
  },
  async ({ startup_mood, startup_song, add_blacklist_artist, remove_blacklist_artist, add_blacklist_track, remove_blacklist_track }) => {
    if (startup_mood !== undefined) prefs.startup_mood = MOOD_PROFILES[startup_mood] ? startup_mood : null;
    if (startup_song !== undefined) prefs.startup_song = startup_song || null;
    if (add_blacklist_artist)    prefs.blacklist_artists = [...new Set([...(prefs.blacklist_artists ?? []), add_blacklist_artist])];
    if (remove_blacklist_artist) prefs.blacklist_artists = (prefs.blacklist_artists ?? []).filter(a => a !== remove_blacklist_artist);
    if (add_blacklist_track)     prefs.blacklist_tracks  = [...new Set([...(prefs.blacklist_tracks  ?? []), add_blacklist_track])];
    if (remove_blacklist_track)  prefs.blacklist_tracks  = (prefs.blacklist_tracks  ?? []).filter(t => t !== remove_blacklist_track);
    savePrefs();
    return { content: [{ type: 'text', text: JSON.stringify(prefs, null, 2) }] };
  }
);

// ── Playback ──────────────────────────────────────────────────────────────────

server.tool('get_current_track', 'Get currently playing track and playback state.', {}, async () => {
  const data = await spotifyFetch('/me/player');
  return { content: [{ type: 'text', text: JSON.stringify(fmtPlayback(data), null, 2) }] };
});

server.tool('play',
  'Resume playback or play a specific URI. Auto-fills the queue with mood-matched tracks.',
  { uri: z.string().optional().describe('Spotify URI (track, album, playlist). Omit to resume.'), device_id: z.string().optional() },
  async ({ uri, device_id }) => {
    const body = {}; const query = device_id ? { device_id } : {};
    if (uri) { if (uri.includes(':track:')) body.uris = [uri]; else body.context_uri = uri; }
    await spotifyFetch('/me/player/play', { method: 'PUT', body: Object.keys(body).length ? body : undefined, query });
    if (uri) {
      await new Promise(r => setTimeout(r, 1000));
      if (!uri.includes(':track:')) {
        await spotifyFetch('/me/player/shuffle', { method: 'PUT', query: { state: true } }).catch(() => {});
      }
    }
    let seedId = uri?.includes(':track:') ? uri.split(':').pop() : null;
    if (!seedId) {
      try {
        await new Promise(r => setTimeout(r, 500));
        const curr = await spotifyFetch('/me/player');
        if (curr?.item) { seedId = curr.item.id; updateSeeds([curr.item]); }
      } catch (_) {}
    }
    const qr = await ensureQueueDepth();
    return { content: [{ type: 'text', text: (uri ? `Playing: ${uri}` : 'Resumed') + (qr.refilled ? ` (+${qr.added} tracks queued)` : '') }] };
  }
);

server.tool('pause', 'Pause playback.', {}, async () => {
  await spotifyFetch('/me/player/pause', { method: 'PUT' });
  return { content: [{ type: 'text', text: 'Paused' }] };
});

server.tool('next_track', 'Skip to next track. Auto-refills queue if running low.', {}, async () => {
  const before = await spotifyFetch('/me/player');
  const beforeId = before?.item?.id;
  await spotifyFetch('/me/player/next', { method: 'POST' });
  let result;
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 600));
    result = await spotifyFetch('/me/player');
    if (result?.item?.id && result.item.id !== beforeId) break;
  }
  if (result?.item) updateSeeds([result.item]);
  const qr  = await ensureQueueDepth();
  const out = fmtPlayback(result);
  if (qr.refilled) out.queue_refilled = qr.added;
  return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
});

server.tool('previous_track', 'Go to previous track.', {}, async () => {
  const before = await spotifyFetch('/me/player');
  const beforeId = before?.item?.id;
  await spotifyFetch('/me/player/previous', { method: 'POST' });
  let result;
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 600));
    result = await spotifyFetch('/me/player');
    if (result?.item?.id && result.item.id !== beforeId) break;
  }
  if (result?.item) updateSeeds([result.item]);
  return { content: [{ type: 'text', text: JSON.stringify(fmtPlayback(result), null, 2) }] };
});

server.tool('set_volume',   'Set volume 0-100.',        { volume: z.number().min(0).max(100) }, async ({ volume }) => { await spotifyFetch('/me/player/volume',  { method: 'PUT', query: { volume_percent: volume } }); return { content: [{ type: 'text', text: `Volume: ${volume}%` }] }; });
server.tool('toggle_shuffle','Enable or disable shuffle.',{ enabled: z.boolean() },             async ({ enabled }) => { await spotifyFetch('/me/player/shuffle', { method: 'PUT', query: { state: enabled } });         return { content: [{ type: 'text', text: `Shuffle: ${enabled ? 'on' : 'off'}` }] }; });
server.tool('set_repeat',   'Set repeat mode.',          { mode: z.enum(['off', 'track', 'context']) }, async ({ mode }) => { await spotifyFetch('/me/player/repeat', { method: 'PUT', query: { state: mode } }); return { content: [{ type: 'text', text: `Repeat: ${mode}` }] }; });
server.tool('seek',         'Seek to position in seconds.',{ position_seconds: z.number().min(0) }, async ({ position_seconds }) => { await spotifyFetch('/me/player/seek', { method: 'PUT', query: { position_ms: Math.round(position_seconds * 1000) } }); return { content: [{ type: 'text', text: `Seeked to ${fmtMs(position_seconds * 1000)}` }] }; });
server.tool('add_to_queue', 'Add a track URI to the queue.', { uri: z.string() }, async ({ uri }) => { await spotifyFetch('/me/player/queue', { method: 'POST', query: { uri } }); return { content: [{ type: 'text', text: `Queued: ${uri}` }] }; });

server.tool('get_queue', 'Get the current playback queue.', {}, async () => {
  const data = await spotifyFetch('/me/player/queue');
  return { content: [{ type: 'text', text: JSON.stringify({ currently_playing: fmtTrack(data?.currently_playing), queue: (data?.queue ?? []).slice(0, 20).map(fmtTrack) }, null, 2) }] };
});

server.tool('get_devices', 'List available playback devices.', {}, async () => {
  const data = await spotifyFetch('/me/player/devices');
  return { content: [{ type: 'text', text: JSON.stringify((data?.devices ?? []).map(d => ({ id: d.id, name: d.name, type: d.type, active: d.is_active, volume: d.volume_percent })), null, 2) }] };
});

server.tool('transfer_playback', 'Transfer playback to a device.', { device_id: z.string() }, async ({ device_id }) => {
  await spotifyFetch('/me/player', { method: 'PUT', body: { device_ids: [device_id] } });
  return { content: [{ type: 'text', text: `Transferred to ${device_id}` }] };
});

// ── Search + Library ──────────────────────────────────────────────────────────

server.tool('search', 'Search tracks, artists, albums, or playlists.', {
  query: z.string(), type: z.enum(['track', 'artist', 'album', 'playlist']).default('track'), limit: z.number().min(1).max(20).default(10),
}, async ({ query, type, limit }) => {
  const data = await spotifyFetch('/search', { query: { q: query, type, limit } });
  let items = [];
  if (type === 'track')    items = (data?.tracks?.items    ?? []).map(fmtTrack);
  else if (type === 'artist')   items = (data?.artists?.items  ?? []).map(a => ({ name: a.name, genres: a.genres, followers: a.followers?.total, popularity: a.popularity, uri: a.uri }));
  else if (type === 'album')    items = (data?.albums?.items   ?? []).map(a => ({ name: a.name, artist: a.artists?.map(ar => ar.name).join(', '), release_date: a.release_date, total_tracks: a.total_tracks, uri: a.uri }));
  else if (type === 'playlist') items = (data?.playlists?.items ?? []).filter(p => p).map(p => ({ name: p.name, owner: p.owner?.display_name, tracks: p.tracks?.total, uri: p.uri }));
  return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
});

server.tool('get_playlists', 'Get your playlists.', { limit: z.number().min(1).max(50).default(20) }, async ({ limit }) => {
  const data = await spotifyFetch('/me/playlists', { query: { limit } });
  return { content: [{ type: 'text', text: JSON.stringify((data?.items ?? []).map(p => ({ name: p.name, tracks: p.tracks?.total, owner: p.owner?.display_name, uri: p.uri, url: p.external_urls?.spotify })), null, 2) }] };
});

server.tool('get_playlist_tracks', 'Get tracks in a playlist.', { playlist_id: z.string(), limit: z.number().min(1).max(50).default(30) }, async ({ playlist_id, limit }) => {
  const id = playlist_id.includes(':') ? playlist_id.split(':').pop() : playlist_id;
  const data = await spotifyFetch(`/playlists/${id}/tracks`, { query: { limit } });
  return { content: [{ type: 'text', text: JSON.stringify((data?.items ?? []).filter(i => i?.track).map(i => ({ ...fmtTrack(i.track), added_at: i.added_at })), null, 2) }] };
});

server.tool('create_playlist', 'Create a new playlist.', { name: z.string(), description: z.string().optional(), public: z.boolean().default(false) }, async ({ name, description, public: pub }) => {
  const me   = await spotifyFetch('/me');
  const data = await spotifyFetch(`/users/${me.id}/playlists`, { method: 'POST', body: { name, description: description ?? '', public: pub } });
  return { content: [{ type: 'text', text: JSON.stringify({ name: data.name, uri: data.uri, url: data.external_urls?.spotify }, null, 2) }] };
});

server.tool('add_to_playlist', 'Add track URIs to a playlist.', { playlist_id: z.string(), uris: z.array(z.string()) }, async ({ playlist_id, uris }) => {
  const id = playlist_id.includes(':') ? playlist_id.split(':').pop() : playlist_id;
  await spotifyFetch(`/playlists/${id}/tracks`, { method: 'POST', body: { uris } });
  return { content: [{ type: 'text', text: `Added ${uris.length} track(s)` }] };
});

server.tool('get_saved_tracks', 'Get liked/saved tracks.', { limit: z.number().min(1).max(50).default(20), offset: z.number().min(0).default(0) }, async ({ limit, offset }) => {
  const data = await spotifyFetch('/me/tracks', { query: { limit, offset } });
  return { content: [{ type: 'text', text: JSON.stringify((data?.items ?? []).map(i => ({ ...fmtTrack(i.track), saved_at: i.added_at })), null, 2) }] };
});

server.tool('save_track',         'Like/save tracks.',         { track_ids: z.array(z.string()) }, async ({ track_ids }) => { await spotifyFetch('/me/tracks', { method: 'PUT',    body: { ids: track_ids } }); return { content: [{ type: 'text', text: `Saved ${track_ids.length} track(s)` }] }; });
server.tool('remove_saved_track', 'Unlike/remove saved tracks.', { track_ids: z.array(z.string()) }, async ({ track_ids }) => { await spotifyFetch('/me/tracks', { method: 'DELETE', body: { ids: track_ids } }); return { content: [{ type: 'text', text: `Removed ${track_ids.length} track(s)` }] }; });

// ── Discovery ─────────────────────────────────────────────────────────────────

server.tool('get_top_tracks',    'Get your top tracks.',   { time_range: z.enum(['short_term', 'medium_term', 'long_term']).default('medium_term'), limit: z.number().min(1).max(50).default(20) }, async ({ time_range, limit }) => { const data = await spotifyFetch('/me/top/tracks',   { query: { time_range, limit } }); return { content: [{ type: 'text', text: JSON.stringify((data?.items ?? []).map(fmtTrack), null, 2) }] }; });
server.tool('get_top_artists',   'Get your top artists.',  { time_range: z.enum(['short_term', 'medium_term', 'long_term']).default('medium_term'), limit: z.number().min(1).max(50).default(20) }, async ({ time_range, limit }) => { const data = await spotifyFetch('/me/top/artists',  { query: { time_range, limit } }); return { content: [{ type: 'text', text: JSON.stringify((data?.items ?? []).map(a => ({ name: a.name, genres: a.genres, popularity: a.popularity, uri: a.uri })), null, 2) }] }; });
server.tool('get_recently_played','Get recently played.', { limit: z.number().min(1).max(50).default(20) }, async ({ limit }) => { const data = await spotifyFetch('/me/player/recently-played', { query: { limit } }); return { content: [{ type: 'text', text: JSON.stringify((data?.items ?? []).map(i => ({ ...fmtTrack(i.track), played_at: i.played_at })), null, 2) }] }; });

server.tool('get_artist', 'Get artist details and top tracks.', { artist_id: z.string() }, async ({ artist_id }) => {
  const id = artist_id.includes(':') ? artist_id.split(':').pop() : artist_id;
  const [artist, topTracks, albums] = await Promise.all([
    spotifyFetch(`/artists/${id}`),
    spotifyFetch(`/artists/${id}/top-tracks`, { query: { market: 'US' } }),
    spotifyFetch(`/artists/${id}/albums`, { query: { limit: 10 } }),
  ]);
  return { content: [{ type: 'text', text: JSON.stringify({ name: artist.name, genres: artist.genres, followers: artist.followers?.total, popularity: artist.popularity, uri: artist.uri, top_tracks: (topTracks?.tracks ?? []).map(fmtTrack), recent_albums: (albums?.items ?? []).map(a => ({ name: a.name, release_date: a.release_date, total_tracks: a.total_tracks, uri: a.uri })) }, null, 2) }] };
});

server.tool('get_album', 'Get album details and track list.', { album_id: z.string() }, async ({ album_id }) => {
  const id   = album_id.includes(':') ? album_id.split(':').pop() : album_id;
  const data = await spotifyFetch(`/albums/${id}`);
  return { content: [{ type: 'text', text: JSON.stringify({ name: data.name, artist: data.artists?.map(a => a.name).join(', '), release_date: data.release_date, total_tracks: data.total_tracks, uri: data.uri, url: data.external_urls?.spotify, tracks: (data.tracks?.items ?? []).map(t => ({ name: t.name, track_number: t.track_number, duration: fmtMs(t.duration_ms), uri: t.uri })) }, null, 2) }] };
});

// ── DJ Tools ─────────────────────────────────────────────────────────────────

async function setVol(v) {
  return spotifyFetch('/me/player/volume', { method: 'PUT', query: { volume_percent: Math.max(0, Math.min(100, Math.round(v))) } }).catch(() => {});
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Five real transition styles modeled on what DJs actually do at live sets
// nextUri: if provided, plays that track directly (live DJ mode). Otherwise skips to queued next.
async function performTransition(style, vol, nextUri = null) {
  const playNext = nextUri
    ? async () => spotifyFetch('/me/player/play', { method: 'PUT', body: { uris: [nextUri] } })
    : async () => spotifyFetch('/me/player/next', { method: 'POST' });

  switch (style) {

    case 'cut': {
      await setVol(0);
      await playNext();
      await sleep(400);
      await setVol(vol);
      break;
    }

    case 'stutter': {
      for (let i = 0; i < 4; i++) {
        await setVol(0); await sleep(80);
        await setVol(vol); await sleep(80);
      }
      await setVol(0);
      await playNext();
      await sleep(400);
      for (let i = 1; i <= 8; i++) { await setVol(vol * i / 8); await sleep(120); }
      break;
    }

    case 'echo': {
      const echoes = [0.9, 0.5, 0.85, 0.4, 0.7, 0.25, 0.5, 0.1, 0];
      for (const level of echoes) { await setVol(vol * level); await sleep(150); }
      await playNext();
      await sleep(500);
      for (let i = 1; i <= 10; i++) { await setVol(vol * i / 10); await sleep(100); }
      break;
    }

    case 'swell': {
      for (let i = 0; i <= 5; i++) { await setVol(Math.min(100, vol + (20 * i / 5))); await sleep(150); }
      await sleep(200);
      await setVol(0);
      await playNext();
      await sleep(400);
      for (let i = 1; i <= 8; i++) { await setVol(vol * i / 8); await sleep(150); }
      break;
    }

    case 'spinback': {
      // Rapid volume spiral down (simulates record spinning back), snap to next, slam back in
      for (let i = 10; i >= 0; i--) { await setVol(vol * i / 10); await sleep(60); }
      await playNext();
      await sleep(200);
      await setVol(vol);
      break;
    }

    case 'fade':
    default: {
      for (let i = 9; i >= 0; i--) { await setVol(vol * i / 10); await sleep(300); }
      await playNext();
      await sleep(600);
      for (let i = 1; i <= 10; i++) { await setVol(vol * i / 10); await sleep(300); }
      break;
    }
  }
}

// ── Live DJ Engine ────────────────────────────────────────────────────────────

const PHASE_STYLES = {
  'warm up': ['fade', 'fade', 'swell', 'fade'],
  'build':   ['swell', 'cut', 'swell', 'echo'],
  'peak':    ['stutter', 'echo', 'cut', 'spinback', 'stutter'],
  'outro':   ['fade', 'fade'],
};

const djLive = {
  active: false, genre: null, phase: 'peak',
  pool: [], usedUris: new Set(),
  lastTransition: 0, transitioning: false, timer: null,
  currentTrackId: null, cutPoint: 0, // per-track random cut point
};

function stopLiveDJ() {
  if (djLive.timer) { clearInterval(djLive.timer); djLive.timer = null; }
  djLive.active = false;
  djLive.pool   = [];
}

async function refillDJPool() {
  const results = [];
  for (const q of [`${djLive.genre} ${djLive.phase}`, `${djLive.genre} electronic energy`]) {
    try {
      const sr = await spotifyFetch('/search', { query: { q, type: 'track', limit: 50 } });
      results.push(...(sr?.tracks?.items ?? []).filter(t => t?.id && t?.uri && !isBlacklisted(t) && !djLive.usedUris.has(t.uri)));
    } catch (_) {}
  }
  return shuffle(results);
}

async function startLiveDJ(genre, phase, pool) {
  stopLiveDJ();
  djLive.active         = true;
  djLive.genre          = genre;
  djLive.phase          = phase;
  djLive.pool           = [...pool];
  djLive.usedUris       = new Set(pool.map(t => t.uri));
  djLive.lastTransition = 0;
  djLive.transitioning  = false;

  djLive.timer = setInterval(async () => {
    if (!djLive.active || djLive.transitioning) return;
    try {
      const player = await spotifyFetch('/me/player');
      if (!player?.is_playing || !player?.item) return;
      const remaining = player.item.duration_ms - player.progress_ms;
      const now = Date.now();
      if (now - djLive.lastTransition < 25000) return; // debounce

      // When track changes, roll a new random cut point for this track.
      // Range: 15s–90s before end. Makes some transitions early, some near end.
      if (player.item.id !== djLive.currentTrackId) {
        djLive.currentTrackId = player.item.id;
        djLive.cutPoint = 15000 + Math.floor(Math.random() * 75000); // 15–90s
      }
      if (remaining > djLive.cutPoint || remaining <= 0) return;

      if (djLive.pool.length < 3) {
        const more = await refillDJPool();
        djLive.pool.push(...more);
      }
      const next = djLive.pool.shift();
      if (!next) return;

      djLive.usedUris.add(next.uri);
      djLive.lastTransition = now;
      djLive.transitioning  = true;

      const vol    = player.device?.volume_percent ?? 80;
      const styles = PHASE_STYLES[djLive.phase] ?? ['fade', 'cut'];
      const style  = styles[Math.floor(Math.random() * styles.length)];
      await performTransition(style, vol, next.uri);
    } catch (_) {}
    djLive.transitioning = false;
  }, 3000);
}

server.tool('dj_transition',
  'DJ-style transition to the next track. Multiple styles: fade (smooth club mix), cut (instant hard drop), stutter (fader chop technique), echo (reverb tail cascade), swell (energy builds then cuts). Default: fade.',
  {
    style: z.enum(['fade', 'cut', 'stutter', 'echo', 'swell', 'spinback']).default('fade').describe('Transition style'),
  },
  async ({ style }) => {
    const current = await spotifyFetch('/me/player');
    const vol     = current?.device?.volume_percent ?? 80;
    await performTransition(style, vol);
    const result  = await spotifyFetch('/me/player');
    if (result?.item) updateSeeds([result.item]);
    return { content: [{ type: 'text', text: JSON.stringify({ transition: style, now_playing: result?.item ? { name: result.item.name, artist: result.item.artists?.map(a => a.name).join(', ') } : null }, null, 2) }] };
  }
);

server.tool('cut_early',
  'Cut the current track now and mix into the next. Pass a style for the transition type.',
  {
    style: z.enum(['fade', 'cut', 'stutter', 'echo', 'swell', 'spinback']).default('cut').describe('Transition style — default cut for an early exit'),
  },
  async ({ style }) => {
    const current  = await spotifyFetch('/me/player');
    const vol      = current?.device?.volume_percent ?? 80;
    // No seek — just fire the transition from wherever the track is.
    // Seeking to near-end causes the track to expire naturally mid-effect and double-skip.
    await performTransition(style, vol);
    const result = await spotifyFetch('/me/player');
    if (result?.item) updateSeeds([result.item]);
    return { content: [{ type: 'text', text: JSON.stringify({ cut: style, now_playing: result?.item ? { name: result.item.name, artist: result.item.artists?.map(a => a.name).join(', ') } : null }, null, 2) }] };
  }
);

server.tool('dj_set',
  'Build a DJ set with a warm up → build → peak arc. live=true enables the live DJ engine: auto-transitions fire between every track with style matching the phase (warm up=fade/swell, build=swell/cut, peak=stutter/echo/cut). No pre-queueing in live mode — the engine drives everything. Call stop_dj to end the session.',
  {
    genre:          z.string().describe('Genre or vibe: "techno", "house", "hip hop", "trance", "drum and bass", etc.'),
    tracks:         z.number().min(4).max(20).default(10).describe('Total tracks in the set'),
    include_outro:  z.boolean().default(false).describe('Add a cool-down phase after peak'),
    live:           z.boolean().default(false).describe('Enable live DJ engine — auto-transitions between every track. Only use when user explicitly requests a live/automatic DJ set.'),
  },
  async ({ genre, tracks, include_outro, live }) => {
    // Pull user's top artists to seed personal taste into the set
    let topArtistNames = [];
    try {
      const ta = await spotifyFetch('/me/top/artists', { query: { time_range: 'short_term', limit: 10 } });
      topArtistNames = (ta?.items ?? []).map(a => a.name).slice(0, 5);
    } catch (_) {}

    const phases = [
      { label: 'warm up', queries: [`${genre} warm up deep opening melodic`, `${genre} intro opening set warm`],           share: 0.20 },
      { label: 'build',   queries: [`${genre} progressive build energy`,       `${genre} building tension peak`],           share: 0.35 },
      { label: 'peak',    queries: [`${genre} peak hour hard intense rave`,    `${genre} peak time club hard floor`],       share: include_outro ? 0.30 : 0.45 },
    ];
    if (include_outro) phases.push(
      { label: 'outro',   queries: [`${genre} cool down closing outro`,        `${genre} end of night closing set`],        share: 0.15 }
    );

    const allTracks = []; // { phase, track } — full set in order
    const usedUris  = new Set();

    const pullTracks = async (query) => {
      // Track search is primary — always accessible, no 403 issues
      try {
        const sr = await spotifyFetch('/search', { query: { q: query, type: 'track', limit: 50 } });
        const tracks = (sr?.tracks?.items ?? []).filter(t => t?.id && t?.uri && !isBlacklisted(t) && !usedUris.has(t.id));
        if (tracks.length >= 3) return tracks;
      } catch (_) {}
      // Fallback: playlists (some are accessible, many 403 — iterate until one works)
      try {
        const sr  = await spotifyFetch('/search', { query: { q: query, type: 'playlist', limit: 10 } });
        const pls = (sr?.playlists?.items ?? []).filter(p => p?.id);
        for (const pl of pls) {
          try {
            const total  = pl.tracks?.total ?? 50;
            const offset = Math.floor(Math.random() * Math.max(1, total - 30));
            const pr     = await spotifyFetch(`/playlists/${pl.id}/tracks`, { query: { limit: 40, offset } });
            const tracks = (pr?.items ?? []).map(i => i?.track).filter(t => t?.id && t?.uri && !isBlacklisted(t) && !usedUris.has(t.id));
            if (tracks.length > 0) return tracks;
          } catch (_) {}
        }
      } catch (_) {}
      return [];
    };

    // Phase 1: collect all tracks without playing anything yet
    for (const phase of phases) {
      const needed = Math.max(1, Math.round(tracks * phase.share));
      let   pool   = [];

      await Promise.allSettled(phase.queries.map(async q => {
        try { pool.push(...await pullTracks(q)); } catch (_) {}
      }));

      if (topArtistNames.length) {
        const artistSeed = topArtistNames[Math.floor(Math.random() * topArtistNames.length)];
        try { pool.push(...await pullTracks(`${artistSeed} ${genre}`)); } catch (_) {}
      }

      shuffle(pool);
      for (const t of pool) {
        if (allTracks.length - allTracks.filter(x => x.phase !== phase.label).length >= needed) break;
        if (!usedUris.has(t.id)) {
          allTracks.push({ phase: phase.label, track: t });
          usedUris.add(t.id);
        }
      }
    }

    const setList = allTracks.map(({ phase, track }) => ({ phase, name: track.name, artist: track.artists?.map(a => a.name).join(', ') }));

    if (allTracks.length === 0) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'No tracks found. Try a different genre or check Spotify is open.' }) }] };
    }

    // Phase 2: start playback
    await spotifyFetch('/me/player/play', { method: 'PUT', body: { uris: [allTracks[0].track.uri] } });
    await sleep(800);
    await spotifyFetch('/me/player/shuffle', { method: 'PUT', query: { state: false } });

    if (live) {
      // Hand remaining tracks to the live engine — it drives transitions from here
      const livePool    = allTracks.slice(1).map(x => x.track);
      const startPhase  = allTracks[0].phase;
      await startLiveDJ(genre, startPhase, livePool);
    } else {
      // Pre-queue everything in order
      for (const { track } of allTracks.slice(1)) {
        try { await spotifyFetch('/me/player/queue', { method: 'POST', query: { uri: track.uri } }); } catch (_) {}
      }
    }

    return { content: [{ type: 'text', text: JSON.stringify({ set_built: true, live_dj: djLive.active, genre, total_tracks: setList.length, personal_seeds: topArtistNames, tracklist: setList }, null, 2) }] };
  }
);

server.tool('stop_dj', 'Stop the live DJ engine. Playback continues but auto-transitions stop firing.', {}, async () => {
  stopLiveDJ();
  return { content: [{ type: 'text', text: JSON.stringify({ live_dj: false, message: 'Live DJ engine stopped. Music keeps playing.' }) }] };
});

// ── Boot ──────────────────────────────────────────────────────────────────────

async function main() {
  // If a startup song is set, queue it up as the first thing that plays
  if (prefs.startup_song) {
    try { await spotifyFetch('/me/player/queue', { method: 'POST', query: { uri: prefs.startup_song } }); } catch (_) {}
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => { console.error('Server error:', err); process.exit(1); });
