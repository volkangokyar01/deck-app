// 2026-10-18: Bluetooth reconnects to the deck it already knows without a new scan; manual "Bluetooth ile bağlan"
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../..');
const page = fs.readFileSync(path.join(root, 'web/body.html'), 'utf8');
const code = page.slice(page.indexOf('const VD_SVC='), page.indexOf('async function connect('));

function harness({ known = [], connectFails = false } = {}) {
  const calls = { request: 0, connect: 0 };
  const dev = (name) => {
    const d = { name, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; },
      gatt: { connect: async () => { calls.connect++; if (connectFails && d.known) throw new Error('unreachable'); return { getPrimaryService: async () => ({ getCharacteristic: async () => ({ addEventListener() {}, startNotifications: async () => {}, writeValueWithResponse: async () => {} }) }) }; }, disconnect() {} } };
    return d;
  };
  const knownDevs = known.map(n => Object.assign(dev(n), { known: true }));
  const ctx = vm.createContext({ ReadableStream, WritableStream, setTimeout, clearTimeout, cfg: { device: { name: 'Game Deck' } }, window: {},
    navigator: { bluetooth: { getDevices: async () => knownDevs, requestDevice: async () => { calls.request++; return dev('Game Deck'); } } } });
  vm.runInContext(code + '\nthis.openBlePort = openBlePort; this.bleWithin = typeof bleWithin === "function" ? bleWithin : null;', ctx);
  if (!ctx.bleWithin) vm.runInContext('function bleWithin(p){ return p; }', ctx);
  return { ctx, calls };
}

test('a deck allowed before is connected directly, no scan', async () => {
  const { ctx, calls } = harness({ known: ['Game Deck'] });
  const p = await ctx.openBlePort();
  assert.equal(p.isBle, true); assert.equal(calls.request, 0); assert.equal(calls.connect, 1);
  await ctx.openBlePort(); assert.equal(calls.request, 0, 'the second time too (remembered device)');
});
test('the known deck unreachable: falls back to a scan', async () => {
  const { ctx, calls } = harness({ known: ['Game Deck'], connectFails: true });
  const p = await ctx.openBlePort();
  assert.equal(p.isBle, true); assert.equal(calls.request, 1);
});
test('another deck name among several allowed devices is not taken', async () => {
  const { ctx, calls } = harness({ known: ['Ali Deck', 'Veli Deck'] });
  await ctx.openBlePort(); assert.equal(calls.request, 1);
});
test('header has the Bluetooth button next to USB; the app connects on it and picks the only deck nearby', () => {
  assert.match(page, /<button class="btn" id="btnConnect">USB ile bağlan<\/button>\n    <button class="btn" id="btnBle"[^>]*>Bluetooth ile bağlan<\/button>/);
  assert.match(page, /\$\("#btnBle"\)\.hidden=on\|\|!\("bluetooth" in navigator\);/, 'hidden while connected');
  const comp = fs.readFileSync(path.join(root, 'app/companion.js'), 'utf8');
  assert.match(comp, /window\.__deckBleConnect = async \(\) => \{/);
  const main = fs.readFileSync(path.join(root, 'app/main.js'), 'utf8');
  assert.match(main, /finish\(manual && seen\.length === 1 \? seen\[0\]\.deviceId : ''\)/);
});
