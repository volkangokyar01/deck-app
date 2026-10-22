// 2026-10-22: the computer starts with the deck switched off. Bluetooth must connect soon after the deck is switched
// on (it waited up to 5 min), and the stats helpers must not run for nobody in the meantime.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const EventEmitter = require('node:events');
const cp = require('node:child_process');
const { createStats } = require('../../app/stats');
const root = path.join(__dirname, '../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const page = read('web/body.html'), comp = read('app/companion.js'), main = read('app/main.js');

function blePort({ request, connect }) {
  const dev = { name: 'Game Deck', addEventListener() {}, gatt: { connect, disconnect() {} } };
  const ctx = vm.createContext({ ReadableStream, WritableStream, setTimeout, clearTimeout, cfg: { device: { name: 'Game Deck' } }, window: {},
    navigator: { bluetooth: { requestDevice: async () => request(dev) } } });
  vm.runInContext(page.slice(page.indexOf('const VD_SVC='), page.indexOf('async function connect(')) + '\nthis.openBlePort = openBlePort;', ctx);
  return ctx.openBlePort;
}
const service = async () => ({ getPrimaryService: async () => ({ getCharacteristic: async () => ({ addEventListener() {}, startNotifications: async () => {} }) }) });

test('a deck the scan does not see is marked unseen; a deck that is seen but fails is not', async () => {
  const off = blePort({ request: () => { throw Object.assign(new Error('User cancelled the requestDevice() chooser.'), { name: 'NotFoundError' }); }, connect: service });
  await assert.rejects(off(), e => e.name === 'NotFoundError' && e.unseen === true);
  const broken = blePort({ request: dev => dev, connect: async () => { throw Object.assign(new Error('GATT error'), { name: 'NetworkError' }); } });
  await assert.rejects(broken(), e => e.name === 'NetworkError' && !e.unseen);
  const ok = blePort({ request: dev => dev, connect: service });
  assert.equal((await ok()).isBle, true);
});

test('companion: an unseen deck is tried every 20 s without growing the back-off; seen failures still back off', () => {
  assert.match(page, /catch\(e\)\{ port=null; bleLastErr=e;/);
  assert.match(page, /if\(!\(auto&&e\.unseen&&before\?\.unseen\)\) log\("er"/, 'a deck that stays off is logged once');
  assert.match(comp, /: bleUnseen\(\) \? 20e3 : \[12e3, 30e3, 60e3\]\[bleFails\] \|\| 300e3;/);
  assert.match(comp, /bleFails = port \? 0 : bleUnseen\(\) \? bleFails : bleFails \+ 1;/);
  assert.match(comp, /window\.addEventListener\?\.\('focus', \(\) => \{ if \(!port && !connecting && Date\.now\(\) - bleTriedAt > 5e3\) bleTriedAt = 0; \}\);/);
  assert.match(main, /powerMonitor\.on\('resume', \(\) => \{\n\s+if \(win && !win\.isDestroyed\(\)\) win\.webContents\.executeJavaScript\('window\.onBleDropped && window\.onBleDropped\(\)', true\)/);
});

test('Windows: a deck paired under an older name still counts as paired (its Game Deck GATT service node)', () => {
  const svc = page.match(/const VD_SVC="([0-9a-f-]+)"/)[1].toUpperCase();
  assert.ok(main.includes("$_.InstanceId -like 'BTHLEDEVICE\\\\{" + svc + "}*'"), 'same UUID as the page');
  assert.match(main, /\(\$_\.InstanceId -like 'BTHLE\\\\DEV_\*' -and \$_\.FriendlyName -eq '\$\{q\}'\) -or /);
});

test('stats helper processes run only while a deck is connected', async () => {
  const spawn = cp.spawn, started = [];
  cp.spawn = file => {
    const p = new EventEmitter();
    p.stdout = new EventEmitter(); p.stdout.setEncoding = () => {};
    p.kill = () => { p.killed = true; setImmediate(() => p.emit('exit')); };
    started.push({ file, p }); return p;
  };
  const stats = createStats({ platform: 'win32', fetch: async () => { throw new Error('offline'); } });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  try {
    stats.setLive(false); stats.start(); await wait(1100);
    assert.equal(started.length, 0, 'no PowerShell helper while no deck is connected');
    stats.setLive(true); await wait(1100);
    assert.deepEqual(started.map(s => s.file), ['powershell.exe']);
    stats.setLive(false); await wait(1100);
    assert.equal(started[0].p.killed, true, 'stopped when the deck went away');
    stats.setLive(true); await wait(1100);
    assert.equal(started.length, 2, 'started again right away on reconnect');
  } finally { stats.stop(); cp.spawn = spawn; }
  assert.match(main, /helpersFollow\(!!s\.connected\)/);
  assert.match(main, /helpersIdle = setTimeout\(\(\) => \{ stats\.setLive\(false\); media\.stop\(\); mailWatcher\.stop\(\); \}, 60e3\)/);
});
