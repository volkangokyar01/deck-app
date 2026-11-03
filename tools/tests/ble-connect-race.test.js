// 2026-11-02: connection races and Bluetooth fixes found by testing on the real deck (firmware 1.18.5)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const page = read('web/body.html'), comp = read('app/companion.js');
const hid = read('firmware/VolkanDeck/Hid.h'), proto = read('firmware/VolkanDeck/Proto.h');
const connectCode = page.slice(page.indexOf('let connectCur=null'), page.indexOf('let readDone=null;'));

// connect() with the transport and UI stubbed: each openBlePort call waits until the test resolves it
function harness({ deck = true, slowUsb = false } = {}) {
  const opened = [], closed = [], detached = [], log = [], ble = [], usbOpen = [];
  const fakePort = (kind) => ({ kind, isBle: kind === 'ble', writable: { getWriter: () => ({}) }, addEventListener() {},
    open: () => { if (kind === 'usb' && usbOpen.busy) return Promise.reject(Object.assign(new Error('already opening'), { name: 'InvalidStateError' }));
      opened.push(kind); if (kind !== 'usb' || !slowUsb) return Promise.resolve();
      usbOpen.busy = true; return new Promise(r => usbOpen.push(() => { usbOpen.busy = false; r(); })); }, close: async () => { closed.push(kind); }, detach: () => { detached.push(kind); }, setSignals: async () => {} });
  const usb = Object.assign(fakePort('usb'), { getInfo: () => ({ usbVendorId: 0x303a }) });
  const ctx = vm.createContext({
    port: null, writer: null, readDone: null, rxBytes: 0, rxSample: '', deviceInfo: null, deviceCfg: null, lastStatus: null, fwNeeded: false, bleLastErr: null,
    ESP_VID: 0x303a, FIRMWARE: { version: '1.18.5' }, setTimeout, Promise,
    window: deck ? { deck: {} } : {},
    navigator: { serial: { getPorts: async () => [usb], requestPort: async () => usb } },
    openBlePort: () => new Promise((res, rej) => { ble.push({ ok: () => res(fakePort('ble')), fail: e => rej(e) }); }),
    bleErrorText: e => String(e.message || e), log: (...a) => log.push(a.join(' ')), serialNote() {}, toast() {},
    setConnUI() {}, renderStatus() {}, drawScreen() {}, renderEditor() {}, refreshConfigDiff() {}, markPending() {},
    readLoop: async () => {}, disconnectedUI() {}, disconnect: async () => { ctx.port = null; }, verGE: () => true, portLabel: () => '?',
    send: async (m) => m.cmd === 'hello' ? { fw: '1.18.5', name: 'Game Deck', mtu: 517 } : { config: {} },
  });
  vm.runInContext(connectCode + '\nthis.connect = connect; this.connectAbandon = connectAbandon; this.busy = () => connectRun();', ctx);
  return { ctx, opened, closed, detached, log, ble, usbOpen };
}
const tick = () => new Promise(r => setImmediate(r));
const fail = () => Object.assign(new Error('gone'), { name: 'NetworkError' });

test('a "USB ile bağlan" click during an automatic Bluetooth attempt connects USB at once; the late Bluetooth result is closed', async () => {
  const h = harness();
  const auto = h.ctx.connect(true, true); await tick();
  assert.ok(h.ctx.busy(), 'the Bluetooth attempt is running');
  await h.ctx.connect(false, false);
  assert.equal(h.ctx.port.kind, 'usb'); assert.deepEqual(h.opened, ['usb'], 'one USB open, no waiting');
  h.ble[0].ok(); await auto;
  assert.equal(h.ctx.port.kind, 'usb', 'the late Bluetooth port did not take over');
  assert.deepEqual(h.closed, ['ble'], 'and its link was closed');
});

test('the same click again while its own attempt runs is ignored', async () => {
  const h = harness();
  const c1 = h.ctx.connect(false, true); await tick();
  const c2 = h.ctx.connect(false, true); await tick();
  assert.equal(h.ble.length, 1, 'one Bluetooth attempt');
  h.ble[0].ok(); await c1; await c2;
  assert.equal(h.ctx.port.kind, 'ble'); assert.deepEqual(h.closed, []);
});

test('an automatic attempt is skipped while another one runs', async () => {
  const h = harness();
  const first = h.ctx.connect(true, true); await tick();
  assert.equal(await h.ctx.connect(true, false), 'busy');
  assert.deepEqual(h.opened, [], 'the automatic USB try returned at once');
  h.ble[0].ok(); await first;
});

test('an abandoned (stuck) attempt that finishes later closes its port instead of taking over', async () => {
  const h = harness();
  const stuck = h.ctx.connect(true, true); await tick();
  h.ctx.connectAbandon();
  assert.equal(h.ctx.busy(), null, 'the stuck rule frees the slot');
  await h.ctx.connect(true, false);
  assert.equal(h.ctx.port.kind, 'usb', 'a new attempt runs');
  h.ble[0].ok(); await stuck;
  assert.equal(h.ctx.port.kind, 'usb', 'the late Bluetooth port did not overwrite USB');
  assert.deepEqual(h.closed, ['ble']);
});

test('an abandoned Bluetooth attempt only lets go (no disconnect) while a newer Bluetooth attempt runs on the device', async () => {
  const h = harness();
  const old = h.ctx.connect(true, true); await tick();
  const click = h.ctx.connect(false, true); await tick();          // the click abandons the automatic one
  assert.equal(h.ble.length, 2);
  h.ble[0].ok(); await old;
  assert.deepEqual(h.detached, ['ble']); assert.deepEqual(h.closed, [], 'the shared device link stays up');
  h.ble[1].ok(); await click;
  assert.equal(h.ctx.port.kind, 'ble');
});

test('a "USB ile bağlan" click while an automatic USB attempt is opening the port waits for it: one open, connected', async () => {
  const h = harness({ slowUsb: true });
  const auto = h.ctx.connect(true, false); await tick();
  assert.equal(h.usbOpen.length, 1, 'the automatic open is in progress');
  const click = h.ctx.connect(false, false); await tick();
  assert.equal(h.usbOpen.length, 1, 'the click did not open the shared SerialPort a second time');
  h.usbOpen[0](); await auto; await click;
  assert.equal(h.ctx.port.kind, 'usb'); assert.deepEqual(h.opened, ['usb']); assert.deepEqual(h.closed, []);
});

test('the caller of an abandoned attempt gets control back at once', async () => {
  const h = harness();
  let done = false;
  const auto = h.ctx.connect(true, true).then(() => { done = true; }); await tick();
  h.ctx.connectAbandon(); await tick(); await tick();
  assert.equal(done, true, 'the automatic loop is not held for the rest of the scan');
  h.ble[0].ok(); await auto;
  assert.equal(h.ctx.port, null); assert.deepEqual(h.closed, ['ble']);
});

test('standalone page: a cable plugged in during a Bluetooth click is tried when that click fails', async () => {
  const h = harness({ deck: false });
  const click = h.ctx.connect(false, true); await tick();
  await h.ctx.connect(true, false);                                   // tryAuto on serial "connect"
  assert.deepEqual(h.opened, [], 'skipped while Bluetooth runs');
  h.ble[0].fail(fail()); await click;
  await new Promise(r => setTimeout(r, 20));
  assert.equal(h.ctx.port?.kind, 'usb', 'tried again afterwards');
});

test('a Bluetooth link that drops during hello is not reported as a USB board that does not answer', () => {
  assert.match(page, /if\(stale\(\)\) return;   \/\/ abandoned: the port may belong to a newer attempt by now\n    if\(p\.isBle\|\|port!==p\)\{ if\(port===p\) await disconnect\(\); return; \}/);
});

test('companion: no second attempt next to a running one, stuck rule abandons, USB busy keeps Bluetooth', () => {
  assert.match(comp, /const own = !connecting;/, 'the Bluetooth button leaves the automatic loop its flag');
  assert.match(comp, /if \(typeof connectAbandon === 'function'\) connectAbandon\(\);/);
  assert.match(comp, /\(typeof connectRun === 'function' && connectRun\(\)\)/);
  assert.match(comp, /finally \{ if \(autoRun === me\) connecting = false; \}/, 'a hung invocation does not clear a newer one');
  assert.match(comp, /if \(await connect\(true, true\) !== 'busy'\) \{ bleFails =/, 'a skipped try is not a failure');
  assert.match(comp, /if \(!deviceInfo\) try \{ await disconnect\(\); \} catch/, 'the stuck rule keeps a working connection');
  const sw = comp.slice(comp.indexOf("if (port) {                                               // on Bluetooth"), comp.indexOf("await connect(true);"));
  assert.ok(sw.indexOf('usbOpenable()') > 0 && sw.indexOf('usbOpenable()') < sw.indexOf('await disconnect()'), 'USB is checked before the Bluetooth link is dropped');
});

test('long Turkish deck names: cut to 29 UTF-8 bytes on a letter boundary, matched both ways', () => {
  const { bleAdvName, pickDeck, macDeckPaired } = require('../../app/ble-pick');
  const name = 'Şükrü Çağdaş Öğütçü Deck İşi';                       // 41 bytes
  const cut = bleAdvName(name);
  assert.ok(Buffer.byteLength(cut) <= 29);
  assert.ok(name.startsWith(cut) && !cut.includes('�'), 'no half letter');
  assert.equal(bleAdvName('Game Deck'), 'Game Deck');
  assert.equal(pickDeck([{ deviceId: 'a', deviceName: cut }], name), 'a', 'firmware 1.18.5 advertises the cut name');
  assert.equal(pickDeck([{ deviceId: 'a', deviceName: name }], name), 'a', 'older firmware / OS cache: the full name');
  assert.equal(pickDeck([{ deviceId: 'a', deviceName: '' }], name), '', 'an empty name is not a match');
  assert.equal(macDeckPaired({ SPBluetoothDataType: [{ device_not_connected: [{ [cut]: {} }] }] }, name), true);
  // same rule as the firmware: back up while the byte at the cut is a UTF-8 continuation byte
  assert.match(hid, /while \(n > 0 && \(\(uint8_t\)name\[n\] & 0xC0\) == 0x80\) n--;/);
  for (const use of ['NimBLEDevice::init(bleName(name).c_str())', 'NimBLEDevice::setDeviceName(bleName(name).c_str())', 'sr.setName(bleName(name).c_str())'])
    assert.ok(hid.includes(use), use);
});

test('firmware 1.18.5: new computer gets the keys, battery notifies on change, half lines are ended and expired', () => {
  assert.match(hid, /if \(!known\) \{ bt\.newBond = true; bleLastConn = ci\.getConnHandle\(\); btEvt\(BTE_PAIRED, 0, id\); return; \}/);
  assert.match(hid, /if \(!bleHid \|\| pct == last\) return;/);
  assert.match(proto, /if \(i\) for \(int t = 0; t < 40 && bleConnAlive\(conn\) && !bleTx->notify\(\(const uint8_t\*\)"\\n", 1, conn\); t\+\+\)/);
  assert.match(proto, /if \(L->len && now - L->at > 15000\) \{ L->len = 0; lineShrink\(L->buf, L->have\); \}/);
  assert.match(read('firmware/VolkanDeck/Board.h'), /#define FW_VERSION "1\.(18\.5|19\.\d+)"/);
});

test('an automatic attempt after a click already connected does not open a second session (which dropped the link)', async () => {
  const h = harness();
  const click = h.ctx.connect(false, true); await tick();
  h.ble[0].ok(); await click;
  assert.equal(h.ctx.port.kind, 'ble');
  assert.equal(await h.ctx.connect(true, true), 'busy', 'skipped');
  assert.equal(h.ble.length, 1); assert.deepEqual(h.closed, []);
  assert.match(page, /if\(port&&port!==p\)\{ if\(p\.isBle&&port\.isBle\) p\.detach\(\); else/);
});
