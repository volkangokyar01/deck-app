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

test('Bağlantılar page: new computers pair only in pairing mode, the chosen one is enforced', () => {
  const hid = read('firmware/VolkanDeck/Hid.h'), ui = read('firmware/VolkanDeck/Ui.h'), ino = read('firmware/VolkanDeck/VolkanDeck.ino');
  const store = read('firmware/VolkanDeck/Store.h'), web = read('web/body.html');
  const begin = hid.slice(hid.indexOf('static void bleBegin('), hid.indexOf('static void bleRename('));
  assert.match(begin, /setSecurityAuth\(false, false, true\)/, 'bonding off outside pairing mode');
  const start = hid.slice(hid.indexOf('static void btPairStart('), hid.indexOf('static void btPairStop('));
  assert.match(start, /setSecurityAuth\(true, false, true\)/);
  assert.match(hid, /bt\.hasSel && memcmp\(id, bt\.sel, 6\)/, 'other computers are dropped when one is chosen');
  assert.match(hid, /if \(bt\.off \|\| bt\.hold\) \{ s->disconnect/);
  assert.match(ui, /if \(S\.mediaOn \|\| S\.sysOn \|\| S\.connOn\) items\.push_back\(\{ false, nullptr, K_MENU \}\)/);
  assert.match(ui, /WI-FI/);
  assert.match(ino, /case K_CONN: connPress\(\); break;/);
  assert.match(ino, /connPoll\(\);/);
  assert.match(store, /"connections":\{"enabled":true\}/);
  assert.match(store, /N\.connOn = pg\["connections"\]\["enabled"\] \| true;/);
  assert.match(web, /connections:\{enabled:true\}/);
  assert.match(web, /function drawConnPage\(\)/);
});

test('NimBLE store fits several computers; a full store never unpairs another computer', () => {
  const sh = read('tools/build_firmware.sh'), hid = read('firmware/VolkanDeck/Hid.h');
  assert.match(sh, /-DMYNEWT_VAL_BLE_STORE_MAX_CCCDS=32 -DMYNEWT_VAL_BLE_STORE_MAX_BONDS=4/);
  assert.match(sh, /compiler\.c\.extra_flags=\$NIMBLE/);
  assert.match(sh, /compiler\.cpp\.extra_flags=\$NIMBLE/);
  assert.match(hid, /#if MYNEWT_VAL\(BLE_STORE_MAX_CCCDS\) < 24 \|\| MYNEWT_VAL\(BLE_STORE_MAX_BONDS\) < 4\n#error/);
  assert.match(hid, /BLE_STORE_OBJ_TYPE_CCCD .*return BLE_HS_ESTORE_CAP;/s);
  assert.match(hid, /NimBLEDevice::setDeviceCallbacks\(new BtStoreCb\(\)\);/);
});

test('deleting pairings stops advertising first (NimBLE refuses to unpair identity-key peers while advertising)', () => {
  const hid = read('firmware/VolkanDeck/Hid.h');
  const f = hid.slice(hid.indexOf('static bool bleForget()'), hid.indexOf('// computer name over GATT'));
  const stop = f.indexOf('NimBLEDevice::stopAdvertising();'), del = f.indexOf('NimBLEDevice::deleteAllBonds();');
  assert.ok(stop > 0 && del > stop, 'advertising stops before the bonds are deleted');
  assert.match(f, /bt\.hold = true;[\s\S]*bt\.hold = false;/);
  assert.match(f, /if \(NimBLEDevice::getNumBonds\(\)\) ble_store_clear\(\);/);
  assert.match(f, /return ok;/);
  assert.match(hid, /static void btAdvertise\(\) \{ if \(bleStarted && !bt\.off && !bt\.hold\)/);
});
