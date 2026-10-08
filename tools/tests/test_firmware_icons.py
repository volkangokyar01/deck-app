"""Without PSRAM only the icons on screen stay in RAM (1.12.0): a 6-slot cache filled from flash."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class IconCacheTest(unittest.TestCase):
    def test_cache_evicts_least_recent_and_never_frees_twice(self):
        store = (ROOT / 'firmware/VolkanDeck/Store.h').read_text()
        code = store[store.index('static const int ICON_CACHE'):store.index('static void loadAppIcons()')]
        compiler = shutil.which('clang++') or shutil.which('g++')
        if not compiler:
            self.skipTest('C++ compiler unavailable')
        harness = r'''#include <cassert>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
struct String : std::string { using std::string::string; String(const std::string& s):std::string(s){} };
String operator+(const char* a, const String& b){ return String(std::string(a)+b); }
uint32_t ms=1000; uint32_t millis(){ return ms++; }
bool psram=false; bool psramOk(){ return psram; } void* ps_malloc(size_t n){ return malloc(n); }
int reads=0, mallocs=0; std::vector<void*> freed;
struct File { bool ok; explicit operator bool() const { return ok; } size_t read(uint8_t* d, size_t n){ memset(d,7,n); reads++; return n; } void close(){} };
struct { File open(const String& p, const char*){ return File{p.find("missing")==std::string::npos}; } } LittleFS;
struct App { String id; bool img=true; uint16_t* pix=nullptr; };
struct { std::vector<App> apps; } S;
''' + code + r'''
int main(){
  S.apps.resize(10); for(int i=0;i<10;i++) S.apps[i].id=String("a")+std::to_string(i);
  for(int i=0;i<6;i++) assert(appPix(&S.apps[i]));            // fills the 6 slots
  assert(reads==6);
  assert(appPix(&S.apps[0])==S.apps[0].pix && reads==6);      // cached: no read
  assert(appPix(&S.apps[6]));                                   // evicts the least recent (apps[1])
  assert(S.apps[1].pix==nullptr && S.apps[0].pix!=nullptr);
  int held=0; for(auto& a:S.apps) if(a.pix) held++; assert(held==6);
  S.apps[9].id="missing"; assert(appPix(&S.apps[9])==nullptr && !S.apps[9].img);
  freeAppPix();                                                 // cache buffers freed once, pointers cleared
  for(auto& a:S.apps) assert(a.pix==nullptr);
  for(auto& s:iconSlots) assert(s.p==nullptr && s.a==nullptr);
  return 0;
}
'''
        with tempfile.TemporaryDirectory() as work:
            cpp, binary = Path(work) / 'icons.cpp', Path(work) / 'test'
            cpp.write_text(harness)
            r = subprocess.run([compiler, '-std=c++17', '-fsanitize=address', str(cpp), '-o', str(binary)], capture_output=True, text=True)
            if r.returncode != 0 and ('sanitize' in r.stderr or 'asan' in r.stderr):
                r = subprocess.run([compiler, '-std=c++17', str(cpp), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            r = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)


if __name__ == '__main__':
    unittest.main()
