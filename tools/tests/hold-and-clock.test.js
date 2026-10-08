// firmware 1.10.0: holding the knob goes home everywhere; media volume / mute on B / A hold; optional Wi-Fi
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('holding the knob goes home from every screen and closes open modes', () => {
  const ino = read('firmware/VolkanDeck/VolkanDeck.ino');
  const hold = ino.slice(ino.indexOf('} else if (e == 2) {'), ino.indexOf('if (pressPendingAt && now - pressPendingAt >= 330)'));
  assert.match(hold, /adjust = 0; connEdit = false; connConfirmAt = 0; menuPick = false;/);
  assert.match(hold, /if \(sel != 0\) selectIndex\(0\);/);
  assert.ok(!/K_MEDIA|K_SYS|K_CONN|K_MENU/.test(hold), 'no screen keeps its own long press');
});

test('media page: A hold mutes, B hold toggles the volume mode; other screens treat a hold as a press', () => {
  const ino = read('firmware/VolkanDeck/VolkanDeck.ino');
  assert.match(ino, /int a = bA\.poll\(600\);\n  if \(a == 2 && curKind\(\) == K_MEDIA && !wakeUp\(\)\) \{ evtInput\("a_hold"\); toggleMute\(\);/);
  assert.match(ino, /int b = bB\.poll\(600\);\n  if \(b == 2 && curKind\(\) == K_MEDIA && !wakeUp\(\)\) \{ evtInput\("b_hold"\); adjust = adjust \? 0 : 1;/);
  assert.match(ino, /else if \(\(a == 1 \|\| a == 2\) && !wakeUp\(\)\)/);
  assert.match(ino, /else if \(\(b == 1 \|\| b == 2\) && !wakeUp\(\)\)/);
});

test('Wi-Fi removed (1.11.0): no Wi-Fi code, the clock survives without it, old credentials are wiped', () => {
  const fw = ['Hid.h', 'Proto.h', 'Stats.h', 'Ui.h', 'VolkanDeck.ino'].map(f => read('firmware/VolkanDeck/' + f)).join('\n');
  assert.ok(!fs.existsSync(path.join(root, 'firmware/VolkanDeck/Wifi.h')));
  assert.ok(!/#include <WiFi\.h>|wifiScan|wifi_set|WiFi\./.test(fw));
  const web = read('web/body.html');
  assert.ok(!/wifi_scan|wifi_set|cardWifi/.test(web));
  const stats = read('firmware/VolkanDeck/Stats.h');
  assert.match(stats, /settimeofday\(&tv, nullptr\);/, 'app time also sets the chip clock');
  assert.match(stats, /time_t now = time\(nullptr\);\n    if \(now < 1700000000\) return false;/, 'chip clock used until the app sends time');
  assert.match(stats, /clockSet\(st\.epoch, st\.tz\);/);
  assert.match(read('firmware/VolkanDeck/VolkanDeck.ino'), /pr\.begin\("vdwifi", false\)\) \{ pr\.clear\(\);/);
  assert.match(read('firmware/VolkanDeck/Proto.h'), /r\["embPsram"\] = cap != 0;/, 'PSRAM read from the eFuse');
});

test('PSRAM (1.12.1): the build turns on the Arduino PSRAM layer, allocations check the heap', () => {
  assert.match(read('tools/build_firmware.sh'), /FLAGS="[^"]*-DBOARD_HAS_PSRAM/);
  assert.match(read('tools/build_firmware.sh'), /export ARDUINO_BUILD_CACHE_PATH=.*cache-\$\(printf %s "\$FLAGS"/, 'core.a cache keyed by the flags');
  const board = read('firmware/VolkanDeck/Board.h');
  assert.match(board, /#ifndef BOARD_HAS_PSRAM\n#error/);
  assert.match(board, /psramOk\(\) \{ return heap_caps_get_total_size\(MALLOC_CAP_SPIRAM\) > 0; \}/);
  const fw = ['Proto.h', 'Store.h', 'Ui.h', 'VolkanDeck.ino'].map(f => read('firmware/VolkanDeck/' + f)).join('\n');
  assert.ok(!/psramFound\(\)|ESP\.getPsramSize/.test(fw), 'psramFound() is true even when PSRAM failed to start');
  const web = read('web/body.html');
  assert.match(web, /if\(d\.fw&&!verGE\(d\.fw,"1\.12\.1"\)\) return "Ek bellek kapalı · firmware'i güncelle"/);
});
