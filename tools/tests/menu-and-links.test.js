// Menü (firmware 1.9.4) and web site shortcuts in the settings page
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('wheel: home, cards and apps; the three pages sit in one Menü item at the end', () => {
  const ui = read('firmware/VolkanDeck/Ui.h'), ino = read('firmware/VolkanDeck/VolkanDeck.ino'), web = read('web/body.html');
  const build = ui.slice(ui.indexOf('static void buildItems()'), ui.indexOf('static String itemId('));
  assert.ok(!/K_MEDIA \}|K_SYS \}|K_CONN \}/.test(build), 'pages are not wheel items any more');
  assert.ok(build.indexOf('K_APP') < build.indexOf('K_MENU'), 'menu after the apps');
  assert.match(ino, /return it->kind == K_MENU && subPage \? subPage : it->kind;/);
  assert.match(ino, /case K_MENU: menuKey\(1\); break;/);
  assert.match(ino, /k == K_MENU && menuKey\(0\)/);
  assert.match(ino, /k == K_MENU && menuKey\(2\)/);
  assert.match(ino, /openPage\(K_MEDIA\);/, 'launching a music app still opens Medya');
  assert.match(web, /\.\.\.cfg\.apps\.filter\(a=>a\.inWheel\), \.\.\.\(menuPages\(\)\.length\?\[MENUP\]:\[\]\)\]/);
});

test('menu keys: 3 pages → A / press / B, 2 → A / B, 1 → press', () => {
  const ui = read('firmware/VolkanDeck/Ui.h'), web = read('web/body.html');
  const fw = ui.slice(ui.indexOf('static int menuIndexForKey('), ui.indexOf('static void drawMenu()'));
  const c = fw.replace('static int menuIndexForKey(int n, int key)', 'function f(n, key)');
  const f = vm.runInNewContext(c + ';f');
  assert.deepStrictEqual([0, 1, 2].map(k => f(3, k)), [0, 1, 2]);
  assert.deepStrictEqual([0, 1, 2].map(k => f(2, k)), [0, -1, 1]);
  assert.deepStrictEqual([0, 1, 2].map(k => f(1, k)), [-1, 0, -1]);
  const line = web.match(/const menuKeyIndex = [^\n]+/)[0];
  const g = vm.runInNewContext(line.replace('const menuKeyIndex =', '(').replace(/;\s*$/, '') + ')');
  assert.deepStrictEqual(['a', 'press', 'b'].map(k => g(3, k)), [0, 1, 2]);
  assert.deepStrictEqual(['a', 'press', 'b'].map(k => g(2, k)), [0, -1, 1]);
  assert.deepStrictEqual(['a', 'press', 'b'].map(k => g(1, k)), [-1, 0, -1]);
});

test('web site shortcut: addresses are normalised, only http(s) is accepted, the name comes from the domain', () => {
  const web = read('web/body.html');
  const src = web.slice(web.indexOf('function normalizeUrl('), web.indexOf('async function addWebLink('));
  const ctx = { URL }; vm.runInNewContext(src, ctx);
  assert.strictEqual(ctx.normalizeUrl('youtube.com'), 'https://youtube.com/');
  assert.strictEqual(ctx.normalizeUrl(' https://www.netflix.com/browse '), 'https://www.netflix.com/browse');
  assert.strictEqual(ctx.normalizeUrl('javascript:alert(1)'), null);
  assert.strictEqual(ctx.normalizeUrl('file:///C:/x'), null);
  assert.strictEqual(ctx.normalizeUrl('localhost'), null);
  assert.strictEqual(ctx.normalizeUrl(''), null);
  assert.strictEqual(ctx.siteName('https://www.youtube.com/'), 'Youtube');
  assert.strictEqual(ctx.siteName('https://music.youtube.com/'), 'Youtube');
  assert.strictEqual(ctx.siteName('https://www.hepsiburada.com.tr/'), 'Hepsiburada');
  assert.match(web, /launch:\{method:"run",value:url\}, targets:\{win:url,mac:url\}/);
});
