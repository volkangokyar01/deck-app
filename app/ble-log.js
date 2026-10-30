// Bluetooth log (2026-10-30): connection attempts, drops and their reasons, with the time, in a file that survives
// a restart (the page's own log keeps 200 lines and is gone when the app is closed). Rolls over to ble.log.1 at ~1 MB.
const fs = require('fs');
const path = require('path');

const pad = (n, w = 2) => String(n).padStart(w, '0');
const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;

function createBleLog({ dir, maxBytes = 1e6, now = () => new Date() }) {
  const file = path.join(dir, 'ble.log');
  let size = -1;
  function write(line) {
    line = String(line == null ? '' : line).replace(/\s+/g, ' ').trim().slice(0, 400);
    if (!line) return;
    try {
      if (size < 0) { fs.mkdirSync(dir, { recursive: true }); try { size = fs.statSync(file).size; } catch (e) { size = 0; } }
      if (size > maxBytes) { try { fs.renameSync(file, file + '.1'); } catch (e) {} size = 0; }
      const out = stamp(now()) + ' ' + line + '\n';
      fs.appendFileSync(file, out); size += Buffer.byteLength(out);
    } catch (e) {}
  }
  return { file, write };
}

module.exports = { createBleLog, stamp };
