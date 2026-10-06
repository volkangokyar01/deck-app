const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStats, parseLocation, resolveLocation } = require('../../app/stats');
const tick = () => new Promise(resolve => setImmediate(resolve));
const ankara = { city: 'Ankara', latitude: '39.933399', longitude: 32.859699 };
const response = j => ({ ok: true, json: async () => j });

test('IP location validates error responses, city and coordinates, and converts device text', () => {
  assert.deepEqual(parseLocation(ankara), { city: 'Ankara', lat: 39.9334, lon: 32.8597 });
  assert.equal(parseLocation({ ...ankara, error: true }), null);
  assert.equal(parseLocation({ ...ankara, success: false }), null);
  for (const latitude of [null, '', 91, 'bad']) assert.equal(parseLocation({ ...ankara, latitude }), null);
  assert.equal(parseLocation({ ...ankara, city: '' }), null);
  assert.equal(parseLocation({ ...ankara, city: 'München 🌦' }).city, 'München');
});

test('IP fallback handles transport, HTTP and provider errors; each fetch has a timeout', async () => {
  for (const failure of ['throw', 'http', 'provider', 'malformed']) {
    const calls = [];
    const result = await resolveLocation(async (url, options) => {
      calls.push(url); assert.ok(options.signal instanceof AbortSignal);
      if (calls.length === 1) {
        if (failure === 'throw') throw Error('offline');
        if (failure === 'http') return { ok: false, status: 429 };
        return response(failure === 'provider' ? { success: false } : { ...ankara, latitude: 999 });
      }
      return response(ankara);
    });
    assert.deepEqual(calls, ['https://ipapi.co/json/', 'https://ipwho.is/']);
    assert.equal(result.city, 'Ankara');
  }
  let calls = 0;
  assert.equal((await resolveLocation(async () => { calls++; return response(ankara); })).city, 'Ankara');
  assert.equal(calls, 1);
  assert.equal(await resolveLocation(async () => { throw Error('offline'); }), null);
});

test('automatic weather uses resolved coordinates; failure retains last location; manual choice survives pending lookup', async () => {
  let fail = false, pending = null;
  const stats = createStats({ platform: 'test', fetch: async url => {
    if (url.includes('ipapi') || url.includes('ipwho')) {
      if (pending) return new Promise(resolve => { pending.resolve = resolve; });
      if (fail) throw Error('offline');
      return response(ankara);
    }
    return response(url.includes('open-meteo') ? { current: { temperature_2m: 20 }, daily: {} } : []);
  } });
  try {
    const w = { auto: true, city: 'İstanbul', lat: 41.01, lon: 28.97 };
    stats.get({ weather: w }); stats.start(); await tick(); await tick();
    assert.equal(stats.get().location.city, 'Ankara'); assert.equal(stats.get().weather.city, 'Ankara');
    stats.get({ weather: w }); assert.equal(stats.get().weather.city, 'Ankara', 'stale renderer input cannot reset resolved city');
    fail = true; await stats.refreshLocation();
    assert.equal(stats.get().location.error, 'Konum bulunamadı'); assert.equal(stats.get().weather.city, 'Ankara');
    fail = false; pending = {}; const lookup = stats.refreshLocation(); await tick();
    stats.get({ weather: { auto: false, city: 'İzmir', lat: 38.42, lon: 27.14 } });
    pending.resolve(response(ankara)); await lookup; await tick();
    assert.equal(stats.get().weather.city, 'İzmir');
  } finally { stats.stop(); }
});

test('IP location refreshes at startup and on the six-hour timer, not on every IPC read', async t => {
  const timers = new Map();
  t.mock.method(global, 'setInterval', (fn, ms) => { timers.set(ms, fn); return {}; });
  let lookups = 0;
  const stats = createStats({ platform: 'test', fetch: async url => {
    if (url.includes('ipapi')) { lookups++; return response(ankara); }
    return response(url.includes('open-meteo') ? { current: { temperature_2m: 20 }, daily: {} } : []);
  } });
  try {
    const w = { auto: true, city: 'İstanbul', lat: 41.01, lon: 28.97 };
    stats.get({ weather: w }); stats.start(); await tick();
    assert.equal(lookups, 1);
    for (let i = 0; i < 10; i++) stats.get({ weather: w });
    assert.equal(lookups, 1);
    assert.ok(timers.has(6 * 3600000));
    timers.get(6 * 3600000)(); await tick(); assert.equal(lookups, 2);
  } finally { stats.stop(); }
});

const { parseReverseLocation, reverseLocation, resolveWeatherLocation } = require('../../app/stats');
test('reverse geocoding parses both providers and preserves OS coordinates', async () => {
  const geo = { lat: 39.933399, lon: 32.859699 };
  for (const j of [{ city: 'Ankara', locality: 'Çankaya' }, { locality: 'Ankara' }, { address: { city: 'Ankara' } }, { address: { town: 'Ankara' } }]) {
    assert.deepEqual(parseReverseLocation(j, geo.lat, geo.lon), { city: 'Ankara', lat: 39.9334, lon: 32.8597 });
  }
  assert.equal(parseReverseLocation({ error: 'bad', city: 'Ankara' }, 39, 32), null);
  const calls = [];
  const loc = await reverseLocation(async (url, options) => {
    calls.push(url); assert.ok(options.signal instanceof AbortSignal);
    if (calls.length === 1) return response({ error: 'bad' });
    assert.match(options.headers['User-Agent'], /VolkanDeck.*https:/);
    return response({ address: { city: 'Ankara' } });
  }, geo);
  assert.equal(loc.source, 'geo'); assert.equal(loc.city, 'Ankara');
  assert.match(calls[0], /localityLanguage=tr/); assert.match(calls[1], /nominatim/);
  assert.equal((await reverseLocation(async () => { throw Error('offline'); }, geo)).city, 'Konumum');
});
test('OS location wins; denied or invalid location falls back to IP; total failure keeps last', async () => {
  const calls = [], fetch = async url => { calls.push(url); return response(url.includes('reverse-geocode') ? { city: 'Ankara' } : ankara); };
  assert.equal((await resolveWeatherLocation(fetch, { lat: 39, lon: 32 })).source, 'geo');
  assert.equal(calls.length, 1); assert.match(calls[0], /reverse-geocode/);
  calls.length = 0;
  assert.equal((await resolveWeatherLocation(fetch, null)).source, 'ip'); assert.match(calls[0], /ipapi/);
  assert.equal((await resolveWeatherLocation(fetch, { lat: NaN, lon: 0 })).source, 'ip');
  let fail = false;
  const stats = createStats({ platform: 'test', fetch: async url => {
    if (fail) throw Error('offline');
    return response(url.includes('reverse-geocode') ? { city: 'Ankara' } : url.includes('open-meteo') ? { current: { temperature_2m: 20 }, daily: {} } : []);
  } });
  try {
    stats.get({ weather: { auto: true, city: 'İstanbul', lat: 41, lon: 29 }, geolocation: { pending: true } });
    stats.start(); await tick(); assert.equal(stats.get().location, undefined, 'IP waits for the renderer');
    stats.get({ weather: { auto: true }, geolocation: { lat: 39, lon: 32 } }); await tick();
    assert.equal(stats.get().location.source, 'geo');
    fail = true; stats.get({ weather: { auto: true }, geolocation: null }); await tick(); await tick();
    assert.equal(stats.get().location.city, 'Ankara'); assert.equal(stats.get().location.source, 'last');
    assert.equal(stats.get().location.error, ''); assert.equal(stats.get().weather.city, 'Ankara');
  } finally { stats.stop(); }
});

test('system location persists across restarts; denial never requests IP; recovery returns to geo', async t => {
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deck-location-test-'));
  t.after(() => fs.rm(cacheDir, { recursive: true, force: true }));
  const calls = [];
  let city = 'Adana';
  const fetch = async url => {
    calls.push(url);
    if (url.includes('ipapi') || url.includes('ipwho')) return response({ city: 'İstanbul', latitude: 41, longitude: 29 });
    return response(url.includes('reverse-geocode') ? { city } : url.includes('open-meteo') ? { current: { temperature_2m: 20 }, daily: {} } : []);
  };
  const weather = { auto: true, city: 'İstanbul', lat: 41, lon: 29 };
  const first = createStats({ platform: 'test', cacheDir, fetch });
  t.after(() => first.stop());
  first.get({ weather, geolocation: { lat: 37, lon: 35.32 } }); first.start(); await tick();
  assert.equal(first.get().location.source, 'geo');
  const saved = JSON.parse(await fs.readFile(path.join(cacheDir, 'last-system-location.json'), 'utf8'));
  assert.deepEqual({ city: saved.city, lat: saved.lat, lon: saved.lon }, { city: 'Adana', lat: 37, lon: 35.32 });
  assert.ok(saved.at > 0);
  first.get({ weather, geolocation: null }); await tick();
  assert.equal(first.get().location.source, 'last');
  first.stop(); calls.length = 0;
  const restarted = createStats({ platform: 'test', cacheDir, fetch });
  t.after(() => restarted.stop());
  restarted.get({ weather, geolocation: { pending: true } }); restarted.start(); await tick();
  assert.equal(restarted.get().location.city, 'Adana');
  restarted.get({ weather, geolocation: null }); await tick();
  assert.equal(restarted.get().location.source, 'last');
  assert.equal(restarted.get().weather.city, 'Adana');
  await restarted.refreshLocation();
  assert.equal(calls.some(url => /ipapi|ipwho/.test(url)), false, 'remembered system location wins over differing IP city');
  city = 'Mersin';
  restarted.get({ weather, geolocation: { lat: 36.8, lon: 34.63 } }); await tick();
  assert.equal(restarted.get().location.source, 'geo');
  assert.equal(restarted.get().weather.city, 'Mersin');
  assert.equal(JSON.parse(await fs.readFile(path.join(cacheDir, 'last-system-location.json'), 'utf8')).city, 'Mersin');
});

test('no remembered system location uses IP without storing it as a system location', async t => {
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deck-location-ip-test-'));
  t.after(() => fs.rm(cacheDir, { recursive: true, force: true }));
  const calls = [], stats = createStats({ platform: 'test', cacheDir, fetch: async url => {
    calls.push(url);
    return response(url.includes('ipapi') ? ankara : url.includes('open-meteo') ? { current: {}, daily: {} } : []);
  } });
  t.after(() => stats.stop());
  stats.get({ weather: { auto: true }, geolocation: null }); stats.start(); await tick();
  assert.equal(stats.get().location.source, 'ip'); assert.ok(calls.some(url => url.includes('ipapi')));
  await assert.rejects(fs.stat(path.join(cacheDir, 'last-system-location.json')), { code: 'ENOENT' });
});

test('denied system location keeps refreshing weather every 15 minutes from persisted last coordinates', async t => {
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deck-weather-last-test-'));
  t.after(() => fs.rm(cacheDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(cacheDir, 'last-system-location.json'), JSON.stringify({ city: 'Adana', lat: 37, lon: 35.32, at: 1 }));
  const timers = new Map(), weatherCalls = [];
  t.mock.method(global, 'setInterval', (fn, ms) => { timers.set(ms, fn); return {}; });
  const stats = createStats({ platform: 'test', cacheDir, fetch: async url => {
    assert.equal(/ipapi|ipwho|reverse-geocode|nominatim/.test(url), false);
    if (url.includes('open-meteo')) {
      const params = new URL(url).searchParams;
      assert.equal(params.get('latitude'), '37'); assert.equal(params.get('longitude'), '35.32');
      weatherCalls.push(url);
      return response({ current: { temperature_2m: 20 + weatherCalls.length }, daily: {} });
    }
    return response([]);
  } });
  t.after(() => stats.stop());
  const weather = { auto: true, city: 'İstanbul', lat: 41, lon: 29 };
  stats.get({ weather, geolocation: null }); stats.start(); await tick(); await tick();
  assert.equal(stats.get().location.source, 'last');
  assert.equal(stats.get().weather.city, 'Adana');
  assert.equal(stats.get().weather.temp, 21);
  for (let i = 0; i < 3; i++) {
    timers.get(15 * 60e3)(); await tick();
    // Renderer IPC polls with old config cannot stop or redirect weather refresh.
    stats.get({ weather });
    assert.equal(stats.get().weather.temp, 22 + i);
    assert.equal(stats.get().location.source, 'last');
  }
  assert.equal(weatherCalls.length, 4);
});
