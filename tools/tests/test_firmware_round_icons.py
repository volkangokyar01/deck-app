"""App icons are round, fill the bubble and have see-through corners in both themes (firmware 1.14.1 / 1.14.2)."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class RoundIconTest(unittest.TestCase):
    def test_drawpix_skips_corners_and_the_flattened_background(self):
        ui = (ROOT / 'firmware/VolkanDeck/Ui.h').read_text()
        code = ui[ui.index('static inline bool pixClear('):ui.index('enum ItemKind')]
        compiler = shutil.which('clang++') or shutil.which('g++')
        if not compiler:
            self.skipTest('C++ compiler unavailable')
        harness = r'''#include <cassert>
#include <cstdint>
#include <cstring>
#include <cmath>
#include <algorithm>
using std::min;
template<class T> T constrain(T v, T a, T b){ return v < a ? a : v > b ? b : v; }
static uint16_t screen[60][60];
struct { void drawPixel(int x, int y, uint16_t c){ screen[y][x] = c; } } spr;
static uint16_t mix(uint16_t a, uint16_t b, float t){ return t >= 0.5f ? a : b; }
''' + code + r'''
int main(){
  static uint16_t pix[1600];
  for (int i = 0; i < 1600; i++) pix[i] = 0x07E0;          // opaque green square
  for (int i = 0; i < 40; i++) pix[20 * 40 + i] = 0x1905;  // a see-through row (flattened background)
  memset(screen, 0, sizeof screen);
  drawPix(pix, 30, 30, 40, 1, 0, 0);
  assert(screen[10][10] == 0);        // top-left corner of the 40 px square: outside the circle
  assert(screen[14][30] == 0x07E0);   // near the top middle: inside the circle (radius 16.4)
  assert(screen[30][10] == 0);        // icon row 20 is see-through
  assert(screen[29][30] == 0x07E0);
  return 0;
}
'''
        with tempfile.TemporaryDirectory() as work:
            cpp, binary = Path(work) / 'pix.cpp', Path(work) / 'test'
            cpp.write_text(harness)
            r = subprocess.run([compiler, '-std=c++17', str(cpp), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            r = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)

    def test_settings_page_sends_see_through_pixels_as_the_skipped_colour(self):
        web = (ROOT / 'web/body.html').read_text()
        fn = web[web.index('async function iconTo565('):web.index('async function sendIcons(')]
        self.assertNotIn('fillRect(0,0,ICON_PX,ICON_PX)', fn, 'no dark square under the icon any more')
        self.assertIn('if(p[i+3]<128){ p[i]=0x1E; p[i+1]=0x23; p[i+2]=0x2C; }', fn)
        ui = (ROOT / 'firmware/VolkanDeck/Ui.h').read_text()
        self.assertIn('return c == 0x1905 || c == 0xF81F;', ui)
        # 1.14.3: square / rounded icons are zoomed until they cover the circle, cut-out logos sit on a filled disc
        trim = web[web.index('function trimIcon('):web.index('function iconImg(')]
        self.assertIn('if(cover(z)>=0.985)', trim)
        self.assertIn('o.fillStyle=bg; o.fillRect(0,0,size,size);', trim)
        self.assertIn('x.drawImage(trimIcon(im,ICON_PX,color),0,0);', fn)


if __name__ == '__main__':
    unittest.main()
