// First-use downloads stay outside app/, so GitHub app updates need no binary payload.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const ASSETS = {
  macmon: { version: '0.8.2', file: 'macmon-v0.8.2.tar.gz', url: 'https://github.com/vladkens/macmon/releases/download/v0.8.2/macmon-v0.8.2.tar.gz', sha256: '588d5bde79885ba36f693e5150911c10c3ad208a2e418a3f2aa827ac84a2d973' },
  lhm: { version: '0.9.6', file: 'LibreHardwareMonitor.zip', url: 'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/v0.9.6/LibreHardwareMonitor.zip', sha256: '086d9f1b5a99e643edc2cfaaac16051685b551e4c5ac0b32a57c58c0e529c001' },
  pawnio: { version: '2.2.0', file: 'PawnIO_setup.exe', url: 'https://github.com/namazso/PawnIO.Setup/releases/download/2.2.0/PawnIO_setup.exe', sha256: '1f519a22e47187f70a1379a48ca604981c4fcf694f4e65b734aaa74a9fba3032' }
};
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
function run(file, args, timeout = 10000) {
  return new Promise((resolve, reject) => cp.execFile(file, args, { windowsHide: true, timeout, maxBuffer: 2 << 20 },
    (err, stdout) => err ? reject(err) : resolve(String(stdout))));
}
async function download(fetch, asset, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, asset.file);
  if (fs.existsSync(dest) && hash(fs.readFileSync(dest)) === asset.sha256) return dest;
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('İndirme başarısız: HTTP ' + response.status);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > 32 << 20 || hash(data) !== asset.sha256) throw new Error('İndirilen dosyanın SHA-256 doğrulaması başarısız.');
  fs.writeFileSync(dest + '.tmp', data, { mode: 0o600 });
  fs.renameSync(dest + '.tmp', dest);
  return dest;
}
async function macmon(fetch, cache) {
  const dir = path.join(cache, 'macmon-' + ASSETS.macmon.version);
  const archive = await download(fetch, ASSETS.macmon, dir);
  const binary = path.join(dir, 'macmon');
  // Keep the verified archive; always extract from it before signing the executable.
  const list = (await run('/usr/bin/tar', ['-tzf', archive])).trim().split('\n');
  const member = list.find(s => /(^|\/)macmon$/.test(s) && !s.startsWith('/') && !s.split('/').includes('..'));
  if (!member) throw new Error('macmon ikilisi arşivde yok.');
  const parts = member.split('/').length - 1;
  await run('/usr/bin/tar', ['-xzf', archive, '-C', dir, '--strip-components=' + parts, member]);
  if (list.includes('LICENSE')) await run('/usr/bin/tar', ['-xzf', archive, '-C', dir, 'LICENSE']);
  fs.chmodSync(binary, 0o755);
  await run('/usr/bin/codesign', ['--force', '--sign', '-', binary]);
  await run('/usr/bin/codesign', ['--verify', '--strict', binary]);
  return binary;
}
module.exports = { ASSETS, download, macmon, run };
