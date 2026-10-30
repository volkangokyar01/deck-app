// 2026-10-30: Bluetooth on Windows (Electron 44 / Chromium 152). A page-side gatt.disconnect() left the deck "connected"
// inside Chromium, and a cancelled connect stayed queued: every later connect hung until the app was restarted. On
// Windows the page now never disconnects, keeps one connect per device, and asks the app for a fresh page when stuck.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createBleLog } = require('../../app/ble-log');
const root = path.join(__dirname, '../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const page = read('web/body.html'), comp = read('app/companion.js'), main = read('app/main.js'), pre = read('app/preload.js');
const code = page.slice(page.indexOf('const VD_SVC='), page.indexOf('async function connect('));

function fakeDeck() {
  const txListeners = [], devListeners = {}, writes = [];
  const tx = { addEventListener: (t, f) => txListeners.push(f), removeEventListener: (t, f) => { const i = txListeners.indexOf(f); if (i >= 0) txListeners.splice(i, 1); },
    startNotifications: async () => {} };
  const rx = { refuse: 0, writeValueWithResponse(b) { if (this.refuse > 0) { this.refuse--; return Promise.reject(Object.assign(new Error('GATT operation failed'), { name: 'NetworkError' })); }
    writes.push(Buffer.from(b).toString()); return Promise.resolve(); } };
  const gatt = { connected: false, connects: 0, disconnects: 0, hang: false, services: true,
    connect() { this.connects++; if (this.hang) return new Promise(() => {}); this.connected = true; return Promise.resolve(this); },
    getPrimaryService() { return this.services ? Promise.resolve({ getCharacteristic: async u => u.endsWith('0002-5c2e-4b7a-9f3d-1a6c0de5d001') ? rx : tx }) : new Promise(() => {}); },
    disconnect() { this.connected = false; this.disconnects++; } };
  const dev = { name: 'Game Deck', gatt, addEventListener: (t, f) => { (devListeners[t] ||= []).push(f); },
    removeEventListener: (t, f) => { const L = devListeners[t] || [], i = L.indexOf(f); if (i >= 0) L.splice(i, 1); } };
  const notify = s => { const b = Buffer.from(s); txListeners.forEach(f => f({ target: { value: new DataView(b.buffer, b.byteOffset, b.byteLength) } })); };
  const drop = () => { gatt.connected = false; [...(devListeners.gattserverdisconnected || [])].forEach(f => f()); };
  return { dev, gatt, rx, writes, txListeners, devListeners, notify, drop, hooks: () => (devListeners.gattserverdisconnected || []).length };
}
function harness(platform, d = fakeDeck()) {
  const trace = [], scans = { n: 0 }, clock = { t: 1.8e12 };
  const deck = { platform, bleLog: m => trace.push(m), bleScan: async () => true };
  const ctx = vm.createContext({ ReadableStream, WritableStream, Uint8Array, TextDecoder, WeakMap, clearTimeout, cfg: { device: { name: 'Game Deck' } },
    Date: class extends Date { static now() { return clock.t; } },  // the page's clock, moved by the tests
    setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 25)),           // time limits shortened for the test
    window: { deck, onBleDropped() {} }, navigator: { bluetooth: { requestDevice: async () => { scans.n++; return d.dev; } } } });
  vm.runInContext(code + '\nthis.openBlePort = openBlePort;', ctx);
  return { ctx, d, trace, scans, clock };
}

test('Windows: a connect that does not finish is never cancelled; the next try waits for the same one', async () => {
  const { ctx, d } = harness('win32');
  d.gatt.hang = true;
  await assert.rejects(ctx.openBlePort(), e => e.name === 'TimeoutError' && e.wedged === true, 'the deck was seen by the scan but did not connect');
  await assert.rejects(ctx.openBlePort(), e => e.name === 'TimeoutError');
  assert.equal(d.gatt.connects, 1, 'one connect for the device, not one per try');
  assert.equal(d.gatt.disconnects, 0, 'gatt.disconnect() is never called on Windows');
});

test('macOS: a connect that does not finish is cancelled as before', async () => {
  const { ctx, d } = harness('darwin');
  d.gatt.hang = true;
  await assert.rejects(ctx.openBlePort(), e => e.name === 'TimeoutError' && !e.wedged);
  assert.ok(d.gatt.disconnects >= 1);
});

test('Windows: a session ends without disconnecting; the next one reuses the link and has one listener', async () => {
  const { ctx, d } = harness('win32');
  const p1 = await ctx.openBlePort();
  assert.equal(p1.reused, false);
  await p1.close();
  assert.equal(d.gatt.disconnects, 0); assert.equal(d.gatt.connected, true);
  assert.equal(d.txListeners.length, 0, 'the closed session no longer listens');
  assert.equal(d.hooks(), 1, 'only the page-wide reconnect listener is left');
  const p2 = await ctx.openBlePort();
  assert.equal(p2.reused, true, 'the open link is used again');
  assert.equal(d.gatt.connects, 1, 'no new connect for a link that is still up');
  assert.equal(d.txListeners.length, 1);
  const r = p2.readable.getReader();
  d.notify('{"ok":true}\n');
  assert.equal(new TextDecoder().decode((await r.read()).value), '{"ok":true}\n');
});

test('macOS: closing a session still disconnects', async () => {
  const { ctx, d } = harness('darwin');
  const p = await ctx.openBlePort(); await p.close();
  assert.equal(d.gatt.disconnects, 1);
});

test('a refused write is sent again; a write that keeps failing ends the session (no disconnect on Windows)', async () => {
  const { ctx, d } = harness('win32');
  const p = await ctx.openBlePort();
  let gone = 0; p.addEventListener('disconnect', () => { gone++; });
  d.rx.refuse = 2;
  await p.writable.getWriter().write(new TextEncoder().encode('{"cmd":"hello"}\n'));
  assert.equal(d.writes.join(''), '{"cmd":"hello"}\n', 'arrived after two refusals');
  assert.equal(gone, 0);
  const { ctx: ctx2, d: d2 } = harness('win32');
  const p2 = await ctx2.openBlePort();
  p2.addEventListener('disconnect', () => { gone++; });
  d2.rx.refuse = 5;
  await assert.rejects(p2.writable.getWriter().write(new Uint8Array([1, 2, 3])));
  assert.equal(gone, 1); assert.equal(d2.gatt.disconnects, 0);
});

test('Windows: when the link drops, a new connect starts right away, also after the page closed its session', async () => {
  const { ctx, d, trace, clock } = harness('win32');
  const p = await ctx.openBlePort();
  let gone = 0; p.addEventListener('disconnect', () => { gone++; });
  d.drop();
  assert.equal(gone, 1);
  assert.equal(d.gatt.connects, 2, 'connect called inside the disconnect event');
  assert.ok(trace.some(m => /bağlantı koptu/.test(m)), 'the drop is written to the Bluetooth log');
  const p2 = await ctx.openBlePort(); await p2.close();          // e.g. moved to USB: the link stays up, no session
  clock.t += 31e3; d.drop();
  assert.equal(d.gatt.connects, 3, 'a drop with no session open still connects again at once');
  assert.equal(d.hooks(), 1, 'one device listener for the page, not one per session');
});

test('Windows: a deck that keeps dropping this computer is not reconnected more than every 30 s by the drop listener', async () => {
  const { ctx, d } = harness('win32');
  await ctx.openBlePort();
  d.drop(); d.gatt.connected = true; d.drop(); d.gatt.connected = true; d.drop();
  assert.equal(d.gatt.connects, 2, 'one immediate reconnect, then the normal tries with their back-off');
});

test('Windows: a session the page closed writes nothing more on the kept link', async () => {
  const { ctx, d } = harness('win32');
  const p = await ctx.openBlePort();
  let release; d.rx.writeValueWithResponse = b => { d.writes.push(Buffer.from(b).toString()); return new Promise(r => { release = r; }); };
  const w = p.writable.getWriter().write(new TextEncoder().encode('x'.repeat(50)));
  await new Promise(r => setTimeout(r, 5));
  await p.close(); release();
  await assert.rejects(w, e => e.name === 'AbortError');
  assert.equal(d.writes.length, 1, 'the rest of the line is not sent after close');
});

test('Windows: a link that is up but whose services never arrive is marked stuck', async () => {
  const { ctx, d } = harness('win32');
  d.gatt.connected = true; d.gatt.services = false;
  await assert.rejects(ctx.openBlePort(), e => e.wedged === true && /servis/.test(e.message));
  const mac = harness('darwin');
  mac.d.gatt.connected = true; mac.d.gatt.services = false;
  await assert.rejects(mac.ctx.openBlePort(), e => !e.wedged);
});

test('page: two stuck tries ask the app for a fresh page; a handshake failure does not fall into the USB advice', () => {
  assert.match(page, /function bleStuck\(w\)\{ if\(!w\)\{ bleWedges=0; return; \} if\(!window\.deck\?\.bleReset\) return; if\(\+\+bleWedges<2\) return;/, 'two stuck tries in a row');
  assert.match(page, /window\.deck\?\.bleResetCancel\?\.\(\);\n    if\(ble\)\{ bleWedges=0;/, 'a working connection withdraws a pending reset');
  assert.match(page, /if\(ble\)\{ bleWedges=0; bleTrace\("bağlandı: "/, 'a successful connection clears the count');
  assert.match(page, /\}catch\(e\)\{\n[^\n]*\n[^\n]*\n    if\(ble\)\{ log\("er","  Bluetooth: cihaz yanıt vermedi/, 'branches on how the try started, not on port');
  assert.match(page, /const BLE_KEEP=window\.deck\?\.platform==="win32";/);
  assert.doesNotMatch(code, /try\{ dev\.gatt\.disconnect\(\); \}catch\(_\)\{\} dev=null; lastBleDev=null;/, 'the remembered deck is not forgotten after one miss');
});

test('app: the stuck-Bluetooth reset goes through an empty page, then restarts the app if needed; rate limited', () => {
  assert.match(pre, /bleReset: why => ipcRenderer\.invoke\('ble-reset', String\(why \|\| ''\)\)/);
  assert.match(pre, /bleScan: \(\) => ipcRenderer\.invoke\('ble-scan'\)/);
  assert.match(pre, /bleLog: line => ipcRenderer\.send\('ble-log', String\(line\)\)/);
  assert.match(main, /if \(bleResetWhy \|\| Date\.now\(\) - bleResetAt < 10 \* 60e3\) return false;/);
  assert.match(main, /if \(win\.isVisible\(\) && win\.isFocused\(\) \|\| dialogsOpen\) return;/, 'not while the window or its file dialog is in use');
  assert.match(main, /if \(Date\.now\(\) - bleResetAsked > 2 \* 60e3\) \{ bleResetWhy = '';/, 'a request that waited too long is dropped');
  assert.match(main, /executeJavaScript\('!window\.__deckResetOk \|\| window\.__deckResetOk\(\)', true\)/, 'not while connected or flashing');
  assert.match(comp, /window\.__deckResetOk = \(\) => !port && !busy && !pickerOpen;/, 'not under the page\'s own file picker');
  assert.match(main, /if \(why === 'adaptör'\) bleAdapterReset = true;/, 'the one adapter reset is used up only when it happens');
  assert.match(main, /if \(bleResetWhy && Date\.now\(\) - bleResetAsked > 2 \* 60e3\) bleResetWhy = '';/);
  assert.match(page, /bleStuck\(BLE_KEEP&&bleReused&&up\)/, 'a deck that dropped us during hello is not "stuck"');
  assert.match(main, /ipcMain\.on\('ble-reset-cancel', \(\) => \{/);
  assert.match(main, /win\.webContents\.loadURL\('about:blank'\)/);
  assert.match(main, /&& !win\.isVisible\(\) && !\(Date\.now\(\) - \(st\.bleRelaunchAt \|\| 0\) < 60 \* 60e3\)\)/, 'restart only with the window hidden, once an hour');
  assert.match(main, /win\.on\('blur', bleResetOnBlur\); win\.on\('hide', \(\) => bleResetSoon\(\)\);/);
  assert.match(main, /dialogsOpen\+\+;/);
  assert.match(main, /bleScanStart = \(\) => \{ clearTimeout\(timer\); timer = null; pending = null; seen = \[\]; \};/, 'a new scan is not ended by an old timer');
  assert.match(main, /label: 'Bluetooth kaydını göster'/);
});

test('companion: watchdog drops only after two silent probes; a lost direct-mode answer is asked again; attempts are numbered', () => {
  assert.match(comp, /else if \(\+\+bleMiss < 2\) deck\.bleLog\?\.\(/);
  assert.match(comp, /if \(Date\.now\(\) - lastRxAt < 10e3\) \{ bleMiss = 0; return; \}/, 'data from the deck clears an older miss');
  assert.match(comp, /Date\.now\(\) - ackTriedAt > 10e3\) handshake\(\);/);
  assert.match(comp, /finally \{ if \(gen === connGen\) connecting = false; \}/);
  assert.match(comp, /if \(connecting\) \{ toast\('Otomatik bağlanma denemesi sürüyor/, 'the button does not start a second try in parallel');
  assert.match(comp, /Date\.now\(\) - usbSwitchFailAt < 300e3/, 'a cable that cannot be opened does not drop Bluetooth over and over');
});

test('Bluetooth log: lines with the local time, rolled over at the size limit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blelog-'));
  try {
    const log = createBleLog({ dir, maxBytes: 200, now: () => new Date(2026, 9, 30, 9, 5, 7, 42) });
    log.write('bağlandı: Game Deck v1.18.3'); log.write('  çok   boşluk\n yeni satır ');
    const lines = fs.readFileSync(log.file, 'utf8').trim().split('\n');
    assert.deepEqual(lines, ['2026-10-30 09:05:07.042 bağlandı: Game Deck v1.18.3', '2026-10-30 09:05:07.042 çok boşluk yeni satır']);
    for (let i = 0; i < 10; i++) log.write('satır ' + i);
    assert.ok(fs.existsSync(log.file + '.1'), 'old lines kept in ble.log.1');
    assert.ok(fs.statSync(log.file).size < 300);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
