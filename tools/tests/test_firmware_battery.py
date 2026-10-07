"""Battery level on cable: the charger's voltage lift must not read as 100%."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class FirmwareBatteryTest(unittest.TestCase):
    def test_level_stays_real_on_cable(self):
        ino = (ROOT / 'firmware/VolkanDeck/VolkanDeck.ino').read_text()
        board = (ROOT / 'firmware/VolkanDeck/Board.h').read_text()
        code = ino[ino.index('// Battery level.'):ino.index('static void goSleep()')]
        defs = '\n'.join(l for l in board.splitlines() if l.startswith('#define BAT_') or l.startswith('#define PIN_BAT'))
        compiler = shutil.which('clang++') or shutil.which('g++')
        if not compiler:
            self.skipTest('C++ compiler unavailable')
        harness = r'''#include <algorithm>
#include <cassert>
#include <cstdint>
#define RTC_NOINIT_ATTR
using std::min; using std::max;
template<class T> T constrain(T n,T lo,T hi){return max(lo,min(n,hi));}
uint32_t ms=1000; uint32_t millis(){return ms;}
int mv=1925; int analogReadMilliVolts(int){return mv;}
bool usbMounted=false,usbSuspended=false,charging=false,extPower=false; uint8_t batPct=0;
''' + defs + '\n' + code + r'''
void run(int seconds){for(int i=0;i<seconds/2;i++){ms+=2000;readBattery();}}
int main(){
 run(60); assert(!extPower && batPct>=50 && batPct<=62);          // 3.85 V at rest: about 57 %
 int before=batPct;
 usbMounted=true; mv=2140; run(60);                                // cable: charger lifts the cell to 4.28 V
 assert(extPower && charging && batPct>=before && batPct<=before+1);
 run(3600); assert(batPct>=before+15 && batPct<=before+30 && charging);   // ~25 %/h at 500 mA / 2000 mAh
 run(6*3600); assert(batPct==100 && !charging);                    // eventually full
 usbMounted=false; mv=2080; run(60); assert(!extPower && batPct>=95);    // unplugged, full cell 4.16 V
 // cable pulled from a computer: no VBUS sense, only a USB suspend; "mounted" stays set
 mv=1900; run(600); int mid=batPct;                                  // back on battery, ~3.80 V
 usbMounted=true; mv=1990; run(60); assert(extPower && charging);   // plugged into the computer
 usbSuspended=true; mv=1925; run(4); assert(!extPower && !charging && batPct>=mid);
 run(60); assert(!extPower && !charging);
 // wall charger (no USB data): found from the voltage step, released by the step down
 usbMounted=false; usbSuspended=false; mv=1900; run(600);
 mv=1990; run(4); assert(extPower && charging);
 run(120); assert(extPower && charging);
 mv=1905; run(4); assert(!extPower && !charging);
 return 0;
}
'''
        with tempfile.TemporaryDirectory() as work:
            cpp, binary = Path(work) / 'bat.cpp', Path(work) / 'test'
            cpp.write_text(harness)
            result = subprocess.run([compiler, '-std=c++17', str(cpp), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            result = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
