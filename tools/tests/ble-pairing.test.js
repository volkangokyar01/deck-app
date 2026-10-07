// Windows: the app must not keep connecting to an unpaired deck (Windows then shows "Try connecting your device again").
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('Bluetooth auto-connect waits for Windows pairing and backs off after failures', () => {
  const comp = read('app/companion.js'), main = read('app/main.js'), pre = read('app/preload.js');
  assert.match(pre, /blePaired: name => ipcRenderer\.invoke\('ble-paired', name\)/);
  assert.match(main, /if \(!IS_WIN\) return true;/);
  assert.match(main, /BTHLE\\\\DEV_\*/);
  assert.match(comp, /deck\.blePaired\?\.\(/);
  assert.match(comp, /\[12e3, 30e3, 60e3\]\[bleFails\] \|\| 300e3/);
  const conn = comp.indexOf('await connect(true, true);'), gate = comp.indexOf('deck.blePaired?.(');
  assert.ok(gate > 0 && gate < conn, 'pairing check comes before the Bluetooth connect');
});

test('firmware clears Bluetooth pairings only over USB and reports the bond count', () => {
  const proto = read('firmware/VolkanDeck/Proto.h'), hid = read('firmware/VolkanDeck/Hid.h');
  const i = proto.indexOf('"ble_forget"');
  assert.ok(i > 0);
  assert.match(proto.slice(i, i + 300), /SRC_BLE\) \{ replyErr\(id, "usb_only"\)/);
  assert.match(proto, /r\["bonds"\] = bleBondCount\(\);/);
  assert.match(hid, /NimBLEDevice::deleteAllBonds\(\);/);
});
