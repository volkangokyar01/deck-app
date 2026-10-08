#pragma once
/* ---------- Wi-Fi (1.10.0): optional, set up from the desktop app ----------
   The radio stays off until a network is saved (NVS "vdwifi": ssid, pass, on). Connected, the deck takes
   the time from NTP, so the clock and the light / dark theme work without the computer. Everything else
   (stats, media, launch) still comes from the desktop app over USB / Bluetooth.
   Without PSRAM the Wi-Fi stack costs ~50 KB of internal RAM: it is started only when a network is set.
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
  int32_t tz = 10800;         // local offset in s, from the desktop app's last "time" (saved); Türkiye by default
  bool dirty = false;
};
WifiState wf;

static bool wifiConnected() { return wf.started && WiFi.status() == WL_CONNECTED; }
static const char* wifiStateName() {
  if (!wf.on || !wf.ssid.length()) return "off";
  if (wifiConnected()) return "connected";
  return wf.failed ? "failed" : "connecting";
}
static void wifiStart() {
  if (!wf.ssid.length()) return;
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
  configTime(0, 0, "pool.ntp.org", "time.google.com");   // UTC; the local offset comes from wf.tz
  wf.failed = false; wf.tryAt = millis() | 1; wf.dirty = true;
}
static void wifiStop() {
  if (wf.started) { WiFi.disconnect(true, false); WiFi.mode(WIFI_OFF); wf.started = false; }
  wf.failed = false; wf.dirty = true;
}
static void wifiSave() {
  Preferences pr; if (pr.begin("vdwifi", false)) { pr.putString("ssid", wf.ssid); pr.putBool("on", wf.on); pr.end(); }
}
static void wifiKeepTz(int32_t tz);
static void wifiBegin() {
  tzHook = wifiKeepTz;
  Preferences pr;
  if (pr.begin("vdwifi", true)) { wf.ssid = pr.getString("ssid", ""); wf.on = pr.getBool("on", false); wf.tz = pr.getInt("tz", 10800); pr.end(); }
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
  Preferences pr; if (pr.begin("vdwifi", false)) { int32_t tz = pr.getInt("tz", wf.tz); pr.clear(); pr.putInt("tz", tz); pr.end(); }
  wf.ssid = ""; wf.on = false; wf.timeSet = false; wf.dirty = true;
}
// the desktop app's time zone, kept for NTP time when the app is away
static void wifiKeepTz(int32_t tz) {
  if (tz == wf.tz) return;
  wf.tz = tz;
  Preferences pr; if (pr.begin("vdwifi", false)) { pr.putInt("tz", tz); pr.end(); }
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
  // NTP → clock, unless the desktop app sent the time in the last 6 hours
  static uint32_t tNtp = 0;
  if (s == WL_CONNECTED && now - tNtp > 5000) {
    tNtp = now;
    time_t t = time(nullptr);
    if (t > 1700000000 && (!st.timeAt || now - st.timeAt > 6UL * 3600000UL || !wf.timeSet)) {
      if (!st.timeAt || now - st.timeAt > 6UL * 3600000UL) { st.epoch = t; st.tz = wf.tz; st.timeAt = now | 1; statsDirty = true; }
      wf.timeSet = true;
    }
  }
}
// networks around (blocking, ~2–4 s); the radio goes back off if Wi-Fi is not in use
// returns the scan result count, < 0 when the radio could not scan (e.g. not enough memory to start Wi-Fi)
static int wifiScan(JsonArray out) {
  bool was = wf.started;
  if (!was) { WiFi.mode(WIFI_STA); WiFi.setSleep(true); }
  int n = WiFi.scanNetworks(false, false);
  for (int i = 0; i < n && out.size() < 15; i++) {
    String ss = WiFi.SSID(i); if (!ss.length()) continue;
    bool dup = false; for (JsonVariant v : out) if (ss == (const char*)(v["ssid"] | "")) dup = true;
    if (dup) continue;
    JsonObject o = out.add<JsonObject>(); o["ssid"] = ss; o["rssi"] = WiFi.RSSI(i); o["lock"] = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
  }
  WiFi.scanDelete();
  if (!was) WiFi.mode(WIFI_OFF);
  return n;
}
static void wifiStatusJson(JsonDocument& r) {
  r["state"] = wifiStateName(); r["ssid"] = wf.ssid; r["on"] = wf.on;
  if (wifiConnected()) { r["ip"] = WiFi.localIP().toString(); r["rssi"] = WiFi.RSSI(); }
  r["time"] = wf.timeSet;
}
