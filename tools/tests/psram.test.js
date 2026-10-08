// Ek bellek (1.12.0): the right build per chip, and what the memory card says
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const web = read('web/body.html');

test('both builds are embedded and the flasher picks one from the chip eFuse', async () => {
  const m = web.match(/const FIRMWARE=(\{.*?\});/s); assert.ok(m);
  const fw = JSON.parse(m[1]);
  assert.ok(fw.parts.length === 4 && fw.qspi && fw.qspi.length === 4, 'OPI and QSPI builds');
  assert.notStrictEqual(fw.parts[3].b64, fw.qspi[3].b64);
  const src = web.slice(web.indexOf('async function pickFirmwareVariant('), web.indexOf('async function flashTo('));
  const pick = vm.runInNewContext(src + ';pickFirmwareVariant');
  const L = (cap, feats) => ({ chip: { getPsramCap: async () => cap, getChipFeatures: async () => feats } });
  assert.strictEqual((await pick(L(1, ['Embedded PSRAM 8MB (AP_3v3)']))).qspi, false);
  assert.strictEqual((await pick(L(2, ['Embedded PSRAM 2MB']))).qspi, true);
  assert.strictEqual((await pick(L(0, ['WiFi', 'BLE']))).qspi, true);
  assert.strictEqual((await pick({ chip: {} })).qspi, false, 'unknown chip: the LilyGO (OPI) build');
  assert.match(web, /\(v\.qspi&&FIRMWARE\.qspi\?FIRMWARE\.qspi:FIRMWARE\.parts\)/);
});

test('memory card: running, mismatched build, no PSRAM, old firmware', () => {
  const src = web.slice(web.indexOf('function memState('), web.indexOf('function fillMemCard('));
  const st = vm.runInNewContext(src + ';memState');
  assert.strictEqual(st({ psram: 8192, psramCap: 1, fwPsram: 'opi' }).have, true);
  const mis = st({ psram: 0, psramCap: 2, fwPsram: 'opi' });
  assert.ok(mis.mismatch && mis.want === 'qspi' && mis.chipText === '2 MB (QSPI)');
  const none = st({ psram: 0, psramCap: 0, fwPsram: 'qspi' });
  assert.ok(!none.mismatch && none.chipText === 'yok');
  assert.strictEqual(st({ psram: 0, fw: '1.10.1' }).old, true);
  assert.match(web, /function fillDevSummary\(\)\{\n  fillMemCard\(\);/, 'refreshed with every status');
});

test('firmware reports the eFuse PSRAM capacity and its own PSRAM mode; build script makes both', () => {
  const proto = read('firmware/VolkanDeck/Proto.h'), sh = read('tools/build_firmware.sh');
  assert.match(proto, /esp_efuse_read_field_blob\(ESP_EFUSE_PSRAM_CAP, &cap, 2\)/);
  assert.match(proto, /r\["fwPsram"\] = "opi";[\s\S]*r\["fwPsram"\] = "qspi";/);
  assert.match(sh, /build opi firmware\/bin\nbuild qspi firmware\/bin-qspi/);
  assert.match(sh, /--build-property "build\.psram_type=\$1"/);
});
