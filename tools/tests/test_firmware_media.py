"""Exercise the actual firmware launch/media functions with a small host-side HAL."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class FirmwareMediaTest(unittest.TestCase):
    def test_launch_session_pin_and_legacy_media_routing(self):
        compiler = shutil.which('clang++') or shutil.which('g++')
        if not compiler:
            self.skipTest('C++ compiler unavailable')
        source = (ROOT / 'firmware/VolkanDeck/VolkanDeck.ino').read_text()
        launch = source[source.index('static String musicPlayerForApp('):source.index('static void onPress()')]
        action = source[source.index('static void mediaAction('):source.index('static void cyclePlayer()')]
        harness = r'''
#include <string>
#include <cstring>
#include <vector>
#include <algorithm>
#include <cassert>
#include <cstdint>
struct String {
  std::string v;
  String(const char* s = "") : v(s) {} String(std::string s) : v(s) {}
  size_t length() const { return v.size(); }
  int indexOf(const char* s) const { auto i=v.find(s); return i==std::string::npos?-1:(int)i; }
  void replace(const char* a,const char* b) { size_t i=0; while((i=v.find(a,i))!=std::string::npos){v.replace(i,std::string(a).size(),b);i+=std::string(b).size();} }
  void toLowerCase(){ std::transform(v.begin(),v.end(),v.begin(),[](unsigned char c){return c<128?std::tolower(c):c;}); }
  friend String operator+(String a,String b){return a.v+b.v;}
  bool operator==(String b) const{return v==b.v;} bool operator!=(String b) const{return v!=b.v;}
};
enum { M_RUN, M_SEARCH, M_TASKBAR, M_KEY, K_APP=10, K_MEDIA, L_NONE };
struct Launch { int method=M_RUN; String value,path,mac; };
struct App { String name; Launch launch; };
struct Item { int kind; App* app=nullptr; };
struct { bool mediaOn=true,kbFallback=false; String mediaPlayer="auto",mediaLaunch="none"; } S;
struct { bool appCtl=false,playing=false; int stamp=1; String player; } media;
String mediaTarget="auto",mediaFlashAct; unsigned mediaFlashAt=0;
std::vector<Item> items; int sel=0,adjust=0; float launchP=-1; bool dirty=false;
bool companion=true,live=false,companionMediaLaunch=true,link=true,launchOK=true;
int hid=0; std::vector<std::string> events;
bool companionOn(){return companion;} bool mediaLive(){return live;}
unsigned millis(){return 10;} bool consumerTap(uint16_t){hid++;return true;}
void toast(String){} void render(const char*){} void delay(int){}
const char* linkName(){return "usb";} int activeLink(){return link?0:L_NONE;}
bool runLaunch(const Launch&,String){return launchOK;}
void evtLaunch(App*){events.push_back("launch");} void evtMedia(const char*){events.push_back("media");}
void selectIndex(int i){sel=i;adjust=0;events.push_back("select");}
'''
        cases = r'''
int main(){
  App a; a.name="sPoTiFy"; assert(musicPlayerForApp(a)=="spotify");
  a.name="OBS";a.launch.value="https://MUSIC.YOUTUBE.COM";assert(musicPlayerForApp(a)=="ytmusic");
  a.launch.value="";a.launch.mac="/Applications/Music.app";assert(musicPlayerForApp(a)=="music");
  a.launch.mac="";a.launch.path="C:\\ITUNES.EXE";assert(musicPlayerForApp(a)=="music");
  a.launch.path="";a.name="MÜZİK";assert(musicPlayerForApp(a)=="music");
  a.name="YouTube Music";assert(musicPlayerForApp(a)=="ytmusic");
  a.name="OBS";assert(musicPlayerForApp(a)=="");
  a.name="Spotify";items={{K_APP,&a},{K_MEDIA,nullptr}};
  doLaunch(&a);assert(sel==1);assert(mediaTarget=="spotify");assert(S.mediaPlayer=="auto");assert(media.stamp==0);
  assert((events==std::vector<std::string>{"launch","media","select"}));
  sel=0;S.mediaOn=false;mediaTarget="auto";events.clear();doLaunch(&a);assert(sel==0);assert(mediaTarget=="auto");assert(events.size()==1);
  S.mediaOn=true;companion=false;S.kbFallback=true;launchOK=false;events.clear();doLaunch(&a);assert(sel==0);assert(mediaTarget=="auto");assert(events.empty());
  launchOK=true;doLaunch(&a);assert(sel==1);assert(mediaTarget=="spotify");assert(S.mediaPlayer=="auto");
  // Fresh/new desktop: launch requests must not send a raw key before the first media snapshot.
  companion=true;live=false;media.player="";events.clear();hid=0;mediaAction("play_pause",1);assert(hid==0);assert(events.size()==1);
  // Old desktop, or no desktop: retain the original HID fallback.
  companionMediaLaunch=false;events.clear();mediaAction("play_pause",1);assert(hid==1);assert(events.empty());
  companionMediaLaunch=true;companion=false;mediaAction("play_pause",1);assert(hid==2);
  companion=true;mediaTarget="auto";S.mediaLaunch="spotify";mediaAction("play_pause",1);assert(hid==2);
  S.mediaLaunch="none";events.clear();mediaAction("play_pause",1);assert(hid==3);assert(events.empty());
  mediaTarget="ytmusic";live=true;media.player="ytmusic";media.appCtl=false;mediaAction("play_pause",1);assert(hid==4);
  media.appCtl=true;companionMediaLaunch=false;events.clear();mediaAction("play_pause",1);assert(hid==4);assert(events.size()==1);
}
'''
        build = ROOT / 'firmware/VolkanDeck/build'
        build.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=build) as work:
            work = Path(work)
            cpp = work / 'media.cpp'
            cpp.write_text(harness + action + launch + cases)
            env = {**os.environ, 'TMPDIR': str(work)}
            result = subprocess.run([compiler, '-std=c++17', str(cpp), '-o', str(work / 'test')], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            result = subprocess.run([str(work / 'test')], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
