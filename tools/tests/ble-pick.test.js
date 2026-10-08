// Başkasının deck'i aynı odadayken Bluetooth'a kendiliğinden bağlanma: macOS onun için "… bağlanılsın mı?" soruyordu.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { macDeckPaired, pickDeck } = require('../../app/ble-pick');
const main = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'main.js'), 'utf8');

// system_profiler SPBluetoothDataType -json biçimi (Sencer'in Mac'i, 2026-10-08)
const profile = { SPBluetoothDataType: [{ device_connected: [{ 'Ali Sencer’s AirPods Pro': { device_address: 'AA' } }],
  device_not_connected: [{ 'Sencer Deck': { device_address: 'BB' } }, { 'BT5.2 Mouse': { device_address: 'CC' } }] }] };

test('macOS: deck yalnız bu Mac eşleşmişse eşleşmiş sayılır', () => {
  assert.equal(macDeckPaired(profile, 'Sencer Deck'), true);
  assert.equal(macDeckPaired(profile, ' sencer  deck '), true, 'büyük/küçük harf ve boşluk fark etmez');
  assert.equal(macDeckPaired(profile, 'Volkan Deck'), false, 'eşleşmemiş deck için bağlanma denenmez');
  assert.equal(macDeckPaired({ SPBluetoothDataType: [{}] }, 'Sencer Deck'), false, 'eşleşmiş cihaz yoksa false');
  assert.equal(macDeckPaired(profile, 'Ali Sencer\'s AirPods Pro'), true, 'tipografik kesme işareti eşitlenir');
});

test('sorulamayan durum null döner (çağıran Bluetooth\'u engellemez)', () => {
  assert.equal(macDeckPaired(null, 'Sencer Deck'), null);
  assert.equal(macDeckPaired({}, 'Sencer Deck'), null);
  assert.equal(macDeckPaired({ SPBluetoothDataType: [] }, 'Sencer Deck'), null);
});

test('seçici yalnız ayarlardaki adı taşıyan deck\'i alır', () => {
  const list = [{ deviceId: 'x1', deviceName: 'Sencer Deck' }, { deviceId: 'x2', deviceName: 'Volkan Deck' }];
  assert.equal(pickDeck(list, 'Volkan Deck'), 'x2');
  assert.equal(pickDeck([list[0]], 'Volkan Deck'), '', 'yalnız başkasının deck\'i görünüyorsa hiçbiri seçilmez');
  assert.equal(pickDeck([], 'Volkan Deck'), '');
  assert.equal(pickDeck(list, ''), 'x1', 'ad bilinmiyorsa (elle bağlanma) eski davranış');
});

test('main.js: seçici ad ile seçer, macOS eşleşme kapısı bağlıdır', () => {
  assert.match(main, /require\('\.\/ble-pick'\)/);
  assert.match(main, /pickDeck\(list, bleWantName\)/);
  assert.doesNotMatch(main, /finish\(list\[0\]\.deviceId\)/, 'ilk cihaza körü körüne bağlanma kalmadı');
  assert.match(main, /bleWantName = name;/);
  assert.match(main, /macDeckPaired\(json, name\)/);
});
