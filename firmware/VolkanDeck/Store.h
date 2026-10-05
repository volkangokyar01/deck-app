#pragma once
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <vector>

enum LaunchMethod : uint8_t { M_RUN = 0, M_SEARCH, M_TASKBAR, M_KEY };
enum AnimKind : uint8_t { A_FAN = 0, A_RADAR, A_PULSE, A_EQ, A_CUSTOM, A_NONE };

struct Launch {
  uint8_t method = M_RUN;
  String  value;
  uint8_t mods = 0;   // HID modifier bits
  uint8_t key = 0;    // HID usage
  uint8_t tb = 1;     // taskbar slot 1..9
  String  path, mac;  // direct targets for the companion app (Windows path / macOS app)
};

struct App {
  String   id, name, icon;
  uint16_t color = 0x632C;
  bool     img = false;
  bool     inWheel = true;
  Launch   launch;
  uint16_t* pix = nullptr;   // 40x40 RGB565 (PSRAM) when img
};

struct Settings {
  String name = "Volkan Deck";
  bool   trq = true;
  uint8_t conn = 0;          // 0 auto, 1 usb, 2 ble
  int brightness = 80, dimAfter = 30, sleepAfter = 300, launchDelay = 400, encDetent = 4;
  bool wrap = true, encRev = false, flip = false;
  bool hostMac = false;
  bool kbFallback = false;   // type Win+R / Start / Spotlight when the desktop app is not running (off by default)      // keyboard fallback style: Windows (Win+R / Start) or macOS (Spotlight)
  // home
  bool homeOn = true;
  String cpuLabel = "Core Ultra 5 245KF", gpuLabel = "RTX 5070";
  int cpuWarn = 85, cpuCrit = 95, gpuWarn = 80, gpuCrit = 87;
  bool showLoad = true;
  int returnAfter = 60;
  String pressApp;
  uint8_t animKind = A_FAN;
  uint16_t animColor = 0x3B7E;
  int animFps = 15;
  // sensors
  String ssid, pass, host, cpuSensor, gpuSensor;
  int port = 8085, interval = 2;
  // apps
  std::vector<App> apps;
  String quickA, quickB;
  // extra pages in the knob list
  bool mediaOn = true, sysOn = true;
  String mediaPlayer = "auto";   // auto | spotify | music | ytmusic
};

Settings S;

static const char DEFAULT_CONFIG[] PROGMEM = R"JSON({
"version":3,
"device":{"name":"Volkan Deck","layout":"tr_q","connection":"auto","brightness":80,"dimAfter":30,"sleepAfter":300,"launchDelay":400,"wrap":true,"encReverse":false,"encDetent":4},
"home":{"enabled":true,"cpuLabel":"Core Ultra 5 245KF","gpuLabel":"RTX 5070","cpuWarn":85,"cpuCrit":95,"gpuWarn":80,"gpuCrit":87,"showLoad":true,"returnAfter":60,"pressApp":null,"anim":{"kind":"fan","color":"#3B6CF6","fps":15}},
"sensors":{"wifiSsid":"","wifiPass":"","host":"","port":8085,"interval":2,"cpuSensor":"","gpuSensor":""},
"apps":[
 {"id":"cs2","name":"Counter-Strike 2","icon":"game","color":"#E0A800","inWheel":true,"launch":{"method":"run","value":"steam://rungameid/730"}},
 {"id":"discord","name":"Discord","icon":"chat","color":"#5865F2","inWheel":true,"launch":{"method":"run","value":"discord://"}},
 {"id":"spotify","name":"Spotify","icon":"music","color":"#16A34A","inWheel":true,"launch":{"method":"run","value":"spotify:"}},
 {"id":"chrome","name":"Chrome","icon":"globe","color":"#E8590C","inWheel":true,"launch":{"method":"run","value":"chrome"}},
 {"id":"steam","name":"Steam","icon":"game","color":"#1B6FD1","inWheel":true,"launch":{"method":"run","value":"steam://open/main"}}
],
"quick":{"a":"discord","b":"cs2"},
"pages":{"media":{"enabled":true,"player":"auto"},"system":{"enabled":true}}
})JSON";

static uint16_t parseColor(const char* s, uint16_t def) {
  if (!s || s[0] != '#' || strlen(s) < 7) return def;
  uint32_t v = strtoul(s + 1, nullptr, 16);
  uint8_t r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}

static uint8_t keyFromName(const char* k) {
  if (!k || !*k) return 0;
  if (!k[1]) {
    char c = k[0];
    if (c >= 'A' && c <= 'Z') return 0x04 + (c - 'A');
    if (c >= 'a' && c <= 'z') return 0x04 + (c - 'a');
    if (c >= '1' && c <= '9') return 0x1E + (c - '1');
    if (c == '0') return 0x27;
  }
  if (k[0] == 'F' && k[1] >= '0' && k[1] <= '9') {
    int n = atoi(k + 1);
    if (n >= 1 && n <= 12) return 0x3A + n - 1;
    if (n >= 13 && n <= 24) return 0x68 + n - 13;
  }
  struct { const char* n; uint8_t v; } T[] = {
    {"ESC",0x29},{"ENTER",0x28},{"TAB",0x2B},{"SPACE",0x2C},{"DELETE",0x4C},{"HOME",0x4A},{"END",0x4D},
    {"PRINT_SCREEN",0x46},{"BACKSPACE",0x2A},{"INSERT",0x49},{"PAGE_UP",0x4B},{"PAGE_DOWN",0x4E},
    {"UP",0x52},{"DOWN",0x51},{"LEFT",0x50},{"RIGHT",0x4F},{"PAUSE",0x48},{"CAPS_LOCK",0x39}};
  for (auto& t : T) if (!strcmp(k, t.n)) return t.v;
  return 0;
}

static uint8_t modsFromArray(JsonArrayConst a) {
  uint8_t m = 0;
  for (JsonVariantConst v : a) {
    const char* s = v.as<const char*>(); if (!s) continue;
    if (!strcmp(s, "ctrl")) m |= 0x01; else if (!strcmp(s, "shift")) m |= 0x02;
    else if (!strcmp(s, "alt")) m |= 0x04; else if (!strcmp(s, "win")) m |= 0x08;
  }
  return m;
}

static void parseLaunch(JsonObjectConst o, Launch& L) {
  const char* m = o["method"] | "run";
  L.method = !strcmp(m, "search") ? M_SEARCH : !strcmp(m, "taskbar") ? M_TASKBAR : !strcmp(m, "key") ? M_KEY : M_RUN;
  L.value = "";
  if (L.method == M_TASKBAR) { L.tb = constrain(o["value"] | 1, 1, 9); }
  else if (L.method == M_KEY) { L.mods = modsFromArray(o["mods"]); L.key = keyFromName(o["key"] | ""); }
  else { L.value = (const char*)(o["value"] | ""); }
  L.path = (const char*)(o["path"] | ""); L.mac = (const char*)(o["mac"] | "");
}

static void freeAppPix() { for (auto& a : S.apps) { if (a.pix) { free(a.pix); a.pix = nullptr; } } }

static void loadAppIcons() {
  for (auto& a : S.apps) {
    if (!a.img) continue;
    String p = "/icons/" + a.id + ".bin";
    File f = LittleFS.open(p, "r");
    if (!f) { a.img = false; continue; }
    a.pix = (uint16_t*)(psramFound() ? ps_malloc(3200) : malloc(3200)); if (!a.pix) a.pix = (uint16_t*)malloc(3200);
    if (a.pix && f.read((uint8_t*)a.pix, 3200) != 3200) { free(a.pix); a.pix = nullptr; a.img = false; }
    f.close();
  }
}

static void applyConfig(JsonObjectConst c) {
  Settings N;
  JsonObjectConst d = c["device"];
  N.name = (const char*)(d["name"] | "Volkan Deck");
  N.trq = strcmp(d["layout"] | "tr_q", "us") != 0;
  const char* cn = d["connection"] | "auto";
  N.conn = !strcmp(cn, "usb") ? 1 : !strcmp(cn, "ble") ? 2 : 0;
  N.brightness = d["brightness"] | 80; N.dimAfter = d["dimAfter"] | 30; N.sleepAfter = d["sleepAfter"] | 300;
  N.launchDelay = d["launchDelay"] | 400; N.encDetent = constrain(d["encDetent"] | 4, 1, 4);
  N.wrap = d["wrap"] | true; N.encRev = d["encReverse"] | false; N.flip = d["flip"] | false;
  N.hostMac = !strcmp(d["host"] | "win", "mac");
  N.kbFallback = d["kbFallback"] | false;

  JsonObjectConst h = c["home"];
  N.homeOn = h["enabled"] | true;
  N.cpuLabel = (const char*)(h["cpuLabel"] | ""); N.gpuLabel = (const char*)(h["gpuLabel"] | "");
  N.cpuWarn = h["cpuWarn"] | 85; N.cpuCrit = h["cpuCrit"] | 95; N.gpuWarn = h["gpuWarn"] | 80; N.gpuCrit = h["gpuCrit"] | 87;
  N.showLoad = h["showLoad"] | true; N.returnAfter = h["returnAfter"] | 60;
  N.pressApp = (const char*)(h["pressApp"] | "");
  JsonObjectConst an = h["anim"];
  const char* k = an["kind"] | "fan";
  N.animKind = !strcmp(k, "radar") ? A_RADAR : !strcmp(k, "pulse") ? A_PULSE : !strcmp(k, "eq") ? A_EQ : !strcmp(k, "custom") ? A_CUSTOM : !strcmp(k, "none") ? A_NONE : A_FAN;
  N.animColor = parseColor(an["color"] | "#3B6CF6", 0x3B7E);
  N.animFps = constrain(an["fps"] | 15, 1, 30);

  JsonObjectConst s = c["sensors"];
  N.ssid = (const char*)(s["wifiSsid"] | ""); N.pass = (const char*)(s["wifiPass"] | "");
  N.host = (const char*)(s["host"] | ""); N.port = s["port"] | 8085; N.interval = constrain(s["interval"] | 2, 1, 60);
  N.cpuSensor = (const char*)(s["cpuSensor"] | ""); N.gpuSensor = (const char*)(s["gpuSensor"] | "");

  for (JsonObjectConst a : c["apps"].as<JsonArrayConst>()) {
    App A;
    A.id = (const char*)(a["id"] | ""); A.name = (const char*)(a["name"] | "");
    A.icon = (const char*)(a["icon"] | "star");
    A.color = parseColor(a["color"] | "#64748B", 0x632C);
    A.img = a["img"] | false; A.inWheel = a["inWheel"] | true;
    parseLaunch(a["launch"], A.launch);
    N.apps.push_back(A);
    if (N.apps.size() >= 16) break;
  }
  N.quickA = (const char*)(c["quick"]["a"] | ""); N.quickB = (const char*)(c["quick"]["b"] | "");
  JsonObjectConst pg = c["pages"];
  N.mediaOn = pg["media"]["enabled"] | true; N.sysOn = pg["system"]["enabled"] | true;
  N.mediaPlayer = (const char*)(pg["media"]["player"] | "auto");

  freeAppPix();
  S = N;
  loadAppIcons();
}

static bool loadConfigFile(JsonDocument& doc) {
  File f = LittleFS.open("/config.json", "r");
  if (!f) return false;
  DeserializationError e = deserializeJson(doc, f);
  f.close();
  return !e;
}

static void loadConfig() {
  JsonDocument doc;
  if (!loadConfigFile(doc)) { doc.clear(); deserializeJson(doc, DEFAULT_CONFIG); }
  applyConfig(doc.as<JsonObjectConst>());
}

static size_t saveConfig(JsonObjectConst c) {
  File f = LittleFS.open("/config.json", "w");
  if (!f) return 0;
  size_t n = serializeJson(c, f);
  f.close();
  return n;
}

static App* appById(const String& id) {
  if (!id.length()) return nullptr;
  for (auto& a : S.apps) if (a.id == id) return &a;
  return nullptr;
}

static void pruneIcons() {
  File dir = LittleFS.open("/icons");
  if (!dir) return;
  std::vector<String> del;
  for (File f = dir.openNextFile(); f; f = dir.openNextFile()) {
    String n = f.name(); n.replace(".bin", "");
    if (!appById(n)) del.push_back(String("/icons/") + f.name());
  }
  for (auto& p : del) LittleFS.remove(p);
}

/* ---------- custom animation (128x128 RGB565 frames) ----------
   Stored in LittleFS as /anim.bin (12-byte header 'VDAN' w h n fps + frames), so it survives power-off.
   Loaded into PSRAM when possible; otherwise frames are streamed from flash one at a time. */
static const size_t ANIM_FRAME = 128 * 128 * 2;
struct Anim { int w = 0, h = 0, frames = 0, fps = 15; uint16_t* buf = nullptr; bool stream = false; uint16_t* frameBuf = nullptr; int cur = -1; } anim;
File animFile;

static void unloadAnim() {
  if (animFile) animFile.close();
  if (anim.buf) { free(anim.buf); anim.buf = nullptr; }
  anim.frames = 0; anim.stream = false; anim.cur = -1;
}

static bool loadAnim() {
  unloadAnim();
  File f = LittleFS.open("/anim.bin", "r");
  if (!f) return false;
  uint8_t hd[12];
  if (f.read(hd, 12) != 12 || memcmp(hd, "VDAN", 4)) { f.close(); return false; }
  int w = hd[4] | hd[5] << 8, h = hd[6] | hd[7] << 8, n = hd[8] | hd[9] << 8;
  size_t bytes = ANIM_FRAME * n;
  if (w != 128 || h != 128 || n <= 0 || n > 60 || f.size() < 12 + bytes) { f.close(); return false; }
  anim.w = w; anim.h = h; anim.frames = n; anim.fps = hd[10] ? hd[10] : 15;
  uint16_t* b = psramFound() ? (uint16_t*)ps_malloc(bytes) : nullptr;
  if (!b && bytes <= 96 * 1024) b = (uint16_t*)malloc(bytes);
  if (b && f.read((uint8_t*)b, bytes) == bytes) { anim.buf = b; f.close(); return true; }
  if (b) free(b);
  // not enough RAM: keep the file open and read one frame at a time
  if (!anim.frameBuf) anim.frameBuf = (uint16_t*)malloc(ANIM_FRAME);
  if (!anim.frameBuf) { f.close(); anim.frames = 0; return false; }
  animFile = f; anim.stream = true; anim.cur = -1;
  return true;
}

static const uint16_t* animFrame(int i) {
  if (!anim.frames) return nullptr;
  if (anim.buf) return anim.buf + (size_t)i * 128 * 128;
  if (anim.stream && animFile) {
    if (i != anim.cur) {
      animFile.seek(12 + (size_t)i * ANIM_FRAME);
      if (animFile.read((uint8_t*)anim.frameBuf, ANIM_FRAME) != ANIM_FRAME) return nullptr;
      anim.cur = i;
    }
    return anim.frameBuf;
  }
  return nullptr;
}

// keep "Kendi GIF'im" selected after a reboot even if the full settings were never written
static void persistAnimChoice(int fps) {
  JsonDocument doc;
  if (!loadConfigFile(doc)) deserializeJson(doc, DEFAULT_CONFIG);
  doc["home"]["anim"]["kind"] = "custom";
  if (fps > 0) doc["home"]["anim"]["fps"] = fps;
  saveConfig(doc.as<JsonObjectConst>());
  S.animKind = A_CUSTOM; if (fps > 0) S.animFps = constrain(fps, 1, 30);
}

/* ---------- media / system state reported by the desktop app ---------- */
struct MediaState {
  String player, name, title, artist;   // player: spotify | music | ytmusic | other | ""
  bool playing = false, appCtl = false; // appCtl: the desktop app controls the player (else media keys)
  float pos = -1, dur = -1; uint32_t posAt = 0, stamp = 0;
} media;
struct SysState { int vol = -1, bright = -1; bool mute = false; uint32_t stamp = 0; } sysSt;
String mediaTarget = "auto";
