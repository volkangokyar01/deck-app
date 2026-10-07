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
        self.assertIn('ecoAnimFps > 0 && now - tFrame >= (uint32_t)(1000 / ecoAnimFps)', loop)
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
        wake = ino[ino.index('static bool wakeUp()'):ino.index('// Battery level.')]
        inputs = ino[ino.index('static void handleInput()'):ino.index('static void applySideEffects()')]
        harness = r'''
#include <cassert>
#include <cstdint>
#include <vector>
#include <algorithm>
#include <cstdlib>
#define VOLKAN_ECO_CPU 1
unsigned tick=10000; unsigned millis(){return tick;}
bool ecoActive=false,dirty=false,screenOff=false,dimmed=false; unsigned lastActivity=0;
int mhz=240; std::vector<int> events;
bool setCpuFrequencyMhz(int v){mhz=v;events.push_back(v);return true;}
struct {int brightness=80;bool encRev=false,homeOn=true;const char* quickA="a";const char* quickB="b";} S;
void setBright(int){assert(mhz==240);}
void noInterrupts(){} void interrupts(){}
int encSteps=0,sel=0,adjust=0;unsigned adjustAt=0;
enum{K_MEDIA,K_SYS,K_APP,K_CONN,K_MENU};int kind=K_APP;int curKind(){return kind;}
int subPage=0; void evtSelect(){} bool menuPick=false; int menuCur=0; unsigned menuAt=0; std::vector<int> menuPages(){return {0};} int wheelStep(int i,int d){return i+d;}
using std::max;
bool connEdit=false,bleStarted=false;int connCur=0;unsigned connAt=0,connConfirmAt=0;
struct {bool off=false;} bt; bool btPairing(){return false;} void btPairStop(){} void btSetOff(bool){}
std::vector<int> connRows(){return {0};} void toast(const char*){}
int constrain(int n,int lo,int hi){return n<lo?lo:n>hi?hi:n;}
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


    def test_dim_and_fps_defaults_clamps_and_power_sources(self):
        store = (ROOT / 'firmware/VolkanDeck/Store.h').read_text()
        ino = (ROOT / 'firmware/VolkanDeck/VolkanDeck.ino').read_text()
        keys = [('dimLevelUsb', 17, 5, 90), ('dimLevel', 17, 5, 90),
                ('ecoFpsUsb', 4, 0, 15), ('ecoFps', 4, 0, 15)]
        assignments = []
        for key, default, low, high in keys:
            self.assertIn(f'{key} = {default}', store)
            self.assertIn(f'"{key}":{default}', store)
            assignment = f'N.{key} = constrain(d["{key}"] | {default}, {low}, {high});'
            self.assertIn(assignment, store)
            assignments.append(assignment)
        compiler = shutil.which('clang++') or shutil.which('g++')
        if not compiler:
            self.skipTest('C++ compiler unavailable')
        idle = ino[ino.index('  bool onCable ='):ino.index('  if (sleepLimit > 0')]
        periodic = ino[ino.index('      if (animate && ecoAnimFps'):ino.index('      if (clockChanged)')]
        harness = r'''#include <algorithm>
#include <cassert>
#include <cstdint>
#include <map>
#include <string>
using std::min; using std::max;
int constrain(int n,int lo,int hi){return max(lo,min(n,hi));}
struct Value {bool exists; int n; int operator|(int def){return exists?n:def;}};
struct Device {std::map<std::string,int> values; Value operator[](std::string k){return {values.count(k)!=0,values[k]};}} d;
struct Settings {int dimLevelUsb=17,dimLevel=17,ecoFpsUsb=4,ecoFps=4;
 int brightness=80,dimAfterUsb=10,dimAfter=10,sleepAfterUsb=0,sleepAfter=0,ecoAfterUsb=10,ecoAfter=10,animFps=15;} S,N;
bool usbMounted=false,charging=false,extPower=false,dimmed=false,screenOff=false,ecoActive=false;
int ecoAnimFps=4,adjust=0,bright=0,frames=0; unsigned toastUntil=0,now=20000,tFrame=0,idle=20;
bool protoTransferBusy(){return false;} void ecoSuspend(){ecoActive=false;}
bool mail=false; bool mailActive(){return mail;}
void ecoEnter(){ecoActive=true;} void setBright(int v){bright=v;}
void renderEcoAnim(unsigned){frames++;}
void parse(){
''' + '\n'.join(assignments) + r'''}
void update(){
 extPower=usbMounted||charging;   // readBattery(): host USB or charger lift
''' + idle + r'''}
void redraw(bool animate){
''' + periodic + r'''}
int main(){
 parse();assert(N.dimLevelUsb==17&&N.dimLevel==17&&N.ecoFpsUsb==4&&N.ecoFps==4);
 d.values={{"dimLevelUsb",0},{"dimLevel",200},{"ecoFpsUsb",-1},{"ecoFps",100}};
 parse();assert(N.dimLevelUsb==5&&N.dimLevel==90&&N.ecoFpsUsb==0&&N.ecoFps==15);
 d.values={{"dimLevelUsb",30},{"dimLevel",10},{"ecoFpsUsb",8},{"ecoFps",0}};
 parse();S=N;
 usbMounted=true;update();assert(dimmed&&bright==24&&ecoActive&&ecoAnimFps==8);
 redraw(true);assert(frames==1);
 usbMounted=false;update();assert(dimmed&&bright==8&&ecoAnimFps==0);
 now+=10000;redraw(true);assert(frames==1); // zero never divides or redraws
 charging=true;update();assert(bright==24&&ecoAnimFps==8);
 S.animFps=2;update();assert(ecoAnimFps==2); // cap respects the normal rate
 S.brightness=10;update();assert(bright==5);
 charging=false;S.dimAfter=0;S.ecoAfter=0;update();assert(!dimmed&&bright==10&&!ecoActive);
 S.dimAfter=10;S.ecoAfter=10;mail=true;update();assert(!dimmed&&!ecoActive); // a mail note holds dimming and eco
 mail=false;update();assert(dimmed&&ecoActive);                              // idle timers kept running behind it
 mail=true;update();assert(!ecoActive);                                      // a new note leaves eco at once
}
'''
        with tempfile.TemporaryDirectory() as work:
            cpp, binary = Path(work) / 'levels.cpp', Path(work) / 'test'
            cpp.write_text(harness)
            result = subprocess.run([compiler, '-std=c++17', str(cpp), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            result = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_freeze_preserves_complete_lcd_frame_during_dirty_redraws(self):
        ui = (ROOT / 'firmware/VolkanDeck/Ui.h').read_text()
        draw = ui[ui.index('static void drawAnim('):ui.index('static void drawHome(')]
        self.assertLess(draw.index('if (ecoActive && ecoAnimFps == 0 && homeFrameShown) return;'), draw.index('spr.fillRoundRect'))
        periodic = ui[ui.index('static void renderEcoAnim('):ui.index('static void renderEcoClock(')]
        self.assertLess(periodic.index('if (ecoAnimFps <= 0) return;'), periodic.index('drawAnim('))
        render = ui[ui.index('static void render(const char*'):ui.index('static void uiBegin()')]
        self.assertIn('ecoActive && ecoAnimFps == 0 && homeFrameShown && !items.empty() && items[sel].home', render)
        for rect in ['0, 0, 320, 2', '0, 2, 2, 128', '130, 2, 190, 128', '0, 130, 320, 40']:
            self.assertIn(f'pushRegion({rect})', render)
        self.assertIn('else spr.pushSprite(0, 0)', render)
        self.assertIn('homeFrameShown = !items.empty() && items[sel].home;', render)
        self.assertIn('if (ecoActive && ecoAnimFps > 0)', draw)
