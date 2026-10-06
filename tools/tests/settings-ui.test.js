// Render the real editor functions with a small DOM stub; no Electron or UI dependency needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../web/body.html'), 'utf8');
const companion = fs.readFileSync(path.join(__dirname, '../../app/companion.js'), 'utf8');
function page(platform) {
  const ids = new Map();
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.events = {}; this.attributes = {}; this.nodeType = 1; }
    append(...kids) { for (const kid of kids.flat()) if (kid != null) { this.children.push(kid); if (typeof kid === 'object') kid.parent = this; } }
    replaceChildren(...kids) { this.children = []; this.append(...kids); }
    addEventListener(k, fn) { this.events[k] = fn; }
    setAttribute(k, v) { this.attributes[k] = v; if (k === 'id') ids.set(v, this); if (k.startsWith('data-')) this.dataset[k.slice(5)] = v; if (k === 'open') this.open = true; if (k === 'disabled') this.disabled = true; }
    before(...kids) { const at = this.parent.children.indexOf(this); this.parent.children.splice(at, 0, ...kids); }
    get childNodes() { return this.children; }
    get textContent() { return this.text ?? this.children.map(k => typeof k === 'object' ? k.textContent : k).join(' '); }
    set textContent(v) { this.text = v; }
  }
  const document = { createElement: tag => new Element(tag), createTextNode: text => String(text),
    querySelector: s => ids.get(s.slice(1)) || null, getElementById: id => ids.get(id), querySelectorAll: () => [] };
  for (const id of ['edBody', 'edTitle', 'btnTest', 'devForm', 'brandName']) { const el = new Element('div'); el.setAttribute('id', id); }
  const ctx = vm.createContext({ document, window: { deck: platform ? { platform } : undefined }, deck: platform ? { platform } : undefined,
    clone: x => JSON.parse(JSON.stringify(x)), uid: () => Math.random().toString(36),
    save() {}, drawScreen() {}, renderList() {}, renderCtlMap() {}, renderAll() {}, changed() {}, toast() {},
    appById: id => ctx.cfg.apps.find(a => a.id === id), COLORS: ['#64748B'], ICONS: { star: '' },
    svgIcon: () => new Element('svg'), svgPath: () => new Element('svg'), NAME_MAX: 14, MAX_APPS: 16,
    PLAYERS: [['spotify', 'Spotify']], port: null, confirmDelete: false, animFrames: [],
    launchSummary: l => l.value || l.method, geoSeq: 0, setTimeout, clearTimeout });
  function load(from, until, file = source) { vm.runInContext(file.slice(file.indexOf(from), file.indexOf(until, file.indexOf(from))), ctx); }
  load('const METHODS =', 'const KEYS =');
  load('const KEYS =', 'const MAX_APPS =');
  load('const $ =', 'const svgIcon =');
  load('/* Templates', 'let cfg =');
  ctx.cfg = ctx.defaultConfig(); ctx.edit = { kind: 'app', id: ctx.cfg.apps[0].id };
  load('let captureOff=', '// city search for');
  load('function renderDeviceForm()', '\nfunction renderStatus()');
  load('function runCmd(', '\nfunction guessIcon('); // declarations before importFiles are pure
  load('function autoFallback(', '\nasync function importFiles(');
  ctx.OS = platform; ctx.iconFromDataUrl = async () => {};
  load('  function syncFallbackFields(', '\n  /* ---- macOS: pick', companion);
  return { ctx, ids, body: ids.get('edBody'), render: () => { ctx.renderEditor(); if (platform) ctx.addTargetBox(); } };
}

for (const platform of ['darwin', 'win32', null]) test(`page editors render on first open, without an app id (${platform || 'browser'})`, () => {
  // selectPage() sets edit = {kind} with no id, and no advanced section exists yet
  for (const kind of ['widgets', 'media', 'system', 'home']) {
    const { ctx, body } = page(platform);
    ctx.edit = { kind }; ctx.renderEditor();
    assert.ok(body.children.length, kind);
  }
});

for (const platform of ['darwin', 'win32', null]) test(`all editor kinds render; platform controls and advanced defaults (${platform || 'browser'})`, () => {
  const { ctx, ids, body, render } = page(platform);
  for (const kind of ['home', 'widgets', 'media', 'system', 'app']) { ctx.edit.kind = kind; render(); assert.ok(body.children.length); }
  if (platform) {
    const advanced = ids.get('launchAdvanced'); assert.equal(!!advanced.open, false);
    assert.ok(ids.get('directBox').textContent.includes('Ne açılsın'));
    assert.ok(ids.get('directBox').textContent.includes(platform === 'darwin' ? '.app' : '.exe'));
    assert.ok(!ids.get('directBox').textContent.includes(platform === 'darwin' ? '.exe' : '.app'));
    const a = ctx.cfg.apps[0]; a.launch = { method: 'key', mods: ['ctrl'], key: 'A' }; render();
    assert.ok(ids.get('launchAdvanced').open); assert.ok(body.textContent.includes('Bu uygulama kısayol tuşuyla açılıyor'));
    a.launch = { method: 'taskbar', value: 2 }; delete a.targets; render(); assert.ok(ids.get('launchAdvanced').open);
  } else { assert.equal(ids.get('launchAdvanced'), undefined); assert.ok(body.textContent.includes('Nasıl açılsın')); }
  ctx.renderDeviceForm();
  if (platform) { assert.equal(!!ids.get('deviceAdvanced').open, false); assert.ok(ids.get('devForm').textContent.includes('Klavye düzeni')); assert.ok(!ids.get('devForm').textContent.includes('Windows klavye')); }
  ctx.edit.kind = 'media'; render();
  if (platform) assert.ok(!body.textContent.includes(platform === 'darwin' ? 'Windows:' : 'macOS:'));
  ctx.edit.kind = 'system'; render();
  if (platform) assert.ok(!body.textContent.includes(platform === 'darwin' ? 'Windows:' : 'macOS:'));
});

test('weather migration preserves chosen city and manual İstanbul; browser only offers manual search', () => {
  for (const platform of ['darwin', 'win32', null]) {
    const { ctx } = page(platform), c = ctx.defaultConfig();
    assert.equal(c.home.weather.auto, !!platform);
    delete c.home.weather.auto; ctx.validate(c); assert.equal(c.home.weather.auto, !!platform);
    c.home.weather = { city: 'İzmir', lat: 38.42, lon: 27.14 }; ctx.validate(c); assert.equal(c.home.weather.auto, false);
    c.home.weather = { city: 'İstanbul', lat: 41.01, lon: 28.97, auto: false }; ctx.validate(c); assert.equal(c.home.weather.auto, false);
    ctx.cfg = c;
    const city = ctx.weatherCitySec().textContent;
    assert.equal(city.includes('Konumumdan otomatik bul'), !!platform); assert.ok(city.includes('Şehir ara'));
  }
});

test('typing a target updates fallback fields without losing the editor or other computer target', () => {
  const { ctx, ids, render } = page('darwin'), a = ctx.cfg.apps[0];
  a.targets = { win: 'C:\\Discord.exe', mac: '/Applications/Discord.app' }; render();
  const target = ids.get('appTarget');
  target.events.input({ target: { value: '/Applications/Spotify.app' } });
  assert.equal(a.targets.win, 'C:\\Discord.exe'); assert.equal(a.launch.value, 'Spotify');
  assert.equal(ids.get('appTarget'), target, 'typing keeps the focused input');
  assert.equal(ids.get('searchVal').attributes.value, 'Spotify');
  target.events.change(); assert.equal(ids.get('appTarget'), target, 'blur must not destroy the picker before its click');
  ids.get('searchVal').events.input({ target: { value: 'Özel ad' } });
  target.events.input({ target: { value: '/Applications/Chrome.app' } });
  assert.equal(a.launch.value, 'Özel ad'); assert.equal(a.fallbackCustom, true);
});

test('media launch editor uses none for old configs and exposes all choices; weather source is visible', () => {
  const { ctx, ids, body, render } = page('darwin');
  ctx.edit.kind = 'media'; render(); assert.ok(body.textContent.includes('Hiçbir şey çalmıyorsa aç'));
  const c = ctx.defaultConfig(); delete c.pages.media.launch; ctx.validate(c); assert.equal(c.pages.media.launch, 'none');
  ids.get('mediaLaunch').events.change({ target: { value: 'spotify' } }); assert.equal(ctx.cfg.pages.media.launch, 'spotify');
  vm.runInContext('weatherLocationSource="geo";cfg.home.weather.city="Ankara"', ctx);
  assert.equal(ctx.weatherLocationLabel(), 'Otomatik: Ankara (konum)');
  vm.runInContext('weatherLocationSource="ip"', ctx);
  assert.equal(ctx.weatherLocationLabel(), 'Yaklaşık konum (IP): Ankara — yanlışsa şehri elle seç');
  ctx.cfg.home.weather.auto = true; assert.ok(ctx.weatherCitySec().textContent.includes('Tekrar dene'));
});
test('simulator launch changes the session player and page only when media is enabled', () => {
  const queue = [], ctx = vm.createContext({ performance: { now: () => 0 }, matchMedia: () => ({ matches: true }),
    requestAnimationFrame: fn => queue.push(fn), setTimeout: fn => queue.push(fn), drawScreen() {}, renderCtlMap() {},
    cfg: { pages: { media: { enabled: true, player: 'auto' } }, home: {} }, pageState: { adjust: 1 }, sel: 0, launching: null,
    wheel: () => [{ name: 'Spotify', launch: { value: 'SPOTIFY:' } }, { page: 'media' }], appById: () => null });
  const start = source.indexOf('function musicPlayerForApp(');
  vm.runInContext(source.slice(start, source.indexOf('/* ---------- Left list', start)), ctx);
  for (const [a, player] of [[{ name: 'sPoTiFy' }, 'spotify'], [{ launch: { mac: '/Applications/Music.app' } }, 'music'],
    [{ name: 'MÜZİK' }, 'music'], [{ launch: { path: 'C:\\iTunes.exe' } }, 'music'], [{ launch: { value: 'https://MUSIC.YOUTUBE.COM' } }, 'ytmusic'],
    [{ name: 'YouTube Music' }, 'ytmusic'], [{ name: 'OBS' }, '']]) assert.equal(ctx.musicPlayerForApp(a), player);
  ctx.simulateLaunch(); queue.shift()(1); queue.shift()();
  assert.equal(ctx.sel, 1); assert.equal(ctx.pageState.player, 'spotify'); assert.equal(ctx.cfg.pages.media.player, 'auto');
  ctx.cfg.pages.media.enabled = false; ctx.sel = 0; ctx.pageState.player = null;
  ctx.simulateLaunch({ name: 'Apple Music' }); queue.shift()(1); queue.shift()(); assert.equal(ctx.sel, 0); assert.equal(ctx.pageState.player, null);
});

test('eco controls render and round-trip through device projection and semantic diff', () => {
  const { ctx, ids } = page('darwin');
  ctx.renderDeviceForm();
  const form = ids.get('devForm');
  assert.ok(form.textContent.includes('Boşta tasarruf (kabloda)')); assert.ok(form.textContent.includes('Boşta tasarruf (pilde)'));
  assert.ok(form.textContent.includes('Ekran açık kalır'));
  for (const key of ['ecoAfterUsb', 'ecoAfter']) {
    const control = ids.get(key); assert.equal(control.children.length, 6);
    assert.deepEqual(control.children.map(c => c.attributes.value), [0, 15, 30, 60, 120, 300]);
    control.events.change({ target: { value: key === 'ecoAfterUsb' ? '120' : '0' } });
  }
  const from = source.indexOf('function forDevice(');
  vm.runInContext(source.slice(from, source.indexOf('function diffValue(', from)), ctx);
  const sent = ctx.forDevice(); assert.equal(sent.device.ecoAfterUsb, 120); assert.equal(sent.device.ecoAfter, 0);
  assert.equal(ctx.configDiff(ctx.cfg, sent, { platform: 'darwin' }).length, 0);
  assert.ok(ctx.configDiff(ctx.cfg, ctx.defaultConfig()).some(d => d.label === 'Cihaz · Boşta tasarruf (kabloda)'));
  const old = ctx.defaultConfig(); delete old.device.ecoAfterUsb; delete old.device.ecoAfter; ctx.validate(old);
  assert.equal(old.device.ecoAfterUsb, 60); assert.equal(old.device.ecoAfter, 30);
  old.device.ecoAfterUsb = 9999; old.device.ecoAfter = -4; ctx.validate(old);
  assert.equal(old.device.ecoAfterUsb, 3600); assert.equal(old.device.ecoAfter, 0);
  const n = ctx.normalizeConfig({ device: { ecoAfterUsb: -5, ecoAfter: 4000 } });
  assert.equal(n.device.ecoAfterUsb, 0); assert.equal(n.device.ecoAfter, 3600);
});

for (const platform of ['darwin', 'win32', null]) test(`location settings recovery appears only after failure in desktop auto mode (${platform || 'browser'})`, async () => {
  const { ctx, body } = page(platform);
  let opens = 0, retries = 0;
  if (platform) ctx.window.deck.openLocationSettings = async () => { opens++; };
  ctx.window.retryWeatherLocation = () => { retries++; };
  const all = e => [e, ...(e?.children || []).flatMap(all)];
  const shown = text => all(body).find(e => e?.tag === 'button' && e.textContent === text && e.attributes.hidden === undefined);
  for (const kind of ['home', 'widgets']) {
    ctx.edit = { kind }; ctx.cfg.home.cards = ['weather', 'cpu']; ctx.cfg.home.weather.auto = true;
    vm.runInContext('weatherLocationFailed=false', ctx); ctx.renderEditor();
    assert.equal(!!shown('Konum ayarlarını aç'), false);
    vm.runInContext('weatherLocationFailed=true', ctx); ctx.renderEditor();
    assert.equal(!!shown('Konum ayarlarını aç'), !!platform);
    if (platform) {
      const hint = all(body).find(e => e?.attributes?.id === 'wxLocationHint');
      assert.equal(hint.textContent, "Konum izni kapalı olabilir. Açtıktan sonra Tekrar dene'ye bas."); assert.equal(hint.attributes.hidden, undefined);
      await shown('Konum ayarlarını aç').events.click(); assert.ok(opens); assert.equal(retries, 0);
    }
    ctx.cfg.home.weather.auto = false; ctx.renderEditor(); assert.equal(!!shown('Konum ayarlarını aç'), false);
  }
});

for (const platform of ['darwin', 'win32', null]) test(`dim level and eco speed controls are first-render safe and round-trip (${platform || 'browser'})`, () => {
  const { ctx, ids } = page(platform);
  const controls = [
    ['dimLevelUsb', 'dimAfterUsb', 'Karartınca parlaklık (kabloda)', 30, 17, 5, 90],
    ['dimLevel', 'dimAfter', 'Karartınca parlaklık (pilde)', 10, 17, 5, 90],
    ['ecoFpsUsb', 'ecoAfterUsb', 'Tasarrufta animasyon (kabloda)', 8, 4, 0, 8],
    ['ecoFps', 'ecoAfter', 'Tasarrufta animasyon (pilde)', 0, 4, 0, 8]
  ];
  for (const kind of ['home', 'media', 'widgets', 'system']) {
    ctx.edit = { kind }; ctx.renderEditor(); ctx.renderDeviceForm();
    for (const [key, , label] of controls) assert.ok(ids.get(key) && ids.get('devForm').textContent.includes(label));
  }
  assert.deepEqual(ids.get('dimLevelUsb').children.map(c => c.attributes.value), [75, 50, 30, 20, 10, 5, 17]);
  assert.ok(ids.get('dimLevelUsb').children.some(c => c.textContent === '%17' && c.attributes.selected !== undefined));
  assert.deepEqual(ids.get('ecoFps').children.map(c => c.attributes.value), [8, 4, 2, 1, 0]);
  assert.equal(ids.get('ecoFps').children.at(-1).textContent, 'Durdur');
  for (const [key, timer, , value] of controls) {
    assert.equal(!!ids.get(key).disabled, false);
    ids.get(key).events.change({ target: { value: String(value) } });
    const isEco = timer.startsWith('eco');
    ids.get(isEco ? timer : 'r_' + timer).events[isEco ? 'change' : 'input']({ target: { value: '0' } });
    assert.equal(ids.get(key).disabled, true);
    ctx.renderDeviceForm(); assert.equal(!!ids.get(key).disabled, true);
    ids.get(isEco ? timer : 'r_' + timer).events[isEco ? 'change' : 'input']({ target: { value: '30' } });
    assert.equal(ids.get(key).disabled, false);
  }
  const from = source.indexOf('function forDevice(');
  vm.runInContext(source.slice(from, source.indexOf('function diffValue(', from)), ctx);
  const sent = ctx.forDevice();
  for (const [key, , label, value] of controls) {
    assert.equal(sent.device[key], value);
    assert.ok(ctx.configDiff(ctx.cfg, ctx.defaultConfig()).some(d => d.label === 'Cihaz · ' + label));
  }
  assert.equal(ctx.configDiff(ctx.cfg, sent, { platform }).length, 0);
  const defaults = ctx.defaultConfig(), old = ctx.clone(defaults); for (const [key] of controls) delete old.device[key];
  assert.equal(ctx.configDiff(old, defaults, { platform }).length, 0);
  ctx.validate(old);
  for (const [key, , , , def, lo, hi] of controls) {
    assert.equal(old.device[key], def);
    for (const [value, expected] of [[-100, lo], [999, hi]]) {
      old.device[key] = value; ctx.validate(old); assert.equal(old.device[key], expected);
      assert.equal(ctx.normalizeConfig({ device: { [key]: value } }).device[key], expected);
    }
  }
  ctx.cfg.device.ecoFpsUsb = 3; ctx.renderDeviceForm();
  assert.ok(ids.get('ecoFpsUsb').children.some(c => c.attributes.value === 3 && c.attributes.selected !== undefined));
});
