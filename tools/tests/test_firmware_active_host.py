"""Two computers: keys, events and screen data follow the one used most recently (firmware 1.9.1)."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ActiveHostTest(unittest.TestCase):
    def test_most_recent_input_wins_and_dead_hosts_drop_out(self):
        hid = (ROOT / 'firmware/VolkanDeck/Hid.h').read_text()
        code = hid[hid.index('static const uint16_t HOST_USB'):hid.index('static const HostSeen* hostOf')]
        code += hid[hid.index('static const HostSeen* hostOf'):].split('\n', 1)[0] + '\n'
        compiler = shutil.which('clang++') or shutil.which('g++')
        if not compiler:
            self.skipTest('C++ compiler unavailable')
        harness = r'''#include <algorithm>
#include <cassert>
#include <cstdint>
#include <cstring>
using std::min;
#define BLE_HS_CONN_HANDLE_NONE 0xFFFF
uint32_t ms=100000; uint32_t millis(){return ms;}
volatile bool usbMounted=true,usbSuspended=false;
''' + code + r'''
int main(){
 assert(activeHostConn()==BLE_HS_CONN_HANDLE_NONE);          // no app: nothing known
 hostReport(HOST_USB,30,"Oyun PC"); hostReport(1,2,"Mac mini");
 assert(activeHostConn()==1);                                 // Mac used 2 s ago, PC 30 s ago
 ms+=2000; hostReport(HOST_USB,0,""); hostReport(1,4,"");
 assert(activeHostConn()==HOST_USB);                          // moved to the PC
 assert(!strcmp(hostOf(HOST_USB)->name,"Oyun PC"));           // name kept from the first report
 usbSuspended=true; assert(activeHostConn()==1);              // PC asleep / cable pulled
 usbSuspended=false; ms+=7000; hostReport(1,9,"");
 assert(activeHostConn()==1);                                 // PC app went quiet for 7 s
 hostForget(1); assert(activeHostConn()==BLE_HS_CONN_HANDLE_NONE);
 hostReport(2,-1,""); assert(activeHostConn()==BLE_HS_CONN_HANDLE_NONE);   // old app without idle
 return 0;
}
'''
        with tempfile.TemporaryDirectory() as work:
            cpp, binary = Path(work) / 'act.cpp', Path(work) / 'test'
            cpp.write_text(harness)
            r = subprocess.run([compiler, '-std=c++17', str(cpp), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            r = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)

    def test_keys_and_events_are_routed_to_the_active_computer(self):
        hid = (ROOT / 'firmware/VolkanDeck/Hid.h').read_text()
        proto = (ROOT / 'firmware/VolkanDeck/Proto.h').read_text()
        comp = (ROOT / 'app/companion.js').read_text()
        self.assertIn('bleIn->notify(bleKeyConn());', hid)
        self.assertIn('bleCc->notify(to);', hid)
        self.assertIn("uint16_t conn = replySrc >= 0 ? replyConn : eventConn();", proto)
        self.assertIn('hostReport(replySrc == SRC_BLE ? replyConn : HOST_USB, doc["idle"] | -1, doc["host"] | "");', proto)
        self.assertIn("idle: idleSec", comp)


if __name__ == '__main__':
    unittest.main()
