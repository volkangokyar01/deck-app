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

test('Medya / Ses ve parlaklık (1.13.4): the knob works inside the page at once; A hold mutes; B hold is a press', () => {
  const ino = read('firmware/VolkanDeck/VolkanDeck.ino');
  assert.match(ino, /int a = bA\.poll\(600\);\n  if \(a == 2 && curKind\(\) == K_MEDIA && !wakeUp\(\)\) \{ evtInput\("a_hold"\); toggleMute\(\);/);
  assert.ok(!/b_hold/.test(ino), 'no volume mode on B hold any more');
  assert.match(ino, /else if \(\(a == 1 \|\| a == 2\) && !wakeUp\(\)\)/);
  assert.match(ino, /if \(\(b == 1 \|\| b == 2\) && !wakeUp\(\)\)/);
  const enc = ino.slice(ino.indexOf('uint8_t k = curKind();', ino.indexOf('static void handleInput()')), ino.indexOf('evtInput(steps > 0 ? "cw" : "ccw");'));
  assert.match(enc, /if \(k == K_MEDIA\) \{ adjust = 1; levelStep\(true, steps\); \}/);
  assert.match(enc, /else if \(k == K_SYS\) \{ if \(!adjust\) adjust = 1; levelStep\(adjust == 1, steps\); \}/);
  assert.ok(enc.indexOf('k == K_MEDIA') < enc.indexOf('selectIndex('), 'the page handles the knob before the wheel moves');
});

test('Wi-Fi (1.13.0): chosen only in the app, kept across restarts, password never echoed; the clock still works without it', () => {
  const w = read('firmware/VolkanDeck/Wifi.h'), proto = read('firmware/VolkanDeck/Proto.h'), ino = read('firmware/VolkanDeck/VolkanDeck.ino');
  const ui = read('firmware/VolkanDeck/Ui.h'), web = read('web/body.html');
  assert.match(w, /if \(wf\.on && wf\.ssid\.length\(\)\) wifiStart\(\);/, 'radio off until a network is saved');
  assert.match(w, /WiFi\.setSleep\(true\);/, 'modem sleep is required with Bluetooth on');
  assert.ok(!/pass/.test(w.slice(w.indexOf('static void wifiStatusJson('))), 'status never carries the password');
  assert.ok(!/pr\.begin\("vdwifi", false\)\) \{ pr\.clear\(\);/.test(ino), 'the 1.11.0 boot wipe is gone: the saved network survives');
  for (const c of ['wifi_status', 'wifi_scan', 'wifi_set', 'wifi_on', 'wifi_forget']) assert.ok(proto.includes('"' + c + '"'), c);
  assert.ok(!/wifiSetOn\(!wf\.on\)/.test(ino), 'no device-side toggle: networks are set in the app only');
  assert.match(ui, /spr\.setPsram\(psramOk\(\) && wifiWanted\(\)\);/, 'screen buffer in PSRAM when Wi-Fi is on');
  assert.match(w, /if \(!wf\.started && internalFree\(\) < WIFI_MIN_HEAP\) \{ wf\.noMem = true;/);
  assert.match(web, /const WIFI_FW="1\.13\.0";/);
  assert.match(web, /await send\(\{cmd:"wifi_set",ssid,pass:pv\},4000,true\); passInp\.value="";/);
  assert.ok(!/cfg\.[a-z.]*pass/i.test(web), 'the password is not part of the saved config');
  const stats = read('firmware/VolkanDeck/Stats.h');
  assert.match(stats, /settimeofday\(&tv, nullptr\);/, 'app time also sets the chip clock');
  assert.match(stats, /time_t now = time\(nullptr\);\n    if \(now < 1700000000\) return false;/, 'chip clock (NTP or app) used while the app is away');
  assert.match(proto, /r\["embPsram"\] = cap != 0;/, 'PSRAM read from the eFuse');
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

test('home status row (1.13.1): Bluetooth and Wi-Fi icons differ when connected and redraw on change', () => {
  const ui = read('firmware/VolkanDeck/Ui.h'), ino = read('firmware/VolkanDeck/VolkanDeck.ino');
  const bt = ui.slice(ui.indexOf('static uint8_t btIconState()'), ui.indexOf('static uint8_t wifiIconState()'));
  assert.match(bt, /if \(!bleStarted \|\| bt\.off\) return 0;/);
  assert.match(bt, /return bleConnected \? 3 : 1;/);
  const wf = ui.slice(ui.indexOf('static uint8_t wifiIconState()'), ui.indexOf('static void gSlash('));
  assert.match(wf, /"connected"/);
  assert.match(wf, /"failed"\) \|\| !strcmp\(ws, "nomem"\)\) return 2;/);
  const draw = ui.slice(ui.indexOf('static void drawLinkIcons('), ui.indexOf('// Layout: 2 px outer margin'));
  assert.match(draw, /b == 3 \? BT_ON/, 'connected Bluetooth has its own colour');
  assert.match(draw, /if \(b == 0\) pxSlash/, 'Bluetooth off is crossed out');
  assert.match(draw, /if \(w == 0\) gSlash/, 'Wi-Fi off is crossed out');
  assert.match(draw, /if \(w == 2\) gSlash\(wx, 7, SC_RED\)/, 'Wi-Fi failure is crossed out in red');
  assert.match(ui, /if \(x0 > 2\) drawLinkIcons\(/, 'only the home status row (x0 = 134) draws the icons');
  assert.ok(!/text\(link,/.test(ui), 'the link is a symbol, not "usb" / "ble" text (1.13.2)');
  assert.match(ui, /pxUsb\(264, 7, usb \? SC_TEXT : SC_DIM\)/);
  assert.match(ui, /static const uint16_t BM_BT\[13\]/, 'status-row symbols are pixel bitmaps (1.13.4)');
  assert.match(ino, /uint8_t ic = btIconState\(\) \| wifiIconState\(\) << 2; if \(ic != lastIcons\)/);
});
