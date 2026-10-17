#pragma once
/* ---------- Wi-Fi (1.13.0; first tried in 1.10.x): optional, chosen only in the desktop app ----------
   The radio stays off until a network is saved from the settings page (NVS "vdwifi": ssid, pass, on).
   Connected, NTP sets the chip clock (Stats.h localTime uses it while the desktop app is away). Everything
   else (stats, media, launch) still comes from the desktop app over USB / Bluetooth.
   With PSRAM working (1.12.1) the Wi-Fi / lwIP buffers go to PSRAM (CONFIG_SPIRAM_TRY_ALLOCATE_WIFI_LWIP);
   without PSRAM the radio is not started when less than WIFI_MIN_HEAP is free.
   Wi-Fi and Bluetooth share the antenna: modem sleep stays on (required for coexistence). */
#include <WiFi.h>
#include <Preferences.h>
#include <WiFiUdp.h>

struct WifiState {
  String ssid;
  bool on = false;            // user wants it on (saved)
  bool started = false;       // radio initialised
  bool failed = false;        // a full attempt failed; shown as "Bağlanamadı" until the next success
  uint32_t tryAt = 0;         // current attempt started (0 = none running)
  uint32_t retryAt = 0;       // next attempt (0 = none planned)
  bool fast = false;          // current attempt goes straight to the remembered access point
  bool up = false;            // connected at the last poll
  uint8_t fails = 0;          // full attempts failed in a row (back-off)
  uint8_t reason = 0;         // why the last attempt / link ended: 0, R_PASS, R_NOAP, R_OTHER
  uint8_t bssid[6] = { 0 }; uint8_t ch = 0;   // remembered access point (fast connect)
  bool timeSet = false;       // NTP answered
  bool noMem = false;         // not started: too little RAM (no PSRAM)
  bool dirty = false;
};
WifiState wf;
enum : uint8_t { R_NONE = 0, R_PASS, R_NOAP, R_OTHER };
// set by the Wi-Fi event task, read in wifiPoll
static volatile uint8_t wfEvtReason = 0; static volatile uint32_t wfEvtCount = 0;

static bool wifiConnected() { return wf.started && WiFi.status() == WL_CONNECTED; }
// internal RAM the radio needs besides PSRAM (static RX buffers, driver state); the screen buffer (108 KB)
// moves to PSRAM first when Wi-Fi comes on (wifiMakeRoom, set by Ui.h)
static const uint32_t WIFI_MIN_HEAP = 45 * 1024;
static uint32_t internalFree() { return heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT); }
void (*wifiMakeRoom)() = nullptr;
static bool wifiWanted() { return wf.on && wf.ssid.length(); }
static const char* wifiStateName() {
  if (!wf.on || !wf.ssid.length()) return "off";
  if (wf.noMem) return "nomem";
  if (wifiConnected()) return "connected";
  return wf.failed ? "failed" : "connecting";
}
static const char* wifiReasonName() { return wf.reason == R_PASS ? "pass" : wf.reason == R_NOAP ? "noap" : wf.reason == R_OTHER ? "other" : ""; }

/* 1.18.2 connection handling
   - Fast connect: after a good connection the access point (BSSID) and channel are kept in NVS. The next attempt
     goes straight there (no channel scan, ~1 s instead of several with Bluetooth sharing the antenna). If that
     fails (router moved channel, other mesh node) a full scan follows at once, strongest access point first.
   - Staying connected: our own reconnect instead of the core's auto-reconnect (which could leave the radio idle):
     a dropped link retries after 0.5 s on the remembered access point; failed full attempts back off
     5 / 10 / 20 / 40 / 60 s; a wrong password waits 60 s. Each attempt ends early on the disconnect event.
   - WPA / WPA2 mixed routers are accepted (min security WPA-PSK), the deck shows up as "GameDeck". */
static void wifiOnEvent(arduino_event_id_t e, arduino_event_info_t info) {
  if (e != ARDUINO_EVENT_WIFI_STA_DISCONNECTED) return;
  uint8_t r = info.wifi_sta_disconnected.reason;
  if (r == WIFI_REASON_ASSOC_LEAVE) return;   // our own disconnect before a new attempt
  wfEvtReason = (r == WIFI_REASON_AUTH_FAIL || r == WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT || r == WIFI_REASON_HANDSHAKE_TIMEOUT ||
                 r == WIFI_REASON_802_1X_AUTH_FAILED) ? R_PASS
              : (r == WIFI_REASON_NO_AP_FOUND || r == WIFI_REASON_NO_AP_FOUND_W_COMPATIBLE_SECURITY ||
                 r == WIFI_REASON_NO_AP_FOUND_IN_AUTHMODE_THRESHOLD || r == WIFI_REASON_NO_AP_FOUND_IN_RSSI_THRESHOLD) ? R_NOAP : R_OTHER;
  wfEvtCount++;
}
static void wifiRadioOn() {
  static bool hooked = false;
  if (!hooked) { WiFi.onEvent(wifiOnEvent); hooked = true; }
  WiFi.persistent(false);                     // our own NVS keeps the credentials
  WiFi.setHostname("GameDeck");
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(true);                        // modem sleep: needed while Bluetooth runs
  WiFi.setAutoReconnect(false);               // wifiPoll reconnects (faster, never gives up)
  WiFi.setMinSecurity(WIFI_AUTH_WPA_PSK);     // older WPA / WPA2 mixed modems
  WiFi.setScanMethod(WIFI_ALL_CHANNEL_SCAN);  // full scan picks the strongest access point, not the first one
  WiFi.setSortMethod(WIFI_CONNECT_AP_BY_SIGNAL);
}
static void wifiConnect(bool fast) {
  Preferences pr; String pass;
  if (pr.begin("vdwifi", true)) { pass = pr.getString("pass", ""); pr.end(); }
  wf.fast = fast && wf.ch && (wf.bssid[0] | wf.bssid[1] | wf.bssid[2] | wf.bssid[3] | wf.bssid[4] | wf.bssid[5]);
  WiFi.disconnect(false, false);
  const char* pw = pass.length() ? pass.c_str() : nullptr;
  if (wf.fast) WiFi.begin(wf.ssid.c_str(), pw, wf.ch, wf.bssid);
  else WiFi.begin(wf.ssid.c_str(), pw);
  wfEvtCount = 0;
  wf.tryAt = millis() | 1; wf.retryAt = 0; wf.dirty = true;
}
static void wifiStart() {
  if (!wf.ssid.length()) return;
  if (!wf.started && internalFree() < WIFI_MIN_HEAP + 20 * 1024 && wifiMakeRoom) wifiMakeRoom();
  if (!wf.started && internalFree() < WIFI_MIN_HEAP) { wf.noMem = true; wf.dirty = true; return; }
  wf.noMem = false;
  if (!wf.started) { wifiRadioOn(); wf.started = true; configTime(0, 0, "pool.ntp.org", "time.google.com"); }   // UTC into the chip clock; Stats.h adds clockTz
  wf.failed = false; wf.fails = 0; wf.reason = R_NONE; wf.up = false;
  wifiConnect(true);
}
static void wifiStop() {
  if (wf.started) { WiFi.disconnect(true, false); WiFi.mode(WIFI_OFF); wf.started = false; }
  wf.failed = false; wf.tryAt = wf.retryAt = 0; wf.up = false; wf.dirty = true;
}
static void wifiSave() {
  Preferences pr; if (pr.begin("vdwifi", false)) { pr.putString("ssid", wf.ssid); pr.putBool("on", wf.on); pr.end(); }
}
// keep the access point that worked (written only when it changed: NVS wear)
static void wifiRemember() {
  uint8_t* b = WiFi.BSSID(); uint8_t ch = WiFi.channel();
  if (!b || !ch || (!memcmp(b, wf.bssid, 6) && ch == wf.ch)) return;
  memcpy(wf.bssid, b, 6); wf.ch = ch;
  Preferences pr; if (pr.begin("vdwifi", false)) { pr.putBytes("bssid", wf.bssid, 6); pr.putUChar("ch", ch); pr.end(); }
}
static void wifiBegin() {
  Preferences pr;
  if (pr.begin("vdwifi", true)) {
    wf.ssid = pr.getString("ssid", ""); wf.on = pr.getBool("on", false);
    if (pr.getBytesLength("bssid") == 6) { pr.getBytes("bssid", wf.bssid, 6); wf.ch = pr.getUChar("ch", 0); }
    pr.end();
  }
  if (wf.on && wf.ssid.length()) wifiStart();
}
static void wifiSet(const String& ssid, const String& pass) {
  Preferences pr;
  if (pr.begin("vdwifi", false)) { pr.putString("ssid", ssid); pr.putString("pass", pass); pr.putBool("on", true); pr.remove("bssid"); pr.remove("ch"); pr.end(); }
  memset(wf.bssid, 0, 6); wf.ch = 0;          // new network: full scan first
  wf.ssid = ssid; wf.on = true; wifiStart();
}
static void wifiSetOn(bool on) {
  if (!wf.ssid.length()) return;
  wf.on = on; wifiSave();
  if (on) wifiStart(); else wifiStop();
}
static void wifiForget() {
  wifiStop();
  Preferences pr; if (pr.begin("vdwifi", false)) { pr.clear(); pr.end(); }
  wf.ssid = ""; wf.on = false; wf.timeSet = false; wf.noMem = false; memset(wf.bssid, 0, 6); wf.ch = 0; wf.dirty = true;
}
// back-off after a failed full attempt: 5, 10, 20, 40, 60 s; wrong password 60 s
static uint32_t wifiRetryDelay(uint8_t fails, uint8_t reason) {
  if (reason == R_PASS) return 60000;
  uint32_t d = 5000UL << (fails > 0 ? min<int>(fails - 1, 4) : 0);
  return d > 60000 ? 60000 : d;
}
// called from the main loop: attempt end / timeout, reconnect, NTP time into the clock, screen refresh on changes
static void wifiPoll() {
  if (!wf.started) return;
  uint32_t now = millis();
  bool up = WiFi.status() == WL_CONNECTED;
  if (up != wf.up) {
    wf.up = up; wf.dirty = true;
    if (up) { wf.failed = false; wf.fails = 0; wf.reason = R_NONE; wf.tryAt = wf.retryAt = 0; wifiRemember(); }
    else if (!wf.tryAt) { wf.reason = wfEvtReason; wf.retryAt = (now + 500) | 1; }   // dropped: back quickly
  }
  if (up) {
    // NTP sets the chip clock itself (configTime); Stats.h localTime reads it while the desktop app is away
    if (!wf.timeSet && time(nullptr) > 1700000000) { wf.timeSet = true; wf.dirty = true; }
    return;
  }
  if (wf.tryAt) {
    bool ended = wfEvtCount > 0 && now - wf.tryAt > 300;          // the driver gave up on this attempt
    if (ended || now - wf.tryAt > (wf.fast ? 6000UL : 15000UL)) {
      wf.tryAt = 0;
      if (wfEvtCount) wf.reason = wfEvtReason;
      if (wf.fast) { wifiConnect(false); return; }               // remembered access point missed: full scan now
      wf.fails = wf.fails < 250 ? wf.fails + 1 : wf.fails;
      wf.failed = true; wf.dirty = true;
      wf.retryAt = (now + wifiRetryDelay(wf.fails, wf.reason)) | 1;
    }
    return;
  }
  if (wf.retryAt && (int32_t)(now - wf.retryAt) >= 0) wifiConnect(true);
}
// networks around. Asynchronous since 1.13.6: a blocking scan (several seconds with Bluetooth sharing the
// antenna) froze the screen and the link, and the settings page scans whenever it opens.
// wifiScanStart: 0 started, -2 not enough memory, -1 the radio refused. wifiScanCollect: WIFI_SCAN_RUNNING
// while scanning, else the result count (< 0 failed); the radio goes back off if Wi-Fi is not in use.
static bool scanRadioWas = false;
static int wifiScanStart() {
  bool was = wf.started;
  if (!was && internalFree() < WIFI_MIN_HEAP + 20 * 1024 && wifiMakeRoom) wifiMakeRoom();
  if (!was && internalFree() < WIFI_MIN_HEAP) return -2;
  if (!was) wifiRadioOn();
  scanRadioWas = was;
  if (WiFi.scanNetworks(true, false) == WIFI_SCAN_FAILED) { if (!was) WiFi.mode(WIFI_OFF); return -1; }
  return 0;
}
static int wifiScanCollect(JsonArray out) {
  int n = WiFi.scanComplete();
  if (n == WIFI_SCAN_RUNNING) return n;
  for (int i = 0; i < n && out.size() < 15; i++) {
    String ss = WiFi.SSID(i); if (!ss.length()) continue;
    bool dup = false; for (JsonVariant v : out) if (ss == (const char*)(v["ssid"] | "")) dup = true;
    if (dup) continue;
    JsonObject o = out.add<JsonObject>(); o["ssid"] = ss; o["rssi"] = WiFi.RSSI(i); o["lock"] = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
  }
  WiFi.scanDelete();
  if (!scanRadioWas && !wf.started) WiFi.mode(WIFI_OFF);
  return n;
}
static void wifiScanAbort() { WiFi.scanDelete(); if (!scanRadioWas && !wf.started) WiFi.mode(WIFI_OFF); }
static void wifiStatusJson(JsonDocument& r) {
  r["state"] = wifiStateName(); r["ssid"] = wf.ssid; r["on"] = wf.on;
  if (wifiConnected()) { r["ip"] = WiFi.localIP().toString(); r["rssi"] = WiFi.RSSI(); r["ch"] = WiFi.channel(); }
  else if (wf.reason) r["reason"] = wifiReasonName();                // 1.18.2: why the last attempt failed (wifiReasonName)
  if (wf.retryAt && !wifiConnected()) r["retry"] = (uint32_t)((int32_t)(wf.retryAt - millis()) > 0 ? (wf.retryAt - millis()) / 1000 : 0);
  r["time"] = wf.timeSet; r["heap"] = internalFree() / 1024;
}


/* ---------- Wake-on-LAN (1.17.0): turn computers on from the deck ----------
   Each desktop app registers its computer's wired network card (name + MAC, NVS "vdwol", up to 3). "Bilgisayarı aç"
   sends the magic packet (6 x FF, 16 x MAC) over Wi-Fi to the LAN broadcast, ports 9 and 7, three times. Works from
   sleep and from full shutdown when the BIOS / network card allow it; a sleeping computer on the USB cable is
   also woken with USB remote wakeup (Hid.h usbWake). */
struct WolTarget { char name[25]; uint8_t mac[6]; };
static WolTarget wolT[3]; static uint8_t wolN = 0;
static void wolLoad() {
  Preferences pr; if (!pr.begin("vdwol", true)) return;
  size_t n = pr.getBytesLength("t"); if (n % sizeof(WolTarget) == 0 && n <= sizeof wolT) { pr.getBytes("t", wolT, n); wolN = n / sizeof(WolTarget); }
  pr.end();
}
static void wolSave() {
  Preferences pr; if (!pr.begin("vdwol", false)) return;
  if (wolN) pr.putBytes("t", wolT, wolN * sizeof(WolTarget)); else pr.remove("t");
  pr.end();
}
static bool wolParseMac(const char* s, uint8_t m[6]) {
  int v[6]; char c; if (!s) return false;
  if (sscanf(s, "%2x%c%2x%*c%2x%*c%2x%*c%2x%*c%2x", &v[0], &c, &v[1], &v[2], &v[3], &v[4], &v[5]) != 7 || (c != ':' && c != '-')) return false;
  for (int i = 0; i < 6; i++) m[i] = v[i];
  return (m[0] | m[1] | m[2] | m[3] | m[4] | m[5]) != 0 && (m[0] & 1) == 0;   // not empty, not multicast
}
static String wolMacText(const uint8_t m[6]) { char b[18]; snprintf(b, sizeof b, "%02X:%02X:%02X:%02X:%02X:%02X", m[0], m[1], m[2], m[3], m[4], m[5]); return b; }
// same name or same card: replace; otherwise add, dropping the oldest when full
static void wolAdd(const String& name, const uint8_t mac[6]) {
  int at = -1;
  for (int i = 0; i < wolN; i++) if (!strncmp(wolT[i].name, name.c_str(), 24) || !memcmp(wolT[i].mac, mac, 6)) { at = i; break; }
  if (at < 0) { if (wolN == 3) { memmove(wolT, wolT + 1, 2 * sizeof(WolTarget)); wolN = 2; } at = wolN++; }
  memset(&wolT[at], 0, sizeof(WolTarget)); strncpy(wolT[at].name, name.c_str(), 24);
  if (name.length() > 24) { int k = 24; while (k > 0 && ((uint8_t)name[k] & 0xC0) == 0x80) k--; wolT[at].name[k] = 0; }   // no half UTF-8 letter
  memcpy(wolT[at].mac, mac, 6);
  wolSave();
}
static bool wolRemove(const String& name) {
  for (int i = 0; i < wolN; i++) if (!strcmp(wolT[i].name, name.c_str())) {
    memmove(wolT + i, wolT + i + 1, (wolN - i - 1) * sizeof(WolTarget)); wolN--; wolSave(); return true;
  }
  return false;
}
// -1 no Wi-Fi connection, -2 no computer registered, else the number of computers the packet went to
static int wolSend() {
  if (!wolN) return -2;
  if (!wifiConnected()) return -1;
  WiFiUDP u; uint8_t pkt[102];
  IPAddress bc = WiFi.broadcastIP(), all(255, 255, 255, 255);
  for (int rep = 0; rep < 3; rep++) {
    for (int i = 0; i < wolN; i++) {
      memset(pkt, 0xFF, 6); for (int k = 0; k < 16; k++) memcpy(pkt + 6 + k * 6, wolT[i].mac, 6);
      for (IPAddress ip : { bc, all }) for (uint16_t port : { (uint16_t)9, (uint16_t)7 }) { u.beginPacket(ip, port); u.write(pkt, sizeof pkt); u.endPacket(); }
    }
    delay(30);
  }
  return wolN;
}
