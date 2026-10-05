#pragma once
#include <WiFi.h>
#include <HTTPClient.h>

struct Temps {
  volatile float cpu = NAN, gpu = NAN, cpuLoad = NAN, gpuLoad = NAN;
  volatile uint32_t stamp = 0;   // millis of last good read
  String cpuName, gpuName, err;
} temps;

SemaphoreHandle_t sensMux;
volatile bool sensCfgChanged = true, sensKick = false, sensBusy = false;
String sHost, sSsid, sPass, sCpu, sGpu; int sPort = 8085, sInterval = 2;

static void sensorsConfigure() {
  xSemaphoreTake(sensMux, portMAX_DELAY);
  sHost = S.host; sSsid = S.ssid; sPass = S.pass; sCpu = S.cpuSensor; sGpu = S.gpuSensor;
  sPort = S.port; sInterval = S.interval; sensCfgChanged = true;
  xSemaphoreGive(sensMux);
}

static bool findValue(const String& b, const String& name, bool wantTemp, float& out) {
  if (!name.length()) return false;
  String key = "\"" + name + "\"";
  int pos = 0;
  while ((pos = b.indexOf(key, pos)) >= 0) {
    int tpos = b.lastIndexOf("\"Text\"", pos);
    pos += key.length();
    if (tpos < 0 || pos - tpos > 12 + (int)key.length()) continue;
    int v = b.indexOf("\"Value\"", pos);
    if (v < 0 || v - pos > 200) continue;
    v = b.indexOf('"', v + 7); if (v < 0) return false; v++;
    int e = b.indexOf('"', v); if (e < 0) return false;
    String s = b.substring(v, e); s.trim();
    bool ok = wantTemp ? (s.endsWith("C") && s.indexOf("Hz") < 0) : s.endsWith("%");
    if (ok) { s.replace(",", "."); out = s.toFloat(); return true; }
  }
  return false;
}

static bool fetchSensors(const String& sHost, int sPort, const String& sCpu, const String& sGpu) {
  if (!sHost.length()) { temps.err = "host"; return false; }
  if (WiFi.status() != WL_CONNECTED) { temps.err = "wifi"; return false; }
  HTTPClient http;
  http.setTimeout(4000);
  String url = "http://" + sHost + ":" + String(sPort) + "/data.json";
  if (!http.begin(url)) { temps.err = "url"; return false; }
  int code = http.GET();
  if (code != 200) { temps.err = "http_" + String(code); http.end(); return false; }
  String body = http.getString();
  http.end();
  float v;
  const char* cpuNames[] = { "", "CPU Package", "Core Max", "Core Average", "Core (Tctl/Tdie)", "CPU Core" };
  const char* gpuNames[] = { "", "GPU Core", "GPU Hot Spot" };
  bool c = false, g = false; String cpuN, gpuN;
  for (auto n : cpuNames) { String nn = *n ? String(n) : sCpu; if (findValue(body, nn, true, v)) { temps.cpu = v; cpuN = nn; c = true; break; } }
  for (auto n : gpuNames) { String nn = *n ? String(n) : sGpu; if (findValue(body, nn, true, v)) { temps.gpu = v; gpuN = nn; g = true; break; } }
  if (findValue(body, "CPU Total", false, v)) temps.cpuLoad = v;
  if (findValue(body, "GPU Core", false, v)) temps.gpuLoad = v;
  if (!c && !g) { temps.err = "not_found"; return false; }
  xSemaphoreTake(sensMux, portMAX_DELAY); temps.cpuName = cpuN; temps.gpuName = gpuN; xSemaphoreGive(sensMux);
  temps.err = ""; temps.stamp = millis();
  return true;
}

static void sensorTask(void*) {
  uint32_t last = 0, wifiTry = 0;
  for (;;) {
    xSemaphoreTake(sensMux, portMAX_DELAY);
    bool changed = sensCfgChanged; sensCfgChanged = false;
    String ssid = sSsid, pass = sPass, host = sHost, cs = sCpu, gs = sGpu; int interval = sInterval, port = sPort;
    xSemaphoreGive(sensMux);
    if (changed) {
      WiFi.disconnect(true);
      if (ssid.length()) { WiFi.mode(WIFI_STA); WiFi.setHostname("volkan-deck"); WiFi.begin(ssid.c_str(), pass.c_str()); wifiTry = millis(); }
      else WiFi.mode(WIFI_OFF);
    }
    if (ssid.length() && WiFi.status() != WL_CONNECTED && millis() - wifiTry > 15000) { WiFi.reconnect(); wifiTry = millis(); }
    if (ssid.length() && (sensKick || millis() - last >= (uint32_t)interval * 1000)) {
      sensBusy = true;
      fetchSensors(host, port, cs, gs);
      sensBusy = false; sensKick = false;
      last = millis();
    }
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

static void sensorsBegin() {
  sensMux = xSemaphoreCreateMutex();
  sensorsConfigure();
  xTaskCreatePinnedToCore(sensorTask, "sens", 8192, nullptr, 1, nullptr, 0);
}
