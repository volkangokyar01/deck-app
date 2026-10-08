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

test('Wi-Fi: off until a network is saved, password never echoed, settings page keeps no password', () => {
  const w = read('firmware/VolkanDeck/Wifi.h'), proto = read('firmware/VolkanDeck/Proto.h'), web = read('web/body.html');
  assert.match(w, /if \(wf\.on && wf\.ssid\.length\(\)\) wifiStart\(\);/);
  assert.match(w, /WiFi\.setSleep\(true\);/, 'modem sleep is required with Bluetooth on');
  const status = w.slice(w.indexOf('static void wifiStatusJson('));
  assert.ok(!/pass/.test(status), 'status never carries the password');
  for (const c of ['wifi_status', 'wifi_scan', 'wifi_set', 'wifi_on', 'wifi_forget']) assert.ok(proto.includes('"' + c + '"'), c);
  assert.match(proto, /pass\.length\(\) && pass\.length\(\) < 8/);
  assert.match(web, /await send\(\{cmd:"wifi_set",ssid:sv,pass:pv\},4000,true\); pass\.value="";/);
  assert.ok(!/cfg\.[a-z.]*pass/i.test(web), 'the password is not part of the saved config');
});
