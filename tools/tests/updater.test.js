const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createUpdater, blobHash, appFiles, differences, verifyApp, extractApp } = require('../../app/updater');

const API = 'https://api.github.com/repos/volkangokyar01/deck-app';
const REMOTE = 'a'.repeat(40), LOCAL = 'b'.repeat(40), STALE = 'c'.repeat(40);
const newerMessage = "Bu bilgisayardaki sürüm GitHub'dakinden yeni (henüz gönderilmemiş değişiklikler var).";
const warning = "Bu bilgisayardaki sürümde GitHub'da olmayan değişiklikler var; güncellersen kaybolur.";
const contents = {
  'main.js': 'remote main', 'package.json': '{}', 'index.html': '<html></html>',
  'preload.js': 'remote preload', 'vendor/nested.js': 'remote module',
  'build-info.json': JSON.stringify({ commit: STALE, dirty: true, built: 'old' })
};
const tree = { tree: Object.entries(contents).map(([name, text]) => ({
  path: 'app/' + name, type: 'blob', mode: '100644', sha: blobHash(Buffer.from(text))
})) };
const files = appFiles(tree);
async function writeApp(dir, values = contents) {
  for (const [name, value] of Object.entries(values)) {
    await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fs.writeFile(path.join(dir, name), value);
  }
}
async function fixture(t, { stamp = { commit: LOCAL, dirty: false }, status = 'behind',
    channel = false, changed = true, platform = 'test' } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deck-updater-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const current = path.join(root, 'Volkan Deck.app', 'Contents', 'Resources', 'app');
  await writeApp(current);
  if (changed) await fs.writeFile(path.join(current, 'main.js'), 'local main');
  if (stamp === null) await fs.rm(path.join(current, 'build-info.json'));
  else await fs.writeFile(path.join(current, 'build-info.json'), JSON.stringify(stamp));
  const requests = [], actions = [];
  const config = { status, compareHttp: 200, compareError: null, archive: null, failSign: false };
  let stored = { updatesReleasesOnly: channel };
  const updater = createUpdater({
    app: { getAppPath: () => current, getPath: name => name === 'temp' ? root : path.join(root, 'user-data'),
      on: () => {}, releaseSingleInstanceLock: () => actions.push('release'),
      relaunch: () => actions.push('relaunch'), exit: n => actions.push(['exit', n]), quit: () => actions.push('quit') },
    net: { fetch: async url => {
      requests.push(url);
      if (url.startsWith(API + '/compare/')) {
        if (config.compareError) throw config.compareError;
        return Response.json({ status: config.status }, { status: config.compareHttp });
      }
      if (url === API + '/releases/latest') return Response.json({ tag_name: 'v1.4.0', name: 'Release 1.4.0' });
      if (url === API + '/commits/' + (channel ? 'v1.4.0' : 'main')) return Response.json({ sha: REMOTE,
        commit: { message: 'Remote version', author: { name: 'Author', date: '2026-10-05T00:00:00Z' } } });
      if (url === API + '/git/trees/' + REMOTE + '?recursive=1') return Response.json(tree);
      if (url.startsWith('https://raw.githubusercontent.com/')) return new Response('V=35.4.0\n');
      if (url === 'https://codeload.github.com/volkangokyar01/deck-app/tar.gz/' + REMOTE)
        return new Response(config.archive);
      throw new Error('Unexpected URL: ' + url);
    } },
    media: { stop: () => actions.push('stop') }, readState: () => stored, writeState: value => { stored = value; },
    platform, electronVersion: '35.4.0', run: async (command, args) => {
      if (command === '/usr/bin/codesign') {
        actions.push('sign');
        // The final stamp must be present before the app bundle is signed.
        const installed = JSON.parse(await fs.readFile(path.join(current, 'build-info.json')));
        if (!config.failSign) assert.deepEqual([installed.commit, installed.dirty],
          config.restoredSigning ? [stamp.commit, stamp.dirty] : [REMOTE, false]);
        if (config.failSign && args[0] === '--verify') {
          config.failSign = false; config.restoredSigning = true; throw new Error('Signing failed');
        }
        return '';
      }
      return execFileSync(command, args, { encoding: 'utf8' });
    }
  });
  return { root, current, updater, requests, actions, config };
}

for (const channel of [false, true]) {
  for (const [status, dirty, localNewer] of [
    ['behind', false, false], ['behind', true, false], ['identical', false, false],
    ['identical', true, true], ['ahead', false, true], ['ahead', true, true], ['diverged', false, false]
  ]) test(`${channel ? 'release' : 'main'}: ${status}, dirty=${dirty}`, async t => {
    const localCommit = status === 'identical' ? REMOTE : LOCAL;
    const f = await fixture(t, { status, channel, stamp: { commit: localCommit, dirty }, platform: 'darwin' });
    const state = await f.updater.check();
    assert.equal(state.available, !localNewer);
    assert.equal(state.localNewer, localNewer);
    assert.equal(state.phase, localNewer ? 'current' : 'available');
    assert.equal(state.message, localNewer ? newerMessage : status === 'diverged' ? warning : 'Güncelleme var');
    assert.equal(state.latest.sha, REMOTE);
    assert.equal(f.requests.filter(url => url.includes('/compare/')).length, 1);
    assert.ok(f.requests.includes(API + '/compare/' + REMOTE + '...' + localCommit));
    if (channel) assert.ok(f.requests.includes(API + '/commits/v1.4.0'));
    const count = f.requests.length;
    await f.updater.check();
    assert.equal(f.requests.length, count, 'direction result is cached');
    await f.updater.check({ manual: true });
    assert.equal(f.requests.length, count, 'a manual check right after reuses the result for 30 s');
    if (localNewer) { await f.updater.apply(); assert.deepEqual(f.actions, []); }
  });
  test(`${channel ? 'release' : 'main'}: unpushed commit (404) is newer`, async t => {
    const f = await fixture(t, { channel, platform: 'darwin' });
    f.config.compareHttp = 404;
    const state = await f.updater.check();
    assert.equal(state.available, false);
    assert.equal(state.localNewer, true);
    assert.equal(state.phase, 'current');
    assert.equal(state.message, newerMessage);
  });
}

for (const stamp of [null, { commit: null, dirty: true }])
  test(`legacy install: ${stamp === null ? 'missing stamp' : 'null commit'} still offers update`, async t => {
    const f = await fixture(t, { stamp });
    assert.equal((await f.updater.check()).available, true);
    assert.equal(f.requests.some(url => url.includes('/compare/')), false);
  });

test('only stamp differs or is missing: current, without a compare request', async t => {
  for (const stamp of [null, { commit: LOCAL, dirty: true }]) {
    const f = await fixture(t, { changed: false, stamp });
    const state = await f.updater.check();
    assert.equal(state.available, false);
    assert.equal(state.localNewer, false);
    assert.equal(state.message, 'Güncel');
    assert.equal(f.requests.some(url => url.includes('/compare/')), false);
  }
});

for (const failure of ['network', 403, 429, 500, 'unknown-status'])
  test(`compare failure ${failure}: no update offered`, async t => {
    const f = await fixture(t, { platform: 'darwin' });
    if (failure === 'network') f.config.compareError = new TypeError('offline');
    else if (failure === 'unknown-status') f.config.status = 'unknown';
    else f.config.compareHttp = failure;
    const state = await f.updater.check();
    assert.equal(state.phase, 'error');
    assert.equal(state.available, false);
    await f.updater.apply();
    assert.deepEqual(f.actions, []);
  });

test('failed refresh retains the last known direction and target metadata', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const f = await fixture(t, { status: 'ahead' });
  const known = await f.updater.check();
  now += 11 * 60e3;
  f.config.compareError = new TypeError('offline');
  const failed = await f.updater.check();
  assert.equal(failed.phase, 'error');
  assert.equal(failed.available, known.available);
  assert.equal(failed.localNewer, known.localNewer);
  assert.deepEqual(failed.latest, known.latest);
  f.config.compareError = null;
  f.config.status = 'behind';
  const recovered = await f.updater.check();
  assert.equal(recovered.localNewer, false);
  assert.equal(recovered.available, true);
});

test('malformed local stamp fails closed', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.current, 'build-info.json'), 'broken JSON');
  assert.equal((await f.updater.check()).available, false);
});

test('temp app hash checks ignore stamp but still validate payload files and links', async t => {
  const f = await fixture(t, { changed: false });
  assert.deepEqual(await differences(f.current, files), []);
  await verifyApp(f.current, files);
  await fs.rm(path.join(f.current, 'build-info.json'));
  await verifyApp(f.current, files);
  await fs.writeFile(path.join(f.current, 'vendor/nested.js'), 'tampered');
  assert.deepEqual(await differences(f.current, files), ['vendor/nested.js']);
  await assert.rejects(verifyApp(f.current, files), /doğrulanamadı/);
  await fs.writeFile(path.join(f.current, 'vendor/nested.js'), contents['vendor/nested.js']);
  await fs.symlink(path.join(f.current, 'main.js'), path.join(f.current, 'build-info.json'));
  await assert.rejects(verifyApp(f.current, files), /dosya türü/);
});

async function archiveFixture(f) {
  const source = path.join(f.root, 'source');
  await writeApp(path.join(source, 'snapshot', 'app'));
  // Extraction must ignore stamp hashes even when the archive stamp differs from the tree.
  await fs.writeFile(path.join(source, 'snapshot', 'app', 'build-info.json'), '{"commit":null}');
  const archive = path.join(f.root, 'fixture.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', source, 'snapshot']);
  f.config.archive = await fs.readFile(archive);
  return archive;
}

test('temp archive extraction ignores build stamp hashes', async t => {
  const f = await fixture(t);
  const archive = await archiveFixture(f);
  const extracted = await extractApp(archive, path.join(f.root, 'extracted'), files);
  assert.deepEqual(await differences(extracted, files), []);
});

test('apply writes target stamp before signing; next check is current despite committed stale stamp', async t => {
  const f = await fixture(t, { platform: 'darwin' });
  await archiveFixture(f);
  assert.equal((await f.updater.check()).available, true);
  const before = Date.now();
  await f.updater.apply();
  const stamp = JSON.parse(await fs.readFile(path.join(f.current, 'build-info.json')));
  assert.equal(stamp.commit, REMOTE);
  assert.equal(stamp.dirty, false);
  assert.ok(Date.parse(stamp.built) >= before && Date.parse(stamp.built) <= Date.now());
  assert.deepEqual(f.actions, ['stop', 'sign', 'sign', 'release', 'relaunch', ['exit', 0]]);
  assert.equal(await fs.readFile(path.join(f.current, 'main.js'), 'utf8'), contents['main.js']);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.root, 'user-data', 'update-receipt.json'))).sha, REMOTE);
  assert.deepEqual((await fs.readdir(f.root)).filter(name => name.startsWith('volkan-update-')), []);
  assert.deepEqual(await fs.readdir(path.dirname(f.current)), ['app']);
  // A fresh updater simulates the relaunched process, without the old check cache.
  const next = createUpdater({ app: { getAppPath: () => f.current, on: () => {} },
    net: { fetch: async url => {
      if (url === API + '/commits/main') return Response.json({ sha: REMOTE,
        commit: { message: 'Remote version', author: { name: 'Author', date: '2026-10-05' } } });
      if (url.includes('/git/trees/')) return Response.json(tree);
      throw new Error('Unexpected request: ' + url);
    } }, readState: () => ({}), writeState: () => {}, platform: 'test' });
  const state = await next.check();
  assert.equal(state.available, false);
  assert.equal(state.message, 'Güncel');
});

test('failed apply restores the old app and its original stamp', async t => {
  const f = await fixture(t, { platform: 'darwin' });
  await archiveFixture(f);
  const originalStamp = await fs.readFile(path.join(f.current, 'build-info.json'), 'utf8');
  await f.updater.check();
  f.config.failSign = true;
  // Restored bundle signing checks the original stamp, not the update stamp.
  const state = await f.updater.apply();
  assert.equal(state.phase, 'error');
  assert.equal(await fs.readFile(path.join(f.current, 'main.js'), 'utf8'), 'local main');
  assert.equal(await fs.readFile(path.join(f.current, 'build-info.json'), 'utf8'), originalStamp);
  assert.equal(f.actions.includes('relaunch'), false);
  assert.deepEqual(await fs.readdir(path.dirname(f.current)), ['app']);
});

test('manual check refreshes a result older than 30 s', async t => {
  const f = await fixture(t, { platform: 'darwin' });
  const realNow = Date.now; let now = realNow(); Date.now = () => now; t.after(() => { Date.now = realNow; });
  await f.updater.check();
  const count = f.requests.length;
  now += 60e3;
  await f.updater.check();
  assert.equal(f.requests.length, count, 'automatic check keeps the 10 min cache');
  await f.updater.check({ manual: true });
  assert.ok(f.requests.length > count, 'manual check asks GitHub again after 30 s');
});
