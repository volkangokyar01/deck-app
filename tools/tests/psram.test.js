// Ek bellek (1.12.1): one OPI build with Arduino's PSRAM layer on, and what the memory card says
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const web = read('web/body.html');

test('one build is embedded and flashed as is (the QSPI variant of 1.12.0 is gone)', () => {
  const m = web.match(/const FIRMWARE=(\{.*?\});/s); assert.ok(m);
  const fw = JSON.parse(m[1]);
  assert.strictEqual(fw.parts.length, 4); assert.ok(!fw.qspi);
  assert.ok(!/pickFirmwareVariant|FIRMWARE\.qspi/.test(web));
  assert.match(web, /const fileArray = FIRMWARE\.parts\.map\(/);
  assert.ok(!fs.existsSync(path.join(root, 'firmware/bin-qspi')));
});

test('memory card: running, old firmware, no PSRAM, 2 MB chip', () => {
  const src = web.slice(web.indexOf('function verGE('), web.indexOf('\n', web.indexOf('function verGE(')))
    + web.slice(web.indexOf('function memState('), web.indexOf('function fillMemCard('));
  const st = vm.runInNewContext(src + ';memState');
  assert.strictEqual(st({ fw: '1.12.1', psram: 8192, psramCap: 1 }).have, true);
  assert.strictEqual(st({ fw: '1.12.0', psram: 0, psramCap: 1 }).old, true, '1.12.0 still had the PSRAM layer off');
  const none = st({ fw: '1.12.1', psram: 0, psramCap: 0 });
  assert.ok(!none.old && none.chipText === 'yok');
  assert.strictEqual(st({ fw: '1.12.1', psram: 0, psramCap: 2 }).chipText, '2 MB');
  assert.match(web, /function fillDevSummary\(\)\{\n  fillMemCard\(\);/, 'refreshed with every status');
});

test('firmware reports the eFuse PSRAM capacity; build script makes one build', () => {
  const proto = read('firmware/VolkanDeck/Proto.h'), sh = read('tools/build_firmware.sh');
  assert.match(proto, /esp_efuse_read_field_blob\(ESP_EFUSE_PSRAM_CAP, &cap, 2\)/);
  assert.match(proto, /r\["psramCap"\] = cap; r\["psramVendor"\] = vendor; r\["embPsram"\] = cap != 0;/);
  assert.ok(!/fwPsram|bin-qspi|psram_type/.test(proto + sh));
});
