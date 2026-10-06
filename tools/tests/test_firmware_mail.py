"""New mail note (firmware 1.8.0): protocol, idle gating and the real input / wrapping code, without a device."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
FW = ROOT / 'firmware/VolkanDeck'


def compile_and_run(test, source):
    compiler = shutil.which('clang++') or shutil.which('g++')
    if not compiler:
        test.skipTest('C++ compiler unavailable')
    with tempfile.TemporaryDirectory() as work:
        cpp, binary = Path(work) / 'mail.cpp', Path(work) / 'test'
        cpp.write_text(source)
        r = subprocess.run([compiler, '-std=c++17', str(cpp), '-o', str(binary)], capture_output=True, text=True)
        test.assertEqual(r.returncode, 0, r.stderr)
        r = subprocess.run([str(binary)], capture_output=True, text=True)
        test.assertEqual(r.returncode, 0, r.stderr)


class FirmwareMailTest(unittest.TestCase):
    def test_protocol(self):
        proto = (FW / 'Proto.h').read_text()
        handler = proto[proto.index('else if (!strcmp(cmd, "mail"))'):proto.index('else if (!strcmp(cmd, "dfu"))')]
        self.assertIn('constrain(doc["ms"] | 10000, 0, 120000)', handler)
        self.assertIn('if (!ms) mailNote.until = 0;', handler)
        self.assertIn('mailNote.wrapped = false;', handler)
        self.assertIn('mailNew = true;', handler)
        self.assertNotIn('ecoExit()', handler)          # data never counts as a user touch
        self.assertIn('|| !strcmp(cmd, "mail"))) {', proto)   # one computer feeds the screen
        self.assertIn('d["evt"] = "mail"; d["action"] = action;', proto)
        page = (ROOT / 'web/body.html').read_text()
        self.assertIn('if(m.evt==="mail"){ window.onDeckMail?.(m); return; }', page)

    def test_loop_and_render_wiring(self):
        ino = (FW / 'VolkanDeck.ino').read_text()
        ui = (FW / 'Ui.h').read_text()
        loop = ino[ino.index('void loop()'):]
        wake, inputs = loop.index('if (mailNew) { mailNew = false; mailWake(); }'), loop.index('if (mailActive() && !screenOff) mailInput();')
        self.assertLess(wake, inputs)
        self.assertLess(inputs, loop.index('handleInput();'))
        self.assertIn('idle >= (uint32_t)sleepLimit && !mailActive()) goSleep();', loop)
        self.assertIn('S.animKind != A_NONE && !mailOn;', loop)
        self.assertIn('(mailOn && now - tFrame >= 250)', loop)
        render = ui[ui.index('static void render(const char*'):ui.index('static void uiBegin()')]
        self.assertLess(render.index('if (mailActive()) {'), render.index('drawStatus('))
        self.assertIn('homeFrameShown = false;', render)
        self.assertIn('if (items.empty() || mailActive()) return;', ui[ui.index('static void renderEcoClock()'):])

    def test_note_takes_knob_and_buttons(self):
        ino = (FW / 'VolkanDeck.ino').read_text()
        code = ino[ino.index('static void mailWake()'):ino.index('/* ---------- setup / loop')]
        harness = r'''
#include <cassert>
#include <cstdint>
#include <string>
#include <vector>
using String = std::string;
unsigned tick=1000; unsigned millis(){return tick;}
bool screenOff=false,dimmed=false,dirty=false,ecoActive=false,companion=true; int bright=0,ecoExits=0,encSteps=0;
struct {int brightness=80;} S;
struct {unsigned until=0;} mailNote;
std::vector<String> events,toasts;
void ecoSuspend(){ecoActive=false;} void ecoExit(){ecoActive=false;ecoExits++;} void setBright(int v){bright=v;}
void noInterrupts(){} void interrupts(){}
struct Btn{int event=0;int poll(int){int e=event;event=0;return e;}} bEnc,bA,bB;
bool companionOn(){return companion;} void evtMail(const char* a){events.push_back(a);} void toast(const String& t){toasts.push_back(t);}
'''
        cases = r'''
void note(){mailNote.until=5000;dirty=false;events.clear();toasts.clear();ecoExits=0;}
int main(){
  dimmed=true;ecoActive=true;mailWake();assert(!dimmed&&bright==80&&!ecoActive&&dirty);
  screenOff=true;dimmed=true;bright=0;mailWake();assert(dimmed&&bright==0);screenOff=false;   // user turned it off: stays off
  note();bA.event=1;mailInput();assert(mailNote.until==0&&events.size()==1&&events[0]=="open"&&toasts[0]=="Outlook açılıyor"&&ecoExits==1);
  note();bB.event=1;mailInput();assert(events.size()==1&&mailNote.until==0);
  note();bEnc.event=1;mailInput();assert(events.size()==1&&mailNote.until==0);
  note();encSteps=-2;mailInput();assert(events.empty()&&mailNote.until==0&&encSteps==0&&ecoExits==1);
  note();bEnc.event=2;mailInput();assert(events.empty()&&mailNote.until==0);           // long press closes
  note();bEnc.event=3;mailInput();assert(mailNote.until==5000&&ecoExits==0);           // release after a long press: nothing
  note();companion=false;bA.event=1;mailInput();assert(events.empty()&&toasts[0]=="Masaüstü uygulaması kapalı"&&mailNote.until==0);
}
'''
        compile_and_run(self, harness + code + cases)

    def test_subject_wraps_on_words_and_utf8(self):
        ui = (FW / 'Ui.h').read_text()
        wrap = ui[ui.index('static void wrap2('):ui.index('static void gMail(')]
        harness = r'''
#include <cassert>
#include <cstdint>
#include <string>
struct String : std::string {
  using std::string::string; String(const std::string& s) : std::string(s) {}
  String substring(size_t a, size_t b = npos) const { return String(std::string::substr(a, b == npos ? npos : b - a)); }
  void trim() { size_t a = find_first_not_of(' '), b = find_last_not_of(' '); *this = a == npos ? String("") : substring(a, b + 1); }
};
struct UFont {} FB18;
int chars(const String& s){int n=0;for(unsigned char c:s) if((c&0xC0)!=0x80) n++;return n;}
int textW(const String& s, UFont&){return chars(s)*10;}
String fit(String t, int max, UFont& f){ if(textW(t,f)<=max) return t; while(t.size()>1){ int n=t.size()-1; while(n>0&&((uint8_t)t[n]&0xC0)==0x80) n--; t.erase(n); if(textW(t+"…",f)<=max) break; } return t+"…"; }
bool whole(const String& s){ for(size_t i=0;i<s.size();){ unsigned char c=s[i]; size_t n=c<0x80?1:c<0xE0?2:c<0xF0?3:4; if(i+n>s.size()) return false; for(size_t k=1;k<n;k++) if(((unsigned char)s[i+k]&0xC0)!=0x80) return false; i+=n; } return true; }
'''
        cases = r'''
int main(){
  String a,b;
  wrap2("Kısa konu",100,FB18,a,b); assert(a=="Kısa konu"&&b.empty());
  wrap2("Yarın toplantı saat onda",100,FB18,a,b); assert(a=="Yarın"&&b=="toplantı …");
  wrap2("Bütçe ve plan",80,FB18,a,b); assert(a=="Bütçe ve"&&b=="plan");
  wrap2("ÇokUzunTekKelimeŞğİöü",80,FB18,a,b); assert(chars(a)==8&&whole(a)&&whole(b)&&textW(b,FB18)<=80);
  wrap2("Bir  iki",40,FB18,a,b); assert(a=="Bir"&&b=="iki");
}
'''
        compile_and_run(self, harness + wrap + cases)


if __name__ == '__main__':
    unittest.main()
