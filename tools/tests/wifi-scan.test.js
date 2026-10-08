// Wi-Fi scan (1.13.6): never blocks the main loop; the settings page does not scan on every open
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('firmware scans asynchronously and answers wifi_scan from protoPoll', () => {
  const w = read('firmware/VolkanDeck/WifiLink.h'), proto = read('firmware/VolkanDeck/Proto.h');
  assert.match(w, /WiFi\.scanNetworks\(true, false\)/);
  assert.ok(!/scanNetworks\(false/.test(w), 'no blocking scan');
  assert.match(proto, /static void protoPoll\(\) \{\n  scanPoll\(\);/);
  assert.match(proto, /if \(scanReq\.on\) \{ replyErr\(id, "busy"\); return; \}/);
  assert.match(proto, /replySrc = scanReq\.src; replyConn = scanReq\.conn; sendJson\(r\);/, 'late reply goes back the way the request came');
  assert.ok(!fs.existsSync(path.join(root, 'firmware/VolkanDeck/Wifi.h')), 'Wifi.h shadows <WiFi.h> on case-insensitive disks');
});

test('settings page: no automatic scan while already on a network', () => {
  const web = read('web/body.html');
  assert.match(web, /refresh\(\)\.then\(\(\)=>\{ if\(current\?\.state==="connected"\)\{ rescan\.hidden=false;/);
});
