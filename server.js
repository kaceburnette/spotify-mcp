#!/usr/bin/env node

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
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
  startup_song: null,
  mood_overrides: {},       // override keywords for any mood: { "grind": { "keywords": [...] } }
  custom_moods: {},         // add entirely new moods: { "deep_house": { "energy": "medium", "keywords": [...], "triggers": [...] } }
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
  grind:       { energy: 'high',   keywords: ['coding mode chillhop beats', 'liquid drum and bass focus', 'synthwave coding instrumental'] },
  focus:       { energy: 'medium', keywords: ['deep focus brain food', 'lofi hip hop beats study', 'IDM focus aphex twin boards of canada'] },
  lock_in:     { energy: 'high',   keywords: ['darksynth cyberpunk coding', 'cyberpunk dark focus programming', 'perturbator carpenter brut darksynth'] },
  hype:        { energy: 'high',   keywords: ['confidence boost walk like a badass', 'porter robinson future bass hype', 'polyphia instrumental energy'] },
  workout:     { energy: 'max',    keywords: ['gym phonk aggressive workout', 'workout phonk 2024', 'aggressive gym motivation trap'] },
  pump_up:     { energy: 'high',   keywords: ['pump up phonk motivation', 'high energy rap hype workout', 'aggressive motivation trap phonk'] },
  chill:       { energy: 'low',    keywords: ['bonobo tycho khruangbin smooth', 'nils frahm jon hopkins ambient clean', 'chillhop smooth instrumental flow', 'late night smooth ambient electronic'] },
  relax:       { energy: 'low',    keywords: ['peaceful piano calm ambient', 'max richter olafur arnalds soft', 'ambient relax instrumental mellow'] },
  wind_down:   { energy: 'min',    keywords: ['sleep ambient calm wind down', 'peaceful instrumental sleep', 'soft piano calm'] },
  sad:         { energy: 'low',    keywords: ['sad indie emotional songs', 'heartbreak sad playlist', 'melancholy emotional music'] },
  in_my_feels: { energy: 'low',    keywords: ['r&b emotional feelings soul', 'indie emotional vibes', 'deep feelings r&b'] },
  angry:       { energy: 'max',    keywords: ['metal intense aggressive hard', 'slipknot meshuggah heavy', 'hard rap drill aggressive'] },
  night_drive: { energy: 'medium', keywords: ['darksynth late night coding', 'cyberpunk voidsynth night', 'chillsynth retrowave night drive'] },
  creative:    { energy: 'medium', keywords: ['flow state ambient creative', 'jon hopkins ambient work music', 'film score study creative trent reznor'] },
  background:  { energy: 'min',    keywords: ['background ambient instrumental quiet', 'peaceful piano background cafe', 'classical background study focus'] },
  confident:   { energy: 'high',   keywords: ['walk like a badass confidence', 'power moves motivation energy', 'confidence boost hype music'] },
};

// Apply user overrides to existing moods
for (const [mood, overrides] of Object.entries(prefs.mood_overrides || {})) {
  if (MOOD_PROFILES[mood]) Object.assign(MOOD_PROFILES[mood], overrides);
}

// Merge custom moods into MOOD_PROFILES only here — VIBE_KEYWORDS not yet defined
// Triggers are merged after VIBE_KEYWORDS is initialized (see below)
for (const [name, def] of Object.entries(prefs.custom_moods || {})) {
  if (!def?.keywords?.length) continue;
  MOOD_PROFILES[name] = { energy: def.energy || 'medium', keywords: def.keywords };
}

// --- Persistent State ---

const DEFAULT_STATE = { mood: null, moodSetAt: null, seedTrackIds: [], seedArtistIds: [], seenTrackIds: [], tracksQueued: 0, skipCounts: {} };

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
    skipCounts: state.skipCounts,
  }, null, 2));
}

async function getDeviceId() {
  try {
    const devs = await spotifyFetch('/me/player/devices');
    const list = devs?.devices ?? [];
    const active = list.find(d => d.is_active) ?? list[0];
    return active?.id ?? null;
  } catch (_) { return null; }
}

async function activateDevice() {
  const devs = await spotifyFetch('/me/player/devices');
  const list = devs?.devices ?? [];
  if (!list.length) return null;
  const device = list.find(d => d.is_active) ?? list[0];
  if (!device.is_active) {
    await spotifyFetch('/me/player', { method: 'PUT', body: { device_ids: [device.id], play: true } });
  }
  return device.id;
}

// Try to launch the Spotify app locally and wait for it to register as a device.
// Mac: `open -a Spotify`. Windows: `start spotify:`. Linux: `xdg-open spotify:`.
// Returns the device id if successful, null otherwise.
async function wakeSpotify({ timeoutMs = 12000 } = {}) {
  // Already have a device? Just activate it.
  const existing = await activateDevice().catch(() => null);
  if (existing) return existing;

  // Try to launch the app locally
  try {
    if (process.platform === 'darwin') {
      spawn('open', ['-a', 'Spotify'], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', 'spotify:'], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', ['spotify:'], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (_) {}

  // Poll for a device to appear
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1500));
    const id = await activateDevice().catch(() => null);
    if (id) return id;
  }
  return null;
}

async function playMood(mood) {
  const profile = MOOD_PROFILES[mood];
  if (!profile) return null;

  const deviceId = (await activateDevice()) ?? (await wakeSpotify());
  const query = deviceId ? { device_id: deviceId } : {};

  // First track: always mood-matched from playlist search (not personal history)
  const keyword = profile.keywords[Math.floor(Math.random() * profile.keywords.length)];
  const sr = await spotifyFetch('/search', { query: { q: keyword, type: 'playlist', limit: 5 } });
  const playlists = (sr?.playlists?.items ?? []).filter(p => p?.id);
  let firstTrack = null;
  if (playlists.length) {
    const pl = playlists[Math.floor(Math.random() * Math.min(playlists.length, 3))];
    const offset = Math.floor(Math.random() * 30);
    const pr = await spotifyFetch(`/playlists/${pl.id}/items`, { query: { limit: 20, offset } });
    const candidates = (pr?.items ?? []).map(i => i?.track).filter(t => t?.id && !isBlacklisted(t));
    if (candidates.length) firstTrack = candidates[Math.floor(Math.random() * candidates.length)];
  }
  if (!firstTrack) return null;

  // Flush old queue first so garbage doesn't leak through
  await flushQueue();

  // Play the mood-matched opener
  try {
    await spotifyFetch('/me/player/play', { method: 'PUT', body: { uris: [firstTrack.uri] }, query });
  } catch (err) {
    if (err?.message?.includes('NO_ACTIVE_DEVICE') || err?.message?.includes('404')) {
      throw new Error('No active Spotify device found. Open the Spotify app on any device and try again.');
    }
    throw err;
  }

  // Fill queue with personal + mood tracks in background
  setImmediate(async () => {
    const tracks = await discoverTracks(20);
    for (const track of tracks) {
      await spotifyFetch('/me/player/queue', { method: 'POST', query: { uri: track.uri } }).catch(() => {});
    }
    updateSeeds([firstTrack, ...tracks]);
    await ensureQueueDepth().catch(() => {});
  });

  return {
    now_playing: { name: firstTrack.name, artist: firstTrack.artists?.map(a => a.name).join(', ') }
  };
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
  const moodActive = !!(state.mood && MOOD_PROFILES[state.mood]);
  const personalPool = new Map();
  const moodPool = new Map();

  const addTo = (pool) => (tracks) => {
    for (const t of (tracks ?? [])) {
      if (t?.id && !state.seenTrackIds.has(t.id) && !pool.has(t.id) && !isBlacklisted(t)) {
        pool.set(t.id, t);
      }
    }
  };

  // Personal tracks — always fetch but cap contribution when mood is active
  await Promise.allSettled([
    spotifyFetch('/me/top/tracks', { query: { time_range: 'short_term',  limit: 50 } }).then(r => addTo(personalPool)(r?.items)),
    spotifyFetch('/me/top/tracks', { query: { time_range: 'medium_term', limit: 50 } }).then(r => addTo(personalPool)(r?.items)),
  ]);

  // Top artist catalogs — skip when mood is active to avoid history dominating
  if (!moodActive) {
    try {
      const r = await spotifyFetch('/me/top/artists', { query: { time_range: 'short_term', limit: 15 } });
      if (r?.items?.length) {
        await Promise.allSettled(
          shuffle([...r.items]).slice(0, 3).map(a =>
            spotifyFetch('/search', { query: { q: `artist:${a.name}`, type: 'track', limit: 10 } }).then(r => addTo(personalPool)(r?.tracks?.items))
          )
        );
      }
    } catch (_) {}
  }

  // Mood-keyed playlist search — primary source when mood is active
  if (moodActive) {
    const kws = shuffle([...MOOD_PROFILES[state.mood].keywords]).slice(0, 4);
    await Promise.allSettled(kws.map(async (kw) => {
      try {
        const sr = await spotifyFetch('/search', { query: { q: kw, type: 'playlist', limit: 5 } });
        const playlists = (sr?.playlists?.items ?? []).filter(p => p?.id);
        if (!playlists.length) return;
        const pl    = playlists[Math.floor(Math.random() * playlists.length)];
        const total = pl.tracks?.total ?? 100;
        const offset = Math.max(0, Math.floor(Math.random() * Math.max(1, total - 25)));
        const pr = await spotifyFetch(`/playlists/${pl.id}/items`, { query: { limit: 25, offset } });
        addTo(moodPool)((pr?.items ?? []).map(i => i?.track).filter(t => t?.id));
      } catch (_) {}
    }));
  }

  if (moodActive) {
    // Mood is active: pure mood-matched tracks, no personal history
    return shuffle([...moodPool.values()]).slice(0, count);
  }

  return shuffle([...personalPool.values()]).slice(0, count);
}

// --- Queue Manager ---

const MIN_QUEUE_DEPTH   = 5;
const QUEUE_REFILL_COUNT = 15;

async function flushQueue() {
  // Spotify's GET /queue caps at ~20 returned tracks even if more are queued.
  // Loop: skip a batch, recheck depth, repeat until empty (capped at 50 total skips).
  try {
    let totalSkipped = 0;
    while (totalSkipped < 50) {
      const data = await spotifyFetch('/me/player/queue');
      const depth = (data?.queue ?? []).length;
      if (depth === 0) return;
      const batch = Math.min(depth, 10);
      for (let i = 0; i < batch; i++) {
        await spotifyFetch('/me/player/next', { method: 'POST' }).catch(() => {});
        await new Promise(r => setTimeout(r, 200));
        totalSkipped++;
      }
    }
  } catch (_) {}
}

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
  lock_in:     ['debug', 'bug', 'prod', 'urgent', 'deadline', 'incident', 'down', 'broken', 'hotfix', 'outage', 'on fire', 'critical', 'crash', 'error', 'fix', 'firefight'],
  grind:       ['implement', 'feature', 'commit', 'refactor', 'sprint', 'pr', 'push', 'ship', 'shipping', 'build out', 'working on', 'building'],
  focus:       ['focus', 'deep focus', 'deep work', 'concentration', 'concentrate', 'zero distraction', 'no lyrics', 'study', 'review', 'read', 'document', 'write', 'plan', 'think', 'research', 'draft', 'locked in', 'heads down'],
  hype:        ['shipped', 'merged', 'launched', 'released', 'done', 'finished', 'deployed', 'just pushed', 'celebrate', 'killed it', 'nailed it', 'closed', 'won', 'party', 'parties', 'club', 'nightclub', 'rooftop', 'bar', 'pregame', 'going out', 'bottle service', 'vegas', 'miami', 'celebration', 'turn up', 'turning up', 'having a great time', 'drinks', 'friday night', 'saturday night'],
  confident:   ['demo', 'pitch', 'presentation', 'client', 'sales', 'investor', 'ceo', 'boss', 'interview', 'call with', 'golf', 'country club', 'yacht', 'penthouse', 'dinner', 'networking'],
  creative:    ['design', 'brainstorm', 'idea', 'concept', 'wireframe', 'figma', 'sketch', 'creative', 'exploring', 'thinking through', 'planning'],
  chill:       ['slow', 'easy', 'casual', 'friday', 'weekend', 'break', 'lunch', 'coffee', 'low stakes', 'light', 'no rush', 'smooth', 'clean', 'mellow', 'calm', 'flowing', 'calm focus', 'calm focused', 'bonobo', 'tycho', 'ambient', 'instrumental', 'chillhop', 'fresh', 'ceo vibe', 'clean vibe'],
  night_drive: ['night drive', 'driving at night', 'darksynth', 'cyberpunk', 'synthwave', 'retrowave', 'midnight drive'],
  wind_down:   ['tired', 'exhausted', 'wrapping up', 'calling it', 'done for the day', 'winding down', 'end of day', 'signing off', 'last thing'],
  background:  ['call', 'zoom', 'meeting', 'talking', 'phone', 'on a call', 'standup', 'sync'],
  workout:     ['gym', 'workout', 'run', 'lift', 'training', 'exercise', 'sets', 'reps', 'running'],
  pump_up:     ['pump up', 'hyped', 'pumped', 'fired up', 'let\'s go', 'energy', 'get going', 'motivate'],
  relax:       ['relax', 'chill out', 'decompress', 'unwind', 'take it easy', 'slow down', 'recover', 'rest'],
  sad:         ['sad', 'down', 'rough day', 'rough one', 'didn\'t go well', 'stressed', 'not feeling it', 'low'],
  in_my_feels: ['in my feels', 'emotional', 'reflecting', 'thinking about', 'missing', 'nostalgic', 'overthinking'],
  angry:       ['angry', 'pissed', 'frustrated', 'annoyed', 'over it', 'done with', 'rage', 'mad'],
};

// Now merge custom mood triggers into VIBE_KEYWORDS (safe — VIBE_KEYWORDS is now defined)
for (const [name, def] of Object.entries(prefs.custom_moods || {})) {
  if (def?.triggers?.length) VIBE_KEYWORDS[name] = def.triggers;
}

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
  const scores = Object.fromEntries(Object.keys(MOOD_PROFILES).map(m => [m, 0]));

  for (const [mood, kws] of Object.entries(VIBE_KEYWORDS)) {
    scores[mood] = kws.filter(kw => ctx.includes(kw)).length;
  }

  // Explicit trigger phrases score +5 (override everything)
  for (const [mood, triggers] of Object.entries(EXPLICIT_MOOD_TRIGGERS)) {
    if (triggers.some(t => ctx.includes(t))) scores[mood] = (scores[mood] || 0) + 5;
  }

  // Time-of-day boosts
  if (hour >= 22 || hour < 5)  { scores.wind_down   += 1; scores.lock_in  += 1; }
  if (hour >= 5  && hour < 10) { scores.grind       += 1; scores.confident += 1; }
  if (hour >= 14 && hour < 17) { scores.chill       += 1; }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return { recommended: sorted[0]?.[0] || 'grind', scores: Object.fromEntries(sorted.filter(([, v]) => v > 0)) };
}

// --- Formatters ---

const fmtMs = ms => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

function fmtTrack(t) {
  if (!t) return null;
  return { name: t.name, artist: t.artists?.map(a => a.name).join(', '), album: t.album?.name, duration: fmtMs(t.duration_ms), uri: t.uri };
}
const fmtTrackSlim = t => t ? { name: t.name, artist: t.artists?.map(a => a.name).join(', '), uri: t.uri } : null;

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

// --- Sleep Timer ---

let sleepTimerId = null;
let sleepTimerEndsAt = null;
async function fireSleepTimer() {
  try { await spotifyFetch('/me/player/pause', { method: 'PUT' }); } catch (_) {}
  sleepTimerId = null;
  sleepTimerEndsAt = null;
}

// --- Session Journal ---
// When mood changes, auto-save what played during the previous mood as a dated playlist.

async function journalPreviousSession(previousMood, sessionStart) {
  try {
    if (!previousMood || !sessionStart) return;
    const sinceMs = new Date(sessionStart).getTime();
    const data = await spotifyFetch('/me/player/recently-played', { query: { limit: 50 } });
    const items = (data?.items ?? []).filter(i => new Date(i.played_at).getTime() >= sinceMs);
    if (items.length < 5) return; // not worth saving
    const uris = items.map(i => i.track?.uri).filter(Boolean).reverse(); // chronological order
    const d = new Date(sessionStart);
    const pad = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    const name = `${previousMood}-${stamp}`;
    const pl = await spotifyFetch('/me/playlists', { method: 'POST', body: { name, description: `Auto-saved ${previousMood} session`, public: false } });
    const id = pl.uri.split(':').pop();
    for (let i = 0; i < uris.length; i += 100) {
      await spotifyFetch(`/playlists/${id}/items`, { method: 'POST', body: { uris: uris.slice(i, i + 100) } });
    }
  } catch (_) {}
}

// --- MCP Server ---

function createServer() {
  const server = new McpServer({ name: 'spotify', version: '3.4.0' });

// ── Mood ─────────────────────────────────────────────────────────────────────

server.tool('set_mood',
  'Set the listening mood. Call this based on session context — what the user is doing, their energy, what they said. Mood persists across restarts. Available: grind, focus, lock_in, hype, workout, pump_up, chill, relax, wind_down, sad, in_my_feels, angry, night_drive, creative, background, confident.',
  { mood: z.enum(Object.keys(MOOD_PROFILES)).describe('Mood label') },
  async ({ mood }) => {
    const previousMood = state.mood; const previousStart = state.moodSetAt;
    if (previousMood && previousMood !== mood) {
      setImmediate(() => journalPreviousSession(previousMood, previousStart));
    }
    state.mood = mood; state.moodSetAt = new Date().toISOString(); state.tracksQueued = 0;
    saveState();
    let playing = null;
    try { playing = await playMood(mood); } catch (_) {}
    return { content: [{ type: 'text', text: JSON.stringify({ mood, energy: MOOD_PROFILES[mood].energy, setAt: state.moodSetAt, ...(playing ?? {}) }, null, 2) }] };
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
    const previousStart = state.moodSetAt;

    if (auto_apply) {
      if (previousMood && previousMood !== recommended) {
        setImmediate(() => journalPreviousSession(previousMood, previousStart));
      }
      state.mood = recommended; state.moodSetAt = new Date().toISOString(); state.tracksQueued = 0;
      saveState();

      // Check if anything is currently playing
      let isPlaying = false;
      try {
        const current = await spotifyFetch('/me/player');
        isPlaying = current?.is_playing === true;
      } catch (_) {}

      try {
        const playing = await playMood(recommended);
        if (playing) {
          return { content: [{ type: 'text', text: JSON.stringify({ recommended_mood: recommended, auto_applied: true, energy: MOOD_PROFILES[recommended]?.energy, ...playing, scores }, null, 2) }] };
        }
      } catch (_) {}

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
    startup_song:           z.string().optional().describe('Spotify track URI to play at startup. Pass empty string "" to disable the startup song entirely.'),
    add_blacklist_artist:   z.string().optional().describe('Artist name to never queue'),
    remove_blacklist_artist:z.string().optional().describe('Artist name to remove from blacklist'),
    add_blacklist_track:    z.string().optional().describe('Track ID to never queue'),
    remove_blacklist_track: z.string().optional().describe('Track ID to remove from blacklist'),
    add_custom_mood:        z.object({
      name:     z.string().describe('Mood name (lowercase_snake_case, e.g. "deep_house")'),
      energy:   z.enum(['min','low','medium','high','max']),
      keywords: z.array(z.string()).describe('2-3 Spotify playlist search terms'),
      triggers: z.array(z.string()).optional().describe('Words/phrases that auto-activate this mood from session context'),
    }).optional().describe('Add or replace a custom mood'),
    remove_custom_mood:     z.string().optional().describe('Custom mood name to delete'),
  },
  async ({ startup_mood, startup_song, add_blacklist_artist, remove_blacklist_artist, add_blacklist_track, remove_blacklist_track, add_custom_mood, remove_custom_mood }) => {
    if (startup_mood !== undefined) prefs.startup_mood = MOOD_PROFILES[startup_mood] ? startup_mood : null;
    if (startup_song !== undefined) prefs.startup_song = startup_song || null;
    if (add_blacklist_artist)    prefs.blacklist_artists = [...new Set([...(prefs.blacklist_artists ?? []), add_blacklist_artist])];
    if (remove_blacklist_artist) prefs.blacklist_artists = (prefs.blacklist_artists ?? []).filter(a => a !== remove_blacklist_artist);
    if (add_blacklist_track)     prefs.blacklist_tracks  = [...new Set([...(prefs.blacklist_tracks  ?? []), add_blacklist_track])];
    if (remove_blacklist_track)  prefs.blacklist_tracks  = (prefs.blacklist_tracks  ?? []).filter(t => t !== remove_blacklist_track);
    if (add_custom_mood) {
      prefs.custom_moods = prefs.custom_moods ?? {};
      prefs.custom_moods[add_custom_mood.name] = { energy: add_custom_mood.energy, keywords: add_custom_mood.keywords, triggers: add_custom_mood.triggers ?? [] };
      MOOD_PROFILES[add_custom_mood.name] = { energy: add_custom_mood.energy, keywords: add_custom_mood.keywords };
      if (add_custom_mood.triggers?.length) VIBE_KEYWORDS[add_custom_mood.name] = add_custom_mood.triggers;
    }
    if (remove_custom_mood) {
      prefs.custom_moods = prefs.custom_moods ?? {};
      delete prefs.custom_moods[remove_custom_mood];
      delete MOOD_PROFILES[remove_custom_mood];
      delete VIBE_KEYWORDS[remove_custom_mood];
    }
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
    if (uri?.includes(':track:')) await flushQueue();
    try {
      await spotifyFetch('/me/player/play', { method: 'PUT', body: Object.keys(body).length ? body : undefined, query });
    } catch (err) {
      // Auto-wake Spotify on no active device, then retry once
      if (err?.message?.includes('NO_ACTIVE_DEVICE') || err?.message?.includes('404')) {
        const woken = await wakeSpotify();
        if (woken) {
          await spotifyFetch('/me/player/play', { method: 'PUT', body: Object.keys(body).length ? body : undefined, query: { ...query, device_id: woken } });
        } else {
          throw new Error('No active Spotify device. Open the Spotify app on any device and play anything for a second to register it.');
        }
      } else throw err;
    }
    setImmediate(() => ensureQueueDepth().catch(() => {}));
    return { content: [{ type: 'text', text: uri ? `Playing: ${uri}` : 'Resumed' }] };
  }
);

server.tool('pause', 'Pause playback.', {}, async () => {
  await spotifyFetch('/me/player/pause', { method: 'PUT' });
  return { content: [{ type: 'text', text: 'Paused' }] };
});

server.tool('next_track', 'Skip to next track. Auto-refills queue if running low. Tracks skipped within 30s twice get auto-blacklisted.', {}, async () => {
  const before = await spotifyFetch('/me/player');
  const beforeId = before?.item?.id;
  const beforeProgress = before?.progress_ms ?? 0;
  const beforeDuration = before?.item?.duration_ms ?? Infinity;

  // Skip learning: if track was skipped within 30s OR before 25% played, count as a skip
  const isEarlySkip = beforeId && (beforeProgress < 30000 || (beforeProgress / beforeDuration) < 0.25);
  if (isEarlySkip) {
    state.skipCounts[beforeId] = (state.skipCounts[beforeId] ?? 0) + 1;
    if (state.skipCounts[beforeId] >= 2 && !prefs.blacklist_tracks.includes(beforeId)) {
      prefs.blacklist_tracks = [...prefs.blacklist_tracks, beforeId];
      savePrefs();
    }
    saveState();
  }

  await spotifyFetch('/me/player/next', { method: 'POST' });
  let result;
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 600));
    result = await spotifyFetch('/me/player');
    if (result?.item?.id && result.item.id !== beforeId) break;
  }
  if (result?.item) updateSeeds([result.item]);
  setImmediate(() => ensureQueueDepth().catch(() => {}));
  const out = fmtPlayback(result);
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

server.tool('clear_queue',
  'Clear the manually-added queue by skipping through every queued track. Use when leftover queue from an earlier session is interfering with current playback.',
  {},
  async () => {
    await flushQueue();
    return { content: [{ type: 'text', text: 'Queue cleared' }] };
  }
);

server.tool('queue_many',
  'Add multiple track URIs to the queue in order. Use this instead of calling add_to_queue in a loop — one tool call queues the whole set.',
  { uris: z.array(z.string()).min(1).max(100).describe('Track URIs in playback order') },
  async ({ uris }) => {
    let added = 0;
    const failed = [];
    for (const uri of uris) {
      try {
        await spotifyFetch('/me/player/queue', { method: 'POST', query: { uri } });
        added++;
      } catch (err) { failed.push({ uri, error: err.message }); }
    }
    return { content: [{ type: 'text', text: JSON.stringify({ queued: added, failed: failed.length, errors: failed.slice(0, 3) }, null, 2) }] };
  }
);

server.tool('fade_volume',
  'Gradually fade volume from current to target over N seconds. Returns immediately; fade runs in background.',
  {
    target_volume:    z.number().min(0).max(100).describe('Target volume percentage'),
    duration_seconds: z.number().min(1).max(300).default(10).describe('Fade duration in seconds (1-300)'),
  },
  async ({ target_volume, duration_seconds }) => {
    setImmediate(async () => {
      try {
        const playback = await spotifyFetch('/me/player');
        const current = playback?.device?.volume_percent ?? 50;
        const steps = Math.max(5, Math.min(60, duration_seconds * 2));
        const intervalMs = (duration_seconds * 1000) / steps;
        const delta = (target_volume - current) / steps;
        for (let i = 1; i <= steps; i++) {
          const v = Math.round(Math.max(0, Math.min(100, current + delta * i)));
          await spotifyFetch('/me/player/volume', { method: 'PUT', query: { volume_percent: v } }).catch(() => {});
          await new Promise(r => setTimeout(r, intervalMs));
        }
      } catch (_) {}
    });
    return { content: [{ type: 'text', text: `Fading to ${target_volume}% over ${duration_seconds}s` }] };
  }
);

server.tool('get_queue', 'Get the current playback queue.', {}, async () => {
  const data = await spotifyFetch('/me/player/queue');
  return { content: [{ type: 'text', text: JSON.stringify({ now: fmtTrackSlim(data?.currently_playing), queue: (data?.queue ?? []).slice(0, 10).map(fmtTrackSlim) }) }] };
});

server.tool('get_devices', 'List available playback devices.', {}, async () => {
  const data = await spotifyFetch('/me/player/devices');
  return { content: [{ type: 'text', text: JSON.stringify((data?.devices ?? []).map(d => ({ id: d.id, name: d.name, type: d.type, active: d.is_active, volume: d.volume_percent })), null, 2) }] };
});

server.tool('transfer_playback', 'Transfer playback to a device.', { device_id: z.string() }, async ({ device_id }) => {
  await spotifyFetch('/me/player', { method: 'PUT', body: { device_ids: [device_id] } });
  return { content: [{ type: 'text', text: `Transferred to ${device_id}` }] };
});

server.tool('wake_spotify',
  'Launch the Spotify app on the local machine if no device is registered. Mac/Windows/Linux desktop only — does nothing useful when the MCP runs on a different machine. Used automatically by play and detect_vibe on cold start.',
  {},
  async () => {
    const id = await wakeSpotify();
    if (id) return { content: [{ type: 'text', text: JSON.stringify({ status: 'ready', device_id: id }, null, 2) }] };
    return { content: [{ type: 'text', text: JSON.stringify({ status: 'no_device', hint: 'Open Spotify manually and play any track briefly.' }, null, 2) }] };
  }
);

// ── Search + Library ──────────────────────────────────────────────────────────

server.tool('search', 'Search tracks, artists, albums, or playlists. Optional year_min/year_max filters by release year (e.g. 2023-2024).', {
  query: z.string(),
  type: z.enum(['track', 'artist', 'album', 'playlist']).default('track'),
  limit: z.number().min(1).max(10).default(10),
  year_min: z.number().optional().describe('Earliest release year, e.g. 2023'),
  year_max: z.number().optional().describe('Latest release year, e.g. 2024'),
}, async ({ query, type, limit, year_min, year_max }) => {
  let q = query;
  if (year_min || year_max) {
    const lo = year_min || 0;
    const hi = year_max || new Date().getFullYear();
    q += ` year:${lo}-${hi}`;
  }
  const data = await spotifyFetch('/search', { query: { q, type, limit } });
  let items = [];
  if (type === 'track')    items = (data?.tracks?.items    ?? []).map(fmtTrackSlim);
  else if (type === 'artist')   items = (data?.artists?.items  ?? []).map(a => ({ name: a.name, uri: a.uri }));
  else if (type === 'album')    items = (data?.albums?.items   ?? []).map(a => ({ name: a.name, artist: a.artists?.map(ar => ar.name).join(', '), uri: a.uri }));
  else if (type === 'playlist') items = (data?.playlists?.items ?? []).filter(p => p).map(p => ({ name: p.name, uri: p.uri }));
  return { content: [{ type: 'text', text: JSON.stringify(items) }] };
});

server.tool('get_playlists', 'Get your playlists.', { limit: z.number().min(1).max(50).default(20) }, async ({ limit }) => {
  const data = await spotifyFetch('/me/playlists', { query: { limit } });
  return { content: [{ type: 'text', text: JSON.stringify((data?.items ?? []).map(p => ({ name: p.name, uri: p.uri }))) }] };
});

server.tool('get_playlist_tracks', 'Get tracks in a playlist.', { playlist_id: z.string(), limit: z.number().min(1).max(50).default(30) }, async ({ playlist_id, limit }) => {
  const id = playlist_id.includes(':') ? playlist_id.split(':').pop() : playlist_id;
  const data = await spotifyFetch(`/playlists/${id}/items`, { query: { limit } });
  return { content: [{ type: 'text', text: JSON.stringify((data?.items ?? []).filter(i => i?.track).map(i => fmtTrackSlim(i.track))) }] };
});

server.tool('create_playlist', 'Create a new playlist.', { name: z.string(), description: z.string().optional(), public: z.boolean().default(false) }, async ({ name, description, public: pub }) => {
  const data = await spotifyFetch('/me/playlists', { method: 'POST', body: { name, description: description ?? '', public: pub } });
  return { content: [{ type: 'text', text: JSON.stringify({ name: data.name, uri: data.uri, url: data.external_urls?.spotify }, null, 2) }] };
});

server.tool('add_to_playlist', 'Add track URIs to a playlist.', { playlist_id: z.string(), uris: z.array(z.string()) }, async ({ playlist_id, uris }) => {
  const id = playlist_id.includes(':') ? playlist_id.split(':').pop() : playlist_id;
  await spotifyFetch(`/playlists/${id}/items`, { method: 'POST', body: { uris } });
  return { content: [{ type: 'text', text: `Added ${uris.length} track(s)` }] };
});

server.tool('remove_from_playlist',
  'Remove specific track URIs from a playlist.',
  { playlist_id: z.string(), uris: z.array(z.string()).min(1).max(100) },
  async ({ playlist_id, uris }) => {
    const id = playlist_id.includes(':') ? playlist_id.split(':').pop() : playlist_id;
    await spotifyFetch(`/playlists/${id}/tracks`, { method: 'DELETE', body: { tracks: uris.map(u => ({ uri: u })) } });
    return { content: [{ type: 'text', text: `Removed ${uris.length} track(s)` }] };
  }
);

server.tool('clear_playlist',
  'Remove ALL tracks from a playlist (keeps the playlist itself).',
  { playlist_id: z.string() },
  async ({ playlist_id }) => {
    const id = playlist_id.includes(':') ? playlist_id.split(':').pop() : playlist_id;
    await spotifyFetch(`/playlists/${id}/tracks`, { method: 'PUT', body: { uris: [] } });
    return { content: [{ type: 'text', text: 'Playlist cleared' }] };
  }
);

server.tool('delete_playlist',
  'Delete a playlist (Spotify API quirk: this unfollows your own playlist, which removes it from your library).',
  { playlist_id: z.string() },
  async ({ playlist_id }) => {
    const id = playlist_id.includes(':') ? playlist_id.split(':').pop() : playlist_id;
    await spotifyFetch(`/playlists/${id}/followers`, { method: 'DELETE' });
    return { content: [{ type: 'text', text: 'Playlist deleted' }] };
  }
);

server.tool('build_set',
  'Curate a DJ set: creates a playlist with the given tracks in order. Use for "build me a 90-min Hi Ibiza set" type requests — Claude picks the tracks (energy progression, era, scene), this saves them as a single playlist the user can play with Smart Shuffle.',
  {
    name:        z.string().describe('Playlist name, e.g. "Hi Ibiza 4am 2024"'),
    uris:        z.array(z.string()).describe('Track URIs in playback order — sequence them by energy curve (warmup → peak → wind-down)'),
    description: z.string().optional().describe('Optional set notes (vibe, era, occasion)'),
    public:      z.boolean().default(false),
  },
  async ({ name, uris, description, public: pub }) => {
    const data = await spotifyFetch('/me/playlists', { method: 'POST', body: { name, description: description ?? '', public: pub } });
    const id = data.uri.split(':').pop();
    // Spotify limits add to 100 URIs per call — chunk if needed
    for (let i = 0; i < uris.length; i += 100) {
      await spotifyFetch(`/playlists/${id}/items`, { method: 'POST', body: { uris: uris.slice(i, i + 100) } });
    }
    return { content: [{ type: 'text', text: JSON.stringify({ name: data.name, uri: data.uri, url: data.external_urls?.spotify, tracks: uris.length }, null, 2) }] };
  }
);

server.tool('build_arc',
  'Build a multi-mood playlist with energy progression. Pass segments like [{mood: "chill", minutes: 20}, {mood: "focus", minutes: 30}, {mood: "grind", minutes: 30}]. Tool fetches mood-matched tracks for each segment and assembles them in order.',
  {
    name:        z.string().describe('Playlist name'),
    segments:    z.array(z.object({
      mood:    z.enum(Object.keys(MOOD_PROFILES)).describe('Mood for this segment'),
      minutes: z.number().min(5).max(120).describe('Length of this segment in minutes'),
    })).min(2).max(6).describe('Sequenced mood segments'),
    description: z.string().optional(),
    public:      z.boolean().default(false),
  },
  async ({ name, segments, description, public: pub }) => {
    const allUris = [];
    for (const seg of segments) {
      const profile = MOOD_PROFILES[seg.mood];
      if (!profile) continue;
      const targetCount = Math.max(3, Math.ceil(seg.minutes / 3)); // ~3min/track avg
      const collected = [];
      for (const kw of shuffle([...profile.keywords])) {
        if (collected.length >= targetCount) break;
        try {
          const sr = await spotifyFetch('/search', { query: { q: kw, type: 'playlist', limit: 3 } });
          const playlists = (sr?.playlists?.items ?? []).filter(p => p?.id);
          if (!playlists.length) continue;
          const pl = playlists[Math.floor(Math.random() * playlists.length)];
          const total = pl.tracks?.total ?? 100;
          const offset = Math.max(0, Math.floor(Math.random() * Math.max(1, total - 25)));
          const pr = await spotifyFetch(`/playlists/${pl.id}/items`, { query: { limit: 25, offset } });
          const tracks = (pr?.items ?? []).map(i => i?.track).filter(t => t?.id && !isBlacklisted(t));
          for (const t of shuffle(tracks)) {
            if (collected.length >= targetCount) break;
            if (!collected.find(c => c.id === t.id)) collected.push(t);
          }
        } catch (_) {}
      }
      allUris.push(...collected.map(t => t.uri));
    }
    if (!allUris.length) return { content: [{ type: 'text', text: 'No tracks could be assembled for the arc.' }] };
    const pl = await spotifyFetch('/me/playlists', { method: 'POST', body: { name, description: description ?? '', public: pub } });
    const id = pl.uri.split(':').pop();
    for (let i = 0; i < allUris.length; i += 100) {
      await spotifyFetch(`/playlists/${id}/items`, { method: 'POST', body: { uris: allUris.slice(i, i + 100) } });
    }
    return { content: [{ type: 'text', text: JSON.stringify({ name: pl.name, uri: pl.uri, url: pl.external_urls?.spotify, segments: segments.length, tracks: allUris.length }, null, 2) }] };
  }
);

server.tool('identify_track_vibe',
  'Get rich metadata for a track (artist, genres, era, popularity) so Claude can mood-match it. Use this when a user asks "what mood is this track" or "what vibe is this album."',
  { track_uri: z.string().describe('Spotify track URI or ID') },
  async ({ track_uri }) => {
    const trackId = track_uri.includes(':') ? track_uri.split(':').pop() : track_uri;
    const track = await spotifyFetch(`/tracks/${trackId}`);
    if (!track) return { content: [{ type: 'text', text: 'Track not found' }] };
    const artistId = track.artists?.[0]?.id;
    const artist = artistId ? await spotifyFetch(`/artists/${artistId}`) : null;
    return { content: [{ type: 'text', text: JSON.stringify({
      name:             track.name,
      artists:          track.artists?.map(a => a.name),
      album:            track.album?.name,
      release_year:     track.album?.release_date?.slice(0, 4),
      duration:         fmtMs(track.duration_ms),
      popularity:       track.popularity,
      genres:           artist?.genres ?? [],
      artist_followers: artist?.followers?.total,
      explicit:         track.explicit,
      uri:              track.uri,
    }, null, 2) }] };
  }
);

server.tool('set_sleep_timer',
  'Pause playback automatically after N minutes. Off by default — only set when user explicitly asks for a sleep timer.',
  { minutes: z.number().min(1).max(720).describe('Minutes until pause (1-720)') },
  async ({ minutes }) => {
    if (sleepTimerId) clearTimeout(sleepTimerId);
    sleepTimerEndsAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    sleepTimerId = setTimeout(fireSleepTimer, minutes * 60 * 1000);
    return { content: [{ type: 'text', text: JSON.stringify({ sleep_timer: 'set', pause_at: sleepTimerEndsAt, minutes }, null, 2) }] };
  }
);

server.tool('cancel_sleep_timer', 'Cancel a pending sleep timer.', {}, async () => {
  if (sleepTimerId) { clearTimeout(sleepTimerId); sleepTimerId = null; sleepTimerEndsAt = null; }
  return { content: [{ type: 'text', text: 'Sleep timer canceled' }] };
});

server.tool('get_sleep_timer', 'Check if a sleep timer is active.', {}, async () => {
  if (!sleepTimerId) return { content: [{ type: 'text', text: JSON.stringify({ active: false }, null, 2) }] };
  const remaining = Math.max(0, Math.round((new Date(sleepTimerEndsAt).getTime() - Date.now()) / 60000));
  return { content: [{ type: 'text', text: JSON.stringify({ active: true, pause_at: sleepTimerEndsAt, minutes_remaining: remaining }, null, 2) }] };
});

server.tool('get_saved_tracks', 'Get liked/saved tracks.', { limit: z.number().min(1).max(50).default(20), offset: z.number().min(0).default(0) }, async ({ limit, offset }) => {
  const data = await spotifyFetch('/me/tracks', { query: { limit, offset } });
  return { content: [{ type: 'text', text: JSON.stringify((data?.items ?? []).map(i => fmtTrackSlim(i.track))) }] };
});

server.tool('save_track',         'Like/save tracks.',         { track_ids: z.array(z.string()) }, async ({ track_ids }) => { await spotifyFetch('/me/tracks', { method: 'PUT',    body: { ids: track_ids } }); return { content: [{ type: 'text', text: `Saved ${track_ids.length} track(s)` }] }; });
server.tool('remove_saved_track', 'Unlike/remove saved tracks.', { track_ids: z.array(z.string()) }, async ({ track_ids }) => { await spotifyFetch('/me/tracks', { method: 'DELETE', body: { ids: track_ids } }); return { content: [{ type: 'text', text: `Removed ${track_ids.length} track(s)` }] }; });

// ── Discovery ─────────────────────────────────────────────────────────────────

server.tool('get_top_tracks',    'Get your top tracks.',   { time_range: z.enum(['short_term', 'medium_term', 'long_term']).default('medium_term'), limit: z.number().min(1).max(50).default(20) }, async ({ time_range, limit }) => { const data = await spotifyFetch('/me/top/tracks',   { query: { time_range, limit } }); return { content: [{ type: 'text', text: JSON.stringify((data?.items ?? []).map(fmtTrackSlim)) }] }; });
server.tool('get_top_artists',   'Get your top artists.',  { time_range: z.enum(['short_term', 'medium_term', 'long_term']).default('medium_term'), limit: z.number().min(1).max(50).default(20) }, async ({ time_range, limit }) => { const data = await spotifyFetch('/me/top/artists',  { query: { time_range, limit } }); return { content: [{ type: 'text', text: JSON.stringify((data?.items ?? []).map(a => ({ name: a.name, uri: a.uri }))) }] }; });
server.tool('get_recently_played','Get recently played.', { limit: z.number().min(1).max(50).default(20) }, async ({ limit }) => { const data = await spotifyFetch('/me/player/recently-played', { query: { limit } }); return { content: [{ type: 'text', text: JSON.stringify((data?.items ?? []).map(i => fmtTrackSlim(i.track))) }] }; });

server.tool('get_artist', 'Get artist details and recent albums.', { artist_id: z.string() }, async ({ artist_id }) => {
  const id = artist_id.includes(':') ? artist_id.split(':').pop() : artist_id;
  const [artist, tracks, albums] = await Promise.all([
    spotifyFetch(`/artists/${id}`),
    spotifyFetch('/search', { query: { q: `artist:${artist_id.includes(':') ? artist_id.split(':').pop() : artist_id}`, type: 'track', limit: 10 } }),
    spotifyFetch(`/artists/${id}/albums`, { query: { limit: 10 } }),
  ]);
  return { content: [{ type: 'text', text: JSON.stringify({ name: artist.name, genres: artist.genres, followers: artist.followers?.total, popularity: artist.popularity, uri: artist.uri, top_tracks: (tracks?.tracks?.items ?? []).map(fmtTrack), recent_albums: (albums?.items ?? []).map(a => ({ name: a.name, release_date: a.release_date, total_tracks: a.total_tracks, uri: a.uri })) }, null, 2) }] };
});

server.tool('search_audiobook',
  'Search audiobooks by title or author. Returns audiobook URIs that can be played with the play tool.',
  { query: z.string(), limit: z.number().min(1).max(20).default(10) },
  async ({ query, limit }) => {
    const data = await spotifyFetch('/search', { query: { q: query, type: 'audiobook', limit } });
    const items = (data?.audiobooks?.items ?? []).map(a => ({
      name:    a.name,
      authors: a.authors?.map(x => x.name).join(', '),
      narrators: a.narrators?.map(x => x.name).join(', '),
      total_chapters: a.total_chapters,
      uri:     a.uri,
    }));
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool('get_audiobook',
  'Get audiobook details and chapter list.',
  { audiobook_id: z.string() },
  async ({ audiobook_id }) => {
    const id = audiobook_id.includes(':') ? audiobook_id.split(':').pop() : audiobook_id;
    const data = await spotifyFetch(`/audiobooks/${id}`);
    return { content: [{ type: 'text', text: JSON.stringify({
      name:      data.name,
      authors:   data.authors?.map(a => a.name).join(', '),
      narrators: data.narrators?.map(n => n.name).join(', '),
      description: data.description,
      total_chapters: data.total_chapters,
      uri: data.uri,
      chapters: (data.chapters?.items ?? []).map(c => ({ name: c.name, number: c.chapter_number, duration: fmtMs(c.duration_ms), uri: c.uri })),
    }, null, 2) }] };
  }
);

server.tool('search_podcast',
  'Search podcasts by name. Returns show URIs that can be played with the play tool.',
  { query: z.string(), limit: z.number().min(1).max(20).default(10) },
  async ({ query, limit }) => {
    const data = await spotifyFetch('/search', { query: { q: query, type: 'show', limit } });
    const items = (data?.shows?.items ?? []).map(s => ({
      name:      s.name,
      publisher: s.publisher,
      description: s.description?.slice(0, 200),
      total_episodes: s.total_episodes,
      uri: s.uri,
    }));
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool('get_podcast_episodes',
  'Get the most recent episodes of a podcast.',
  { show_id: z.string(), limit: z.number().min(1).max(50).default(20) },
  async ({ show_id, limit }) => {
    const id = show_id.includes(':') ? show_id.split(':').pop() : show_id;
    const data = await spotifyFetch(`/shows/${id}/episodes`, { query: { limit } });
    const items = (data?.items ?? []).map(e => ({
      name: e.name,
      release_date: e.release_date,
      duration: fmtMs(e.duration_ms),
      description: e.description?.slice(0, 200),
      uri: e.uri,
    }));
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool('get_album', 'Get album details and track list.', { album_id: z.string() }, async ({ album_id }) => {
  const id   = album_id.includes(':') ? album_id.split(':').pop() : album_id;
  const data = await spotifyFetch(`/albums/${id}`);
  return { content: [{ type: 'text', text: JSON.stringify({ name: data.name, artist: data.artists?.map(a => a.name).join(', '), release_date: data.release_date, total_tracks: data.total_tracks, uri: data.uri, url: data.external_urls?.spotify, tracks: (data.tracks?.items ?? []).map(t => ({ name: t.name, track_number: t.track_number, duration: fmtMs(t.duration_ms), uri: t.uri })) }, null, 2) }] };
});

// ══════════════════════════════════════════════════════════════════════════════

  return server;
}

async function main() {
  if (prefs.startup_song) {
    try { await spotifyFetch('/me/player/queue', { method: 'POST', query: { uri: prefs.startup_song } }); } catch (_) {}
  }

  const useHttp = process.argv.includes('--http') || process.env.PORT;

  if (useHttp) {
    const portArg = process.argv[process.argv.indexOf('--http') + 1];
    const preferredPort = Number(process.env.PORT || (portArg && !portArg.startsWith('-') ? portArg : null) || 3000);
    const net = require('net');
    const port = await new Promise((resolve) => {
      const tryPort = (p) => {
        const s = net.createServer();
        s.once('error', () => tryPort(p + 1));
        s.once('listening', () => { s.close(); resolve(p); });
        s.listen(p);
      };
      tryPort(preferredPort);
    });
    const express = require('express');
    const app = express();
    app.use(express.json());

    app.use((req, res, next) => {
      console.error(`${req.method} ${req.path} | headers: ${JSON.stringify(req.headers)}`);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id, Authorization');
      if (req.method === 'OPTIONS') return res.sendStatus(200);
      next();
    });

    const sessions = new Map();

    app.post('/mcp', async (req, res) => {
      try {
        const existingId = req.headers['mcp-session-id'];
        if (existingId && sessions.has(existingId)) {
          await sessions.get(existingId).handleRequest(req, res, req.body);
          return;
        }
        const mcpServer = createServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => {
            const id = randomUUID();
            sessions.set(id, transport);
            return id;
          },
        });
        transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (err) {
        if (!res.headersSent) res.status(500).json({ error: err.message });
      }
    });

    app.get('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'];
      if (!sessionId || !sessions.has(sessionId)) return res.status(404).json({ error: 'Session not found' });
      await sessions.get(sessionId).handleRequest(req, res);
    });

    app.delete('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'];
      if (sessionId && sessions.has(sessionId)) {
        await sessions.get(sessionId).close();
        sessions.delete(sessionId);
      }
      res.sendStatus(200);
    });

    app.listen(port, () => console.error(`Spotify MCP HTTP server running on http://localhost:${port}/mcp`));
  } else {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

// Background queue watcher — refills automatically as tracks play
setInterval(async () => {
  try {
    const playback = await spotifyFetch('/me/player');
    if (!playback?.is_playing) return;
    const data = await spotifyFetch('/me/player/queue');
    const depth = (data?.queue ?? []).length;
    if (depth < MIN_QUEUE_DEPTH) await ensureQueueDepth();
  } catch (_) {}
}, 30000);

main().catch(err => { console.error('Server error:', err); process.exit(1); });
