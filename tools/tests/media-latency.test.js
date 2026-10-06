const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMacSource, parseMacLines, asPlayer } = require('../../app/media');
const { create } = require('../../app/art');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const never = () => new Promise(() => {});
test('native metadata waits for the fresh answer', async () => {
  const source = createMacSource({ osa: async () => { await sleep(20); return { code: 0, stdout: 'spotify\tplaying\tNew' }; } });
  assert.deepEqual(await source.lines([['Spotify', 's']]), ['spotify\tplaying\tNew']);
});
test('hung Automation is bounded and never duplicates the job', async () => {
  let calls = 0;
  const source = createMacSource({ osa: () => { calls++; return never(); }, freshWait: 30 });
  const t = performance.now(); await source.lines([['Spotify', 's']]);
  assert.ok(performance.now() - t < 300); await source.lines([['Spotify', 's']]); assert.equal(calls, 1);
});
test('browser scans respect minGap and never wait', async () => {
  let now = 10000, calls = 0;
  const source = createMacSource({ osa: () => { calls++; return never(); }, now: () => now });
  const t = performance.now(); await source.lines([['Google Chrome', 's', 2000]]);
  now += 500; await source.lines([['Google Chrome', 's', 2000]]);
  assert.equal(calls, 1); assert.ok(performance.now() - t < 100);
  // Completed scans also respect the gap.
  let completed = 0;
  const other = createMacSource({ osa: async () => { completed++; return { stdout: 'ytmusic\tT' }; }, now: () => now });
  await other.lines([['Google Chrome', 's', 2000]]); await sleep(0); now += 500;
  await other.lines([['Google Chrome', 's', 2000]]); assert.equal(completed, 1);
});
test('running apps are cached for two seconds', async () => {
  let now = 10000, calls = 0;
  const source = createMacSource({ running: async () => { calls++; return new Set(['Spotify']); }, now: () => now });
  await source.runningApps(); now += 1000; await source.runningApps(); assert.equal(calls, 1);
  now += 1500; await source.runningApps(); assert.equal(calls, 2);
});
test('native scripts guard against relaunch and Spotify alone reads artwork', () => {
  assert.match(asPlayer('spotify', 'Spotify', 1000), /artwork url/); assert.match(asPlayer('spotify', 'Spotify', 1000), /is running/);
  assert.match(asPlayer('music', 'Music', 1), /is running/); assert.doesNotMatch(asPlayer('music', 'Music', 1), /artwork url/);
});
test('native parsing preserves comma decimals and HTTPS artwork', () => {
  const [c] = parseMacLines('spotify\tplaying\tT\tA\t12,5\t200\thttps://i.scdn.co/image/ab67616d0000b273x');
  assert.equal(c.player, 'spotify'); assert.equal(c.playing, true); assert.equal(c.pos, 12.5); assert.equal(c.dur, 200); assert.match(c.artUrl, /^https:/);
  assert.equal(parseMacLines('spotify\tplaying\tT\tA\t0\t1\thttp://x')[0].artUrl, '');
});
const candidate = { player: 'spotify', title: 'T', artist: 'A', artUrl: 'https://i.scdn.co/image/ab67616d0000b273abc' };
function art(fetchData, decode = () => 'QUJD') { return create({ platform: 'darwin', run: () => { throw Error('osascript must not run'); }, ps: () => {}, fetchData, decode }); }
test('art uses metadata URL and 300px first', async () => {
  const calls = [], a = art(async url => { calls.push(url); return Buffer.from('x'); }), key = a.request(candidate);
  assert.deepEqual(await a.wait(key, 1000), { key, w: 64, h: 64, data: 'QUJD' }); assert.match(calls[0], /ab67616d00001e02abc/);
});
test('missing 300px falls back to original 640px', async () => {
  const calls = [], a = art(async url => { calls.push(url); return calls.length === 1 ? null : Buffer.from('x'); }), key = a.request(candidate);
  assert.ok(await a.wait(key, 1000)); assert.equal(calls[1], candidate.artUrl);
});
test('wait resolves as soon as decoding finishes', async () => {
  const a = art(async () => Buffer.from('x'), async () => { await sleep(30); return 'QUJD'; }), key = a.request(candidate), t = performance.now();
  assert.ok(await a.wait(key, 4000)); assert.ok(performance.now() - t < 500);
});
test('wait is bounded even if fetching hangs', async () => {
  const a = art(never), key = a.request(candidate), t = performance.now();
  assert.equal(await a.wait(key, 50), null); assert.ok(performance.now() - t < 300);
});
