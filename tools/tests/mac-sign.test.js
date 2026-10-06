const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createMacSigner, CN, KEYCHAIN, ADHOC_REQUIREMENT } = require('../../app/mac-sign');
const ID = 'A1'.repeat(20);
async function fixture(t, failAt = -1) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'deck-sign-test-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const calls = [], dir = path.join(userData, 'signing'), keychain = path.join(dir, KEYCHAIN);
  let missingIdentity = false, badDR = false;
  const run = async (command, args) => {
    calls.push([command, args]);
    if (calls.length === failAt) throw Error('Mock failure');
    if (args[0] === 'create-keychain') await fs.writeFile(keychain, 'mock');
    if (args[0] === 'delete-keychain') await fs.rm(keychain, { force: true });
    if (args[0] === 'req') {
      for (const flag of ['-keyout', '-out']) await fs.writeFile(args[args.indexOf(flag) + 1], 'secret');
    }
    if (args[0] === 'pkcs12') await fs.writeFile(args[args.indexOf('-out') + 1], 'secret');
    if (args[0] === 'set-key-partition-list') assert.deepEqual(await fs.readdir(dir), ['keychain-pass', KEYCHAIN]);
    if (args[0] === 'find-identity') return missingIdentity ? '' : `1) ${ID} "${CN}" (CSSMERR_TP_NOT_TRUSTED)`;
    if (args[0] === '-dr') return badDR ? ADHOC_REQUIREMENT : { stderr: `designated => identifier "com.volkan.deck" and certificate leaf = H"${ID.toLowerCase()}"` };
    return '';
  };
  return { userData, dir, keychain, calls, signer: createMacSigner({ userData, run }),
    missing: () => { missingIdentity = true; }, badDR: () => { badDR = true; } };
}
test('missing identity creates the non-interactive sequence, restricted password and cleans PEM/P12 immediately', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.signer.ensureIdentity(), { keychain: f.keychain, id: ID });
  assert.deepEqual(f.calls.map(([cmd, args]) => [path.basename(cmd), args[0]]), [
    ['openssl', 'req'], ['openssl', 'pkcs12'], ['security', 'create-keychain'],
    ['security', 'unlock-keychain'], ['security', 'import'], ['security', 'set-key-partition-list'], ['security', 'find-identity']
  ]);
  const req = f.calls[0][1];
  assert.equal(req[req.indexOf('-subj') + 1], '/CN=' + CN);
  for (const ext of ['extendedKeyUsage=critical,codeSigning', 'keyUsage=critical,digitalSignature', 'basicConstraints=critical,CA:false']) assert.ok(req.includes(ext));
  assert.deepEqual(f.calls[4][1].slice(-2), ['-T', '/usr/bin/codesign']);
  assert.deepEqual(f.calls[5][1].slice(0, 4), ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s']);
  const password = await fs.readFile(path.join(f.dir, 'keychain-pass'), 'utf8');
  assert.match(password, /^[a-f0-9]{32}$/);
  assert.equal((await fs.stat(path.join(f.dir, 'keychain-pass'))).mode & 0o777, 0o600);
  assert.equal((await fs.stat(f.dir)).mode & 0o777, 0o700);
  assert.deepEqual(await fs.readdir(f.dir), ['keychain-pass', KEYCHAIN]);
  assert.ok(f.calls.every(([cmd]) => cmd.startsWith('/usr/bin/')));
});
test('existing identity unlocks and reuses the same certificate without openssl', async t => {
  const f = await fixture(t);
  const first = await f.signer.ensureIdentity(); f.calls.length = 0;
  assert.deepEqual(await f.signer.ensureIdentity(), first);
  assert.deepEqual(f.calls.map(([, args]) => args[0]), ['unlock-keychain', 'find-identity']);
  await f.signer.signApp('/tmp/fixture.app');
  assert.deepEqual(f.calls.find(([cmd, args]) => cmd.endsWith('/codesign') && args[0] === '--force')[1],
    ['--force', '--deep', '--keychain', f.keychain, '--sign', ID, '/tmp/fixture.app']);
});
test('broken leftover keychain is deleted before rebuilding', async t => {
  const f = await fixture(t); await fs.mkdir(f.dir);
  await fs.writeFile(f.keychain, 'broken');
  assert.ok(await f.signer.ensureIdentity());
  assert.equal(f.calls[0][1][0], 'delete-keychain');
  assert.equal(f.calls[1][1][0], 'req');
});
for (let step = 1; step <= 7; step++) test(`identity failure at step ${step} returns null and cleans secrets`, async t => {
  const f = await fixture(t, step);
  assert.equal(await f.signer.ensureIdentity(), null);
  assert.equal((await fs.readdir(f.dir)).some(name => name.startsWith('identity-')), false);
  if (step >= 4) await assert.rejects(fs.stat(f.keychain), { code: 'ENOENT' });
  const fallback = await fixture(t, step);
  await fallback.signer.signApp('/tmp/fixture.app');
  const signing = fallback.calls.filter(([cmd]) => cmd.endsWith('/codesign')).map(([, args]) => args);
  assert.deepEqual(signing, [
    ['--force', '--deep', '--sign', '-', '/tmp/fixture.app'],
    ['--force', '--sign', '-', '-r=' + ADHOC_REQUIREMENT, '/tmp/fixture.app'],
    ['--verify', '--deep', '--strict', '/tmp/fixture.app']
  ]);
});
test('unavailable identity falls back to the ad-hoc two-step and verifies', async t => {
  const f = await fixture(t, 1);
  await f.signer.signApp('/tmp/fixture.app');
  assert.deepEqual(f.calls.filter(([cmd]) => cmd.endsWith('/codesign')).map(([, args]) => args), [
    ['--force', '--deep', '--sign', '-', '/tmp/fixture.app'],
    ['--force', '--sign', '-', '-r=' + ADHOC_REQUIREMENT, '/tmp/fixture.app'],
    ['--verify', '--deep', '--strict', '/tmp/fixture.app']
  ]);
});
test('an empty identity list returns null; certificate DR mismatch rejects signing', async t => {
  const f = await fixture(t); f.missing();
  assert.equal(await f.signer.ensureIdentity(), null);
  const good = await fixture(t); good.badDR();
  await assert.rejects(good.signer.signApp('/tmp/fixture.app'), /imzası doğrulanamadı/);
});
test('installer and app use the same CN, private keychain, extensions, fallback and certificate DR check', async () => {
  const shell = await fs.readFile(path.join(__dirname, '../../installer/Mac-Kur.command'), 'utf8');
  assert.ok(shell.includes('/CN=' + CN));
  assert.ok(shell.includes('$HOME/Library/Application Support/Volkan Deck/signing'));
  assert.ok(shell.includes('$SIGN_DIR/' + KEYCHAIN));
  assert.ok(shell.includes('$SIGN_DIR/keychain-pass'));
  assert.ok(shell.includes(ADHOC_REQUIREMENT));
  assert.ok(shell.includes('certificate leaf = h'));
  assert.ok(shell.includes('--force --deep --keychain "$SIGN_KC" --sign "$ID"'));
  for (const ext of ['extendedKeyUsage=critical,codeSigning', 'keyUsage=critical,digitalSignature', 'basicConstraints=critical,CA:false']) assert.ok(shell.includes(ext));
  for (const forbidden of ['list-keychains', 'default-keychain', 'add-trusted-cert', 'login.keychain']) assert.equal(shell.includes(forbidden), false);
});
for (const fail of [false, true]) test(`installer identity flow executes with mocked tools (failure=${fail})`, async t => {
  const f = await fixture(t);
  const shell = await fs.readFile(path.join(__dirname, '../../installer/Mac-Kur.command'), 'utf8');
  const quote = text => "'" + text.replaceAll("'", "'\\''") + "'";
  const block = shell.slice(shell.indexOf('# BEGIN local signing'), shell.indexOf('# END local signing'))
    .replace('"$HOME/Library/Application Support/Volkan Deck/signing"', quote(f.dir))
    .replaceAll('/usr/bin/security', 'mock_security').replaceAll('/usr/bin/openssl', 'mock_openssl').replaceAll('/usr/bin/codesign', 'mock_codesign');
  const log = path.join(f.userData, 'commands');
  const script = `
set -e
LOG=${quote(log)}
mock_openssl() {
  printf 'openssl %s\\n' "$1" >> "$LOG"
  if [ "$1" = rand ]; then printf '%s\\n' 0123456789abcdef0123456789abcdef; return; fi
  ${fail ? 'return 1' : 'return 0'}
}
mock_security() {
  printf 'security %s\\n' "$1" >> "$LOG"
  case "$1" in
    create-keychain) touch "${f.keychain}";;
    delete-keychain) rm -f "${f.keychain}";;
    find-identity) printf '%s\\n' '1) ${ID} "${CN}" (CSSMERR_TP_NOT_TRUSTED)';;
  esac
}
mock_codesign() {
  printf 'codesign %s\\n' "$1" >> "$LOG"
  if [ "$1" = -dr ]; then printf '%s\\n' 'designated => identifier "com.volkan.deck" and certificate leaf = H"${ID}"' >&2; fi
}
${block}
sign_mac_app '/tmp/fixture.app'
sign_mac_app '/tmp/fixture.app'
`;
  const scriptPath = path.join(f.userData, 'mock-installer.sh');
  await fs.writeFile(scriptPath, script);
  await require('node:util').promisify(require('node:child_process').execFile)('/bin/bash', [scriptPath]);
  const calls = (await fs.readFile(log, 'utf8')).trim().split('\n');
  if (fail) {
    assert.equal(calls.filter(x => x === 'codesign --force').length, 4);
    assert.equal(calls.filter(x => x === 'codesign --verify').length, 2);
    assert.equal(calls.includes('security create-keychain'), false);
  } else {
    assert.equal(calls.filter(x => x === 'openssl req').length, 1);
    assert.equal(calls.filter(x => x === 'security create-keychain').length, 1);
    assert.equal(calls.filter(x => x === 'codesign --force').length, 2);
    assert.equal(calls.filter(x => x === 'codesign -dr').length, 2);
  }
  assert.equal((await fs.stat(path.join(f.dir, 'keychain-pass'))).mode & 0o777, 0o600);
  assert.equal((await fs.stat(f.dir)).mode & 0o777, 0o700);
  assert.equal((await fs.readdir(f.dir)).some(x => x.startsWith('identity-')), false);
});
