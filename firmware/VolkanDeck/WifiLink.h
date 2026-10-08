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

struct WifiState {
  String ssid;
  bool on = false;            // user wants it on (saved)
  bool started = false;       // radio initialised
  bool failed = false;        // last attempt timed out / wrong password
  uint32_t tryAt = 0;         // last connect attempt
  bool timeSet = false;       // NTP answered
  bool noMem = false;         // not started: too little RAM (no PSRAM)
  bool dirty = false;
};
WifiState wf;

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
static void wifiStart() {
  if (!wf.ssid.length()) return;
  if (!wf.started && internalFree() < WIFI_MIN_HEAP + 20 * 1024 && wifiMakeRoom) wifiMakeRoom();
  if (!wf.started && internalFree() < WIFI_MIN_HEAP) { wf.noMem = true; wf.dirty = true; return; }
  wf.noMem = false;
  Preferences pr; String pass;
  if (pr.begin("vdwifi", true)) { pass = pr.getString("pass", ""); pr.end(); }
  if (!wf.started) {
    WiFi.persistent(false);                   // our own NVS keeps the credentials
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(true);                      // modem sleep: needed while Bluetooth runs
    WiFi.setAutoReconnect(true);
    wf.started = true;
  }
  WiFi.disconnect(false, false);
  WiFi.begin(wf.ssid.c_str(), pass.length() ? pass.c_str() : nullptr);
  configTime(0, 0, "pool.ntp.org", "time.google.com");   // UTC into the chip clock; Stats.h adds clockTz
  wf.failed = false; wf.tryAt = millis() | 1; wf.dirty = true;
}
static void wifiStop() {
  if (wf.started) { WiFi.disconnect(true, false); WiFi.mode(WIFI_OFF); wf.started = false; }
  wf.failed = false; wf.dirty = true;
}
static void wifiSave() {
  Preferences pr; if (pr.begin("vdwifi", false)) { pr.putString("ssid", wf.ssid); pr.putBool("on", wf.on); pr.end(); }
}
static void wifiBegin() {
  Preferences pr;
  if (pr.begin("vdwifi", true)) { wf.ssid = pr.getString("ssid", ""); wf.on = pr.getBool("on", false); pr.end(); }
  if (wf.on && wf.ssid.length()) wifiStart();
}
static void wifiSet(const String& ssid, const String& pass) {
  Preferences pr; if (pr.begin("vdwifi", false)) { pr.putString("ssid", ssid); pr.putString("pass", pass); pr.putBool("on", true); pr.end(); }
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
  wf.ssid = ""; wf.on = false; wf.timeSet = false; wf.noMem = false; wf.dirty = true;
}
// called from the main loop: attempt timeout, NTP time into the clock, screen refresh on changes
static void wifiPoll() {
  static wl_status_t last = WL_IDLE_STATUS;
  if (!wf.started) return;
  uint32_t now = millis();
  wl_status_t s = WiFi.status();
  if (s != last) { last = s; wf.dirty = true; if (s == WL_CONNECTED) wf.failed = false; }
  if (s != WL_CONNECTED && !wf.failed && wf.tryAt && now - wf.tryAt > 20000) { wf.failed = true; wf.dirty = true; }
  if (s != WL_CONNECTED && wf.failed && now - wf.tryAt > 60000) wifiStart();   // try again every minute
  // NTP sets the chip clock itself (configTime); Stats.h localTime reads it while the desktop app is away
  if (s == WL_CONNECTED && !wf.timeSet && time(nullptr) > 1700000000) { wf.timeSet = true; wf.dirty = true; }
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
  if (!was) { WiFi.mode(WIFI_STA); WiFi.setSleep(true); }
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
  if (wifiConnected()) { r["ip"] = WiFi.localIP().toString(); r["rssi"] = WiFi.RSSI(); }
  r["time"] = wf.timeSet; r["heap"] = internalFree() / 1024;
}
