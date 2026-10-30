// Bluetooth: hangi deck ile konuşulacağı. Uygulama yalnız bu bilgisayarın eşleştiği, ayarlardaki adı taşıyan
// deck'e bağlanır. Aynı odadaki başka birinin deck'ine bağlanmaya çalışmak macOS'te onun için
// "… bağlanılsın mı?" eşleştirme penceresi açtırır.
const norm = s => String(s || '').normalize('NFC').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr');

// `system_profiler SPBluetoothDataType -json` çıktısı: eşleşmiş cihazlar device_connected / device_not_connected içinde
function macPairedNames(json) {
  const names = [];
  const root = json && Array.isArray(json.SPBluetoothDataType) ? json.SPBluetoothDataType[0] : null;
  if (!root) return null;                                    // beklenmeyen biçim: bilinmiyor
  for (const key of ['device_connected', 'device_not_connected'])
    for (const entry of Array.isArray(root[key]) ? root[key] : []) names.push(...Object.keys(entry || {}));
  return names;
}

// true / false; null = sorulamadı (çağıran engellemez)
function macDeckPaired(json, name) {
  const names = macPairedNames(json);
  if (!names) return null;
  const want = norm(name);
  return names.some(n => norm(n) === want);
}

// Web Bluetooth seçicisinin listesinden (Electron: {deviceId, deviceName}) doğru deck'in kimliği, yoksa ''.
// Adı tutan yoksa daha önce adıyla seçilmiş deck (knownId, adresi) alınır: Windows onu eşleştirme anındaki adla
// listeler, adı sonradan değişse de bulunur (2026-10-30). Ad bilinmiyorsa (elle bağlanma) ilk cihaz.
function pickDeck(list, wantName, knownId) {
  if (!Array.isArray(list) || !list.length) return '';
  if (!norm(wantName)) return list[0].deviceId;
  const hit = list.find(d => norm(d.deviceName) === norm(wantName));
  if (hit) return hit.deviceId;
  return knownId && list.some(d => d.deviceId === knownId) ? knownId : '';
}

module.exports = { macDeckPaired, macPairedNames, pickDeck, norm };
