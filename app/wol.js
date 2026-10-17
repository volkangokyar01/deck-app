// Wake-on-LAN (2026-10-17, firmware 1.17.0): which network card the deck should send the magic packet to.
// A wired adapter is preferred (Wi-Fi cards cannot wake a computer from shutdown); virtual adapters
// (VPN, Hyper-V, WSL, Docker, VMware, Bluetooth) and random / locally administered MACs are skipped.
// On macOS the interface names do not tell Ethernet from Wi-Fi, so "wired" is null there.
'use strict';
const SKIP = /(vethernet|virtual|vmware|vbox|hyper-v|wsl|docker|vpn|tailscale|zerotier|wireguard|\btun|\btap|loopback|bluetooth|bridge|awdl|llw|utun|anpi)/i;
const WIFI = /(wi-?fi|wlan|wireless|kablosuz|802\.11)/i;
function wolInfo(ifaces, platform = process.platform) {
  const list = [];
  for (const [name, addrs] of Object.entries(ifaces || {})) {
    if (SKIP.test(name)) continue;
    const a = (addrs || []).find(x => !x.internal && x.mac && x.mac !== '00:00:00:00:00:00' && x.family === 'IPv4');
    if (!a || (parseInt(a.mac.slice(0, 2), 16) & 3)) continue;
    const wired = platform === 'darwin' ? null : !WIFI.test(name);
    list.push({ name, mac: a.mac.toUpperCase(), wired });
  }
  list.sort((x, y) => (y.wired === true) - (x.wired === true));
  return list[0] ? { ...list[0], others: list.length - 1 } : null;
}
module.exports = { wolInfo };
