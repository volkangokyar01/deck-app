"""Idle defaults, redraw gates and real input handlers, without a device."""
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class FirmwareEcoTest(unittest.TestCase):
    def test_defaults_and_clamping(self):
        source = (ROOT / 'firmware/VolkanDeck/Store.h').read_text()
        for key, default in [('ecoAfterUsb', 60), ('ecoAfter', 30)]:
            self.assertIn(f'{key} = {default}', source)
            self.assertIn(f'"{key}":{default}', source)
            self.assertIn(f'N.{key} = constrain(d["{key}"] | {default}, 0, 3600)', source)

    def test_data_and_redraw_do_not_reset_user_idle(self):
        ino = (ROOT / 'firmware/VolkanDeck/VolkanDeck.ino').read_text()
        proto = (ROOT / 'firmware/VolkanDeck/Proto.h').read_text()
        loop = ino[ino.index('void loop()'):]
        self.assertNotIn('ecoExit()', loop)
        self.assertNotIn('lastActivity =', loop)
        self.assertNotIn('ecoExit()', proto)
        self.assertIn('protoTransferBusy() || adjust || (toastUntil && now <= toastUntil)', loop)
        self.assertIn('!ecoActive && ((animate', loop)
        self.assertIn('1000 / min(S.animFps, 4)', loop)
        self.assertIn('if (clockChanged) renderEcoClock()', loop)
        self.assertIn('delay(2)', loop)
        self.assertIn('ecoSuspend(); transferAt = millis() | 1;', proto)
        on_press = ino[ino.index('static void onPress()'):ino.index('static void handleInput()')]
        self.assertLess(on_press.index('ecoExit()'), on_press.index('switch'))

    def test_real_inputs_restore_cpu_then_act_without_swallowing(self):
        compiler = shutil.which('clang++') or shutil.which('g++')
        if not compiler:
            self.skipTest('C++ compiler unavailable')
        ino = (ROOT / 'firmware/VolkanDeck/VolkanDeck.ino').read_text()
        eco = ino[ino.index('static void ecoSuspend()'):ino.index('int curBright')]
        wake = ino[ino.index('static bool wakeUp()'):ino.index('static void readBattery()')]
        inputs = ino[ino.index('static void handleInput()'):ino.index('static void applySideEffects()')]
        harness = r'''
#include <cassert>
#include <cstdint>
#include <vector>
#define VOLKAN_ECO_CPU 1
unsigned tick=10000; unsigned millis(){return tick;}
bool ecoActive=false,dirty=false,screenOff=false,dimmed=false; unsigned lastActivity=0;
int mhz=240; std::vector<int> events;
bool setCpuFrequencyMhz(int v){mhz=v;events.push_back(v);return true;}
struct {int brightness=80;bool encRev=false,homeOn=true;const char* quickA="a";const char* quickB="b";} S;
void setBright(int){assert(mhz==240);}
void noInterrupts(){} void interrupts(){}
int encSteps=0,sel=0,adjust=0;unsigned adjustAt=0;
enum{K_MEDIA,K_SYS,K_APP};int kind=K_APP;int curKind(){return kind;}
struct Btn{int event=0;int poll(int){int e=event;event=0;return e;}} bEnc,bA,bB,bPwr,bRst;
void act(){assert(mhz==240);events.push_back(1);}
void selectIndex(int n){act();sel=n;} void levelStep(bool,int){act();}
void evtInput(const char*){assert(mhz==240);} bool companionOn(){return false;}
void cyclePlayer(){act();} void onPress(){act();}
void mediaAction(const char*,int){act();} void toggleMute(){act();} void toggleMic(){act();}
const char* appById(const char* a){return a;} void doLaunch(const char*){act();} void goSleep(){act();}
const int CC_PREV=1,CC_NEXT=2,SC_BG=0,FB18=0,SC_SUB=0;
namespace textdatum_t{const int middle_center=0;}
void text(const char*,int,int,int,int,int){} void delay(int){}
struct {void fillSprite(int){}void pushSprite(int,int){}} spr;
struct {void restart(){}} ESP;
'''
        cases = r'''
void idle(){ecoEnter();assert(ecoActive&&mhz==80);events.clear();screenOff=false;dimmed=true;}
void acted(){assert(!ecoActive&&mhz==240);assert(events.size()>=2&&events[0]==240&&events[1]==1);assert(lastActivity==tick);}
int main(){
 idle();encSteps=1;handleInput();acted();assert(sel==1);
 idle();bEnc.event=1;handleInput();acted();
 idle();bA.event=1;handleInput();acted();
 idle();bB.event=1;handleInput();acted();
 idle();bPwr.event=1;handleInput();assert(!ecoActive&&mhz==240&&events[0]==240);assert(lastActivity==tick);assert(!screenOff);
 idle();handleInput();assert(ecoActive&&mhz==80&&events.empty());
}
'''
        with tempfile.TemporaryDirectory() as work:
            cpp, binary = Path(work) / 'eco.cpp', Path(work) / 'test'
            cpp.write_text(harness + eco + wake + inputs + cases)
            r = subprocess.run([compiler, '-std=c++17', str(cpp), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            r = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
