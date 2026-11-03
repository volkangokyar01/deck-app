// 2026-11-04: Windows / Chromium Web Bluetooth stops finding the deck's services in the app process after the data
// channel was lost (it started each time the TP-Link adapter stopped answering, BTHUSB event 3). The app restarts itself.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const comp = read('app/companion.js'), main = read('app/main.js'), pre = read('app/preload.js');

const errOf = src => { const m = src.match(/const bleWedgeErr = (e => [\s\S]*?\)\)\);)/); return eval(m[1].replace(/;$/, '')); };
const wedge = errOf(comp);
const E = (name, message, extra = {}) => Object.assign(new Error(message), { name, ...extra });

test('only "services never come" failures count as the stuck state', () => {
  assert.equal(wedge(E('TimeoutError', 'servis zaman aşımı')), true);
  assert.equal(wedge(E('TimeoutError', 'okuma kanalı zaman aşımı')), true);
  assert.equal(wedge(E('NetworkError', 'GATT Server is disconnected. Cannot retrieve services. (Re)connect first with `device.gatt.connect`.')), true);
  assert.equal(wedge(E('TimeoutError', 'cihaz arama zaman aşımı', { unseen: true })), false, 'a deck that is off is not this');
  assert.equal(wedge(E('NotFoundError', 'User cancelled the requestDevice() chooser.', { unseen: true })), false);
  assert.equal(wedge(E('TimeoutError', 'bağlanma zaman aşımı')), false, 'gatt.connect timing out is an unreachable deck');
  assert.equal(wedge(null), false);
});

test('companion: two stuck failures (three before any link) ask for a restart; the window in use is never closed', () => {
  assert.match(comp, /if \(\+\+bleWedges < \(bleHadLink \? 2 : 3\)\) return;/);
  assert.match(comp, /const r = await deck\.bleRelaunch\?\.\(\)\.catch\(\(\) => null\);/);
  assert.match(comp, /if \(r\?\.reason === 'focused'\) serialNote\(/);
  assert.match(comp, /deck\.bleAdapterTimeouts\?\.\(\)/, 'the log names the adapter when Windows saw it fail');
  assert.ok((comp.match(/await bleWedgeCheck\(\);/g) || []).length >= 2, 'after automatic and manual Bluetooth attempts');
  assert.match(pre, /bleRelaunch: \(\) => ipcRenderer\.invoke\('ble-relaunch'\)/);
  assert.match(pre, /bleAdapterTimeouts: \(\) => ipcRenderer\.invoke\('ble-adapter-timeouts'\)/);
});

test('main: restart only on Windows, not while focused, 3 min apart, 6 an hour, hidden stays hidden', () => {
  const i = main.indexOf("ipcMain.handle('ble-relaunch'"), h = main.slice(i, main.indexOf('\n});', i));
  assert.ok(i > 0);
  assert.match(h, /if \(!IS_WIN\) return \{ ok: false, reason: 'platform' \};/);
  assert.match(h, /win\.isFocused\(\)\) return \{ ok: false, reason: 'focused' \};/);
  assert.match(h, /recent\.length >= 6 \|\| recent\.some\(t => now - t < 3 \* 60e3\)/);
  assert.match(h, /concat\(visible \? \[\] : \['--hidden'\]\)/);
  assert.match(h, /app\.relaunch\(/); assert.match(h, /quitting = true; app\.quit\(\);/);
  assert.match(main, /ProviderName='BTHUSB'; Id=3; StartTime=\(Get-Date\)\.AddMinutes\(-15\)/);
});
