// Track artwork is fetched once per key, outside the host-state poll.
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');

function bgraToRGB565(bgra) {
  const out = Buffer.alloc(bgra.length / 2);
  for (let i = 0, j = 0; i < bgra.length; i += 4, j += 2) {
    const v = ((bgra[i + 2] & 0xF8) << 8) | ((bgra[i + 1] & 0xFC) << 3) | (bgra[i] >> 3);
    out.writeUInt16LE(v, j);
  }
  return out;
}
const asText = s => '"' + String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
async function fetchData(url, json = false) {
  if (!/^https:\/\//i.test(url)) return null;
  const { net } = require('electron'), ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  try {
    const r = await net.fetch(url, { signal: ac.signal });
    if (!r.ok) return null;
    return json ? await r.json() : Buffer.from(await r.arrayBuffer());
  } finally { clearTimeout(timer); }
}
// Apple Music for Windows reports "Artist — Album" as the artist; search with the artist part only.
const mainArtist = a => String(a || '').split(/\s+[\u2014\u2013]\s+/)[0].trim();
async function fallback(c) {
  const r = await fetchData('https://itunes.apple.com/search?term=' + encodeURIComponent(mainArtist(c.artist) + ' ' + c.title) + '&entity=song&limit=1', true);
  const url = r && r.results && r.results[0] && r.results[0].artworkUrl100;
  return url ? fetchData(url.replace('100x100', '300x300')) : null;
}
function create({ run, ps }) {
  const cache = new Map();
  function prune() {
    for (const [key, e] of cache) { if (cache.size <= 8) break; if (!e.pending) cache.delete(key); }
  }
  async function source(c) {
    if (process.platform === 'win32') {
      // Windows' media session thumbnail first; Apple Music for Windows often has none -> iTunes catalogue artwork
      const r = await ps('art', { app: c.app, title: c.title, artist: c.artist }, 12000);
      if (r.ok && r.r) return Buffer.from(r.r, 'base64');
      return c.player === 'music' || c.tries > 1 ? fallback(c) : null;
    }
    const app = c.player === 'spotify' ? 'Spotify' : 'Music';
    // Verify the raw metadata again: a track can change while the background job is starting.
    const guard = `if (name of current track) is not ${asText(c.title)} or (artist of current track) is not ${asText(c.artist)} then return ""`;
    if (c.player === 'spotify') {
      const r = await run('osascript', ['-'], 4000, `tell application "${app}"\n${guard}\nreturn artwork url of current track\nend tell`);
      const url = r.code ? '' : r.stdout.trim();
      return /^https:\/\//i.test(url) ? fetchData(url) : fallback(c);
    }
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'volkan-art-')), file = path.join(dir, 'cover');
    try {
      const script = `set vdArt to missing value
tell application "Music"
  ${guard}
  if (count of artworks of current track) > 0 then set vdArt to raw data of artwork 1 of current track
end tell
if vdArt is not missing value then
  set vdFile to open for access POSIX file ${asText(file)} with write permission
  try
    set eof vdFile to 0
    write vdArt to vdFile
    close access vdFile
  on error
    try
      close access vdFile
    end try
  end try
end if`;
      const r = await run('osascript', ['-'], 4000, script);
      if (!r.code) { try { const b = await fs.readFile(file); if (b.length) return b; } catch (e) {} }
      return await fallback(c);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  }
  async function load(c) {
    const b = await source(c); if (!b || !b.length) return null;
    const { nativeImage } = require('electron');
    let img = nativeImage.createFromBuffer(b); if (img.isEmpty()) return null;
    const { width, height } = img.getSize(), side = Math.min(width, height);
    if (width !== height) img = img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side });
    const bitmap = img.resize({ width: 64, height: 64, quality: 'best' }).toBitmap({ scaleFactor: 1 });
    return bitmap.length === 64 * 64 * 4 ? bgraToRGB565(bitmap).toString('base64') : null;
  }
  function request(c) {
    if (!c || !c.title || !['spotify', 'music'].includes(c.player) || !['darwin', 'win32'].includes(process.platform)) return '';
    const key = createHash('sha256').update(JSON.stringify([c.player, c.title, c.artist, c.app || ''])).digest('hex');
    let e = cache.get(key);
    const start = () => {
      e.pending = true; e.tries = (e.tries || 0) + 1; e.at = Date.now();
      const job = { ...c, tries: e.tries };
      setImmediate(() => load(job).then(data => { e.data = data; }).catch(() => {}).finally(() => { e.pending = false; prune(); }));
    };
    if (e) {
      cache.delete(key); cache.set(key, e);
      // the player often publishes the cover a moment after the title: try again a few times
      if (!e.pending && !e.data && e.tries < 3 && Date.now() - e.at > 4000) start();
    } else {
      e = { pending: false, data: null, tries: 0, at: 0 }; cache.set(key, e); start();
      prune();
    }
    return e.pending || e.data ? key : '';
  }
  function get(key) { const e = cache.get(key); return e && e.data ? { key, w: 64, h: 64, data: e.data } : null; }
  return { request, get };
}
module.exports = { create, bgraToRGB565 };
