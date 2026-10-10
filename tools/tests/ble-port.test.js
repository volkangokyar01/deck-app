// Bluetooth port adapter in the settings page: chunked writes, notifications as a byte stream, disconnect event
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const body = fs.readFileSync(path.join(__dirname, '../../web/body.html'), 'utf8');
const src = body.slice(body.indexOf('const VD_SVC='), body.indexOf('async function connect('));

function fakeDevice() {
  const writes = [], txListeners = [], devListeners = {};
  const tx = { addEventListener: (t, f) => txListeners.push(f), startNotifications: async () => {} };
  const rx = { writeValueWithResponse: async b => { writes.push(Buffer.from(b).toString()); } };
  const dev = { name: 'Volkan Deck', addEventListener: (t, f) => { devListeners[t] = f; },
    gatt: { connected: true, connect: async () => ({ getPrimaryService: async () => ({ getCharacteristic: async u => u.endsWith('0002-5c2e-4b7a-9f3d-1a6c0de5d001') ? rx : tx }) }), disconnect() { this.connected = false; } } };
  const notify = s => { const b = Buffer.from(s); txListeners.forEach(f => f({ target: { value: new DataView(b.buffer, b.byteOffset, b.byteLength) } })); };
  return { dev, writes, notify, drop: () => devListeners.gattserverdisconnected() };
}

test('BLE port chunks writes, streams notifications and reports disconnects', async () => {
  const d = fakeDevice();
  const ctx = vm.createContext({ navigator: { bluetooth: { requestDevice: async o => { assert.deepEqual(o.filters[0].services, ['7d9a0001-5c2e-4b7a-9f3d-1a6c0de5d001']); return d.dev; } } },
    ReadableStream, WritableStream, Uint8Array, TextDecoder, setTimeout, clearTimeout, window: {} });
  vm.runInContext(src + ';this.open=openBlePort;', ctx);
  const p = await ctx.open();
  assert.equal(p.isBle, true);
  const w = p.writable.getWriter();
  const line = JSON.stringify({ id: 1, cmd: 'hello' }) + '\n';
  await w.write(new TextEncoder().encode(line));
  assert.ok(d.writes.every(c => c.length <= 20)); assert.equal(d.writes.join(''), line);
  p.chunk = 240; d.writes.length = 0;
  const big = 'x'.repeat(1000) + '\n'; await w.write(new TextEncoder().encode(big));
  assert.equal(d.writes.length, 5); assert.equal(d.writes.join(''), big);
  const r = p.readable.getReader();
  d.notify('{"id":1,'); d.notify('"ok":true}\n');
  let got = ''; while (!got.includes('\n')) got += new TextDecoder().decode((await r.read()).value);
  assert.equal(got, '{"id":1,"ok":true}\n');
  let gone = false; p.addEventListener('disconnect', () => { gone = true; });
  d.drop(); assert.equal(gone, true); assert.equal((await r.read()).done, true);
});

test('BLE port (2026-10-10): a hung write or connect times out instead of blocking the auto-connect loop', async () => {
  const d = fakeDevice();
  let dropped = 0;
  d.dev.gatt.connect = () => new Promise(() => {});           // Windows after the deck restarted: never answers
  const ctx = vm.createContext({ navigator: { bluetooth: { requestDevice: async () => d.dev } },
    ReadableStream, WritableStream, Uint8Array, TextDecoder, clearTimeout, window: { onBleDropped() { dropped++; } },
    setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 20)) });   // time limits shortened for the test
  vm.runInContext(src + ';this.open=openBlePort;', ctx);
  await assert.rejects(ctx.open(), e => e.name === 'TimeoutError');
  assert.equal(d.dev.gatt.connected, false, 'the half-open link is closed');
  const d2 = fakeDevice(); d2.dev.gatt.connect = fakeDevice().dev.gatt.connect;
  ctx.navigator.bluetooth.requestDevice = async () => d2.dev;
  const p = await ctx.open();
  d2.dev.gatt.connect = null;
  const rxHang = { writeValueWithResponse: () => new Promise(() => {}) };
  // a write that never completes ends the port and reports the drop
  const p2src = src.replace('rx=await bleWithin(svc.getCharacteristic(VD_RX),5000,"yazma kanalı");', 'rx=__rx;');
  const ctx2 = vm.createContext({ ...ctx, __rx: rxHang, navigator: { bluetooth: { requestDevice: async () => fakeDevice().dev } } });
  vm.runInContext(p2src + ';this.open=openBlePort;', ctx2);
  const port = await ctx2.open();
  let gone = false; port.addEventListener('disconnect', () => { gone = true; });
  await assert.rejects(port.writable.getWriter().write(new Uint8Array([1, 2, 3])));
  assert.equal(gone, true); assert.ok(dropped >= 1);
  assert.ok(p.isBle);
});

test('companion: fast Bluetooth retries after a drop, watchdog asks hello after 10 s of silence, a stuck try is reset', () => {
  const comp = fs.readFileSync(path.join(__dirname, '../../app/companion.js'), 'utf8');
  assert.match(comp, /window\.onBleDropped = \(\) => \{ bleFails = 0; bleTriedAt = 0; bleFastUntil = Date\.now\(\) \+ 180e3; \};/);
  assert.match(comp, /const bleWait = Date\.now\(\) < bleFastUntil \? 4e3 :/);
  assert.match(comp, /Date\.now\(\) - lastRxAt < 10e3\) return;/);
  assert.match(comp, /if \(connecting && Date\.now\(\) - connectingAt > 60e3\)/);
  assert.match(body, /setTimeout\(\(\)=>\{ if\(pending\.has\(id\)\)\{ pending\.delete\(id\); rejFn\(new Error\("Cihaz yanıt vermedi"\)\); \} \},timeout\);\n  const w=withWrite/, 'send() times out even when the write hangs');
});
