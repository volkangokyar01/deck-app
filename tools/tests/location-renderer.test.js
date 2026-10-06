const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../app/companion.js'), 'utf8');
function renderer({ denied = false, available = true, previous = '', permission = denied || previous === 'attempted' ? 'denied' : 'granted', pending = false, snapshot = null, noDOM = false } = {}) {
  const stored = new Map(previous ? [['test.location-attempt', previous]] : []), calls = [], timers = [], ui = { textContent: '' };
  let asks = 0, checks = 0;
  const state = { denied, permission, snapshot };
  const ctx = vm.createContext({ Date, KEY: 'test', cfg: { home: { weather: { auto: true, city: 'İstanbul', lat: 41, lon: 29 } } },
    updateState: null, weatherLocationStatus: '', weatherLocationSource: '', weatherLocationFailed: false, window: {},
    weatherLocationLabel: () => '', document: { getElementById: () => noDOM ? null : ui }, save() {}, drawScreen() {}, renderJson() {},
    localStorage: { getItem: k => stored.get(k), setItem: (k, v) => stored.set(k, v) },
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
    navigator: { permissions: { query: async () => ({ state: state.permission }) }, geolocation: { getCurrentPosition: (ok, fail, options) => {
      asks++; assert.equal(options.timeout, 15000); assert.equal(options.maximumAge, 3600000);
      if (pending) return;
      if (state.denied) fail({ code: 1 }); else ok({ coords: { latitude: 39.93, longitude: 32.85 } });
    } } },
    deck: { locationAvailable: async () => { checks++; return available; }, stats: async o => {
      calls.push(o); return { location: state.snapshot || { city: 'Ankara', lat: 39.93, lon: 32.85, source: 'ip' } };
    } } });
  const start = source.indexOf('  let locationPolling =');
  vm.runInContext(source.slice(start, source.indexOf('  pollLocation(); setInterval', start)), ctx);
  return { ctx, calls, timers, stored, state, ui, asks: () => asks, checks: () => checks };
}
test('renderer asks once on first auto use, persists denial, falls back and retries only explicitly', async () => {
  const r = renderer({ denied: true });
  await r.ctx.requestLocation(); assert.equal(r.asks(), 1);
  assert.equal(r.ctx.weatherLocationFailed, true);
  assert.equal(r.calls[0].geolocation.pending, true); assert.equal(r.calls[1].geolocation, null);
  await r.ctx.requestLocation(); assert.equal(r.asks(), 1);
  await r.ctx.window.retryWeatherLocation(); assert.equal(r.asks(), 2);
  r.ctx.cfg.home.weather.auto = false; await r.ctx.window.retryWeatherLocation(); assert.equal(r.asks(), 2);
  const restarted = renderer({ previous: 'attempted' }); await restarted.ctx.requestLocation(); assert.equal(restarted.asks(), 0);
});
test('successful permission is cached; revoked permission and missing macOS plist use fallback', async () => {
  const r = renderer(); await r.ctx.requestLocation(); assert.equal(r.ctx.weatherLocationFailed, false); assert.equal(r.stored.get('test.location-attempt'), 'granted');
  assert.deepEqual(JSON.parse(JSON.stringify(r.calls[1].geolocation)), { lat: 39.93, lon: 32.85 });
  const revoked = renderer({ previous: 'granted', permission: 'denied' }); await revoked.ctx.requestLocation(); assert.equal(revoked.asks(), 0);
  const oldBundle = renderer({ available: false }); await oldBundle.ctx.requestLocation(); assert.equal(oldBundle.asks(), 0);
  assert.equal(oldBundle.calls[1].geolocation, null);
});
test('renderer has its own timeout and falls back even if geolocation never calls back', async () => {
  const r = renderer({ pending: true }), result = r.ctx.requestLocation();
  await new Promise(resolve => setImmediate(resolve));
  r.timers[0](); await result; assert.equal(r.calls[1].geolocation, null);
});
test('permission handlers allow geolocation only for the own page; existing permissions stay allowed', () => {
  let check, request;
  const own = { getURL: () => 'file:///repo/app/index.html' };
  const ctx = vm.createContext({ session: { defaultSession: { on() {}, setPermissionCheckHandler: fn => { check = fn; },
    setPermissionRequestHandler: fn => { request = fn; }, setDevicePermissionHandler() {} } },
    win: { webContents: own }, path, pathToFileURL: require('node:url').pathToFileURL, __dirname: '/repo/app', setInterval() {} });
  const main = fs.readFileSync(path.join(__dirname, '../../app/main.js'), 'utf8'), start = main.indexOf('function setupSerial()');
  vm.runInContext(main.slice(start, main.indexOf('/* ---------------- launching', start)), ctx); ctx.setupSerial();
  assert.equal(check(own, 'geolocation'), true); assert.equal(check({ getURL: () => 'https://other.test/' }, 'geolocation'), false);
  assert.equal(check(own, 'geolocation', '', { requestingUrl: 'https://other.test/' }), false);
  for (const perm of ['serial', 'notifications', 'clipboard-sanitized-write', 'clipboard-read']) assert.equal(check(own, perm), true);
  assert.equal(check(own, 'camera'), false);
  let allowed; request(own, 'geolocation', v => { allowed = v; }, { requestingUrl: own.getURL() }); assert.equal(allowed, true);
  request(own, 'geolocation', v => { allowed = v; }, { requestingUrl: 'https://other.test/' }); assert.equal(allowed, false);
});

test('renderer keeps the remembered system city after denial and switches back on explicit retry', async () => {
  const r = renderer({ previous: 'granted', permission: 'denied', noDOM: true,
    snapshot: { city: 'Adana', lat: 37, lon: 35.32, source: 'last' } });
  await r.ctx.requestLocation();
  assert.equal(r.asks(), 0); assert.equal(r.ctx.cfg.home.weather.city, 'Adana');
  assert.equal(r.ctx.weatherLocationSource, 'last'); assert.equal(r.ctx.weatherLocationFailed, true);
  r.state.denied = false; r.state.permission = 'granted';
  r.state.snapshot = { city: 'Adana', lat: 37, lon: 35.32, source: 'geo' };
  await r.ctx.window.retryWeatherLocation();
  assert.equal(r.asks(), 1); assert.equal(r.ctx.weatherLocationSource, 'geo'); assert.equal(r.ctx.weatherLocationFailed, false);
});
test('hourly permission re-check recovers from denial silently without repeated prompts', async t => {
  let now = 10000000; t.mock.method(Date, 'now', () => now);
  const r = renderer({ denied: true, snapshot: { city: 'Adana', lat: 37, lon: 35.32, source: 'last' } });
  await r.ctx.requestLocation(); assert.equal(r.asks(), 1);
  now += 3600000; await r.ctx.pollLocation();
  assert.equal(r.asks(), 1, 'denied permission is checked without prompting');
  r.state.denied = false; r.state.permission = 'granted';
  r.state.snapshot = { city: 'Adana', lat: 37, lon: 35.32, source: 'geo' };
  now += 3600000; await r.ctx.pollLocation();
  assert.equal(r.asks(), 2); assert.equal(r.ctx.weatherLocationSource, 'geo'); assert.equal(r.ctx.weatherLocationFailed, false);
});
test('first location poll safely updates IP fallback without existing DOM', async () => {
  const r = renderer({ denied: true, noDOM: true });
  await r.ctx.pollLocation();
  assert.equal(r.ctx.weatherLocationSource, 'ip'); assert.equal(r.ctx.cfg.home.weather.city, 'Ankara');
});

test('hourly system-location retries continue through multiple failures while source is last', async t => {
  let now = 10000000; t.mock.method(Date, 'now', () => now);
  const r = renderer({ denied: true, snapshot: { city: 'Adana', lat: 37, lon: 35.32, source: 'last' } });
  await r.ctx.pollLocation();
  for (let hour = 1; hour <= 3; hour++) {
    now += 3600000; await r.ctx.pollLocation();
    assert.equal(r.calls.filter(o => o.geolocation?.pending).length, hour + 1);
    assert.equal(r.ctx.cfg.home.weather.city, 'Adana');
    assert.equal(r.ctx.weatherLocationSource, 'last');
  }
  r.state.denied = false; r.state.permission = 'granted';
  r.state.snapshot = { city: 'Adana', lat: 37, lon: 35.32, source: 'geo' };
  now += 3600000; await r.ctx.pollLocation();
  assert.equal(r.asks(), 2); assert.equal(r.ctx.weatherLocationSource, 'geo');
});
