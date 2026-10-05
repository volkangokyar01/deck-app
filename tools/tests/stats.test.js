const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStats, parseNvidia, parseMacmon, parseNetstat, netDelta, cpuName } = require('../../app/stats');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('NVIDIA CSV: name, zero fan, MiB to GB, unsupported and malformed values', () => {
  assert.deepEqual(parseNvidia('NVIDIA GeForce RTX 5070, 61, 64, 180.3, 0, 5324.8, 12288\r'), {
    name: 'RTX 5070', temp: 61, load: 64, power: 180.3, fan: 0, vram: 5.2, vramTotal: 12
  });
  assert.deepEqual(parseNvidia('NVIDIA GeForce RTX 5070, [N/A], 3, [Not Supported], [N/A], [Not Supported], 12288'), {
    name: 'RTX 5070', temp: null, load: 3, power: null, fan: null, vram: null, vramTotal: 12
  });
  assert.deepEqual(parseNvidia('NVIDIA RTX A4000, 999, -1, bad, 101, -1, NaN'), {
    name: 'RTX A4000', temp: null, load: null, power: null, fan: null, vram: null, vramTotal: null
  });
  assert.equal(parseNvidia('driver error'), null);
});

test('macmon units, real schema and missing fields; CPU name tidying', () => {
  const m = parseMacmon({ temp: { cpu_temp_avg: 44.5, gpu_temp_avg: 38 }, cpu_power: 4, gpu_power: 2,
    cpu_active_ratio: .2, gpu_active_ratio: .1, ecpu_cores: [{ freq_mhz: 1000 }], pcpu_cores: [{ freq_mhz: 3000 }] }, 'Apple M2');
  assert.deepEqual(m.cpu, { temp: 44.5, load: 20, power: 4, clock: 2 });
  assert.equal(m.gpu.name, 'Apple M2 GPU'); assert.equal(m.gpu.load, 10); assert.equal(m.gpu.vram, null);
  assert.equal(parseMacmon({}, '').cpu.temp, null); assert.equal(parseMacmon({}, '').gpu.load, null);
  assert.equal(cpuName('Intel(R) Core(TM) i7 CPU @ 3.20GHz'), 'Intel Core i7');
});

test('macOS interface rows count once; resets/new/down interfaces do not spike', () => {
  const text = 'Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll\n' +
    'en0 1500 <Link#4> aa:bb 1 0 1000 1 0 500 0\n' +
    'en0 1500 192.168.1 192.168.1.2 1 - 1000 1 - 500 -\n' +
    'lo0 1500 <Link#1> 00:00 1 0 4000 1 0 4000 0\n' +
    'utun0 1380 <Link#8> 1 0 2500 1 0 3000 0\n';
  assert.deepEqual(parseNetstat(text, new Set(['en0', 'lo0', 'utun0'])), { en0: { down: 1000, up: 500 }, utun0: { down: 2500, up: 3000 } });
  const prev = { en0: { down: 1000, up: 500 }, gone: { down: 9999999, up: 9999999 } };
  assert.deepEqual(netDelta(prev, { en0: { down: 126000, up: 63000 }, new: { down: 9e8, up: 9e8 } }, 1), { down: 1, up: .5 });
  assert.deepEqual(netDelta(prev, { en0: { down: 5, up: 5 } }, 1), { down: 0, up: 0 });
  assert.deepEqual(netDelta(null, {}, 1), { down: null, up: null });
});

test('weather optional/config changes; real API shapes; FX preceding business day; errors retain cache', async () => {
  let fail = false, count = 0;
  const stats = createStats({ platform: 'test', fetch: async url => {
    count++; if (fail) throw new Error('offline');
    return { ok: true, json: async () => url.includes('open-meteo') ? {
      current: { temperature_2m: 17.5, weather_code: 3 },
      daily: { temperature_2m_max: [19], temperature_2m_min: [12], precipitation_probability_max: [40] }
    } : [
      { date: '2026-10-01', base: 'EUR', quote: 'TRY', rate: 40 }, { date: '2026-10-01', base: 'EUR', quote: 'USD', rate: 1.25 },
      { date: '2026-10-02', base: 'EUR', quote: 'TRY', rate: 44 }, { date: '2026-10-02', base: 'EUR', quote: 'USD', rate: 1.25 }
    ] };
  } });
  try {
    assert.equal(stats.get().weather, undefined);
    stats.get({ weather: { city: 'İstanbul', lat: 41.01, lon: 28.97 } }); stats.start(); await tick();
    const good = stats.get();
    assert.deepEqual(good.weather, { city: 'İstanbul', temp: 17.5, code: 3, hi: 19, lo: 12, rain: 40 });
    assert.equal(good.fx.usd, 35.2); assert.equal(good.fx.eur, 44); assert.ok(Math.abs(good.fx.usdChg - 10) < 1e-9);
    assert.equal(good.time.epoch, Math.floor(Date.now() / 1000));
    const requests = count; stats.get(); stats.get(); assert.equal(count, requests, 'IPC reads only the cache');
    fail = true; await stats.refreshWeather(); await stats.refreshFx();
    assert.deepEqual(stats.get().weather, good.weather); assert.deepEqual(stats.get().fx, good.fx);
    stats.get({ weather: { city: 'Ankara', lat: 39.93, lon: 32.86 } }); await tick();
    assert.equal(stats.get().weather.city, 'Ankara'); assert.equal(stats.get().weather.temp, null);
    assert.equal(stats.get({ weather: { lat: null, lon: null } }).weather, undefined);
  } finally { stats.stop(); }
});

test('weather response from previous city cannot overwrite new configuration', async () => {
  let resolveWeather;
  const stats = createStats({ platform: 'test', fetch: async url => ({ ok: true, json: async () => {
    if (!url.includes('open-meteo')) return [];
    return new Promise(resolve => { resolveWeather = resolve; });
  } }) });
  try {
    stats.start(); stats.get({ weather: { city: 'Old', lat: 41, lon: 29 } }); await tick();
    stats.get({ weather: null });
    resolveWeather({ current: { temperature_2m: 20 }, daily: {} }); await tick();
    assert.equal(stats.get().weather, undefined);
  } finally { stats.stop(); }
});

test('companion firmware gate, independent send rates, simulator and reconnect snapshot', async () => {
  const fs = require('fs'), vm = require('vm'), path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '../../app/companion.js'), 'utf8');
  const section = source.slice(source.indexOf('  /* ---- cached widget groups'), source.indexOf('  /* ---- media + volume'));
  let now = 1000000, reads = 0;
  const sent = [], demo = [], snapshot = { cpu: { load: 20 }, gpu: { load: 40 }, net: { down: 1 }, time: { epoch: 1 }, weather: { temp: 17 }, fx: { usd: 35 } };
  const ctx = vm.createContext({ busy: false, writer: {}, port: {}, deviceInfo: { fw: '1.3.2' }, updateState: null,
    cfg: { home: { weather: { lat: 41.01, lon: 28.97 } } }, Date: { now: () => now },
    verGE: (a, b) => a.localeCompare(b, undefined, { numeric: true }) >= 0,
    deck: { stats: async () => { reads++; return snapshot; } }, sendRaw: async m => sent.push(m),
    window: { onDeckStats: m => demo.push(m) }, setInterval: () => {} });
  vm.runInContext(section, ctx);
  await ctx.pollStats(); assert.equal(reads, 0); assert.equal(sent.length, 0);
  ctx.deviceInfo.fw = undefined; await ctx.pollStats(); assert.equal(reads, 0);
  ctx.deviceInfo.fw = '1.4.0'; await ctx.pollStats();
  assert.equal(sent[0].cmd, 'stats'); assert.equal(Object.keys(sent[0]).length, 7); assert.equal(demo.length, 1);
  now += 1000; await ctx.pollStats(); assert.deepEqual(Object.keys(sent[1]).sort(), ['cmd', 'cpu', 'gpu', 'net']);
  snapshot.weather = { temp: 18 }; now += 1000; await ctx.pollStats(); assert.equal(sent[2].weather.temp, 18);
  now += 60000; await ctx.pollStats(); assert.ok(sent[3].time); assert.equal(sent[3].fx, undefined);
  ctx.writer = {}; await ctx.pollStats(); assert.equal(Object.keys(sent[4]).length, 7); assert.equal(demo.length, 5);
  ctx.busy = true; now += 1000; await ctx.pollStats(); assert.equal(sent.length, 5);
});
