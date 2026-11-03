// 1.19.0 home: animation full height on the left, four cards 2 x 2 (CPU | GPU, FPS | RAM), no A / B rows; RAM stats
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('desktop app: RAM in use and installed (Windows: total - available, macOS: vm_stat)', () => {
  const { ramFromOs, parseVmStat, RATES } = require('../../app/stats');
  assert.deepEqual(ramFromOs(32 * 1024 ** 3, 13.6 * 1024 ** 3), { used: 18.4, total: 32 });
  assert.equal(ramFromOs(0, 0), null);
  const vm_ = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:   5000.\nPages active:   300000.\nPages inactive: 290000.\nPages wired down:  150000.\nPages occupied by compressor:   50000.\n';
  assert.deepEqual(parseVmStat(vm_, 16 * 1024 ** 3), { used: 7.6, total: 16 });
  assert.equal(parseVmStat('garbage', 16 * 1024 ** 3), null);
  assert.equal(RATES.ram, 2000);
  assert.match(read('app/companion.js'), /statsRates = \{[^}]*ram: 2000/);
});
test('settings: four home slots, older configs keep their cards and get FPS / RAM', () => {
  const src = read('web/body.html'), ctx = vm.createContext({});
  vm.runInContext(src.slice(src.indexOf('function normalizeConfig('), src.indexOf('/* ---------- End config semantics')), ctx);
  const n = ctx.normalizeConfig({ device: {}, home: { cards: ['cpu', 'net'] }, apps: [] });
  assert.deepEqual([...n.home.cards], ['cpu', 'net', 'fps', 'ram']);
  assert.deepEqual([...ctx.normalizeConfig({ device: {}, home: {}, apps: [] }).home.cards], ['cpu', 'gpu', 'fps', 'ram']);
  assert.match(src, /c\.home\.cards=\[0,1,2,3\]\.map\(i=>ids\.includes\(cd\[i\]\)\?cd\[i\]:DEFAULT_HOME\(\)\.cards\[i\]\);/);
  assert.match(src, /const HOME_CARDS=\[\[132,15,91,76\],\[227,15,91,76\],\[132,93,91,75\],\[227,93,91,75\]\];/);
  const home = src.slice(src.indexOf('function drawHome(){'), src.indexOf('function isHomeShown('));
  assert.ok(!/cfg\.quick/.test(home), 'no A / B rows on the home preview');
});
test('firmware: 2 x 2 narrow cards, watts under CPU / GPU, RAM parsed, animation centred in a full-height panel', () => {
  const ui = read('firmware/VolkanDeck/Ui.h'), stats = read('firmware/VolkanDeck/Stats.h'), store = read('firmware/VolkanDeck/Store.h');
  const home = ui.slice(ui.indexOf('static void drawHome()'), ui.indexOf('// Keep periodic eco updates'));
  assert.match(home, /spr\.fillRoundRect\(2, 2, 128, 166, 8, SC_PANEL\);/);
  assert.match(home, /drawAnim\(2, HOME_ANIM_Y, 128, 128, millis\(\)\);/);
  assert.ok(!/quickA|quickB|miniIcon/.test(home), 'the A / B rows are gone');
  assert.match(ui, /if \(w < 120\) \{ drawNarrowCard\(wdg, x, y, w, h\); return; \}/);
  assert.match(ui, /text\(String\(\(int\)roundf\(p\.power\)\) \+ " W", x \+ 8, sy, FSB12, SC_TEXT\);/);
  assert.match(stats, /st\.ram\.used = num\(o\["used"\]\); st\.ram\.total = num\(o\["total"\]\);/);
  assert.match(store, /uint8_t cards\[4\] = \{ W_CPU, W_GPU, W_FPS, W_RAM \}, ccount = 4;/);
});
