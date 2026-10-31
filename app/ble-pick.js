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
// Ad bilinmiyorsa (elle bağlanma) ilk cihaz.
function pickDeck(list, wantName) {
  if (!Array.isArray(list) || !list.length) return '';
  if (!norm(wantName)) return list[0].deviceId;
  const hit = list.find(d => norm(d.deviceName) === norm(wantName));
  return hit ? hit.deviceId : '';
}

// 2026-10-31: the scan saw no deck with the name in the settings. Windows / macOS often report the name the deck had
// when it was paired (e.g. "Volkan Deck") or no name at all. The scan is already limited to the Game Deck service, so
// when exactly one deck is around (and this computer has a deck paired) it is ours.
function pickOnlyDeck(list) {
  if (!Array.isArray(list) || list.length !== 1) return '';
  const n = norm(list[0].deviceName);
  return !n || /deck|unknown|bilinmeyen/.test(n) ? list[0].deviceId : '';
}

module.exports = { macDeckPaired, macPairedNames, pickDeck, pickOnlyDeck, norm };
