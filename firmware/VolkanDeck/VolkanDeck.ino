// Volkan Deck firmware — LilyGO T-Display-S3 app launcher
// Board: LilyGO T-Display-S3, USB Mode: USB-OTG (TinyUSB), USB CDC On Boot: Enabled
#include "Board.h"
#include "Store.h"
#include "Hid.h"
#include "Stats.h"
#include "Ui.h"
#include "Proto.h"
#include "esp_sleep.h"
#include "esp_system.h"
#include "driver/rtc_io.h"
#include "tusb.h"

static const uint32_t OFF_MAGIC = 0x56444F46;   // VDOF; survives software / watchdog resets too
RTC_NOINIT_ATTR uint32_t offMarker;

static void offSleep() {
  offMarker = OFF_MAGIC;
  Serial.enableReboot(false); tud_disconnect();   // CDCOnBoot starts USB in the core, before setup()
  if (bleStarted) { NimBLEDevice::deinit(true); bleStarted = false; }
  // Keep both display enables low, including during deep sleep (LCD power is RTC GPIO15).
  gpio_set_direction((gpio_num_t)PIN_LCD_BL, GPIO_MODE_OUTPUT);
  gpio_set_level((gpio_num_t)PIN_LCD_BL, 0);
  gpio_hold_dis((gpio_num_t)PIN_LCD_BL);
  gpio_hold_en((gpio_num_t)PIN_LCD_BL); gpio_deep_sleep_hold_en();
  rtc_gpio_hold_dis((gpio_num_t)PIN_LCD_POWER);
  rtc_gpio_init((gpio_num_t)PIN_LCD_POWER);
  rtc_gpio_set_level((gpio_num_t)PIN_LCD_POWER, 0);
  rtc_gpio_set_direction((gpio_num_t)PIN_LCD_POWER, RTC_GPIO_MODE_OUTPUT_ONLY);
  rtc_gpio_hold_en((gpio_num_t)PIN_LCD_POWER);

  esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_ALL);   // no USB / BLE / timer wake; only BOOT low
  esp_sleep_pd_config(ESP_PD_DOMAIN_RTC_PERIPH, ESP_PD_OPTION_ON);
  rtc_gpio_hold_dis((gpio_num_t)PIN_KEY_PWR);
  rtc_gpio_init((gpio_num_t)PIN_KEY_PWR);
  rtc_gpio_set_direction((gpio_num_t)PIN_KEY_PWR, RTC_GPIO_MODE_INPUT_ONLY);
  rtc_gpio_pullup_en((gpio_num_t)PIN_KEY_PWR); rtc_gpio_pulldown_dis((gpio_num_t)PIN_KEY_PWR);
  // Require a continuous released interval, not just one HIGH sample followed by a delay.
  uint32_t releasedAt = 0; bool released = false;
  for (;;) {
    uint32_t now = millis();
    if (!rtc_gpio_get_level((gpio_num_t)PIN_KEY_PWR)) released = false;
    else if (!released) { released = true; releasedAt = now; }
    else if (now - releasedAt >= 80) break;
    delay(5);
  }
  esp_sleep_enable_ext0_wakeup((gpio_num_t)PIN_KEY_PWR, 0);
  esp_deep_sleep_start();
}

/* ---------- link name for status / protocol ---------- */
const char* linkName() {
  switch (activeLink()) { case L_USB: return "usb"; case L_BLE: return "ble"; default: return "none"; }
}

/* ---------- input ---------- */
volatile int32_t encSteps = 0;           // whole clicks, taken by handleInput()
volatile uint8_t encState = 0, encDet = 4;
volatile int8_t encAcc = 0;
static const int8_t ENC_TAB[16] = { 0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0 };
void IRAM_ATTR encISR() {
  uint8_t s = (digitalRead(PIN_ENC_CLK) << 1) | digitalRead(PIN_ENC_DT);
  encState = ((encState << 2) | s) & 0x0F;
  encAcc += ENC_TAB[encState];
  // Count only when the knob sits in a detent (both pins high; half-step knobs also rest at both low) and start
  // from zero there: a stray or missed edge can't build up and swallow the first click after a direction change.
  if (encDet <= 1 || s == 3 || (encDet == 2 && s == 0)) {
    int8_t a = encAcc, h = (encDet + 1) / 2;
    encSteps += a >= 0 ? (a + encDet - h) / encDet : -((-a + encDet - h) / encDet);
    encAcc = 0;
  }
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
bool dirty = true;

// Restore the CPU before processing inputs or heavy transfers; no sleep / USB reset.
static void ecoSuspend() {
  if (!ecoActive) return;
#if VOLKAN_ECO_CPU
  if (!setCpuFrequencyMhz(240)) return;
#endif
  ecoActive = false; dirty = true;
}
static void ecoExit() { ecoSuspend(); lastActivity = millis(); }
static void ecoEnter() {
#if VOLKAN_ECO_CPU
  if (!setCpuFrequencyMhz(80)) return;
#endif
  ecoActive = true;
}
int curBright = -1;

static void setBright(int pct) {
  if (pct == curBright) return;
  curBright = pct; lcd.setBrightness(pct <= 0 ? 0 : map(pct, 1, 100, 8, 255));
}

static bool wakeUp() {   // returns true if the input should be swallowed
  bool wasEco = ecoActive; ecoExit();
  bool was = (screenOff || dimmed) && !wasEco;
  screenOff = false; dimmed = false; setBright(S.brightness);
  return was;
}

// Battery level. On battery the cell voltage is read through a Li-Po discharge curve. On cable the charger
// lifts the measured voltage (charge current x internal resistance, then 4.2 V hold), so the voltage alone
// would say ~100%. There the level starts from the last battery reading and grows at the charge rate,
// kept between what the measured voltage allows (upper) and its IR-corrected value (lower, CC phase only).
RTC_NOINIT_ATTR static uint32_t socMagic;
RTC_NOINIT_ATTR static float socKept;          // survives software resets (update, crash) while on cable
static const uint32_t SOC_MAGIC = 0x56445343;  // VDSC

static float ocvPct(float v) {
  static const float T[][2] = { {3.30f, 0}, {3.50f, 3}, {3.60f, 8}, {3.68f, 15}, {3.73f, 25}, {3.77f, 35},
    {3.80f, 45}, {3.84f, 55}, {3.88f, 63}, {3.93f, 72}, {3.98f, 80}, {4.04f, 88}, {4.10f, 95}, {4.16f, 100} };
  const int n = sizeof(T) / sizeof(T[0]);
  if (v <= T[0][0]) return 0;
  for (int i = 1; i < n; i++)
    if (v < T[i][0]) return T[i - 1][1] + (v - T[i - 1][0]) / (T[i][0] - T[i - 1][0]) * (T[i][1] - T[i - 1][1]);
  return 100;
}

static void readBattery() {
  static float v = 0, soc = -1;
  static uint32_t tLast = 0, tPlug = 0, tUnplug = 0;
  static bool wasExt = false;
  uint32_t now = millis();
  static float vf = 0;               // fast average: sees the step when a charger starts or stops
  static bool charger = false;       // charger-only cable, found from that step
  static bool wasSusp = false;
  float raw = analogReadMilliVolts(PIN_BAT) * 2 / 1000.0f;
  float vfPrev = vf;
  v = v == 0 ? raw : v * 0.9f + raw * 0.1f;
  vf = vf == 0 ? raw : vf * 0.5f + raw * 0.5f;
  float dt = tLast ? (now - tLast) / 1000.0f : 0; tLast = now;
  // The board has no VBUS sense: pulling the cable from a computer only gives a USB "suspend", the
  // "mounted" flag stays set. So a suspended host does not count as cable, and the voltage step
  // (charge current x cell resistance) marks a charger being plugged in or pulled out.
  bool hostUsb = usbMounted && !usbSuspended;
  if (vfPrev == 0 && vf > 4.25f) charger = true;   // booted on a charger: cell above a resting Li-Po
  if (vfPrev > 0 && vf - v > BAT_STEP_V) charger = true;    // fast average jumped above the slow one
  if (vfPrev > 0 && v - vf > BAT_STEP_V) charger = false;
  if (usbSuspended && !wasSusp) charger = false;    // cable pulled from the computer
  wasSusp = usbSuspended;
  extPower = hostUsb || charger;
  if (soc < 0) {   // first reading after boot
    if (socMagic == SOC_MAGIC && socKept >= 0 && socKept <= 100) soc = socKept;
    else soc = extPower ? ocvPct(v - BAT_IR_V) : ocvPct(v);
  }
  if (extPower) {
    if (!wasExt) tPlug = now;
    float rate = BAT_CHARGE_MA * 100.0f / BAT_MAH / 3600.0f;          // %/s in the constant-current phase
    if (soc > 80) rate *= max(0.15f, (100 - soc) / 20.0f);           // tapering constant-voltage phase
    soc += rate * dt;
    float hi = v < 4.12f ? ocvPct(v) : 100;                            // terminal voltage >= rest voltage
    float lo = v < 4.12f && now - tPlug > 60000 ? ocvPct(v - BAT_IR_V) : 0;
    soc = constrain(soc, lo, hi);
    if (soc > 99.5f) soc = 100;
  } else {
    if (wasExt) tUnplug = now;
    float s = ocvPct(v);
    // after unplugging the cell relaxes for a few minutes: only let the level fall, slowly
    if (now - tUnplug < 180000 && tUnplug) { if (s < soc) soc = max(s, soc - 0.05f * dt); }
    else if (s < soc) soc = max(s, soc - 0.2f * dt);                    // follow drops, smooth load dips
    else if (s > soc + 8) soc = s;                                       // re-sync (e.g. other battery)
  }
  wasExt = extPower;
  socKept = soc; socMagic = SOC_MAGIC;
  batPct = (uint8_t)constrain((int)(soc + 0.5f), 0, 100);
  charging = extPower && batPct < 100;
}

static void goSleep() {
  offMarker = OFF_MAGIC;
  spr.fillSprite(SC_BG);
  text("Kapanıyor", 160, 85, FB18, SC_SUB, textdatum_t::middle_center);
  spr.pushSprite(0, 0); delay(600);
  setBright(0);
  lcd.sleep();
  ledcDetach(PIN_LCD_BL);
  offSleep();
}

/* ---------- navigation & actions ---------- */

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
  bool launchPlay = !strcmp(act, "play_pause") && companionOn() && companionMediaLaunch &&
                    (!mediaLive() || !media.player.length()) && (mediaTarget != "auto" || S.mediaLaunch != "none");
  if ((mediaLive() && media.appCtl) || launchPlay) {           // the desktop app talks to Spotify / Music / the browser directly
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

static void toggleMic() {      // microphone mute needs the desktop app (no standard keyboard key for it)
  if (sysLive() && sysSt.mic >= 0) { sysSt.mic = sysSt.mic ? 0 : 1; sysLocalAt = millis(); evtSys("micMute", sysSt.mic); }
  else toast(companionOn() ? "Mikrofon bulunamadı" : "Mikrofon için masaüstü uygulaması gerekli");
  dirty = true;
}
static void toggleMute() {
  if (sysLive() && sysSt.vol >= 0) { sysSt.mute = !sysSt.mute; sysLocalAt = millis(); evtSys("mute", sysSt.mute); }
  else consumerTap(CC_MUTE);
  dirty = true;
}

static String musicPlayerForApp(const App& a) {
  String text = a.name + " " + a.launch.value + " " + a.launch.path + " " + a.launch.mac;
  text.replace("Ü", "ü"); text.replace("İ", "i"); text.toLowerCase();
  if (text.indexOf("spotify") >= 0) return "spotify";
  if (text.indexOf("youtube music") >= 0 || text.indexOf("music.youtube.com") >= 0) return "ytmusic";
  if (text.indexOf("apple music") >= 0 || text.indexOf("music.app") >= 0 || text.indexOf("müzik") >= 0 || text.indexOf("muzik") >= 0 || text.indexOf("itunes") >= 0) return "music";
  return "";
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
  else if (S.mediaOn) {
    String player = musicPlayerForApp(*a);
    if (player.length()) {
      mediaTarget = player;                    // session pin, never change S.mediaPlayer / saved config
      media.stamp = 0; evtMedia("select");
      for (int i = 0; i < (int)items.size(); i++) if (items[i].kind == K_MEDIA) { selectIndex(i); break; }
    }
  }
  dirty = true;
}

/* ---------- Bağlantılar page ---------- */
static void connAct() {
  auto rows = connRows();
  if (connCur < 0 || connCur >= (int)rows.size()) return;
  const ConnRow& r = rows[connCur];
  if (r.type != CR_FORGET) connConfirmAt = 0;
  switch (r.type) {
    case CR_ALL: btSelectAll(); toast("Eşleşmiş bütün bilgisayarlar bağlanabilir"); connEdit = false; break;
    case CR_HOST: btSelect(r.a); toast(btName(r.a) + " seçildi"); connEdit = false; break;
    case CR_PAIR: btPairStart(); connEdit = false; break;
    case CR_FORGET:
      if (connConfirmAt && millis() - connConfirmAt < 4000) { connConfirmAt = 0; bleForget(); connCur = 0; connEdit = false; toast("Eşleşmeler silindi"); }
      else connConfirmAt = millis() | 1;
      break;
  }
  dirty = true;
}
static void connPress() {
  if (!bleStarted) { toast("Bluetooth kapalı: uygulamada Bağlantı → Otomatik"); dirty = true; return; }
  if (bt.off) { toast("A: Bluetooth'u aç"); dirty = true; return; }
  if (btPairing()) { btPairStop(); toast("Eşleştirme iptal"); dirty = true; return; }
  if (!connEdit) { auto rows = connRows(); connEdit = true; connCur = connActiveRow(rows); connConfirmAt = 0; connAt = millis(); dirty = true; return; }
  connAt = millis(); connAct();
}
// Bluetooth events from the NimBLE task: toasts, pairing end, names
static void connPoll() {
  uint32_t now = millis();
  if (bt.pairUntil && !btPairing()) { btPairStop(); toast("Eşleştirme süresi doldu"); dirty = true; }
  if (connEdit && now - connAt > 20000) { connEdit = false; connConfirmAt = 0; dirty = true; }
  uint8_t e = bt.evt;
  if (e) {
    bt.evt = BTE_NONE;
    uint8_t a[6]; memcpy(a, bt.evtAddr, 6);
    static uint32_t rejAt = 0;
    switch (e) {
      case BTE_PAIRED:
        btPairStop();
        if (bt.hasSel) btSelect(a);          // "only this computer" moves to the new one
        toast("Eşleşti: " + btName(a), 3000); break;
      case BTE_PAIR_FAIL: toast(btPairing() ? "Eşleşme başarısız, tekrar dene" : "Eşleştirme kapalı: Bağlantılar → Yeni cihaz", 3500); break;
      case BTE_UNPAIRED: toast("Eşleştirme kapalı: Bağlantılar → Yeni cihaz", 3500); break;
      case BTE_REJECT: if (now - rejAt > 30000) { rejAt = now; toast(btName(a) + " seçili değil"); } break;
      case BTE_CONN: toast(btName(a) + " bağlandı"); break;
      default: break;
    }
    if (curKind() == K_CONN || e != BTE_DISC) dirty = true;
  }
  // the computer in use changed: say where the keys go now, refresh the new one
  static uint16_t lastAct = BLE_HS_CONN_HANDLE_NONE;
  uint16_t act = activeHostConn();
  if (act != lastAct) {
    bool had = lastAct != BLE_HS_CONN_HANDLE_NONE;
    lastAct = act;
    if (act != BLE_HS_CONN_HANDLE_NONE) {
      if (had) toast("Aktif: " + hostName(act), 1500);
      media.stamp = 0; sysSt.stamp = 0;          // the screen waits for the new computer's data
      evtStatus(); evtSelect(); if (companionOn()) evtMedia("select");
    }
    dirty = true;
  }
  static uint32_t tName = 0;
  if (now - tName > 3000) { tName = now; btLearnNames(); }
  static uint32_t tPair = 0;
  if (btPairing() && curKind() == K_CONN && now - tPair > 1000) { tPair = now; dirty = true; }   // countdown
}

static void onPress() {
  ecoExit();
  if (items.empty()) return;
  Item& it = items[sel];
  switch (it.kind) {
    case K_HOME: { App* a = appById(S.pressApp); if (a) doLaunch(a); break; }
    case K_MEDIA: mediaAction("play_pause", CC_PLAY); break;
    case K_SYS: adjust = adjust == 1 ? 2 : 1; adjustAt = millis(); dirty = true; break;   // volume ↔ brightness
    case K_WIDGETS: break;
    case K_CONN: connPress(); break;
    default: doLaunch(it.app);
  }
}

static void handleInput() {
  // encoder
  int steps; noInterrupts(); steps = encSteps; encSteps = 0; interrupts();
  if (steps) {
    if (!wakeUp()) {
      if (S.encRev) steps = -steps;
      uint8_t k = curKind();
      if (adjust && k == K_MEDIA) levelStep(true, steps);           // volume mode on the media page
      else if (adjust && k == K_SYS) levelStep(adjust == 1, steps);
      else if (connEdit && k == K_CONN) {
        int n = connRows().size(); connCur = constrain(connCur + steps, 0, n - 1); connAt = millis(); connConfirmAt = 0; dirty = true;
      }
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
    else if (k == K_CONN && (connEdit || btPairing())) { connEdit = false; connConfirmAt = 0; if (btPairing()) btPairStop(); dirty = true; }
    else if (S.homeOn) selectIndex(0);
  }
  if (pressPendingAt && now - pressPendingAt >= 330) { pressPendingAt = 0; onPress(); }

  int a = bA.poll(0);
  if (a == 1 && !wakeUp()) {
    evtInput("a"); uint8_t k = curKind();
    if (k == K_MEDIA) mediaAction("prev", CC_PREV);
    else if (k == K_SYS) { toggleMute(); adjustAt = now; }
    else if (k == K_CONN && bleStarted) { btSetOff(!bt.off); connEdit = false; toast(bt.off ? "Bluetooth kapandı" : "Bluetooth açıldı"); dirty = true; }
    else doLaunch(appById(S.quickA));
  }
  int b = bB.poll(0);
  if (b == 1 && !wakeUp()) {
    evtInput("b"); uint8_t k = curKind();
    if (k == K_MEDIA) mediaAction("next", CC_NEXT);
    else if (k == K_SYS) { toggleMic(); if (adjust) adjustAt = now; }
    else doLaunch(appById(S.quickB));
  }

  int p = bPwr.poll(2000);
  if (p == 1) {
    ecoExit();
    if (screenOff || dimmed) wakeUp();
    else { screenOff = true; setBright(0); }
  } else if (p == 2) { ecoExit(); goSleep(); }

  if (bRst.poll(0) == 1) {     // act on release so BOOT is not held during reset
    ecoExit();
    spr.fillSprite(SC_BG); text("Yeniden başlatılıyor", 160, 85, FB18, SC_SUB, textdatum_t::middle_center); spr.pushSprite(0, 0);
    delay(300); ESP.restart();
  }
}

static void applySideEffects() {
  applyTheme(effectiveLight());
  buildItems(); adjust = 0; encDet = S.encDetent;
  mediaTarget = S.mediaPlayer;
  if (companionOn()) evtMedia("select");       // keep the desktop app on the same player
  if (sel >= (int)items.size()) sel = 0;
  lcd.setRotation(S.flip ? 3 : 1);
  if (!screenOff && !dimmed) { curBright = -1; setBright(S.brightness); }
  if (S.conn != 1 && !bleStarted) bleBegin(S.name);
  if (pendingName.length()) { bleRename(pendingName); pendingName = ""; }
  dirty = true;
}

/* ---------- new mail note (1.8.0) ---------- */
// The note wakes the screen without counting as a user touch (idle timers keep running behind it).
static void mailWake() {
  ecoSuspend();
  if (!screenOff && dimmed) { dimmed = false; setBright(S.brightness); }
  dirty = true;
}
static void mailClose() { mailNote.until = 0; dirty = true; }
// While the note is on screen it takes the knob, its press and A / B: press, A or B opens Outlook on the
// computer, turning or a long press closes it. Power and restart keys stay with handleInput().
static void mailInput() {
  int steps; noInterrupts(); steps = encSteps; encSteps = 0; interrupts();
  int e = bEnc.poll(700), a = bA.poll(0), b = bB.poll(0);
  if (e == 1 || a == 1 || b == 1) {
    ecoExit(); mailClose();
    if (companionOn()) { evtMail("open"); toast("Outlook açılıyor"); }
    else toast("Masaüstü uygulaması kapalı");
  } else if (steps || e == 2) { ecoExit(); mailClose(); }
}

/* ---------- setup / loop ---------- */
void setup() {
  if (offMarker == OFF_MAGIC && esp_reset_reason() != ESP_RST_POWERON && esp_sleep_get_wakeup_cause() != ESP_SLEEP_WAKEUP_EXT0) offSleep();
  offMarker = 0;   // real key wake or fresh power-on: boot normally
  rtc_gpio_hold_dis((gpio_num_t)PIN_KEY_PWR); rtc_gpio_deinit((gpio_num_t)PIN_KEY_PWR);
  rtc_gpio_hold_dis((gpio_num_t)PIN_LCD_POWER); rtc_gpio_deinit((gpio_num_t)PIN_LCD_POWER);
  gpio_set_direction((gpio_num_t)PIN_LCD_BL, GPIO_MODE_OUTPUT); gpio_set_level((gpio_num_t)PIN_LCD_BL, 0);
  gpio_hold_dis((gpio_num_t)PIN_LCD_BL); gpio_deep_sleep_hold_dis();
  pinMode(PIN_LCD_POWER, OUTPUT); digitalWrite(PIN_LCD_POWER, HIGH);
  for (uint8_t p : { PIN_ENC_CLK, PIN_ENC_DT, PIN_ENC_SW, PIN_BTN_A, PIN_BTN_B, PIN_KEY_PWR, PIN_KEY_RST }) pinMode(p, INPUT_PULLUP);

  hidBegin();
  Serial.begin(115200);
  Serial.enableReboot(false);
  protoBegin();

  LittleFS.begin(true);
  loadConfig();
  applyTheme(effectiveLight());
  loadAnim(anim); loadAnim(animLight);
  buildItems();
  mediaTarget = S.mediaPlayer;
  if (S.homeOn) sel = 0;

  uiBegin();
  render("none");
  setBright(S.brightness);

  if (S.conn != 1) bleBegin(S.name);

  encDet = S.encDetent;
  encState = (digitalRead(PIN_ENC_CLK) << 1) | digitalRead(PIN_ENC_DT);   // start from where the knob really is
  attachInterrupt(digitalPinToInterrupt(PIN_ENC_CLK), encISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_ENC_DT), encISR, CHANGE);
  analogReadResolution(12);
  readBattery();
  lastActivity = millis();
}

void loop() {
  protoPoll();
  if (configChangedFlag) { configChangedFlag = false; crumbSet("apply"); applySideEffects(); crumbClear(); }
  if (companionNew) { companionNew = false; toast("Masaüstü uygulaması bağlı"); dirty = true; evtMedia("select"); }
  if (mailNew) { mailNew = false; mailWake(); }
  if (mailActive() && !screenOff) mailInput();
  crumbSet("input"); handleInput(); crumbClear();
  connPoll();

  uint32_t now = millis();
  static uint32_t tBat = 0, tStatus = 0, tFrame = 0, tTheme = 0;
  if (now - tTheme >= 3000) { tTheme = now; bool light = effectiveLight(); if (light != lightTheme) { applyTheme(light); dirty = true; } }
  static Link lastLink = L_NONE;
  if (now - tBat > 2000) { tBat = now; uint8_t oldBat = batPct; bool oldCharge = charging; readBattery(); bleBattery(batPct); if (oldBat != batPct || oldCharge != charging) dirty = true; }
  if (now - tStatus > 5000) { tStatus = now; evtStatus(); if (!ecoActive) dirty = true; }
  Link l = activeLink(); if (l != lastLink) { lastLink = l; dirty = true; evtStatus(); }

  bool onHome = !items.empty() && items[sel].home;
  bool onWidgets = curKind() == K_WIDGETS;
  if (statsDirty) { statsDirty = false; if (onHome || onWidgets) dirty = true; }

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
  if (S.homeOn && !(S.mediaStay && curKind() == K_MEDIA) && curKind() != K_WIDGETS && S.returnAfter > 0 && idle >= (uint32_t)S.returnAfter && sel != 0 && !items.empty() && items[0].home) { sel = 0; dirty = true; evtSelect(); }
  // dimming / auto power-off: separate settings on cable (USB host or charger) and on battery, 0 = off
  bool onCable = extPower;
  int dimLimit = onCable ? S.dimAfterUsb : S.dimAfter, sleepLimit = onCable ? S.sleepAfterUsb : S.sleepAfter;
  int dimLevel = onCable ? S.dimLevelUsb : S.dimLevel;
  ecoAnimFps = min(S.animFps, onCable ? S.ecoFpsUsb : S.ecoFps);
  int ecoLimit = onCable ? S.ecoAfterUsb : S.ecoAfter;
  bool ecoBlocked = protoTransferBusy() || adjust || (toastUntil && now <= toastUntil) || mailActive();
  if (ecoActive && (ecoLimit <= 0 || adjust || (toastUntil && now <= toastUntil) || mailActive())) ecoSuspend();
  if (!ecoActive && !ecoBlocked && ecoLimit > 0 && idle >= (uint32_t)ecoLimit) ecoEnter();
  if (dimmed && dimLimit <= 0) { dimmed = false; setBright(S.brightness); }          // switched to a source with dimming off
  if (!screenOff && !dimmed && dimLimit > 0 && idle >= (uint32_t)dimLimit && !mailActive()) { dimmed = true; }
  if (!screenOff && dimmed) setBright(max(5, S.brightness * dimLevel / 100));
  if (sleepLimit > 0 && idle >= (uint32_t)sleepLimit && !mailActive()) goSleep();

  onHome = !items.empty() && items[sel].home;
  bool mailOn = mailActive();
  static bool mailWas = false;
  if (mailOn != mailWas) { mailWas = mailOn; dirty = true; }   // note shown or gone: redraw the whole screen
  bool animate = onHome && !screenOff && S.animKind != A_NONE && !mailOn;
  static int64_t clockMinute = -1;
  int64_t minute = st.timeAt ? (st.epoch + st.tz + (int64_t)((now - st.timeAt) / 1000)) / 60 : -1;
  bool clockChanged = minute != clockMinute; clockMinute = minute;
  static uint8_t liveBits = 0;
  uint8_t bits = (cpuFresh() ? 1 : 0) | (gpuFresh() ? 2 : 0) | (netFresh() ? 4 : 0) | (wxFresh() ? 8 : 0) | (fxFresh() ? 16 : 0) | (mediaLive() ? 32 : 0) | (sysLive() ? 64 : 0);
  if (bits != liveBits) { liveBits = bits; dirty = true; }
  bool toastExpired = toastUntil && now > toastUntil;
  if (toastExpired) { toastUntil = 0; dirty = true; }
  if (!screenOff) {
    if (dirty || (!ecoActive && ((animate && now - tFrame >= 40) || (onPage && now - tFrame >= 250) || ((onHome || onWidgets) && now - tFrame >= 1000) || (mailOn && now - tFrame >= 250)))) {
      tFrame = now; dirty = false; crumbSet("render"); render(linkName()); crumbClear();
    } else if (ecoActive) {
      if (animate && ecoAnimFps > 0 && now - tFrame >= (uint32_t)(1000 / ecoAnimFps)) { tFrame = now; renderEcoAnim(now); }
      if (clockChanged) renderEcoClock();
    }
  }
  delay(2);
}
