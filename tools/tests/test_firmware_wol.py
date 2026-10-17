"""Turn the computer on from the deck (firmware 1.17.0): MAC parsing, the target list and the magic packet."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class WakeOnLanTest(unittest.TestCase):
    def test_targets_and_magic_packet(self):
        src = (ROOT / 'firmware/VolkanDeck/WifiLink.h').read_text()
        code = src[src.index('struct WolTarget'):]
        compiler = shutil.which('clang++') or shutil.which('g++')
        if not compiler:
            self.skipTest('C++ compiler unavailable')
        harness = r'''#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include <initializer_list>
struct String : std::string { String(const char* s = "") : std::string(s) {} String(const std::string& s) : std::string(s) {} };
std::vector<uint8_t> saved; int saves = 0;
struct Preferences {
  bool begin(const char*, bool) { return true; } void end() {}
  size_t getBytesLength(const char*) { return saved.size(); }
  void getBytes(const char*, void* d, size_t n) { memcpy(d, saved.data(), n); }
  void putBytes(const char*, const void* d, size_t n) { saved.assign((const uint8_t*)d, (const uint8_t*)d + n); saves++; }
  void remove(const char*) { saved.clear(); saves++; }
};
struct IPAddress { uint8_t a[4]; IPAddress(int x = 0, int y = 0, int z = 0, int w = 0) : a{(uint8_t)x, (uint8_t)y, (uint8_t)z, (uint8_t)w} {} };
struct Sent { IPAddress ip; uint16_t port; std::vector<uint8_t> data; }; std::vector<Sent> sent;
struct WiFiUDP {
  Sent cur;
  void beginPacket(IPAddress ip, uint16_t p) { cur = { ip, p, {} }; }
  void write(const uint8_t* d, size_t n) { cur.data.assign(d, d + n); }
  void endPacket() { sent.push_back(cur); }
};
struct { IPAddress broadcastIP() { return IPAddress(192, 168, 1, 255); } } WiFi;
bool wifiOn = false; bool wifiConnected() { return wifiOn; }
void delay(int) {}
''' + code + r'''
int main() {
  uint8_t m[6];
  assert(wolParseMac("18:C0:4D:AA:BB:CC", m) && m[0] == 0x18 && m[5] == 0xCC);
  assert(wolParseMac("18-c0-4d-aa-bb-cc", m) && m[3] == 0xAA);
  assert(!wolParseMac("00:00:00:00:00:00", m));          // empty
  assert(!wolParseMac("01:00:5E:00:00:01", m));          // multicast
  assert(!wolParseMac("18C04DAABBCC", m) && !wolParseMac("", m) && !wolParseMac(nullptr, m));
  assert(wolMacText((const uint8_t[]){0x18, 0xC0, 0x4D, 0xAA, 0xBB, 0x0C}) == "18:C0:4D:AA:BB:0C");

  assert(wolSend() == -2);                                 // nothing registered
  wolParseMac("18:C0:4D:AA:BB:CC", m); wolAdd("Oyun PC", m);
  assert(wolSend() == -1 && sent.empty());                 // no Wi-Fi: nothing sent
  wolAdd("Oyun PC", m); assert(wolN == 1);                 // same computer again: replaced
  uint8_t m2[6]; wolParseMac("18:C0:4D:AA:BB:DD", m2);
  wolAdd("Yeni ad", m); assert(wolN == 1 && !strcmp(wolT[0].name, "Yeni ad"));   // renamed: same card
  wolAdd("Mac mini", m2); assert(wolN == 2);
  uint8_t m3[6], m4[6]; wolParseMac("AA:00:00:00:00:03", m3); wolParseMac("AA:00:00:00:00:04", m4);
  wolAdd("Ucuncu", m3); wolAdd("Dorduncu", m4);           // full: the oldest drops out
  assert(wolN == 3 && !strcmp(wolT[0].name, "Mac mini") && !strcmp(wolT[2].name, "Dorduncu"));
  wolAdd("Çalışma bilgisayarı ğğğğğğğ", m3);             // long Turkish name: cut on a letter boundary
  assert(strlen(wolT[1].name) <= 24 && ((uint8_t)wolT[1].name[strlen(wolT[1].name) - 1] & 0xC0) != 0xC0);

  // survives a restart
  WolTarget copy[3]; memcpy(copy, wolT, sizeof copy); memset(wolT, 0, sizeof wolT); wolN = 0;
  wolLoad(); assert(wolN == 3 && !memcmp(copy, wolT, sizeof copy));

  wifiOn = true; assert(wolSend() == 3);
  assert(sent.size() == 3 * 3 * 4);                        // 3 repeats x 3 computers x (2 addresses x 2 ports)
  for (auto& s : sent) { assert(s.data.size() == 102); for (int i = 0; i < 6; i++) assert(s.data[i] == 0xFF); }
  const Sent& first = sent[0];
  for (int k = 0; k < 16; k++) assert(!memcmp(first.data.data() + 6 + k * 6, wolT[0].mac, 6));
  assert(first.ip.a[3] == 255 && (first.port == 9 || first.port == 7));

  assert(wolRemove("Mac mini") && wolN == 2 && !wolRemove("Mac mini"));
  wolRemove(wolT[0].name); wolRemove(wolT[0].name); assert(wolN == 0 && saved.empty());
  return 0;
}
'''
        with tempfile.TemporaryDirectory() as d:
            cpp, exe = Path(d) / 'wol.cpp', Path(d) / 'wol'
            cpp.write_text(harness)
            r = subprocess.run([compiler, '-std=c++17', '-o', str(exe), str(cpp)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            r = subprocess.run([str(exe)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)

    def test_wake_key_usb_and_protocol(self):
        hid = (ROOT / 'firmware/VolkanDeck/Hid.h').read_text()
        self.assertIn('TUSB_DESC_CONFIG_ATT_REMOTE_WAKEUP', hid)
        self.assertIn('usbWakeArmed = ((arduino_usb_event_data_t*)data)->suspend.remote_wakeup_en', hid)
        ui = (ROOT / 'firmware/VolkanDeck/Ui.h').read_text()
        self.assertIn('id == "__wake" ? QA_WAKE', ui)
        ino = (ROOT / 'firmware/VolkanDeck/VolkanDeck.ino').read_text()
        self.assertIn('if (t == QA_WAKE) { wakeComputers();', ino)
        self.assertIn('wolLoad();', ino)
        proto = (ROOT / 'firmware/VolkanDeck/Proto.h').read_text()
        for cmd in ('wol_add', 'wol_del', 'wol_list', 'wol_send'):
            self.assertIn('"' + cmd + '"', proto)


if __name__ == '__main__':
    unittest.main()
