#pragma once
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <vector>

enum LaunchMethod : uint8_t { M_RUN = 0, M_SEARCH, M_TASKBAR, M_KEY };
enum AnimKind : uint8_t { A_FAN = 0, A_RADAR, A_PULSE, A_EQ, A_CUSTOM, A_NONE };
enum Widget : uint8_t { W_CPU = 0, W_GPU, W_CLOCK, W_WEATHER, W_FX, W_NET };
static const char* WIDGET_IDS[6] = { "cpu", "gpu", "clock", "weather", "fx", "net" };

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
  int brightness = 80, dimAfter = 30, sleepAfter = 300, launchDelay = 400, encDetent = 4;   // dimAfter / sleepAfter: on battery (s, 0 = off)
  int dimAfterUsb = 30, sleepAfterUsb = 0;   // on cable (USB host or charger), 0 = off
  int ecoAfterUsb = 60, ecoAfter = 30;   // idle work reduction (s, 0 = off)
  int dimLevelUsb = 17, dimLevel = 17;   // percent of normal brightness, 5..90
  int ecoFpsUsb = 4, ecoFps = 4;   // animation cap, 0 freezes the last complete frame
  bool wrap = true, encRev = false, flip = false;
  String theme = "auto";
  int lightFrom = 420, darkFrom = 1140;   // local minutes after midnight
  bool hostMac = false;
  bool kbFallback = false;   // type Win+R / Start / Spotlight when the desktop app is not running (off by default)      // keyboard fallback style: Windows (Win+R / Start) or macOS (Spotlight)
  // home
  bool homeOn = true;
  uint8_t cards[2] = { W_CPU, W_GPU };   // the two home-screen slots
  String cpuLabel, gpuLabel;              // "" = name from stats
  String wxCity;                          // home.weather.city: label until the app sends weather
  int cpuWarn = 85, cpuCrit = 95, gpuWarn = 80, gpuCrit = 87;
  bool showLoad = true;
  int returnAfter = 60;
  String pressApp;
  uint8_t animKind = A_FAN;
  uint16_t animColor = 0x3B7E;
  int animFps = 15;
  // apps
  std::vector<App> apps;
  String quickA, quickB;
  // extra pages in the knob list
  bool mediaOn = true, mediaStay = true, sysOn = true, connOn = true;
  bool widgetsOn = true;                                           // widgets page: 1–4 cards
  uint8_t wcards[4] = { W_CPU, W_GPU, W_CLOCK, W_WEATHER }, wcount = 4;
  String mediaLaunch = "none";   // desktop-only launch choice; old configs retain HID behaviour
  String mediaPlayer = "auto";   // auto | spotify | music | ytmusic
};

Settings S;

static const char DEFAULT_CONFIG[] PROGMEM = R"JSON({
"version":3,
"device":{"name":"Volkan Deck","layout":"tr_q","connection":"auto","brightness":80,"dimAfter":30,"sleepAfter":300,"dimAfterUsb":30,"sleepAfterUsb":0,"ecoAfterUsb":60,"ecoAfter":30,"dimLevelUsb":17,"dimLevel":17,"ecoFpsUsb":4,"ecoFps":4,"launchDelay":400,"wrap":true,"encReverse":false,"encDetent":4,"theme":"auto","lightFrom":420,"darkFrom":1140},
"home":{"enabled":true,"cards":["cpu","gpu"],"weather":{"city":"İstanbul","lat":41.01,"lon":28.97},"cpuLabel":"","gpuLabel":"","cpuWarn":85,"cpuCrit":95,"gpuWarn":80,"gpuCrit":87,"showLoad":true,"returnAfter":60,"pressApp":null,"anim":{"kind":"fan","color":"#3B6CF6","fps":15}},
"apps":[
 {"id":"cs2","name":"Counter-Strike 2","icon":"game","color":"#E0A800","inWheel":true,"launch":{"method":"run","value":"steam://rungameid/730"}},
 {"id":"discord","name":"Discord","icon":"chat","color":"#5865F2","inWheel":true,"launch":{"method":"run","value":"discord://"}},
 {"id":"spotify","name":"Spotify","icon":"music","color":"#16A34A","inWheel":true,"launch":{"method":"run","value":"spotify:"}},
 {"id":"chrome","name":"Chrome","icon":"globe","color":"#E8590C","inWheel":true,"launch":{"method":"run","value":"chrome"}},
 {"id":"steam","name":"Steam","icon":"game","color":"#1B6FD1","inWheel":true,"launch":{"method":"run","value":"steam://open/main"}}
],
"quick":{"a":"discord","b":"cs2"},
"pages":{"widgets":{"enabled":true,"cards":["cpu","gpu","clock","weather"]},"media":{"enabled":true,"player":"auto","stay":true},"system":{"enabled":true},"connections":{"enabled":true}}
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

/* App icons (40 x 40 RGB565, 3.2 KB each, /icons/<id>.bin). With PSRAM every icon stays loaded there.
   Without PSRAM (1.12.0) only the icons on screen are in RAM: a small cache filled when an icon is drawn
   (16 apps used to hold ~51 KB of internal RAM, which left too little for "Cihaza yaz"). */
static const int ICON_CACHE = 6;
struct IconSlot { App* a = nullptr; uint16_t* p = nullptr; uint32_t used = 0; };
IconSlot iconSlots[ICON_CACHE];
static bool iconInCache(const uint16_t* p) { for (auto& s : iconSlots) if (p && s.p == p) return true; return false; }
static void freeAppPix() {
  for (auto& a : S.apps) { if (a.pix && !iconInCache(a.pix)) free(a.pix); a.pix = nullptr; }
  for (auto& s : iconSlots) { if (s.p) free(s.p); s = IconSlot(); }   // given back too: set_config needs the heap
}
static bool readIcon(const String& id, uint16_t* dst) {
  File f = LittleFS.open("/icons/" + id + ".bin", "r"); if (!f) return false;
  bool ok = f.read((uint8_t*)dst, 3200) == 3200; f.close(); return ok;
}
// the icon's pixels, loading them when needed; nullptr = draw the line icon instead
static uint16_t* appPix(App* a) {
  if (!a || !a->img) return nullptr;
  uint32_t now = millis() | 1;
  if (a->pix) { for (auto& s : iconSlots) if (s.a == a) s.used = now; return a->pix; }
  if (psramFound()) {
    a->pix = (uint16_t*)ps_malloc(3200);
    if (a->pix && !readIcon(a->id, a->pix)) { free(a->pix); a->pix = nullptr; a->img = false; }
    return a->pix;
  }
  IconSlot* s = &iconSlots[0];
  for (auto& c : iconSlots) { if (!c.a) { s = &c; break; } if (c.used < s->used) s = &c; }
  if (s->a) s->a->pix = nullptr;                 // evict the least recently drawn icon
  s->a = nullptr;
  if (!s->p) s->p = (uint16_t*)malloc(3200);
  if (!s->p) return nullptr;
  if (!readIcon(a->id, s->p)) { a->img = false; return nullptr; }
  s->a = a; s->used = now; a->pix = s->p;
  return a->pix;
}

static void loadAppIcons() {
  if (!psramFound()) {                            // no PSRAM: only check the files, load on first draw
    for (auto& a : S.apps) if (a.img && !LittleFS.exists("/icons/" + a.id + ".bin")) a.img = false;
    return;
  }
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
  // Without PSRAM the heap is tight: give the icon pixels (3.2 KB per app) back before building the
  // new settings, and move instead of copy. A failed vector allocation aborts the whole firmware.
  freeAppPix();
  Settings N;
  JsonObjectConst d = c["device"];
  N.name = (const char*)(d["name"] | "Volkan Deck");
  N.trq = strcmp(d["layout"] | "tr_q", "us") != 0;
  const char* cn = d["connection"] | "auto";
  N.conn = !strcmp(cn, "usb") ? 1 : !strcmp(cn, "ble") ? 2 : 0;
  N.brightness = d["brightness"] | 80; N.dimAfter = d["dimAfter"] | 30; N.sleepAfter = d["sleepAfter"] | 300;
  N.dimAfterUsb = d["dimAfterUsb"] | N.dimAfter; N.sleepAfterUsb = d["sleepAfterUsb"] | 0;   // pre-1.5.1 configs: cable = old dim, never sleep
  N.ecoAfterUsb = constrain(d["ecoAfterUsb"] | 60, 0, 3600); N.ecoAfter = constrain(d["ecoAfter"] | 30, 0, 3600);
  N.dimLevelUsb = constrain(d["dimLevelUsb"] | 17, 5, 90);
  N.dimLevel = constrain(d["dimLevel"] | 17, 5, 90);
  N.ecoFpsUsb = constrain(d["ecoFpsUsb"] | 4, 0, 15);   // 1.7.1: up to 15 (was 8)
  N.ecoFps = constrain(d["ecoFps"] | 4, 0, 15);
  N.launchDelay = d["launchDelay"] | 400; N.encDetent = constrain(d["encDetent"] | 4, 1, 4);
  N.wrap = d["wrap"] | true; N.encRev = d["encReverse"] | false; N.flip = d["flip"] | false;
  const char* th = d["theme"] | "auto";
  N.theme = !strcmp(th, "dark") ? "dark" : !strcmp(th, "light") ? "light" : "auto";
  N.lightFrom = constrain(d["lightFrom"] | 420, 0, 1439); N.darkFrom = constrain(d["darkFrom"] | 1140, 0, 1439);
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

  JsonArrayConst cards = h["cards"];          // unknown / missing entries keep the defaults (cpu, gpu)
  for (int i = 0; i < 2; i++) {
    const char* w = cards[i] | "";
    for (uint8_t k = 0; k < 6; k++) if (!strcmp(w, WIDGET_IDS[k])) N.cards[i] = k;
  }
  N.wxCity = (const char*)(h["weather"]["city"] | "");

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
  N.widgetsOn = pg["widgets"]["enabled"] | true;
  JsonArrayConst wc = pg["widgets"]["cards"];
  if (!wc.isNull()) {                         // missing → defaults; unknown ids are skipped
    N.wcount = 0;
    for (JsonVariantConst v : wc) {
      const char* w = v | "";
      for (uint8_t k = 0; k < 6; k++) if (!strcmp(w, WIDGET_IDS[k]) && N.wcount < 4) { N.wcards[N.wcount++] = k; break; }
    }
    if (!N.wcount) { N.wcards[0] = W_CPU; N.wcount = 1; }
  }
  N.mediaOn = pg["media"]["enabled"] | true; N.sysOn = pg["system"]["enabled"] | true;
  N.connOn = pg["connections"]["enabled"] | true;
  N.mediaPlayer = (const char*)(pg["media"]["player"] | "auto");
  N.mediaStay = pg["media"]["stay"] | true;
  N.mediaLaunch = (const char*)(pg["media"]["launch"] | "none");
  if (N.mediaLaunch != "spotify" && N.mediaLaunch != "music" && N.mediaLaunch != "ytmusic") N.mediaLaunch = "none";

  S = std::move(N);
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
   Stored in LittleFS as /anim.bin (12-byte header 'VDAN' w h n fps flags + frames), so it survives power-off.
   flags bit0: a table of n uint16 per-frame durations (ms) follows the header, so a GIF keeps its own timing.
   Two slots (1.7.0): /anim.bin for the dark theme, /anim_light.bin for the light theme; a missing slot uses the other.
   Loaded into PSRAM when possible; otherwise frames are streamed from flash one at a time. */
static const size_t ANIM_FRAME = 128 * 128 * 2;
struct Anim { const char* path; int w = 0, h = 0, frames = 0, fps = 15; uint16_t* buf = nullptr; bool stream = false; uint16_t* frameBuf = nullptr; int cur = -1;
               uint16_t delays[60]; uint32_t total = 0; size_t data = 12; File file; };
Anim anim{ "/anim.bin" }, animLight{ "/anim_light.bin" };
static Anim& animSlot(bool light) { return light ? animLight : anim; }

static void unloadAnim(Anim& A) {
  if (A.file) A.file.close();
  if (A.buf) { free(A.buf); A.buf = nullptr; }
  A.frames = 0; A.stream = false; A.cur = -1; A.total = 0; A.data = 12;
}

static bool loadAnim(Anim& A) {
  unloadAnim(A);
  File f = LittleFS.open(A.path, "r");
  if (!f) return false;
  uint8_t hd[12];
  if (f.read(hd, 12) != 12 || memcmp(hd, "VDAN", 4)) { f.close(); return false; }
  int w = hd[4] | hd[5] << 8, h = hd[6] | hd[7] << 8, n = hd[8] | hd[9] << 8;
  size_t bytes = ANIM_FRAME * n, data = (hd[11] & 1) ? 12 + 2 * n : 12;
  if (w != 128 || h != 128 || n <= 0 || n > 60 || f.size() < data + bytes) { f.close(); return false; }
  A.w = w; A.h = h; A.frames = n; A.fps = hd[10] ? hd[10] : 15; A.data = data;
  if (hd[11] & 1) {
    uint8_t dl[120];
    if (f.read(dl, 2 * n) != (size_t)(2 * n)) { f.close(); A.frames = 0; return false; }
    for (int i = 0; i < n; i++) { A.delays[i] = max(20, dl[2 * i] | dl[2 * i + 1] << 8); A.total += A.delays[i]; }
  }
  uint16_t* b = psramFound() ? (uint16_t*)ps_malloc(bytes) : nullptr;
  if (!b && bytes <= 96 * 1024) b = (uint16_t*)malloc(bytes);
  if (b && f.read((uint8_t*)b, bytes) == bytes) { A.buf = b; f.close(); return true; }
  if (b) free(b);
  // not enough RAM: keep the file open and read one frame at a time
  if (!A.frameBuf) A.frameBuf = (uint16_t*)malloc(ANIM_FRAME);
  if (!A.frameBuf) { f.close(); A.frames = 0; return false; }
  A.file = f; A.stream = true; A.cur = -1;
  return true;
}

// the animation for the current theme; falls back to the other slot when only one was uploaded
static Anim& themeAnim(bool light) {
  Anim& want = animSlot(light);
  return want.frames ? want : animSlot(!light);
}

static const uint16_t* animFrame(Anim& A, int i) {
  if (!A.frames) return nullptr;
  if (A.buf) return A.buf + (size_t)i * 128 * 128;
  if (A.stream && A.file) {
    if (i != A.cur) {
      A.file.seek(A.data + (size_t)i * ANIM_FRAME);
      if (A.file.read((uint8_t*)A.frameBuf, ANIM_FRAME) != ANIM_FRAME) return nullptr;
      A.cur = i;
    }
    return A.frameBuf;
  }
  return nullptr;
}

// frame to show at time t: the GIF's own durations if it has them, else a fixed fps
static int animIndex(const Anim& A, uint32_t t, int fps) {
  if (!A.total) return (int)(t / 1000.0f * fps) % A.frames;
  uint32_t m = t % A.total;
  for (int i = 0; i < A.frames; i++) { if (m < A.delays[i]) return i; m -= A.delays[i]; }
  return A.frames - 1;
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
  String artKey; uint16_t* art = nullptr; bool hasArt = false;
  float pos = -1, dur = -1; uint32_t posAt = 0, stamp = 0;
} media;
struct SysState { int vol = -1, bright = -1; bool mute = false; int mic = -1; uint32_t stamp = 0; } sysSt;   // mic: -1 unknown, 0 on, 1 muted
String mediaTarget = "auto";

/* ---------- new mail note, pushed by the desktop app ({"cmd":"mail"}, firmware 1.8.0) ---------- */
struct MailNote {
  String subject, l1, l2;               // l1 / l2: subject wrapped to two lines on first draw
  int unread = -1, fresh = 1;           // unread: -1 unknown
  uint32_t at = 0, ms = 0, until = 0;   // until: 0 = no note
  bool wrapped = false;
} mailNote;
static bool mailActive() { return mailNote.until && (int32_t)(millis() - mailNote.until) < 0; }
