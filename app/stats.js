// Nullable widget groups. No Electron import: the main process supplies net.fetch.
const os = require('os');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const tcp = require('net');
const assets = require('./stats-assets');
const RATES = { cpu: 1000, gpu: 1000, net: 1000, time: 60000, weather: 900000, fx: 1800000 };
const number = v => v !== null && v !== undefined && String(v).trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
const range = (v, min, max) => { const n = number(v); return n !== null && n >= min && n <= max ? n : null; };
const cpuName = s => String(s || '').replace(/\((R|TM)\)|\bCPU\b|@\s*[\d.]+\s*GHz/gi, '').replace(/\s+/g, ' ').trim() || null;
const gpuEmpty = () => ({ name: null, temp: null, load: null, power: null, fan: null, vram: null, vramTotal: null });
function parseNvidia(line) {
  const fields = line.trim().split(/,\s*/).map(s => s.trim().replace(/^"|"$/g, ''));
  if (fields.length !== 7 || !fields[0] || /^\[/.test(fields[0])) return null;
  const [name, temp, load, power, fan, used, total] = fields;
  return { name: name.replace(/^NVIDIA\s+(GeForce\s+)?/i, ''), temp: range(temp, 0, 150), load: range(load, 0, 100),
    power: range(power, 0, 3000), fan: range(fan, 0, 100), vram: range(used, 0, 1e7) === null ? null : Number(used) / 1024,
    vramTotal: range(total, 0, 1e7) === null ? null : Number(total) / 1024 };
}
// macmon reports 0 W when IOReport has no energy data (seen for the CPU on macOS 27): treat 0 as unknown
function parseMacmon(m, name) {
  const cores = [...(m.ecpu_cores || []), ...(m.pcpu_cores || [])];
  const freq = cores.length ? cores.reduce((sum, c) => sum + (number(c.freq_mhz) || 0), 0) / cores.length : Math.max(m.ecpu_freq_mhz || 0, m.pcpu_freq_mhz || 0);
  return {
    cpu: { temp: range(m.temp?.cpu_temp_avg, 1, 150), load: range(number(m.cpu_active_ratio ?? m.cpu_usage) === null ? null : (m.cpu_active_ratio ?? m.cpu_usage) * 100, 0, 100), power: m.cpu_power > 0 ? range(m.cpu_power, 0, 3000) : null, clock: freq > 0 ? freq / 1000 : null },
    gpu: { ...gpuEmpty(), name: name ? name + ' GPU' : 'Apple GPU', temp: range(m.temp?.gpu_temp_avg, 1, 150), load: range(number(m.gpu_active_ratio ?? m.gpu_usage) === null ? null : (m.gpu_active_ratio ?? m.gpu_usage) * 100, 0, 100), power: m.gpu_power > 0 ? range(m.gpu_power, 0, 3000) : null }
  };
}
function parseNetstat(text, active) {
  const lines = text.trim().split('\n'), header = lines.shift().trim().split(/\s+/);
  const rx = header.indexOf('Ibytes'), tx = header.indexOf('Obytes');
  if (rx < 0 || tx < 0) throw new Error('netstat columns');
  const out = {};
  for (const line of lines) {
    const f = line.trim().split(/\s+/), name = f[0];
    if (!/^<Link#/.test(f[2]) || !active.has(name) || name === 'lo0') continue;
    // utun has no link-layer Address: the seven trailing counter columns stay aligned.
    const down = number(f[f.length - (header.length - rx)]), up = number(f[f.length - (header.length - tx)]);
    if (down !== null && up !== null) out[name] = { down, up };
  }
  return out;
}
function netDelta(prev, next, seconds) {
  let down = 0, up = 0, common = false;
  for (const [name, n] of Object.entries(next)) {
    const p = prev?.[name]; if (!p) continue;
    common = true;
    down += Math.max(0, n.down - p.down); up += Math.max(0, n.up - p.up);
  }
  return common && seconds > 0 ? { down: down * 8 / seconds / 1e6, up: up * 8 / seconds / 1e6 } : { down: null, up: null };
}
async function findNvidia() {
  const paths = (process.env.PATH || '').split(path.delimiter).map(p => path.join(p, 'nvidia-smi.exe'));
  const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  paths.push(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'), path.join(system, 'nvidia-smi.exe'));
  const drivers = path.join(system, 'DriverStore', 'FileRepository');
  try { for (const d of fs.readdirSync(drivers).filter(d => /^nv_dispi/i.test(d)).sort().reverse()) paths.push(path.join(drivers, d, 'nvidia-smi.exe')); } catch (_) {}
  return paths.find(p => fs.existsSync(p)) || null;
}
// Both providers use latitude/longitude; error responses can still have HTTP 200.
function parseLocation(j) {
  if (!j || j.error || j.success === false || typeof j.city !== 'string' || !j.city.trim()) return null;
  const lat = range(j.latitude, -90, 90), lon = range(j.longitude, -180, 180);
  if (lat === null || lon === null) return null;
  const city = [...j.city.trim()].map(ch => /[\x20-\x7EÇÖÜçöüĞğİıŞş]/.test(ch) ? ch : ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '')).join('').replace(/[^\x20-\x7EÇÖÜçöüĞğİıŞş]/g, '').trim().slice(0, 24);
  return city ? { city, lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 } : null;
}
async function resolveLocation(fetch) {
  for (const url of ['https://ipapi.co/json/', 'https://ipwho.is/']) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const location = r.ok ? parseLocation(await r.json()) : null;
      if (location) return location;
    } catch (_) {}
  }
  return null;
}
// Coordinates come only from the renderer's OS location request; providers supply the label.
function parseReverseLocation(j, lat, lon) {
  if (!j || j.error) return null;
  const a = j.address || {};
  return parseLocation({ city: j.city || j.locality || a.city || a.town || a.village || a.municipality || a.state, latitude: lat, longitude: lon });
}
async function reverseLocation(fetch, geo) {
  const lat = range(geo?.lat, -90, 90), lon = range(geo?.lon, -180, 180);
  if (lat === null || lon === null) return null;
  const queries = [
    ['https://api.bigdatacloud.net/data/reverse-geocode-client?' + new URLSearchParams({ latitude: lat, longitude: lon, localityLanguage: 'tr' }), {}],
    ['https://nominatim.openstreetmap.org/reverse?' + new URLSearchParams({ lat, lon, format: 'jsonv2', 'accept-language': 'tr', zoom: 10 }), { 'User-Agent': 'VolkanDeck/1.5.3 (https://github.com/volkangokyar01/deck-app)' }]
  ];
  for (const [url, headers] of queries) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      const loc = r.ok ? parseReverseLocation(await r.json(), lat, lon) : null;
      if (loc) return { ...loc, source: 'geo' };
    } catch (_) {}
  }
  return { ...parseLocation({ city: 'Konumum', latitude: lat, longitude: lon }), source: 'geo' };
}
async function resolveWeatherLocation(fetch, geo, lastSystemLocation = null) {
  const loc = await reverseLocation(fetch, geo);
  if (loc) return loc;
  if (lastSystemLocation) return { ...lastSystemLocation, source: 'last' };
  const ip = await resolveLocation(fetch);
  return ip ? { ...ip, source: 'ip' } : null;
}
function createStats({ fetch, cacheDir, platform = process.platform, arch = process.arch, sensorFile } = {}) {
  const cache = { cpu: { name: cpuName(os.cpus()[0]?.model), temp: null, load: null, power: null, clock: null }, gpu: gpuEmpty(), net: { down: null, up: null, ping: null }, fx: { usd: null, eur: null, usdChg: null, eurChg: null } };
  let running = false, previousCpu = null, previousNet = null, netAt = 0, netSeen = 0, sensorAt = 0, pingAt = 0;
  let weather = null, weatherKey = '', weatherGeneration = 0, weatherBusy = false, fxBusy = false, weatherAt = 0, fxAt = 0;
  let macSample = null, macAt = 0;
  let geoCoordinates = null, geoPending = false;
  let autoLocation = false, locationBusy = false, locationAt = 0, locationGeneration = 0;
  // cacheDir is under userData, outside the app bundle, so this survives updates and restarts.
  const locationFile = cacheDir ? path.join(cacheDir, 'last-system-location.json') : null;
  let lastSystemLocation = null;
  try {
    const saved = JSON.parse(fs.readFileSync(locationFile, 'utf8'));
    const loc = parseLocation({ city: saved.city, latitude: saved.lat, longitude: saved.lon });
    if (loc && Number.isFinite(saved.at) && saved.at > 0) lastSystemLocation = { ...loc, at: saved.at };
  } catch (_) {}
  if (lastSystemLocation) cache.location = { ...lastSystemLocation, source: 'last', pending: false, error: '' };
  const timers = new Set(), children = new Set(), sockets = new Set();
  function every(fn, ms) { const t = setInterval(() => { Promise.resolve().then(fn).catch(() => {}); }, ms); timers.add(t); }
  function stream(file, args, onLine) {
    let child = null, buffer = '', lastLine = Date.now(), retryAt = 0;
    function launch() {
      if (!running || child || Date.now() < retryAt) return;
      lastLine = Date.now(); buffer = '';
      const proc = cp.spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      child = proc; children.add(proc);
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', data => {
        buffer += data;
        if (buffer.length > 65536) { buffer = ''; return; }
        let i;
        while ((i = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1);
          try { if (onLine(line)) lastLine = Date.now(); } catch (_) {}
        }
      });
      const dead = () => { children.delete(proc); if (child === proc) { child = null; retryAt = Date.now() + 5000; } };
      proc.once('error', dead); proc.once('exit', dead);
    }
    launch();
    every(() => { if (child && Date.now() - lastLine > 8000) child.kill(); launch(); }, 1000);
  }
  function cpu() {
    const cpus = os.cpus();
    const next = cpus.reduce((sum, c) => ({ idle: sum.idle + c.times.idle, total: sum.total + Object.values(c.times).reduce((a, b) => a + b, 0) }), { idle: 0, total: 0 });
    const delta = previousCpu ? next.total - previousCpu.total : 0;
    cache.cpu.load = delta > 0 ? range(100 * (1 - (next.idle - previousCpu.idle) / delta), 0, 100) : null;
    previousCpu = next;
    cache.cpu.clock = cpus.length && cpus[0].speed > 0 ? cpus.reduce((s, c) => s + c.speed, 0) / cpus.length / 1000 : null;
    cache.cpu.temp = null; cache.cpu.power = null;
    if (platform === 'darwin' && macSample && Date.now() - macAt < 5000) {
      const m = parseMacmon(macSample, cache.cpu.name);
      Object.assign(cache.cpu, m.cpu, { load: m.cpu.load ?? cache.cpu.load }); cache.gpu = m.gpu;
    } else if (platform === 'darwin') cache.gpu = gpuEmpty();
    if (platform === 'win32' && sensorFile) {
      try {
        const s = JSON.parse(fs.readFileSync(typeof sensorFile === 'function' ? sensorFile() : sensorFile, 'utf8'));
        if (Date.now() - s.epoch * 1000 >= 0 && Date.now() - s.epoch * 1000 < 5000) {
          cache.cpu.temp = range(s.temp, 1, 150); cache.cpu.power = range(s.power, 0, 3000);
        }
      } catch (_) {} // absent/partial/stale output always leaves temp and power null
    }
    if (platform === 'win32' && Date.now() - sensorAt >= 5000) cache.gpu = gpuEmpty();
    if (Date.now() - netSeen >= 5000) Object.assign(cache.net, { down: null, up: null });
  }
  function network(next) {
    const now = performance.now();
    Object.assign(cache.net, netDelta(previousNet, next, (now - netAt) / 1000));
    previousNet = next; netAt = now; netSeen = Date.now();
  }
  let netBusy = false;
  async function macNetwork() {
    if (netBusy) return; netBusy = true;
    try {
      const active = new Set(Object.entries(os.networkInterfaces()).filter(([, a]) => a?.some(n => !n.internal)).map(([name]) => name));
      const text = await assets.run('/usr/sbin/netstat', ['-ibn'], 2000);
      network(parseNetstat(text, active));
    } finally { netBusy = false; }
  }
  async function ping() {
    for (const host of ['1.1.1.1', '8.8.8.8']) {
      if (!running) return;
      const result = await new Promise(resolve => {
        const start = performance.now(), socket = tcp.connect({ host, port: 443 }); sockets.add(socket);
        let settled = false;
        const done = value => { if (settled) return; settled = true; sockets.delete(socket); socket.destroy(); resolve(value); };
        socket.setTimeout(2000, () => done(null)); socket.once('error', () => done(null)); socket.once('close', () => done(null));
        socket.once('connect', () => done(Math.round(performance.now() - start)));
      });
      if (result !== null) { cache.net.ping = result; pingAt = Date.now(); return; }
    }
    cache.net.ping = null;
  }
  async function json(url) {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  async function refreshWeather() {
    if (!running || !weather || weatherBusy) return;
    weatherBusy = true;
    const w = { ...weather }, generation = weatherGeneration;
    try {
      const q = new URLSearchParams({ latitude: w.lat, longitude: w.lon, current: 'temperature_2m,weather_code', daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max', timezone: 'auto', forecast_days: '1' });
      const j = await json('https://api.open-meteo.com/v1/forecast?' + q);
      if (generation !== weatherGeneration || !running) return;
      if (number(j.current?.temperature_2m) === null) return;
      cache.weather = { city: w.city, temp: number(j.current.temperature_2m), code: number(j.current.weather_code), hi: number(j.daily?.temperature_2m_max?.[0]), lo: number(j.daily?.temperature_2m_min?.[0]), rain: range(j.daily?.precipitation_probability_max?.[0], 0, 100) }; weatherAt = Date.now();
    } catch (_) {} finally { weatherBusy = false; if (generation !== weatherGeneration && weather) refreshWeather(); }
  }
  async function refreshFx() {
    if (!running || fxBusy) return; fxBusy = true;
    try {
      // ECB series: get the last two published business days, including holidays.
      const from = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
      const rows = await json('https://api.frankfurter.dev/v2/rates?base=EUR&quotes=USD,TRY&providers=ecb&from=' + from);
      const days = {};
      for (const r of rows) { if (r.base === 'EUR' && ['USD', 'TRY'].includes(r.quote) && number(r.rate) > 0) (days[r.date] ||= {})[r.quote] = r.rate; }
      const dates = Object.keys(days).filter(d => days[d].USD && days[d].TRY).sort();
      const latest = days[dates.at(-1)], prev = days[dates.at(-2)];
      if (!latest || !running) return;
      const usd = latest.TRY / latest.USD, eur = latest.TRY;
      cache.fx = { usd, eur, usdChg: prev ? (usd / (prev.TRY / prev.USD) - 1) * 100 : null, eurChg: prev ? (eur / prev.TRY - 1) * 100 : null }; fxAt = Date.now();
    } catch (_) {} finally { fxBusy = false; }
  }
  function setWeather(next) {
    if (next) next = { lat: next.lat, lon: next.lon, city: next.city };
    const key = JSON.stringify(next); if (key === weatherKey) return;
    weatherKey = key; weather = next; weatherGeneration++; weatherAt = 0;
    if (!weather) delete cache.weather;
    else { cache.weather = { city: weather.city, temp: null, code: null, hi: null, lo: null, rain: null }; refreshWeather(); }
  }
  async function refreshLocation() {
    if (!running || !autoLocation || geoPending || locationBusy) return;
    locationBusy = true; const generation = locationGeneration;
    cache.location = { ...cache.location, pending: true };
    try {
      const next = await resolveWeatherLocation(fetch, geoCoordinates, lastSystemLocation);
      if (!running || generation !== locationGeneration) return;
      locationAt = Date.now();
      if (next?.source === 'geo') {
        lastSystemLocation = { city: next.city, lat: next.lat, lon: next.lon, at: locationAt };
        if (locationFile) {
          try {
            fs.mkdirSync(cacheDir, { recursive: true });
            fs.writeFileSync(locationFile + '.tmp', JSON.stringify(lastSystemLocation) + '\n');
            fs.renameSync(locationFile + '.tmp', locationFile);
          } catch (_) {}
        }
      }
      cache.location = { ...(next || cache.location), pending: false, error: next ? '' : 'Konum bulunamadı' };
      if (next) setWeather(next);
    } finally { locationBusy = false; if (running && autoLocation && generation !== locationGeneration) refreshLocation(); }
  }
  function configure(w) {
    const auto = !!w?.auto;
    if (auto !== autoLocation) { autoLocation = auto; locationGeneration++; locationAt = 0; }
    const valid = w && range(w.lat, -90, 90) !== null && range(w.lon, -180, 180) !== null;
    const next = valid ? { lat: Number(w.lat), lon: Number(w.lon), city: String(w.city || '').slice(0, 64) } : null;
    const known = autoLocation && cache.location?.city ? cache.location : null;
    setWeather(known ? { lat: known.lat, lon: known.lon, city: known.city } : next);
    if (autoLocation && !locationAt) refreshLocation();
  }
  function get(options) {
    if (options && Object.hasOwn(options, 'geolocation')) {
      geoPending = !!options.geolocation?.pending;
      geoCoordinates = geoPending ? null : options.geolocation; locationGeneration++; locationAt = 0;
    }
    if (options && Object.hasOwn(options, 'weather')) configure(options.weather);
    cache.time = { epoch: Math.floor(Date.now() / 1000), tz: -new Date().getTimezoneOffset() * 60 };
    if (weatherAt && Date.now() - weatherAt > 7200000) cache.weather = { city: weather.city, temp: null, code: null, hi: null, lo: null, rain: null };
    if (fxAt && Date.now() - fxAt > 7200000) cache.fx = { usd: null, eur: null, usdChg: null, eurChg: null };
    if (Date.now() - pingAt > 15000) cache.net.ping = null;
    return structuredClone(cache);
  }
  function start() {
    if (running) return; running = true; cpu(); every(cpu, RATES.cpu);
    ping(); every(ping, 5000); refreshFx(); every(refreshFx, RATES.fx); refreshWeather(); every(refreshWeather, RATES.weather);
    locationAt = 0; refreshLocation(); every(refreshLocation, 6 * 3600000);
    if (platform === 'darwin') {
      macNetwork().catch(() => {}); every(macNetwork, RATES.net);
      if (arch === 'arm64' && cacheDir) assets.macmon(fetch, cacheDir).then(binary => {
        if (running) stream(binary, ['pipe', '-i', '1000'], line => { macSample = JSON.parse(line); macAt = Date.now(); return true; });
      }).catch(() => {});
    }
    if (platform === 'win32') {
      stream('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'win-stats.ps1')], line => { network(JSON.parse(line)); return true; });
      findNvidia().then(binary => {
        // TODO: AMD ADLX / Intel IGCL GPUs. For now every unsupported field stays null.
        if (running && binary) stream(binary, ['--id=0', '--query-gpu=name,temperature.gpu,utilization.gpu,power.draw,fan.speed,memory.used,memory.total', '--format=csv,noheader,nounits', '-lms', '1000'], line => {
          const gpu = parseNvidia(line); if (!gpu) return false; cache.gpu = gpu; sensorAt = Date.now(); return true;
        });
      }).catch(() => {});
    }
  }
  function stop() { running = false; locationGeneration++; for (const t of timers) clearInterval(t); timers.clear(); for (const c of children) c.kill(); children.clear(); for (const s of sockets) s.destroy(); sockets.clear(); }
  return { start, stop, get, refreshWeather, refreshFx, refreshLocation };
}
module.exports = { createStats, RATES, parseNvidia, parseMacmon, parseNetstat, netDelta, cpuName, parseLocation, resolveLocation, parseReverseLocation, reverseLocation, resolveWeatherLocation };
