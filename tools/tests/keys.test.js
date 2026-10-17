// 1.18.0: every key (A, B, knob press on home, power, power-on, reset) runs a list of up to 4 actions
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'web/body.html'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function normalizeConfig('), source.indexOf('/* ---------- End config semantics')), context);
const apps = [{ id: 'spotify', name: 'Spotify', launch: { method: 'run', value: 'spotify:' } }, { id: 'discord', name: 'Discord', launch: { method: 'run', value: 'discord' } }];

test('older configs become key lists: A / B, knob = home press app, power = screen, reset = restart', () => {
  const k = context.keysFrom({ apps, quick: { a: 'spotify', b: '__wake' }, home: { pressApp: 'discord' } }, ['spotify', 'discord']);
  assert.deepEqual(JSON.parse(JSON.stringify(k)), { a: ['spotify'], b: ['__wake'], knob: ['discord'], pwr: ['__screen'], pwrOn: [], rst: ['__restart'] });
});
test('lists drop unknown ids and duplicates, keep at most 4; the power-on list cannot turn the device off', () => {
  const k = context.keysFrom({ keys: { a: ['spotify', 'gone', 'spotify', '__mic', '__mute', '__wake', '__screen'], pwrOn: ['__wake', '__off', '__restart'] } }, ['spotify']);
  assert.deepEqual([...k.a], ['spotify', '__mic', '__mute', '__wake']);
  assert.deepEqual([...k.pwrOn], ['__wake']);
  assert.deepEqual([...k.rst], ['__restart']);                       // missing slot keeps its default
});
test('the old fields follow the first action, so older firmware still works', () => {
  const c = { apps, home: {}, keys: { a: ['__wake', 'spotify'], b: [], knob: ['__media', 'discord'] } };
  context.syncLegacyKeys(c);
  assert.deepEqual({ ...c.quick }, { a: '__wake', b: null });
  assert.equal(c.home.pressApp, 'discord');
});
test('a key difference is one Turkish line; old and new configs with the same meaning do not differ', () => {
  const old = { device: {}, home: { pressApp: 'discord' }, apps, quick: { a: 'spotify' } };
  const now = { device: {}, home: {}, apps, keys: { a: ['spotify'], b: [], knob: ['discord'], pwr: ['__screen'], pwrOn: [], rst: ['__restart'] } };
  assert.deepEqual(JSON.parse(JSON.stringify(context.configDiff(now, old))), []);
  now.keys.pwr = ['__screen', '__wake'];
  const d = JSON.parse(JSON.stringify(context.configDiff(now, old)));
  assert.equal(d.length, 1); assert.equal(d[0].label, 'Tuşlar · Güç tuşu'); assert.deepEqual(d[0].here, ['__screen', '__wake']);
});
test('firmware: lists per key, run in order, off / restart last; power-on list runs once, wake waits for Wi-Fi', () => {
  const store = fs.readFileSync(path.join(root, 'firmware/VolkanDeck/Store.h'), 'utf8');
  const ino = fs.readFileSync(path.join(root, 'firmware/VolkanDeck/VolkanDeck.ino'), 'utf8');
  assert.match(store, /static const char\* KEY_NAMES\[6\] = \{ "a", "b", "knob", "pwr", "pwrOn", "rst" \};/);
  assert.match(ino, /case K_HOME: runKey\(KEY_KNOB\);/);
  const run = ino.slice(ino.indexOf('static void runKey('), ino.indexOf('static bool keyHas('));
  assert.ok(run.indexOf('quickAct(id)') < run.indexOf('if (off) { ecoExit(); goSleep(); }'));
  assert.match(ino, /if \(p == 1\) \{[\s\S]*?runKey\(KEY_PWR\);[\s\S]*?\} else if \(p == 2\) \{ ecoExit\(\); goSleep\(\); \}/);
  assert.match(ino, /if \(r == 1\) \{ ecoExit\(\); wakeUp\(\); runKey\(KEY_RST\); \}\n  else if \(r == 2\) restartNow\(\);/);
  assert.match(ino, /bool keyBoot = offMarker == OFF_MAGIC && esp_sleep_get_wakeup_cause\(\) == ESP_SLEEP_WAKEUP_EXT0;/);
  assert.match(ino, /if \(id == "__wake"\) \{ if \(wifiWanted\(\)\) \{ bootWakeAt = millis\(\) \| 1;/);
  assert.match(ino, /bPwr\.raw = bPwr\.down = bPwr\.longFired = true;/, 'the press that woke the device is not a press');
});
