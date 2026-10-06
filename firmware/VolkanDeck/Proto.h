#pragma once
#include "mbedtls/base64.h"
#include "esp32-hal-tinyusb.h"

static const size_t LINEBUF_MAX = 128 * 1024;
static void ecoSuspend();
static uint32_t transferAt = 0;
static volatile bool usbPartial = false;
static File animUp; static size_t animBytes = 0, animGot = 0; static int animW = 0, animH = 0, animN = 0, animFpsIn = 15; static bool animUpLight = false;
bool configChangedFlag = false;
uint32_t rxBytes = 0, rxLines = 0;
static void* bigAlloc(size_t n) { void* p = psramFound() ? ps_malloc(n) : nullptr; if (!p) p = malloc(n); return p; }      // main applies side effects
String pendingName;
uint32_t companionAt = 0; bool companionNew = false, companionMediaLaunch = false;
bool mediaDirty = false; uint32_t sysLocalAt = 0;
bool mailNew = false;

// Two transports carry the same JSON lines: USB serial and the Bluetooth data channel (Hid.h).
// Replies go back where the command came from; events go to the desktop app's link (USB first).
enum Src : uint8_t { SRC_USB = 0, SRC_BLE };
uint32_t companionUsbAt = 0, companionBleAt = 0;
static int8_t replySrc = -1;                         // set while a command is handled
static bool bleHostOn() { return bleHostConn != BLE_HS_CONN_HANDLE_NONE; }
static bool usbCompanion() { return companionUsbAt && millis() - companionUsbAt < 6000 && Serial; }
static bool bleCompanion() { return companionBleAt && millis() - companionBleAt < 6000 && bleHostOn(); }
static bool companionOn() { return usbCompanion() || bleCompanion(); }
static bool hostListening() { return Serial || bleHostOn(); }   // something may read events
static uint8_t eventSrc() { return usbCompanion() || (Serial && !bleCompanion()) ? SRC_USB : SRC_BLE; }

const char* linkName();

// Bluetooth sending runs on its own task: the main loop (screen, knob) never waits for the radio,
// and the NimBLE host task is never blocked by us, so its buffers keep draining.
struct TxItem { char* p; size_t n; };
static QueueHandle_t bleTxQ = nullptr;
static void bleTxTask(void*) {
  TxItem it;
  for (;;) {
    if (xQueueReceive(bleTxQ, &it, portMAX_DELAY) != pdTRUE) continue;
    uint16_t conn = bleHostConn;
    size_t chunk = bleHostMtu > 23 ? min<size_t>(bleHostMtu - 3, 244) : 20;
    for (size_t i = 0; i < it.n && bleTx && bleHostConn == conn; ) {
      size_t k = min(chunk, it.n - i);
      if (bleTx->notify((const uint8_t*)it.p + i, k, conn)) { i += k; continue; }
      int tries = 0;
      while (!bleTx->notify((const uint8_t*)it.p + i, k, conn) && bleHostConn == conn && ++tries < 400) vTaskDelay(pdMS_TO_TICKS(5));
      if (tries >= 400) break;                       // link stuck for 2 s: drop the rest of this line
      i += k;
    }
    free(it.p);
  }
}
static void sendJson(JsonDocument& d) {   // replies: always write (host just talked to us)
  uint8_t to = replySrc >= 0 ? replySrc : eventSrc();
  if (to == SRC_USB) { serializeJson(d, Serial); Serial.print('\n'); return; }
  if (!bleTxQ || !bleHostOn()) return;
  size_t n = measureJson(d);
  TxItem it; it.p = (char*)bigAlloc(n + 2); if (!it.p) return;
  serializeJson(d, it.p, n + 1); it.p[n] = '\n'; it.n = n + 1;
  if (xQueueSend(bleTxQ, &it, 0) != pdTRUE) free(it.p);   // queue full: drop (events are refreshed anyway)
}
static void replyOk(JsonVariantConst id) { JsonDocument r; r["id"] = id; r["ok"] = true; sendJson(r); }
static void replyErr(JsonVariantConst id, const char* e) { JsonDocument r; r["id"] = id; r["ok"] = false; r["error"] = e; sendJson(r); }

static void evtInput(const char* ctl) { if (!hostListening()) return; JsonDocument d; d["evt"] = "input"; d["control"] = ctl; sendJson(d); }
static void evtSelect() {
  if (!hostListening() || items.empty()) return;
  JsonDocument d; d["evt"] = "select"; d["app"] = itemId(items[sel]); sendJson(d);
}
static void evtStatus() {
  if (!hostListening()) return;
  JsonDocument d; d["evt"] = "status"; d["fw"] = FW_VERSION; d["battery"] = batPct; d["charging"] = charging; d["link"] = linkName();
  d["rx"] = rxBytes; d["lines"] = rxLines; d["psram"] = (uint32_t)(ESP.getPsramSize() / 1024); sendJson(d);
}
static void evtLaunch(App* a) {
  JsonDocument d; d["evt"] = "launch"; d["app"] = a->id; d["name"] = a->name;
  const Launch& L = a->launch;
  d["method"] = L.method == M_SEARCH ? "search" : L.method == M_TASKBAR ? "taskbar" : L.method == M_KEY ? "key" : "run";
  d["value"] = L.value; if (L.path.length()) d["path"] = L.path; if (L.mac.length()) d["mac"] = L.mac;
  sendJson(d);
}
static void evtMedia(const char* action) {      // play_pause | next | prev | select
  JsonDocument d; d["evt"] = "media"; d["action"] = action; d["player"] = mediaTarget; sendJson(d);
}
static void evtMail(const char* action) {      // open: the user wants the mail app in front
  if (!hostListening()) return;
  JsonDocument d; d["evt"] = "mail"; d["action"] = action; sendJson(d);
}
static void evtSys(const char* key, int value) {  // vol | bright (0..100), mute / micMute (0/1)
  JsonDocument d; d["evt"] = "sys";
  if (!strcmp(key, "mute") || !strcmp(key, "micMute")) d[key] = value != 0; else d[key] = value;
  sendJson(d);
}

static size_t b64decode(const char* src, uint8_t* dst, size_t cap) {
  size_t olen = 0;
  if (mbedtls_base64_decode(dst, cap, &olen, (const unsigned char*)src, strlen(src)) != 0) return 0;
  return olen;
}

static void handleLine(char* buf, size_t len) {
  JsonDocument doc;
  if (deserializeJson(doc, buf, len)) { JsonDocument r; r["ok"] = false; r["error"] = "json"; sendJson(r); return; }
  JsonVariantConst id = doc["id"];
  const char* cmd = doc["cmd"] | "";
  // Transfers suspend eco without counting desktop traffic as a user touch.
  if (!strcmp(cmd, "set_config") || !strcmp(cmd, "icon_set") || !strncmp(cmd, "anim_", 5) || !strcmp(cmd, "dfu")) { ecoSuspend(); transferAt = millis() | 1; }
  // Two computers at once (one on USB, one on Bluetooth): the USB one feeds the screen
  if (replySrc == SRC_BLE && usbCompanion() &&
      (!strcmp(cmd, "stats") || !strcmp(cmd, "media") || !strcmp(cmd, "media_art") || !strcmp(cmd, "sys") || !strcmp(cmd, "mail"))) {
    if (!id.isNull()) replyOk(id);
    return;
  }

  if (!strcmp(cmd, "hello")) {
    JsonDocument r; r["id"] = id; r["ok"] = true; r["fw"] = FW_VERSION; r["name"] = S.name;
    r["battery"] = batPct; r["charging"] = charging; r["link"] = linkName(); r["psram"] = (uint32_t)(ESP.getPsramSize() / 1024);
    r["via"] = replySrc == SRC_BLE ? "ble" : "usb"; if (replySrc == SRC_BLE) r["mtu"] = bleHostMtu;
    r["anim"] = anim.frames; r["animLight"] = animLight.frames;   // frames stored per theme (0: none)
    sendJson(r);
  }
  else if (!strcmp(cmd, "get_config")) {
    JsonDocument c;
    if (!loadConfigFile(c)) deserializeJson(c, DEFAULT_CONFIG);
    c.remove("sensors");                           // pre-1.4.0 Wi-Fi settings (with the password) are never sent back
    JsonDocument r; r["id"] = id; r["ok"] = true; r["config"] = c; sendJson(r);
  }
  else if (!strcmp(cmd, "set_config")) {
    JsonObject c = doc["config"];
    if (c.isNull() || !c["apps"].is<JsonArray>()) { replyErr(id, "bad_config"); return; }
    c.remove("sensors");                           // old settings pages may still send it; nothing reads it any more
    size_t n = saveConfig(c);
    if (!n) { replyErr(id, "fs"); return; }
    String oldName = S.name;
    applyConfig(c);
    pruneIcons();
    if (S.name != oldName) pendingName = S.name;
    configChangedFlag = true;
    JsonDocument r; r["id"] = id; r["ok"] = true; r["bytes"] = n; sendJson(r);
  }
  else if (!strcmp(cmd, "launch")) {
    Launch L; parseLaunch(doc["launch"], L);
    if (runLaunch(L, L.value)) replyOk(id); else replyErr(id, "no_host");
  }
  else if (!strcmp(cmd, "icon_set")) {
    String aid = (const char*)(doc["app"] | "");
    const char* data = doc["data"] | "";
    static uint8_t tmp[3300];
    size_t n = b64decode(data, tmp, sizeof(tmp));
    if (n != 3200 || !aid.length()) { replyErr(id, "bad_icon"); return; }
    LittleFS.mkdir("/icons");
    File f = LittleFS.open("/icons/" + aid + ".bin", "w");
    if (!f) { replyErr(id, "fs"); return; }
    f.write(tmp, 3200); f.close();
    App* a = appById(aid);
    if (a) { if (!a->pix) a->pix = (uint16_t*)bigAlloc(3200); if (a->pix) memcpy(a->pix, tmp, 3200); a->img = true; }
    replyOk(id);
  }
  else if (!strcmp(cmd, "anim_begin")) {            // written straight to flash (/anim.tmp), no big RAM buffer needed
    animUpLight = !strcmp(doc["slot"] | "dark", "light");   // 1.7.0: separate animation for the light theme
    animW = doc["w"] | 0; animH = doc["h"] | 0; animN = doc["frames"] | 0; animFpsIn = doc["fps"] | 15;
    size_t bytes = doc["bytes"] | 0;
    if (animW != 128 || animH != 128 || animN < 1 || animN > 60 || bytes != (size_t)animW * animH * 2 * animN) { replyErr(id, "bad_size"); return; }
    if (animUp) animUp.close();
    LittleFS.remove("/anim.tmp");
    animUp = LittleFS.open("/anim.tmp", "w");
    if (!animUp) { replyErr(id, "fs"); return; }
    JsonArrayConst dl = doc["delays"];               // optional per-frame durations (ms), the GIF's own timing
    bool hasDl = dl.size() == (size_t)animN;
    uint8_t hd[12] = { 'V','D','A','N', (uint8_t)animW, (uint8_t)(animW >> 8), (uint8_t)animH, (uint8_t)(animH >> 8), (uint8_t)animN, (uint8_t)(animN >> 8), (uint8_t)animFpsIn, (uint8_t)(hasDl ? 1 : 0) };
    animUp.write(hd, 12);
    if (hasDl) for (JsonVariantConst v : dl) { uint16_t ms = constrain(v.as<int>(), 20, 60000); uint8_t b[2] = { (uint8_t)ms, (uint8_t)(ms >> 8) }; animUp.write(b, 2); }
    animBytes = bytes; animGot = 0;
    replyOk(id);
  }
  else if (!strcmp(cmd, "anim_data")) {
    size_t off = doc["off"] | 0; const char* data = doc["data"] | "";
    if (!animUp) { replyErr(id, "no_begin"); return; }
    if (off != animGot) { replyErr(id, "bad_offset"); return; }
    static uint8_t chunk[8192];
    size_t n = b64decode(data, chunk, sizeof(chunk));
    if (!n || animGot + n > animBytes) { replyErr(id, "bad_data"); return; }
    if (animUp.write(chunk, n) != n) { animUp.close(); replyErr(id, "fs_full"); return; }
    animGot += n;
    replyOk(id);
  }
  else if (!strcmp(cmd, "anim_end")) {
    if (!animUp) { replyErr(id, "no_begin"); return; }
    animUp.close();
    if (animGot != animBytes) { LittleFS.remove("/anim.tmp"); replyErr(id, "incomplete"); return; }
    Anim& A = animSlot(animUpLight);
    unloadAnim(A);
    LittleFS.remove(A.path);
    if (!LittleFS.rename("/anim.tmp", A.path)) { replyErr(id, "fs"); return; }
    if (!loadAnim(A)) { replyErr(id, "load"); return; }
    persistAnimChoice(animUpLight ? 0 : animFpsIn);  // the speed setting belongs to the dark slot
    configChangedFlag = true;
    JsonDocument r; r["id"] = id; r["ok"] = true; r["mode"] = A.buf ? "ram" : "flash"; r["slot"] = animUpLight ? "light" : "dark"; sendJson(r);
  }
  else if (!strcmp(cmd, "anim_clear")) {          // remove one slot; the other one is then used for both themes
    Anim& A = animSlot(!strcmp(doc["slot"] | "light", "light"));
    unloadAnim(A); LittleFS.remove(A.path);
    configChangedFlag = true;
    replyOk(id);
  }
  else if (!strcmp(cmd, "companion")) {           // heartbeat from the desktop app (every ~2 s)
    if (!companionOn()) companionNew = true;
    companionMediaLaunch = doc["mediaLaunch"] | false;
    companionAt = millis();
    if (replySrc == SRC_BLE) companionBleAt = companionAt; else companionUsbAt = companionAt;
    const char* os = doc["os"] | "";
    if (*os) S.hostMac = !strcmp(os, "mac");
    if (doc["ack"] | false) { JsonDocument r; r["id"] = id; r["ok"] = true; r["fw"] = FW_VERSION; sendJson(r); }
  }
  else if (!strcmp(cmd, "stats")) parseStats(doc.as<JsonObjectConst>());   // home-screen widgets, pushed by the desktop app (no reply)
  else if (!strcmp(cmd, "media")) {              // now playing, pushed by the desktop app
    String key = (const char*)(doc["artKey"] | "");
    if (key != media.artKey || media.player != (doc["player"] | "") || media.title != (doc["title"] | "") || media.artist != (doc["artist"] | "")) media.hasArt = false;
    media.artKey = key;
    media.player = (const char*)(doc["player"] | ""); media.name = (const char*)(doc["name"] | "");
    media.title = (const char*)(doc["title"] | ""); media.artist = (const char*)(doc["artist"] | "");
    media.playing = doc["playing"] | false; media.appCtl = !strcmp(doc["ctl"] | "keys", "app");
    media.pos = doc["pos"] | -1.0f; media.dur = doc["dur"] | -1.0f; media.posAt = millis();
    media.stamp = millis() | 1; mediaDirty = true;
  }
  else if (!strcmp(cmd, "media_art")) {
    const char* key = doc["key"] | "";
    if (!*key) { media.hasArt = false; mediaDirty = true; replyOk(id); return; }
    static uint8_t tmp[8192];
    if ((doc["w"] | 0) != 64 || (doc["h"] | 0) != 64 || b64decode(doc["data"] | "", tmp, sizeof(tmp)) != sizeof(tmp)) { replyErr(id, "bad_art"); return; }
    if (!media.art) media.art = (uint16_t*)bigAlloc(sizeof(tmp));
    if (!media.art) { replyErr(id, "bad_art"); return; }
    memcpy(media.art, tmp, sizeof(tmp)); media.artKey = key; media.hasArt = true; mediaDirty = true; replyOk(id);
  }
  else if (!strcmp(cmd, "sys")) {                // volume / brightness, pushed by the desktop app
    uint32_t now = millis();
    JsonVariantConst v = doc["vol"], b = doc["bright"];
    if (now - sysLocalAt > 1500) {               // the user is turning the knob: keep the local value
      sysSt.vol = v.isNull() ? -1 : v.as<int>(); sysSt.bright = b.isNull() ? -1 : b.as<int>();
      sysSt.mute = doc["mute"] | false;
      JsonVariantConst mm = doc["micMute"]; sysSt.mic = mm.isNull() ? -1 : (mm.as<bool>() ? 1 : 0);
    }
    sysSt.stamp = now | 1; mediaDirty = true;
  }
  else if (!strcmp(cmd, "mail")) {               // new mail note, pushed by the desktop app; "ms":0 removes it
    uint32_t ms = constrain(doc["ms"] | 10000, 0, 120000);
    if (!ms) mailNote.until = 0;
    else {
      mailNote.subject = (const char*)(doc["subject"] | "");
      mailNote.unread = doc["unread"] | -1; mailNote.fresh = max(1, doc["new"] | 1);
      mailNote.wrapped = false; mailNote.at = millis(); mailNote.ms = ms; mailNote.until = (mailNote.at + ms) | 1;
      mailNew = true;
    }
    if (!id.isNull()) replyOk(id);
  }
  else if (!strcmp(cmd, "dfu")) {
    if (replySrc == SRC_BLE) { replyErr(id, "usb_only"); return; }
    replyOk(id); Serial.flush(); delay(200);
    usb_persist_restart(RESTART_BOOTLOADER);
  }
  else if (!strcmp(cmd, "restart")) { replyOk(id); delay(200); ESP.restart(); }
  else replyErr(id, "unknown_cmd");
}

struct LineItem { char* p; size_t n; uint8_t src; };
static QueueHandle_t lineQ = nullptr;

// Reads USB serial on its own task so drawing the screen never stalls input.

static void serialTask(void*) {
  size_t cap = psramFound() ? LINEBUF_MAX : 24 * 1024;
  char* buf = (char*)bigAlloc(cap);
  while (!buf) { vTaskDelay(100); buf = (char*)bigAlloc(cap = 16 * 1024); } // also fits a 64x64 media_art line
  size_t len = 0;
  for (;;) {
    int n = Serial.available();
    if (n <= 0) { vTaskDelay(1); continue; }
    while (n-- > 0) {
      int c = Serial.read(); if (c < 0) break;
      rxBytes++;
      if (c == '\n') {
        if (len) {
          rxLines++;
          LineItem it; it.p = (char*)bigAlloc(len + 1); it.n = len; it.src = SRC_USB;
          if (it.p) { memcpy(it.p, buf, len); it.p[len] = 0; xQueueSend(lineQ, &it, portMAX_DELAY); }
        }
        len = 0;
      } else if (c != '\r' && len < cap - 1) buf[len++] = (char)c;
      usbPartial = len != 0;
    }
  }
}

// Bluetooth data channel: called on the NimBLE host task with each written chunk
static char* bleBuf = nullptr; static size_t bleLen = 0, bleCap = 0;
static void bleRx(const uint8_t* p, size_t n) {
  if (bleRxReset) { bleRxReset = false; bleLen = 0; }
  if (!bleBuf) { bleCap = psramFound() ? LINEBUF_MAX : 24 * 1024; bleBuf = (char*)bigAlloc(bleCap); if (!bleBuf) return; }
  for (size_t i = 0; i < n; i++) {
    char c = (char)p[i]; rxBytes++;
    if (c == '\n') {
      if (bleLen) {
        rxLines++;
        LineItem it; it.p = (char*)bigAlloc(bleLen + 1); it.n = bleLen; it.src = SRC_BLE;
        if (it.p) { memcpy(it.p, bleBuf, bleLen); it.p[bleLen] = 0; if (xQueueSend(lineQ, &it, 0) != pdTRUE) free(it.p); }   // never block the BLE host task
      }
      bleLen = 0;
    } else if (c != '\r' && bleLen < bleCap - 1) bleBuf[bleLen++] = c;
  }
}

static void protoBegin() {
  Serial.setRxBufferSize(8192);
  lineQ = xQueueCreate(24, sizeof(LineItem));
  bleTxQ = xQueueCreate(24, sizeof(TxItem));
  xTaskCreatePinnedToCore(bleTxTask, "bletx", 4096, nullptr, 2, nullptr, 0);
  bleRxHook = bleRx;
  xTaskCreatePinnedToCore(serialTask, "ser", 4096, nullptr, 3, nullptr, 0);
}

static void protoPoll() {
  LineItem it;
  while (lineQ && xQueueReceive(lineQ, &it, 0) == pdTRUE) { replySrc = it.src; handleLine(it.p, it.n); replySrc = -1; free(it.p); }
}

static bool protoTransferBusy() {
  return animUp || configChangedFlag || usbPartial || bleLen || (lineQ && uxQueueMessagesWaiting(lineQ)) || (transferAt && millis() - transferAt < 1000);
}
