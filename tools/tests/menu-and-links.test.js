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
  assert.match(ino, /case K_MENU: menuPress\(\); break;/);
  assert.match(ino, /openPage\(K_MEDIA\);/, 'launching a music app still opens Medya');
  assert.match(web, /\.\.\.cfg\.apps\.filter\(a=>a\.inWheel\), \.\.\.\(menuPages\(\)\.length\?\[MENUP\]:\[\]\)\]/);
});

test('menu: press shows a cursor, turning moves it, press opens; A / B stay quick apps', () => {
  const ino = read('firmware/VolkanDeck/VolkanDeck.ino'), ui = read('firmware/VolkanDeck/Ui.h'), web = read('web/body.html');
  const press = ino.slice(ino.indexOf('static void menuPress()'), ino.indexOf('static void onPress()'));
  assert.match(press, /if \(!menuPick\) \{ menuPick = true; return; \}/);
  assert.match(press, /openPage\(pages\[constrain\(menuCur/);
  assert.match(ino, /else if \(menuPick && k == K_MENU\) \{/, 'turning moves the cursor in pick mode');
  assert.ok(!/menuKey|menuIndexForKey/.test(ino + ui), 'no A / B shortcuts');
  assert.match(ino, /if \(menuPick && now - menuAt > 15000\)/);
  assert.match(ui, /menuPick = false; int menuCur = 0;/);
  assert.ok(!/menuKeyIndex|openMenuPage/.test(web));
  assert.match(web, /function menuPress\(\)/);
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

test('knob: the menu opens only by turning left on home and keeps you there; right past the last app goes home', () => {
  const ui = read('firmware/VolkanDeck/Ui.h'), web = read('web/body.html');
  const fw = ui.slice(ui.indexOf('static int wheelStep('), ui.indexOf('static void buildItems()'));
  const js = fw.replace('static int wheelStep(int i, int dir)', 'function step(i, dir)').replace(/int n = /, 'let n = ')
    .replace('bool hasMenu', 'let hasMenu').replace('int last', 'let last');
  for (const wrap of [true, false]) {
    // items: 0 home, 1 cards, 2..4 apps, 5 menu
    const items = [{kind:0},{kind:4},{kind:3},{kind:3},{kind:3},{kind:6}]; items.size = () => items.length;
    const ctx = { S: { wrap }, items, K_MENU: 6 };
    const step = vm.runInNewContext(js + ';step', ctx);
    assert.strictEqual(step(0, -1), 5, 'left on home → menu');
    assert.strictEqual(step(5, 1), 0, 'right on menu → home');
    assert.strictEqual(step(4, 1), wrap ? 0 : 4, 'right on the last app never enters the menu');
    assert.strictEqual(step(5, -1), 5, 'left on the menu stays there');
    assert.strictEqual(step(2, 1), 3); assert.strictEqual(step(2, -1), 1);
  }
  assert.match(read('firmware/VolkanDeck/VolkanDeck.ino'), /i = wheelStep\(i, steps > 0 \? 1 : -1\)/);
  assert.match(web, /const i=wheelStep\(sel,c==="cw"\?1:-1\)/);
});

test('A / B can open a menu page; config keeps the page ids', () => {
  const ino = read('firmware/VolkanDeck/VolkanDeck.ino'), ui = read('firmware/VolkanDeck/Ui.h'), web = read('web/body.html');
  assert.match(ui, /id == "__media" \? K_MEDIA : id == "__system" \? K_SYS : id == "__connections" \? K_CONN : 0/);
  assert.match(ino, /else quickAct\(S\.quickA\);/);
  assert.match(ino, /else quickAct\(S\.quickB\);/);
  const q = ino.slice(ino.indexOf('static void quickAct('), ino.indexOf('// press on the menu list'));
  assert.match(q, /if \(!pg\) \{ doLaunch\(appById\(id\)\); return; \}/);
  assert.match(q, /openPage\(pg\);/);
  assert.match(web, /qref=v=>\["__media","__system","__connections"\]\.includes\(v\)\?v:ref\(v\)/, 'device projection keeps page ids');
  assert.match(web, /!\["__media","__system","__connections"\]\.includes\(c\.quick\[k\]\) && !c\.apps\.some/, 'migration keeps page ids');
});
