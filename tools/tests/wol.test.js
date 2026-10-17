// Turn the computer on from the deck (1.17.0): which network card the app registers
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { wolInfo } = require('../../app/wol');
const nic = (mac, extra = {}) => [{ family: 'IPv4', mac, internal: false, address: '192.168.1.5', ...extra }];

test('the wired card wins over Wi-Fi and virtual adapters', () => {
  const r = wolInfo({ 'Wi-Fi': nic('a4:bb:6d:11:22:33'), 'vEthernet (WSL)': nic('00:15:5d:00:00:01'), 'Ethernet': nic('18:c0:4d:aa:bb:cc') }, 'win32');
  assert.deepStrictEqual(r, { name: 'Ethernet', mac: '18:C0:4D:AA:BB:CC', wired: true, others: 1 });
});
test('only Wi-Fi: reported as not wired', () => {
  assert.strictEqual(wolInfo({ 'Wi-Fi': nic('a4:bb:6d:11:22:33') }, 'win32').wired, false);
});
test('loopback, empty, random and disconnected cards are skipped', () => {
  assert.strictEqual(wolInfo({
    'Loopback Pseudo-Interface 1': nic('00:00:00:00:00:00', { internal: true }),
    'Ethernet 2': nic('02:11:22:33:44:55'),                         // locally administered (random)
    'Ethernet 3': [{ family: 'IPv6', mac: '18:c0:4d:aa:bb:cc', internal: false }],   // no IPv4: cable out
  }, 'win32'), null);
});
test('macOS: names do not tell Ethernet from Wi-Fi', () => {
  assert.strictEqual(wolInfo({ en0: nic('a4:bb:6d:11:22:33'), utun3: nic('a4:bb:6d:11:22:34'), awdl0: nic('a4:bb:6d:11:22:35') }, 'darwin').wired, null);
});
test('the Windows setup script and IPC exist; the page offers the key and the card', () => {
  const root = path.join(__dirname, '../..');
  const ps = fs.readFileSync(path.join(root, 'app/wol-setup.ps1'), 'utf8');
  for (const s of ['*WakeOnMagicPacket', 'S5WakeOnLan', 'Set-NetAdapterPowerManagement', '/deviceenablewake', 'HiberbootEnabled', 'VID_303A', '$UserSid', '$Mac']) assert.ok(ps.includes(s), s);
  const main = fs.readFileSync(path.join(root, 'app/main.js'), 'utf8');
  assert.match(main, /ipcMain\.handle\('wol-setup'/);
  assert.match(fs.readFileSync(path.join(root, 'app/preload.js'), 'utf8'), /wolSetup: \(\) => ipcRenderer\.invoke\('wol-setup'\)/);
  assert.match(fs.readFileSync(path.join(root, 'app/companion.js'), 'utf8'), /cmd: 'wol_add'/);
  const page = fs.readFileSync(path.join(root, 'web/body.html'), 'utf8');
  assert.match(page, /const QUICK_ACTS = \[QA_MIC, QA_MUTE, QA_WAKE\]/);
  assert.ok(page.includes('card("cardWol","wake","Bilgisayarı uzaktan aç"'));
  assert.strictEqual((page.match(/"__mic","__mute","__wake"\]/g) || []).length, 3);
});
