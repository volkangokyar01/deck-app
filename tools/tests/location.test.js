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
    assert.equal(stats.get().location.city, 'Ankara'); assert.equal(stats.get().location.source, 'geo');
    assert.equal(stats.get().location.error, 'Konum bulunamadı'); assert.equal(stats.get().weather.city, 'Ankara');
  } finally { stats.stop(); }
});
