// Volkan Deck firmware — LilyGO T-Display-S3 app launcher
// Board: LilyGO T-Display-S3, USB Mode: USB-OTG (TinyUSB), USB CDC On Boot: Enabled
#include "Board.h"
#include "Store.h"
#include "Hid.h"
#include "Sensors.h"
#include "Ui.h"
#include "Proto.h"
#include "esp_sleep.h"

/* ---------- link name for status / protocol ---------- */
const char* linkName() {
  switch (activeLink()) { case L_USB: return "usb"; case L_BLE: return "ble"; default: return "none"; }
}

/* ---------- input ---------- */
volatile int32_t encCount = 0;
volatile uint8_t encState = 0;
static const int8_t ENC_TAB[16] = { 0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0 };
void IRAM_ATTR encISR() {
  uint8_t s = (digitalRead(PIN_ENC_CLK) << 1) | digitalRead(PIN_ENC_DT);
  encState = ((encState << 2) | s) & 0x0F;
  encCount += ENC_TAB[encState];
}

struct Btn {
  uint8_t pin; bool down = false, raw = false, longFired = false; uint32_t tChange = 0, tDown = 0;
  explicit Btn(uint8_t p) : pin(p) {}
  // returns 1 short (on release), 2 long (fires once while held), 3 released after long, 0 nothing
  int poll(uint32_t longMs) {
    bool r = digitalRead(pin) == LOW; uint32_t now = millis();
    if (r != raw) { raw = r; tChange = now; }
    if (now - tChange < 25) return 0;
    if (r && !down) { down = true; tDown = now; longFired = false; return 0; }
    if (r && down && !longFired && longMs && now - tDown >= longMs) { longFired = true; return 2; }
    if (!r && down) { down = false; return longFired ? 3 : 1; }
    return 0;
  }
};
Btn bEnc(PIN_ENC_SW), bA(PIN_BTN_A), bB(PIN_BTN_B), bPwr(PIN_KEY_PWR), bRst(PIN_KEY_RST);

/* ---------- power / screen ---------- */
uint32_t lastActivity = 0;
bool screenOff = false, dimmed = false;
int curBright = -1;

static void setBright(int pct) {
  if (pct == curBright) return;
  curBright = pct; lcd.setBrightness(pct <= 0 ? 0 : map(pct, 1, 100, 8, 255));
}

static bool wakeUp() {   // returns true if the input should be swallowed
  lastActivity = millis();
  bool was = screenOff || dimmed;
  screenOff = false; dimmed = false; setBright(S.brightness);
  return was;
}

static void readBattery() {
  static float v = 0;
  float now = analogReadMilliVolts(PIN_BAT) * 2 / 1000.0f;
  v = v == 0 ? now : v * 0.9f + now * 0.1f;
  charging = v > 4.25f;
  batPct = constrain((int)((v - 3.3f) / (4.15f - 3.3f) * 100), 0, 100);
  if (charging) batPct = 100;
}

static void goSleep() {
  spr.fillSprite(SC_BG);
  text("Kapanıyor", 160, 85, FB18, SC_SUB, textdatum_t::middle_center);
  spr.pushSprite(0, 0); delay(600);
  setBright(0);
  while (digitalRead(PIN_KEY_PWR) == LOW) delay(10);
  delay(50);
  lcd.sleep();
  digitalWrite(PIN_LCD_POWER, LOW);
  esp_sleep_enable_ext0_wakeup((gpio_num_t)PIN_KEY_PWR, 0);
  esp_deep_sleep_start();
}

/* ---------- navigation & actions ---------- */
bool dirty = true;

static void selectIndex(int i) {
  int n = items.size(); if (!n) return;
  if (S.wrap) i = (i % n + n) % n; else i = constrain(i, 0, n - 1);
  if (i != sel) { sel = i; adjust = 0; dirty = true; evtSelect(); }
}
static Item* curItem() { return items.empty() ? nullptr : &items[sel]; }
static uint8_t curKind() { Item* it = curItem(); return it ? it->kind : K_APP; }

/* ---------- media & system pages ---------- */
bool volPending = false, brightPending = false;

static void mediaAction(const char* act, uint16_t key) {
  mediaFlashAct = act; mediaFlashAt = millis(); dirty = true;
  if (mediaLive() && media.appCtl) {           // the desktop app talks to Spotify / Music / the browser directly
    evtMedia(act);
    if (!strcmp(act, "play_pause")) media.playing = !media.playing;
    return;
  }
  if (!consumerTap(key)) toast("Bilgisayara bağlı değil");   // media keys: whatever is playing on the computer
}

static void cyclePlayer() {
  static const char* order[4] = { "auto", "spotify", "music", "ytmusic" };
  int i = 0; for (int k = 0; k < 4; k++) if (mediaTarget == order[k]) i = k;
  mediaTarget = order[(i + 1) % 4];
  evtMedia("select");
  media.stamp = 0;                             // wait for the new player's info
  toast(mediaTarget == "auto" ? String("Oynatıcı: otomatik") : String(PLAYER_NAMES[i % 3]));
  dirty = true;
}

static void levelStep(bool vol, int steps) {
  int& v = vol ? sysSt.vol : sysSt.bright;
  if (sysLive() && v >= 0) {
    v = constrain(v + steps * (vol ? 2 : 5), 0, 100);
    sysLocalAt = millis();
    (vol ? volPending : brightPending) = true;
  } else {                                     // no desktop app (or value unknown): send keys
    for (int i = 0; i < abs(steps); i++) consumerTap(vol ? (steps > 0 ? CC_VOL_UP : CC_VOL_DOWN) : (steps > 0 ? CC_BRIGHT_UP : CC_BRIGHT_DOWN));
    keyFlash = steps > 0 ? 1 : -1; keyFlashWhat = vol ? 1 : 2; keyFlashAt = millis();
  }
  adjustAt = millis(); dirty = true;
}

static void toggleMute() {
  if (sysLive() && sysSt.vol >= 0) { sysSt.mute = !sysSt.mute; sysLocalAt = millis(); evtSys("mute", sysSt.mute); }
  else consumerTap(CC_MUTE);
  dirty = true;
}

static void doLaunch(App* a) {
  if (!a) return;
  const Launch& L = a->launch;
  bool direct = L.method == M_RUN || L.method == M_SEARCH || ((L.method == M_TASKBAR) && (L.path.length() || L.mac.length()));
  // apps are opened only by the desktop app (system call); no Win+R / Start / Spotlight typing unless enabled
  if (direct && !companionOn() && !S.kbFallback) { toast("Volkan Deck uygulaması açık değil"); dirty = true; return; }
  if (activeLink() == L_NONE && !companionOn()) { toast("Bilgisayara bağlı değil"); dirty = true; return; }
  bool onApp = !items.empty() && items[sel].kind == K_APP && items[sel].app == a;
  if (onApp) {
    for (int i = 0; i <= 8; i++) { launchP = i / 8.0f; render(linkName()); delay(25); }
  } else { toast(a->name + " açılıyor"); render(linkName()); }
  bool ok;
  if (companionOn() && direct) { evtLaunch(a); ok = true; }   // desktop app opens it directly, no keystrokes
  else ok = runLaunch(a->launch, a->name);
  launchP = -1;
  if (!ok) toast("Bilgisayara bağlı değil");
  dirty = true;
}

static void onPress() {
  if (items.empty()) return;
  Item& it = items[sel];
  switch (it.kind) {
    case K_HOME: { App* a = appById(S.pressApp); if (a) doLaunch(a); break; }
    case K_MEDIA: mediaAction("play_pause", CC_PLAY); break;
    case K_SYS: adjust = adjust == 1 ? 2 : 1; adjustAt = millis(); dirty = true; break;   // volume ↔ brightness
    default: doLaunch(it.app);
  }
}

static void handleInput() {
  // encoder
  int32_t c; noInterrupts(); c = encCount; interrupts();
  int steps = c / S.encDetent;
  if (steps) {
    noInterrupts(); encCount -= steps * S.encDetent; interrupts();
    if (!wakeUp()) {
      if (S.encRev) steps = -steps;
      uint8_t k = curKind();
      if (adjust && k == K_MEDIA) levelStep(true, steps);           // volume mode on the media page
      else if (adjust && k == K_SYS) levelStep(adjust == 1, steps);
      else selectIndex(sel + steps);
      evtInput(steps > 0 ? "cw" : "ccw");
    }
  }
  // double press on the media page switches the player (only when the desktop app can target one)
  static uint32_t pressPendingAt = 0;
  uint32_t now = millis();
  int e = bEnc.poll(700);
  if (e == 1) {
    if (!wakeUp()) {
      evtInput("press");
      if (curKind() == K_MEDIA && companionOn()) {
        if (pressPendingAt && now - pressPendingAt < 330) { pressPendingAt = 0; cyclePlayer(); }
        else pressPendingAt = now;
      } else onPress();
    }
  } else if (e == 2) {
    wakeUp(); pressPendingAt = 0;
    uint8_t k = curKind();
    if (k == K_MEDIA) { adjust = adjust ? 0 : 1; adjustAt = now; dirty = true; }
    else if (k == K_SYS && adjust) { adjust = 0; dirty = true; }
    else if (S.homeOn) selectIndex(0);
  }
  if (pressPendingAt && now - pressPendingAt >= 330) { pressPendingAt = 0; onPress(); }

  int a = bA.poll(0);
  if (a == 1 && !wakeUp()) {
    evtInput("a"); uint8_t k = curKind();
    if (k == K_MEDIA) mediaAction("prev", CC_PREV);
    else if (k == K_SYS) { toggleMute(); adjustAt = now; }
    else doLaunch(appById(S.quickA));
  }
  int b = bB.poll(0);
  if (b == 1 && !wakeUp()) {
    evtInput("b"); uint8_t k = curKind();
    if (k == K_MEDIA) mediaAction("next", CC_NEXT);
    else if (k == K_SYS) { adjust = adjust == 2 ? 1 : 2; adjustAt = now; dirty = true; }
    else doLaunch(appById(S.quickB));
  }

  int p = bPwr.poll(2000);
  if (p == 1) {
    if (screenOff || dimmed) wakeUp();
    else { screenOff = true; setBright(0); }
  } else if (p == 2) goSleep();

  if (bRst.poll(0) == 1) {     // act on release so BOOT is not held during reset
    spr.fillSprite(SC_BG); text("Yeniden başlatılıyor", 160, 85, FB18, SC_SUB, textdatum_t::middle_center); spr.pushSprite(0, 0);
    delay(300); ESP.restart();
  }
}

static void applySideEffects() {
  buildItems(); adjust = 0;
  mediaTarget = S.mediaPlayer;
  if (companionOn()) evtMedia("select");       // keep the desktop app on the same player
  if (sel >= (int)items.size()) sel = 0;
  lcd.setRotation(S.flip ? 3 : 1);
  if (!screenOff && !dimmed) { curBright = -1; setBright(S.brightness); }
  sensorsConfigure();
  if (S.conn != 1 && !bleStarted) bleBegin(S.name);
  if (pendingName.length()) { bleRename(pendingName); pendingName = ""; }
  dirty = true;
}

/* ---------- setup / loop ---------- */
void setup() {
  pinMode(PIN_LCD_POWER, OUTPUT); digitalWrite(PIN_LCD_POWER, HIGH);
  for (uint8_t p : { PIN_ENC_CLK, PIN_ENC_DT, PIN_ENC_SW, PIN_BTN_A, PIN_BTN_B, PIN_KEY_PWR, PIN_KEY_RST }) pinMode(p, INPUT_PULLUP);

  hidBegin();
  Serial.begin(115200);
  Serial.enableReboot(false);
  protoBegin();

  LittleFS.begin(true);
  loadConfig();
  loadAnim();
  buildItems();
  mediaTarget = S.mediaPlayer;
  if (S.homeOn) sel = 0;

  uiBegin();
  render("none");
  setBright(S.brightness);

  if (S.conn != 1) bleBegin(S.name);
  sensorsBegin();

  attachInterrupt(digitalPinToInterrupt(PIN_ENC_CLK), encISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_ENC_DT), encISR, CHANGE);
  analogReadResolution(12);
  readBattery();
  lastActivity = millis();
}

void loop() {
  protoPoll();
  if (configChangedFlag) { configChangedFlag = false; applySideEffects(); }
  if (companionNew) { companionNew = false; toast("Masaüstü uygulaması bağlı"); dirty = true; evtMedia("select"); }
  handleInput();

  uint32_t now = millis();
  static uint32_t tBat = 0, tStatus = 0, tFrame = 0, lastStamp = 0;
  static Link lastLink = L_NONE;
  if (now - tBat > 2000) { tBat = now; readBattery(); bleBattery(batPct); }
  if (now - tStatus > 5000) { tStatus = now; evtStatus(); dirty = true; }
  Link l = activeLink(); if (l != lastLink) { lastLink = l; dirty = true; evtStatus(); }

  if (temps.stamp != lastStamp) {
    lastStamp = temps.stamp;
    if (histN < 40) histN++; else for (int k = 0; k < 2; k++) memmove(hist[k], hist[k] + 1, 39 * sizeof(float));
    hist[0][histN - 1] = isnan(temps.cpu) ? 0 : temps.cpu; hist[1][histN - 1] = isnan(temps.gpu) ? 0 : temps.gpu;
    evtTemps();
    dirty = true;
  }

  // media / system pages: send level changes (throttled), leave adjust mode after a pause
  static uint32_t volSentAt = 0, brightSentAt = 0;
  if (volPending && now - volSentAt >= 60) { volPending = false; volSentAt = now; evtSys("vol", sysSt.vol); }
  if (brightPending && now - brightSentAt >= 200) { brightPending = false; brightSentAt = now; evtSys("bright", sysSt.bright); }
  if (adjust && now - adjustAt > 6000) { adjust = 0; dirty = true; }
  uint8_t kind = curKind();
  bool onPage = kind == K_MEDIA || kind == K_SYS;
  if (mediaDirty) { mediaDirty = false; if (onPage) dirty = true; }

  // idle handling
  uint32_t idle = (now - lastActivity) / 1000;
  if (S.homeOn && S.returnAfter > 0 && idle >= (uint32_t)S.returnAfter && sel != 0 && !items.empty() && items[0].home) { sel = 0; dirty = true; evtSelect(); }
  if (!screenOff && !dimmed && S.dimAfter > 0 && idle >= (uint32_t)S.dimAfter) { dimmed = true; setBright(max(5, S.brightness / 6)); }
  if (!usbMounted && S.sleepAfter > 0 && idle >= (uint32_t)S.sleepAfter) goSleep();

  bool onHome = !items.empty() && items[sel].home;
  bool animate = onHome && !screenOff && S.animKind != A_NONE;
  if (!screenOff && (dirty || (animate && now - tFrame >= 40) || (onPage && now - tFrame >= 250) || (toastUntil && now > toastUntil && now - toastUntil < 100))) {
    tFrame = now; dirty = false;
    render(linkName());
  }
  delay(2);
}
