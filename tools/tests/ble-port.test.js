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
    ReadableStream, WritableStream, Uint8Array, TextDecoder });
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
