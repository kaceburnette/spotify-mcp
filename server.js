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
    if (uri) await new Promise(r => setTimeout(r, 1000));
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
