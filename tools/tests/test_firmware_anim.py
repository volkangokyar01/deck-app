"""Custom animation per theme (firmware 1.7.0): two LittleFS slots, fallback and protocol, without a device."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
FW = ROOT / 'firmware/VolkanDeck'


class FirmwareAnimTest(unittest.TestCase):
    def test_protocol_and_wiring(self):
        proto = (FW / 'Proto.h').read_text()
        ui = (FW / 'Ui.h').read_text()
        ino = (FW / 'VolkanDeck.ino').read_text()
        self.assertIn('animUpLight = !strcmp(doc["slot"] | "dark", "light")', proto)
        self.assertIn('else if (!strcmp(cmd, "anim_clear"))', proto)
        self.assertIn('r["anim"] = anim.frames; r["animLight"] = animLight.frames;', proto)
        self.assertIn('persistAnimChoice(animUpLight ? 0 : animFpsIn)', proto)
        self.assertIn('themeAnim(lightTheme)', ui)
        self.assertIn('loadAnim(anim); loadAnim(animLight);', ino)
        self.assertIn('#define FW_VERSION "1.8.0"', (FW / 'Board.h').read_text())

    def test_slots_fallback_timing_and_streaming(self):
        compiler = shutil.which('clang++') or shutil.which('g++')
        if not compiler:
            self.skipTest('C++ compiler unavailable')
        store = (FW / 'Store.h').read_text()
        block = store[store.index('/* ---------- custom animation'):store.index('// keep "Kendi GIF\'im" selected')]
        harness = r'''
#include <cassert>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <map>
#include <string>
#include <vector>
#include <algorithm>
using std::max; using std::min;
std::map<std::string, std::vector<uint8_t>> disk;
struct File {
  std::string p; size_t pos = 0; bool open = false;
  explicit operator bool() const { return open; }
  size_t read(uint8_t* b, size_t n) { auto& d = disk[p]; n = min(n, d.size() - pos); memcpy(b, d.data() + pos, n); pos += n; return n; }
  void seek(size_t at) { pos = at; } size_t size() { return disk[p].size(); } void close() { open = false; }
};
struct { File open(const char* p, const char*) { File f; if (disk.count(p)) { f.p = p; f.open = true; } return f; }
         void remove(const char* p) { disk.erase(p); } } LittleFS;
bool psram = true; bool psramFound() { return psram; } void* ps_malloc(size_t n) { return malloc(n); }
// 128x128 file: n frames, each frame filled with its index; optional per-frame delays
void put(const char* path, int n, const std::vector<int>& delays = {}) {
  std::vector<uint8_t> f = { 'V','D','A','N', 128, 0, 128, 0, (uint8_t)n, 0, 12, (uint8_t)(delays.empty() ? 0 : 1) };
  for (int d : delays) { f.push_back(d & 255); f.push_back(d >> 8); }
  for (int i = 0; i < n; i++) f.insert(f.end(), 128 * 128 * 2, (uint8_t)(i + 1));
  disk[path] = f;
}
'''
        cases = r'''
int main() {
  // nothing uploaded: no animation in either theme
  assert(!loadAnim(anim) && !loadAnim(animLight));
  assert(!themeAnim(false).frames && !themeAnim(true).frames);
  // only the dark slot: both themes use it
  put("/anim.bin", 3);
  assert(loadAnim(anim) && anim.frames == 3 && anim.buf);
  assert(&themeAnim(true) == &anim && &themeAnim(false) == &anim);
  // light slot with the GIF's own timing (long pauses kept)
  put("/anim_light.bin", 4, { 100, 7000, 100, 10000 });
  assert(loadAnim(animLight) && animLight.frames == 4 && animLight.total == 17200);
  assert(&themeAnim(true) == &animLight && &themeAnim(false) == &anim);
  assert(animIndex(animLight, 50, 15) == 0 && animIndex(animLight, 150, 15) == 1 && animIndex(animLight, 7150, 15) == 2);
  assert(animIndex(animLight, 7250, 15) == 3 && animIndex(animLight, 17200 + 50, 15) == 0);
  assert(animFrame(animLight, 2)[0] == 0x0303 && animFrame(anim, 1)[0] == 0x0202);
  assert(animIndex(anim, 1000, 3) == 0 && animIndex(anim, 1400, 3) == 1);   // fixed fps without delays
  // only the light slot: the dark theme falls back to it
  unloadAnim(anim); LittleFS.remove(anim.path);
  assert(!loadAnim(anim) && &themeAnim(false) == &animLight);
  // corrupt or oversize files are rejected
  disk["/anim.bin"] = { 'X','X','X','X' }; assert(!loadAnim(anim));
  put("/anim.bin", 61); assert(!loadAnim(anim));
  // no PSRAM: frames stream from flash one at a time, per slot
  psram = false; put("/anim.bin", 5);
  assert(loadAnim(anim) && anim.stream && !anim.buf && anim.file);
  assert(animFrame(anim, 4)[0] == 0x0505 && anim.cur == 4 && animFrame(anim, 0)[0] == 0x0101);
  assert(loadAnim(animLight) && animLight.stream && animFrame(animLight, 3)[0] == 0x0404);
  unloadAnim(anim); assert(!anim.file && !anim.frames && &themeAnim(false) == &animLight);
  return 0;
}
'''
        with tempfile.TemporaryDirectory() as work:
            cpp, binary = Path(work) / 'anim.cpp', Path(work) / 'test'
            cpp.write_text(harness + block + cases)
            r = subprocess.run([compiler, '-std=c++17', '-Wall', str(cpp), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            r = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)


if __name__ == '__main__':
    unittest.main()
