const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMediaController, launchTarget, shapeForTarget } = require('../../app/media');
function controller(platform, overrides = {}) {
  const calls = [], opened = [];
  let time = 0;
  const deps = { platform, poll: async () => [], running: async () => new Set(),
    run: async (...args) => { calls.push(args); return { code: 0, stdout: '', stderr: '' }; },
    ps: async (...args) => { calls.push(args); return { ok: true, r: true }; },
    sleep: async ms => { time += ms; }, now: () => time, ...overrides };
  return { control: createMediaController(deps), calls, opened, launchPlayer: async p => { opened.push(p); return { ok: true }; } };
}
test('existing configs use system behaviour; session pin beats the launch setting and enables old firmware forwarding', () => {
  assert.equal(launchTarget('auto', undefined), ''); assert.equal(launchTarget('auto', 'none'), '');
  assert.equal(launchTarget('spotify', 'music'), 'spotify');
  assert.equal(shapeForTarget(null, 'auto', 'none').ctl, 'keys');
  assert.equal(shapeForTarget(null, 'auto', 'spotify').ctl, 'app');
  assert.equal(shapeForTarget(null, 'music', 'none').ctl, 'app');
});
for (const player of ['spotify', 'music']) test(`macOS launches ${player}, waits, then sends play (not toggle or raw keys)`, async () => {
  let polls = 0;
  const c = controller('darwin', { running: async () => new Set(++polls >= 3 ? [player === 'spotify' ? 'Spotify' : 'Music'] : []) });
  const r = await c.control('play_pause', 'auto', { launch: player, launchPlayer: c.launchPlayer });
  assert.equal(r.ok, true); assert.deepEqual(c.opened, [player]); assert.equal(c.calls.length, 1);
  assert.equal(c.calls[0][0], 'osascript'); assert.match(c.calls[0][1][1], / to play$/);
});
test('a running player is toggled even while its metadata is warming up; next/prev never launch', async () => {
  const c = controller('darwin', { running: async () => new Set(['Spotify']) });
  assert.equal((await c.control('play_pause', 'auto', { launch: 'music', launchPlayer: c.launchPlayer })).ok, true);
  assert.deepEqual(c.opened, []); assert.match(c.calls[0][1][1], /Spotify.*playpause/);
  const empty = controller('darwin');
  assert.equal((await empty.control('next', 'spotify', { launchPlayer: empty.launchPlayer })).error, 'keys'); assert.deepEqual(empty.opened, []);
});
test('a paused candidate is controlled and not replaced by the chosen launch player', async () => {
  const c = controller('darwin', { poll: async () => [{ player: 'music', ctl: 'app', playing: false }] });
  await c.control('play_pause', 'auto', { launch: 'spotify', launchPlayer: c.launchPlayer });
  assert.deepEqual(c.opened, []); assert.match(c.calls[0][1][1], /Music.*playpause/);
});
test('session pin launches despite another running player; failure and timeout never return keys', async () => {
  const c = controller('darwin', { poll: async () => [{ player: 'music', ctl: 'app' }] });
  assert.equal((await c.control('play_pause', 'spotify', { launch: 'music', launchPlayer: c.launchPlayer })).error, 'Oynatıcı hazır değil');
  assert.deepEqual(c.opened, ['spotify']); assert.deepEqual(c.calls, []);
  const failed = await c.control('play_pause', 'spotify', { launchPlayer: async () => ({ ok: false, error: 'Kurulu değil' }) });
  assert.equal(failed.error, 'Kurulu değil');
});
test('YouTube Music on macOS opens once without sending a media key', async () => {
  const c = controller('darwin');
  assert.equal((await c.control('play_pause', 'ytmusic', { launchPlayer: c.launchPlayer })).ok, true);
  assert.deepEqual(c.opened, ['ytmusic']); assert.deepEqual(c.calls, []);
});
test('Windows waits for a matching SMTC session and sends play, not toggle', async () => {
  let polls = 0;
  const c = controller('win32', { poll: async () => ++polls >= 3 ? [{ player: 'music', app: 'AppleMusic!App', ctl: 'app' }] : [] });
  const r = await c.control('play_pause', 'music', { launch: 'spotify', launchPlayer: c.launchPlayer });
  assert.equal(r.ok, true); assert.deepEqual(c.opened, ['music']); assert.deepEqual(c.calls, [['mctl', { app: 'AppleMusic!App', action: 'play' }]]);
});
test('concurrent play presses share one launch', async () => {
  let resolve, launches = 0;
  const c = controller('darwin');
  const launchPlayer = () => { launches++; return new Promise(r => { resolve = r; }); };
  const first = c.control('play_pause', 'ytmusic', { launchPlayer });
  await new Promise(r => setImmediate(r));
  const second = c.control('play_pause', 'ytmusic', { launchPlayer });
  resolve({ ok: true }); await Promise.all([first, second]); assert.equal(launches, 1);
});

test('main opens macOS players, Windows StartApps AUMIDs and YouTube URL through system calls', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../../app/main.js'), 'utf8'), from = src.indexOf('async function launchMediaPlayer(');
  for (const platform of ['darwin', 'win32']) {
    const calls = [], ctx = vm.createContext({ IS_MAC: platform === 'darwin', IS_WIN: platform === 'win32',
      ok: () => ({ ok: true }), fail: error => ({ ok: false, error }),
      shell: { openExternal: async url => { calls.push(url); } }, openMac: async args => { calls.push(args); return { ok: true }; },
      findStartApp: async name => ({ AppID: name + '!App' }), detached: async (...args) => { calls.push(args); return { ok: true }; } });
    vm.runInContext(src.slice(from, src.indexOf('/* ---------------- IPC', from)), ctx);
    for (const player of ['spotify', 'music', 'ytmusic']) assert.equal((await ctx.launchMediaPlayer(player)).ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), platform === 'darwin' ? [['-a', 'Spotify'], ['-a', 'Music'], 'https://music.youtube.com'] :
      [['explorer.exe', ['shell:AppsFolder\\Spotify!App']], ['explorer.exe', ['shell:AppsFolder\\Apple Music!App']], 'https://music.youtube.com']);
    if (platform === 'win32') {
      ctx.findStartApp = async () => null;
      assert.equal((await ctx.launchMediaPlayer('music')).error, 'Apple Music kurulu değil');
      await ctx.launchMediaPlayer('spotify'); assert.equal(calls.at(-1), 'spotify:');
    }
  }
});

test('AppleScript refusal and missing Windows session do not fall back to raw keys', async () => {
  let launched = false;
  const mac = controller('darwin', { running: async () => new Set(launched ? ['Spotify'] : []), run: async () => ({ code: 1, stderr: 'İzin yok' }) });
  const r = await mac.control('play_pause', 'spotify', { launchPlayer: async () => { launched = true; return { ok: true }; } });
  assert.equal(r.ok, false); assert.equal(r.error, 'İzin yok');
  const win = controller('win32');
  assert.equal((await win.control('play_pause', 'auto', { launch: 'music', launchPlayer: win.launchPlayer })).error, 'Oynatıcı hazır değil');
  assert.deepEqual(win.calls, []);
});
