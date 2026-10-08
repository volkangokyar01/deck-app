#pragma once
#include <time.h>

/* ---------- home-screen widget data, pushed by the desktop app ({"cmd":"stats"}, firmware 1.4.0) ----------
   Each group replaces its previous values; every field may be null (NAN / "" here = unknown, drawn as "-").
   Staleness: cpu / gpu / net older than 5 s, weather / fx older than 2 h; the clock needs one "time" first. */
struct Hist {                                   // last 40 samples for the trend lines
  float v[40]; uint8_t n = 0;
  void push(float x) { if (n < 40) v[n++] = x; else { memmove(v, v + 1, 39 * sizeof(float)); v[39] = x; } }
};
struct PcStat { String name; float temp = NAN, load = NAN, power = NAN, clock = NAN, fan = NAN, vram = NAN, vramTotal = NAN; uint32_t at = 0; };
struct Stats {
  PcStat cpu, gpu;
  struct { float down = NAN, up = NAN, ping = NAN; uint32_t at = 0; } net;
  struct { String city; float temp = NAN, hi = NAN, lo = NAN, rain = NAN; int code = -1; uint32_t at = 0; } wx;
  struct { float usd = NAN, eur = NAN, usdChg = NAN, eurChg = NAN; uint32_t at = 0; } fx;
  int64_t epoch = 0; int32_t tz = 0; uint32_t timeAt = 0;   // UTC seconds + local offset, at millis() timeAt
  Hist cpuT, gpuT, netD;
} st;
bool statsDirty = false;

static bool fresh(uint32_t at, uint32_t ms) { return at && millis() - at < ms; }
static bool cpuFresh() { return fresh(st.cpu.at, 5000); }
static bool gpuFresh() { return fresh(st.gpu.at, 5000); }
static bool netFresh() { return fresh(st.net.at, 5000); }
static bool wxFresh() { return fresh(st.wx.at, 2 * 3600000UL); }
static bool fxFresh() { return fresh(st.fx.at, 2 * 3600000UL); }

// local time, kept running from millis() between "time" updates
void (*tzHook)(int32_t) = nullptr;
static bool localTime(struct tm& t) {
  if (!st.timeAt) return false;
  time_t s = (time_t)(st.epoch + st.tz + (int64_t)((millis() - st.timeAt) / 1000));
  gmtime_r(&s, &t);
  return true;
}

static float num(JsonVariantConst v) { return v.is<float>() ? v.as<float>() : NAN; }

static void parsePc(JsonObjectConst o, PcStat& p, Hist& h) {
  p.name = (const char*)(o["name"] | "");
  p.temp = num(o["temp"]); p.load = num(o["load"]); p.power = num(o["power"]); p.clock = num(o["clock"]);
  p.fan = num(o["fan"]); p.vram = num(o["vram"]); p.vramTotal = num(o["vramTotal"]);
  p.at = millis() | 1;
  h.push(p.temp);
}

static void parseStats(JsonObjectConst d) {
  if (d["cpu"].is<JsonObjectConst>()) parsePc(d["cpu"], st.cpu, st.cpuT);
  if (d["gpu"].is<JsonObjectConst>()) parsePc(d["gpu"], st.gpu, st.gpuT);
  if (d["net"].is<JsonObjectConst>()) {
    JsonObjectConst o = d["net"];
    st.net.down = num(o["down"]); st.net.up = num(o["up"]); st.net.ping = num(o["ping"]); st.net.at = millis() | 1;
    st.netD.push(st.net.down);
  }
  if (d["weather"].is<JsonObjectConst>()) {
    JsonObjectConst o = d["weather"];
    st.wx.city = (const char*)(o["city"] | "");
    st.wx.temp = num(o["temp"]); st.wx.hi = num(o["hi"]); st.wx.lo = num(o["lo"]); st.wx.rain = num(o["rain"]);
    st.wx.code = o["code"].is<int>() ? o["code"].as<int>() : -1;
    st.wx.at = millis() | 1;
  }
  if (d["fx"].is<JsonObjectConst>()) {
    JsonObjectConst o = d["fx"];
    st.fx.usd = num(o["usd"]); st.fx.eur = num(o["eur"]); st.fx.usdChg = num(o["usdChg"]); st.fx.eurChg = num(o["eurChg"]);
    st.fx.at = millis() | 1;
  }
  if (d["time"].is<JsonObjectConst>() && d["time"]["epoch"].is<double>()) {
    st.epoch = (int64_t)d["time"]["epoch"].as<double>(); st.tz = (int32_t)(d["time"]["tz"] | 0.0); st.timeAt = millis() | 1;
    if (tzHook) tzHook(st.tz);                    // Wi-Fi keeps it for NTP time
  }
  statsDirty = true;
}
