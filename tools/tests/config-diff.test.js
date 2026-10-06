const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../../web/body.html'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function normalizeConfig('), source.indexOf('/* ---------- End config semantics')), context);
const diff = (a, b, options) => JSON.parse(JSON.stringify(context.configDiff(a, b, options)));
const clone = a => JSON.parse(JSON.stringify(a));
const base = () => ({ device: {}, home: {}, apps: [{ id: 'spotify', name: 'Spotify', launch: { method: 'run', value: 'spotify:' } }] });

test('key order and missing firmware/UI defaults do not differ', () => {
  const a = base(), b = { apps: a.apps, home: {}, device: {} };
  assert.deepEqual(diff(a, b), []);
  const normalized = context.normalizeConfig(a);
  assert.deepEqual(diff(a, normalized), []);
  const c = clone(a); c.version = 3; c.sensors = { removed: true }; c.device.flip = false; c.device.kbFallback = false;
  c.home.anim = { kind: 'fan', fps: 15, color: '#3B6CF6', frames: 0, fit: 'cover' };
  c.apps[0].img = false; c.apps[0].inWheel = true;
  assert.deepEqual(diff(a, c), []);
});

test('float serialization, integer clamps, RGB565 colours and modifier order are semantic', () => {
  const a = base(), b = clone(a);
  a.home.weather = { city: 'Ankara', lat: 39.9334, lon: 32.8597 };
  b.home.weather = { city: 'Ankara', lat: 39.933399, lon: 32.859699 };
  a.device.encDetent = 8; b.device.encDetent = 4;
  a.home.anim = { fps: 40, color: '#3B6CF6' }; b.home.anim = { fps: 30, color: '#386CF0' };
  a.apps[0].launch = { method: 'key', mods: ['shift', 'ctrl', 'ctrl'], key: 'a' };
  b.apps[0].launch = { method: 'key', mods: ['ctrl', 'shift'], key: 'A' };
  assert.deepEqual(diff(a, b), []);
  b.home.weather.lat = 38; assert.equal(diff(a, b)[0].label, 'Ana sayfa · Enlem');
});

test('computer targets, image flags, animation metadata, bg and auto-generated fallback stay local', () => {
  const a = base(), b = clone(a);
  a.device.host = 'mac'; b.device.host = 'win';
  Object.assign(a.apps[0], { targets: { mac: '/Applications/Spotify.app', win: 'C:\\Spotify.exe' }, bg: true, iconData: 'data:image/png;base64,x', src: { file: 'Spotify.lnk' }, fallbackCustom: false });
  a.apps[0].launch = { method: 'search', value: 'Spotify' };
  b.apps[0].launch.path = 'C:\\Other.exe'; b.apps[0].launch.mac = '/Applications/Old.app'; b.apps[0].img = true;
  a.home.anim = { fit: 'cover', name: 'a.gif', frames: 30, delays: [100] };
  b.home.anim = { fit: 'contain', name: 'b.gif', frames: 10 };
  assert.deepEqual(diff(a, b, { platform: 'darwin' }), []);
  a.apps[0].fallbackCustom = true;
  assert.ok(diff(a, b, { platform: 'darwin' }).some(d => d.label === 'Uygulama “Spotify” · Klavye yöntemi'));
  assert.ok(diff(a, b).some(d => d.path === 'device.host'), 'browser host choice remains a device setting');
});

test('auto weather ignores the device city; manual weather compares it', () => {
  const a = base(), b = clone(a);
  a.home.weather = { auto: true, city: 'Ankara', lat: 39.9, lon: 32.8 };
  b.home.weather = { city: 'İstanbul', lat: 41.01, lon: 28.97 };
  assert.deepEqual(diff(a, b), []);
  a.home.weather.auto = false;
  assert.ok(diff(a, b).some(d => d.label === 'Ana sayfa · Şehir'));
});

test('real name, card and cable dimming changes have Turkish labels', () => {
  const a = base(), b = clone(a);
  b.apps[0].name = 'Müzik'; b.home.cards = ['clock', 'gpu']; b.device.dimAfterUsb = 60;
  assert.deepEqual(diff(a, b).map(d => d.label).sort(), ['Ana sayfa · Kart 1', 'Cihaz · Karartma (kabloda)', 'Uygulama “Spotify” · ad'].sort());
});

test('app additions, removals and reordering are reported once by ID', () => {
  const a = base(); a.apps.push({ id: 'obs', name: 'OBS', launch: { method: 'search', value: 'OBS' } });
  const b = clone(a); b.apps.reverse();
  assert.deepEqual(diff(a, b).map(d => d.label), ['Sıra farklı']);
  b.apps[0] = { id: 'chrome', name: 'Chrome' };
  assert.deepEqual(diff(a, b).map(d => d.label), ['Uygulama kaldırıldı: OBS', 'Uygulama eklendi: Chrome']);
});

function helpers(cfg, platform = 'darwin') {
  const ctx = vm.createContext({ cfg, window: { deck: platform ? { platform } : undefined }, clone });
  for (const [start, end] of [['function forDevice(', 'function diffValue('], ['function keepLocalExtras(', '\n$("#useDevice")'], ['function runCmd(', '\nfunction stripExt('], ['function autoFallback(', '\nasync function importFiles(']]) {
    const from = source.indexOf(start), to = source.indexOf(end, from);
    // runCmd is deliberately extracted as a single source line, shared with the UI.
    vm.runInContext(source.slice(from, start === 'function runCmd(' ? source.indexOf('\n', from) : to), ctx);
  }
  return ctx;
}

test('device projection strips local flags; device load preserves both computer targets and local assets', () => {
  const a = base(); a.home = { weather: { auto: true, city: 'Ankara', lat: 39.9, lon: 32.8 }, anim: { kind: 'fan', delays: [100], frames: 1, name: 'x.gif', fit: 'cover' } };
  Object.assign(a.apps[0], { iconData: 'png', src: { file: 'x.lnk' }, targets: { win: 'C:\\Spotify.exe', mac: '/Applications/Spotify.app' }, fallbackCustom: false, bg: true });
  const ctx = helpers(a), sent = ctx.forDevice(a);
  assert.equal(sent.home.weather.auto, undefined); assert.equal(sent.apps[0].fallbackCustom, undefined); assert.equal(sent.apps[0].bg, undefined);
  assert.equal(sent.home.anim.delays, undefined); assert.equal(sent.device.host, 'mac'); assert.equal(sent.apps[0].launch.path, a.apps[0].targets.win);
  const device = clone(sent); device.home.weather.city = 'Other'; device.apps[0].launch.path = 'Old'; device.apps[0].launch.mac = 'OldMac'; device.apps[0].launch.method = 'search';
  const loaded = ctx.keepLocalExtras(device);
  assert.deepEqual(loaded.home.weather, a.home.weather); assert.deepEqual(clone(loaded.apps[0].targets), a.apps[0].targets);
  assert.equal(loaded.apps[0].bg, true); assert.equal(loaded.apps[0].iconData, 'png'); assert.equal(loaded.home.anim.name, 'x.gif');
  assert.deepEqual(loaded.apps[0].launch, a.apps[0].launch);
});

test('automatic fallback follows platform, shortcut working directory and custom flag', () => {
  const ctx = helpers(base()), a = base().apps[0];
  ctx.autoFallback(a, 'win32', 'C:\\Program Files\\Spotify.exe', null);
  assert.deepEqual(clone(a.launch), { method: 'run', value: '"C:\\Program Files\\Spotify.exe"' });
  ctx.autoFallback(a, 'win32', 'x.lnk', { workdir: 'C:\\x', searchName: 'Spotify' });
  assert.deepEqual(clone(a.launch), { method: 'search', value: 'Spotify' });
  ctx.autoFallback(a, 'darwin', '/Applications/Spotify.app', null);
  assert.deepEqual(clone(a.launch), { method: 'search', value: 'Spotify' });
  ctx.autoFallback(a, 'darwin', 'spotify:', null); assert.equal(a.launch.value, 'Spotify');
  a.fallbackCustom = true; ctx.autoFallback(a, 'win32', 'Other.exe', null);
  assert.equal(a.launch.value, 'Spotify');
});

test('media launch defaults to none, has a Turkish diff and survives device projection/loading', () => {
  const a = base(), b = clone(a);
  a.pages = { media: { launch: 'none' } }; assert.deepEqual(diff(a, b), []);
  a.pages.media.launch = 'spotify';
  assert.equal(diff(a, b)[0].label, 'Medya · Hiçbir şey çalmıyorsa aç');
  assert.equal(context.normalizeConfig({ ...a, pages: { media: { launch: 'invalid' } } }).pages.media.launch, 'none');
  const ctx = helpers(a), sent = ctx.forDevice(a);
  assert.equal(sent.pages.media.launch, 'spotify');
  sent.pages.media.launch = 'music'; assert.equal(ctx.keepLocalExtras(sent).pages.media.launch, 'music');
});
