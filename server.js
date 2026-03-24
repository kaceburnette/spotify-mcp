#!/usr/bin/env node

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const SpotifyWebApi = require('spotify-web-api-node');
const fs = require('fs');
const path = require('path');

const TOKEN_PATH = path.join(__dirname, '.spotify-tokens.json');
const CONFIG_PATH = path.join(__dirname, '.spotify-config.json');

// --- Token Management ---

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error('Missing .spotify-config.json — run: node auth-setup.js');
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function loadTokens() {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error('No tokens found — run: node auth-setup.js');
  }
  return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

const config = loadConfig();
const spotify = new SpotifyWebApi({
  clientId: config.clientId,
  clientSecret: config.clientSecret,
});

async function ensureAuth() {
  const tokens = loadTokens();
  spotify.setAccessToken(tokens.accessToken);
  spotify.setRefreshToken(tokens.refreshToken);

  // Refresh if expiring within 5 minutes
  if (Date.now() > tokens.expiresAt - 300000) {
    const data = await spotify.refreshAccessToken();
    const newTokens = {
      accessToken: data.body.access_token,
      refreshToken: tokens.refreshToken,
      expiresAt: Date.now() + data.body.expires_in * 1000,
    };
    saveTokens(newTokens);
    spotify.setAccessToken(newTokens.accessToken);
  }
}

// Helper to run spotify calls with auto-refresh
async function withAuth(fn) {
  await ensureAuth();
  try {
    return await fn();
  } catch (err) {
    // If 401, try refreshing once more
    if (err.statusCode === 401) {
      const tokens = loadTokens();
      spotify.setRefreshToken(tokens.refreshToken);
      const data = await spotify.refreshAccessToken();
      const newTokens = {
        accessToken: data.body.access_token,
        refreshToken: tokens.refreshToken,
        expiresAt: Date.now() + data.body.expires_in * 1000,
      };
      saveTokens(newTokens);
      spotify.setAccessToken(newTokens.accessToken);
      return await fn();
    }
    throw err;
  }
}

// --- Formatters ---

function formatTrack(track) {
  return {
    name: track.name,
    artist: track.artists.map(a => a.name).join(', '),
    album: track.album?.name,
    duration: `${Math.floor(track.duration_ms / 60000)}:${String(Math.floor((track.duration_ms % 60000) / 1000)).padStart(2, '0')}`,
    uri: track.uri,
    url: track.external_urls?.spotify,
  };
}

function formatPlaybackState(state) {
  if (!state || !state.item) {
    return { playing: false, message: 'Nothing is currently playing' };
  }
  return {
    playing: state.is_playing,
    track: formatTrack(state.item),
    device: state.device ? { name: state.device.name, type: state.device.type, volume: state.device.volume_percent } : null,
    shuffle: state.shuffle_state,
    repeat: state.repeat_state,
    progress: `${Math.floor(state.progress_ms / 60000)}:${String(Math.floor((state.progress_ms % 60000) / 1000)).padStart(2, '0')}`,
  };
}

// --- MCP Server ---

const server = new McpServer({
  name: 'spotify',
  version: '1.0.0',
});

// --- Playback Tools ---

server.tool('get_current_track', 'Get the currently playing track', {}, async () => {
  const result = await withAuth(() => spotify.getMyCurrentPlaybackState());
  return { content: [{ type: 'text', text: JSON.stringify(formatPlaybackState(result.body), null, 2) }] };
});

server.tool('play', 'Resume playback or play a specific track/album/playlist. Single tracks auto-queue similar songs so music keeps flowing.', {
  uri: z.string().optional().describe('Spotify URI to play (track, album, playlist). Leave empty to resume.'),
  device_id: z.string().optional().describe('Device ID to play on'),
}, async ({ uri, device_id }) => {
  const options = {};
  if (device_id) options.device_id = device_id;
  if (uri) {
    if (uri.includes(':track:')) {
      options.uris = [uri];
    } else {
      options.context_uri = uri;
    }
  }
  await withAuth(() => spotify.play(options));

  // When playing a single track, auto-queue recommendations so music keeps going
  if (uri && uri.includes(':track:')) {
    try {
      const trackId = uri.split(':').pop();
      const recs = await withAuth(() => spotify.getRecommendations({ seed_tracks: [trackId], limit: 20 }));
      for (const track of recs.body.tracks) {
        await withAuth(() => spotify.addToQueue(track.uri));
      }
    } catch (_) {
      // Non-critical — music still plays, just won't auto-continue
    }
  }

  return { content: [{ type: 'text', text: uri ? `Playing: ${uri}` : 'Resumed playback' }] };
});

server.tool('pause', 'Pause playback', {}, async () => {
  await withAuth(() => spotify.pause());
  return { content: [{ type: 'text', text: 'Paused' }] };
});

server.tool('next_track', 'Skip to next track', {}, async () => {
  await withAuth(() => spotify.skipToNext());
  // Brief delay then fetch what's playing
  await new Promise(r => setTimeout(r, 500));
  const result = await withAuth(() => spotify.getMyCurrentPlaybackState());
  return { content: [{ type: 'text', text: JSON.stringify(formatPlaybackState(result.body), null, 2) }] };
});

server.tool('previous_track', 'Go to previous track', {}, async () => {
  await withAuth(() => spotify.skipToPrevious());
  await new Promise(r => setTimeout(r, 500));
  const result = await withAuth(() => spotify.getMyCurrentPlaybackState());
  return { content: [{ type: 'text', text: JSON.stringify(formatPlaybackState(result.body), null, 2) }] };
});

server.tool('set_volume', 'Set playback volume (0-100)', {
  volume: z.number().min(0).max(100).describe('Volume percentage'),
}, async ({ volume }) => {
  await withAuth(() => spotify.setVolume(volume));
  return { content: [{ type: 'text', text: `Volume set to ${volume}%` }] };
});

server.tool('toggle_shuffle', 'Turn shuffle on or off', {
  enabled: z.boolean().describe('true to enable shuffle, false to disable'),
}, async ({ enabled }) => {
  await withAuth(() => spotify.setShuffle(enabled));
  return { content: [{ type: 'text', text: `Shuffle ${enabled ? 'on' : 'off'}` }] };
});

server.tool('set_repeat', 'Set repeat mode', {
  mode: z.enum(['off', 'track', 'context']).describe('off, track, or context (album/playlist)'),
}, async ({ mode }) => {
  await withAuth(() => spotify.setRepeat(mode));
  return { content: [{ type: 'text', text: `Repeat: ${mode}` }] };
});

server.tool('seek', 'Seek to position in current track', {
  position_seconds: z.number().min(0).describe('Position in seconds'),
}, async ({ position_seconds }) => {
  await withAuth(() => spotify.seek(position_seconds * 1000));
  return { content: [{ type: 'text', text: `Seeked to ${Math.floor(position_seconds / 60)}:${String(Math.floor(position_seconds % 60)).padStart(2, '0')}` }] };
});

server.tool('add_to_queue', 'Add a track to the playback queue', {
  uri: z.string().describe('Spotify track URI (spotify:track:xxxx)'),
}, async ({ uri }) => {
  await withAuth(() => spotify.addToQueue(uri));
  return { content: [{ type: 'text', text: `Added to queue: ${uri}` }] };
});

server.tool('get_queue', 'Get the current playback queue', {}, async () => {
  const result = await withAuth(() => spotify.getMyCurrentPlaybackState());
  // The spotify-web-api-node doesn't have a queue endpoint, so we use a raw request
  await ensureAuth();
  const response = await fetch('https://api.spotify.com/v1/me/player/queue', {
    headers: { Authorization: `Bearer ${spotify.getAccessToken()}` },
  });
  const data = await response.json();
  const queue = {
    currently_playing: data.currently_playing ? formatTrack(data.currently_playing) : null,
    queue: (data.queue || []).slice(0, 20).map(formatTrack),
  };
  return { content: [{ type: 'text', text: JSON.stringify(queue, null, 2) }] };
});

server.tool('get_devices', 'List available playback devices', {}, async () => {
  const result = await withAuth(() => spotify.getMyDevices());
  const devices = result.body.devices.map(d => ({
    id: d.id,
    name: d.name,
    type: d.type,
    active: d.is_active,
    volume: d.volume_percent,
  }));
  return { content: [{ type: 'text', text: JSON.stringify(devices, null, 2) }] };
});

server.tool('transfer_playback', 'Transfer playback to a different device', {
  device_id: z.string().describe('Device ID to transfer to'),
}, async ({ device_id }) => {
  await withAuth(() => spotify.transferMyPlayback([device_id]));
  return { content: [{ type: 'text', text: `Transferred playback to device ${device_id}` }] };
});

// --- Search ---

server.tool('search', 'Search Spotify for tracks, artists, albums, or playlists', {
  query: z.string().describe('Search query'),
  type: z.enum(['track', 'artist', 'album', 'playlist']).default('track').describe('Type to search for'),
  limit: z.number().min(1).max(20).default(10).describe('Number of results'),
}, async ({ query, type, limit }) => {
  const types = [type];
  const result = await withAuth(() => spotify.search(query, types, { limit }));

  let items = [];
  if (type === 'track' && result.body.tracks) {
    items = result.body.tracks.items.map(formatTrack);
  } else if (type === 'artist' && result.body.artists) {
    items = result.body.artists.items.map(a => ({
      name: a.name,
      genres: a.genres,
      followers: a.followers?.total,
      popularity: a.popularity,
      uri: a.uri,
      url: a.external_urls?.spotify,
    }));
  } else if (type === 'album' && result.body.albums) {
    items = result.body.albums.items.map(a => ({
      name: a.name,
      artist: a.artists.map(ar => ar.name).join(', '),
      release_date: a.release_date,
      total_tracks: a.total_tracks,
      uri: a.uri,
      url: a.external_urls?.spotify,
    }));
  } else if (type === 'playlist' && result.body.playlists) {
    items = result.body.playlists.items.map(p => ({
      name: p.name,
      owner: p.owner?.display_name,
      tracks: p.tracks?.total,
      uri: p.uri,
      url: p.external_urls?.spotify,
    }));
  }
  return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
});

// --- Library ---

server.tool('get_playlists', 'Get your playlists', {
  limit: z.number().min(1).max(50).default(20).describe('Number of playlists to return'),
}, async ({ limit }) => {
  const result = await withAuth(() => spotify.getUserPlaylists({ limit }));
  const playlists = result.body.items.map(p => ({
    name: p.name,
    tracks: p.tracks?.total,
    owner: p.owner?.display_name,
    uri: p.uri,
    url: p.external_urls?.spotify,
  }));
  return { content: [{ type: 'text', text: JSON.stringify(playlists, null, 2) }] };
});

server.tool('get_playlist_tracks', 'Get tracks in a playlist', {
  playlist_id: z.string().describe('Playlist ID or URI'),
  limit: z.number().min(1).max(50).default(30).describe('Number of tracks'),
}, async ({ playlist_id, limit }) => {
  // Extract ID from URI if needed
  const id = playlist_id.includes(':') ? playlist_id.split(':').pop() : playlist_id;
  const result = await withAuth(() => spotify.getPlaylistTracks(id, { limit }));
  const tracks = result.body.items
    .filter(item => item.track)
    .map(item => ({
      ...formatTrack(item.track),
      added_at: item.added_at,
      added_by: item.added_by?.id,
    }));
  return { content: [{ type: 'text', text: JSON.stringify(tracks, null, 2) }] };
});

server.tool('create_playlist', 'Create a new playlist', {
  name: z.string().describe('Playlist name'),
  description: z.string().optional().describe('Playlist description'),
  public: z.boolean().default(false).describe('Whether the playlist is public'),
}, async ({ name, description, public: isPublic }) => {
  const me = await withAuth(() => spotify.getMe());
  const result = await withAuth(() =>
    spotify.createPlaylist(me.body.id, name, { description: description || '', public: isPublic })
  );
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        name: result.body.name,
        uri: result.body.uri,
        url: result.body.external_urls?.spotify,
      }, null, 2),
    }],
  };
});

server.tool('add_to_playlist', 'Add tracks to a playlist', {
  playlist_id: z.string().describe('Playlist ID'),
  uris: z.array(z.string()).describe('Array of Spotify track URIs'),
}, async ({ playlist_id, uris }) => {
  const id = playlist_id.includes(':') ? playlist_id.split(':').pop() : playlist_id;
  await withAuth(() => spotify.addTracksToPlaylist(id, uris));
  return { content: [{ type: 'text', text: `Added ${uris.length} track(s) to playlist` }] };
});

// --- Saved Tracks ---

server.tool('get_saved_tracks', 'Get your liked/saved tracks', {
  limit: z.number().min(1).max(50).default(20).describe('Number of tracks'),
  offset: z.number().min(0).default(0).describe('Offset for pagination'),
}, async ({ limit, offset }) => {
  const result = await withAuth(() => spotify.getMySavedTracks({ limit, offset }));
  const tracks = result.body.items.map(item => ({
    ...formatTrack(item.track),
    saved_at: item.added_at,
  }));
  return { content: [{ type: 'text', text: JSON.stringify(tracks, null, 2) }] };
});

server.tool('save_track', 'Save/like a track', {
  track_ids: z.array(z.string()).describe('Track IDs to save'),
}, async ({ track_ids }) => {
  await withAuth(() => spotify.addToMySavedTracks(track_ids));
  return { content: [{ type: 'text', text: `Saved ${track_ids.length} track(s)` }] };
});

server.tool('remove_saved_track', 'Remove a track from saved/liked', {
  track_ids: z.array(z.string()).describe('Track IDs to remove'),
}, async ({ track_ids }) => {
  await withAuth(() => spotify.removeFromMySavedTracks(track_ids));
  return { content: [{ type: 'text', text: `Removed ${track_ids.length} track(s) from saved` }] };
});

// --- Discovery ---

server.tool('get_recommendations', 'Get track recommendations based on seeds', {
  seed_tracks: z.array(z.string()).optional().describe('Track IDs to seed (max 5 total seeds)'),
  seed_artists: z.array(z.string()).optional().describe('Artist IDs to seed'),
  seed_genres: z.array(z.string()).optional().describe('Genre names to seed'),
  limit: z.number().min(1).max(50).default(20).describe('Number of recommendations'),
}, async ({ seed_tracks, seed_artists, seed_genres, limit }) => {
  const options = { limit };
  if (seed_tracks) options.seed_tracks = seed_tracks;
  if (seed_artists) options.seed_artists = seed_artists;
  if (seed_genres) options.seed_genres = seed_genres;

  const result = await withAuth(() => spotify.getRecommendations(options));
  const tracks = result.body.tracks.map(formatTrack);
  return { content: [{ type: 'text', text: JSON.stringify(tracks, null, 2) }] };
});

server.tool('get_top_tracks', 'Get your top tracks', {
  time_range: z.enum(['short_term', 'medium_term', 'long_term']).default('medium_term')
    .describe('short_term (~4 weeks), medium_term (~6 months), long_term (all time)'),
  limit: z.number().min(1).max(50).default(20).describe('Number of tracks'),
}, async ({ time_range, limit }) => {
  const result = await withAuth(() => spotify.getMyTopTracks({ time_range, limit }));
  const tracks = result.body.items.map(formatTrack);
  return { content: [{ type: 'text', text: JSON.stringify(tracks, null, 2) }] };
});

server.tool('get_top_artists', 'Get your top artists', {
  time_range: z.enum(['short_term', 'medium_term', 'long_term']).default('medium_term')
    .describe('short_term (~4 weeks), medium_term (~6 months), long_term (all time)'),
  limit: z.number().min(1).max(50).default(20).describe('Number of artists'),
}, async ({ time_range, limit }) => {
  const result = await withAuth(() => spotify.getMyTopArtists({ time_range, limit }));
  const artists = result.body.items.map(a => ({
    name: a.name,
    genres: a.genres,
    popularity: a.popularity,
    uri: a.uri,
    url: a.external_urls?.spotify,
  }));
  return { content: [{ type: 'text', text: JSON.stringify(artists, null, 2) }] };
});

server.tool('get_recently_played', 'Get recently played tracks', {
  limit: z.number().min(1).max(50).default(20).describe('Number of tracks'),
}, async ({ limit }) => {
  const result = await withAuth(() => spotify.getMyRecentlyPlayedTracks({ limit }));
  const tracks = result.body.items.map(item => ({
    ...formatTrack(item.track),
    played_at: item.played_at,
  }));
  return { content: [{ type: 'text', text: JSON.stringify(tracks, null, 2) }] };
});

// --- Artist Info ---

server.tool('get_artist', 'Get details about an artist', {
  artist_id: z.string().describe('Artist ID or URI'),
}, async ({ artist_id }) => {
  const id = artist_id.includes(':') ? artist_id.split(':').pop() : artist_id;
  const [artist, topTracks, albums] = await Promise.all([
    withAuth(() => spotify.getArtist(id)),
    withAuth(() => spotify.getArtistTopTracks(id, 'US')),
    withAuth(() => spotify.getArtistAlbums(id, { limit: 10 })),
  ]);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        name: artist.body.name,
        genres: artist.body.genres,
        followers: artist.body.followers?.total,
        popularity: artist.body.popularity,
        uri: artist.body.uri,
        url: artist.body.external_urls?.spotify,
        top_tracks: topTracks.body.tracks.map(formatTrack),
        recent_albums: albums.body.items.map(a => ({
          name: a.name,
          release_date: a.release_date,
          total_tracks: a.total_tracks,
          uri: a.uri,
        })),
      }, null, 2),
    }],
  };
});

// --- Album ---

server.tool('get_album', 'Get details about an album', {
  album_id: z.string().describe('Album ID or URI'),
}, async ({ album_id }) => {
  const id = album_id.includes(':') ? album_id.split(':').pop() : album_id;
  const result = await withAuth(() => spotify.getAlbum(id));
  const album = result.body;
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        name: album.name,
        artist: album.artists.map(a => a.name).join(', '),
        release_date: album.release_date,
        total_tracks: album.total_tracks,
        uri: album.uri,
        url: album.external_urls?.spotify,
        tracks: album.tracks.items.map(t => ({
          name: t.name,
          track_number: t.track_number,
          duration: `${Math.floor(t.duration_ms / 60000)}:${String(Math.floor((t.duration_ms % 60000) / 1000)).padStart(2, '0')}`,
          uri: t.uri,
        })),
      }, null, 2),
    }],
  };
});

// --- Start Server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error('Server error:', err);
  process.exit(1);
});
