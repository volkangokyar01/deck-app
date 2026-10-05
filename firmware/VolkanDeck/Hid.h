#pragma once
#include "USB.h"
#include "USBHIDKeyboard.h"
#include "USBHIDConsumerControl.h"
#include <NimBLEDevice.h>
#include <NimBLEHIDDevice.h>

USBHIDKeyboard usbKb;
USBHIDConsumerControl usbCc;
volatile bool usbMounted = false, usbSuspended = false;
volatile bool bleConnected = false;
NimBLEServer* bleServer = nullptr;
NimBLEHIDDevice* bleHid = nullptr;
NimBLECharacteristic* bleIn = nullptr;
NimBLECharacteristic* bleCc = nullptr;   // consumer (media) report
bool bleStarted = false;

enum Link : uint8_t { L_NONE = 0, L_USB, L_BLE };

static const uint8_t HID_MAP[] = {
  0x05,0x01, 0x09,0x06, 0xA1,0x01, 0x85,0x01,
  0x05,0x07, 0x19,0xE0, 0x29,0xE7, 0x15,0x00, 0x25,0x01, 0x75,0x01, 0x95,0x08, 0x81,0x02,
  0x95,0x01, 0x75,0x08, 0x81,0x01,
  0x95,0x05, 0x75,0x01, 0x05,0x08, 0x19,0x01, 0x29,0x05, 0x91,0x02,
  0x95,0x01, 0x75,0x03, 0x91,0x01,
  0x95,0x06, 0x75,0x08, 0x15,0x00, 0x25,0x73, 0x05,0x07, 0x19,0x00, 0x29,0x73, 0x81,0x00,
  0xC0,
  // consumer control (media keys, volume, brightness): report 2, one 16-bit usage
  0x05,0x0C, 0x09,0x01, 0xA1,0x01, 0x85,0x02,
  0x15,0x00, 0x26,0xFF,0x03, 0x19,0x00, 0x2A,0xFF,0x03, 0x75,0x10, 0x95,0x01, 0x81,0x00,
  0xC0
};

class BleCb : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* s, NimBLEConnInfo& ci) override { bleConnected = true; }
  void onDisconnect(NimBLEServer* s, NimBLEConnInfo& ci, int reason) override { bleConnected = false; NimBLEDevice::startAdvertising(); }
};

static void usbEvent(void* arg, esp_event_base_t base, int32_t id, void* data) {
  if (base != ARDUINO_USB_EVENTS) return;
  switch (id) {
    case ARDUINO_USB_STARTED_EVENT: usbMounted = true; usbSuspended = false; break;
    case ARDUINO_USB_STOPPED_EVENT: usbMounted = false; break;
    case ARDUINO_USB_SUSPEND_EVENT: usbSuspended = true; break;
    case ARDUINO_USB_RESUME_EVENT: usbSuspended = false; break;
  }
}

static void bleBegin(const String& name) {
  if (bleStarted) return;
  NimBLEDevice::init(name.c_str());
  NimBLEDevice::setSecurityAuth(true, false, true);
  NimBLEDevice::setSecurityIOCap(BLE_HS_IO_NO_INPUT_OUTPUT);
  bleServer = NimBLEDevice::createServer();
  bleServer->setCallbacks(new BleCb());
  bleHid = new NimBLEHIDDevice(bleServer);
  bleIn = bleHid->getInputReport(1);
  bleCc = bleHid->getInputReport(2);
  bleHid->setManufacturer("Volkan Deck");
  bleHid->setPnp(0x02, 0x303A, 0x1001, 0x0100);
  bleHid->setHidInfo(0x00, 0x01);
  bleHid->setReportMap((uint8_t*)HID_MAP, sizeof(HID_MAP));
  bleHid->setBatteryLevel(100);
  bleServer->start();
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->setAppearance(0x03C1);
  adv->addServiceUUID(bleHid->getHidService()->getUUID());
  adv->setName(name.c_str());
  adv->enableScanResponse(true);
  adv->start();
  bleStarted = true;
}

static void bleRename(const String& name) {
  if (!bleStarted) return;
  NimBLEDevice::setDeviceName(name.c_str());
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->stop(); adv->setName(name.c_str()); adv->start();
}

static void bleBattery(uint8_t pct) { if (bleHid) bleHid->setBatteryLevel(pct, bleConnected); }

static void hidBegin() {
  usbKb.begin();
  usbCc.begin();
  USB.onEvent(usbEvent);
  USB.productName("Volkan Deck");
  USB.manufacturerName("Volkan");
  USB.begin();
}

static Link activeLink() {
  bool usbOk = usbMounted && !usbSuspended;
  if (S.conn == 1) return usbMounted ? L_USB : L_NONE;
  if (S.conn == 2) return bleConnected ? L_BLE : L_NONE;
  if (usbOk) return L_USB;
  if (bleConnected) return L_BLE;
  return usbMounted ? L_USB : L_NONE;
}

static void sendKey(uint8_t mods, uint8_t key) {
  Link l = activeLink();
  if (l == L_USB) {
    KeyReport r; r.modifiers = mods; r.reserved = 0; memset(r.keys, 0, 6); r.keys[0] = key;
    usbKb.sendReport(&r);
  } else if (l == L_BLE && bleIn) {
    uint8_t r[8] = { mods, 0, key, 0, 0, 0, 0, 0 };
    bleIn->setValue(r, 8); bleIn->notify();
  }
}

static void tap(uint8_t mods, uint8_t key) {
  int d = activeLink() == L_BLE ? 18 : 8;
  if (mods && key) { sendKey(mods, 0); delay(d); }
  sendKey(mods, key); delay(d);
  sendKey(0, 0); delay(d);
}

/* ---------- consumer keys: work on Windows and macOS without the desktop app ---------- */
enum : uint16_t { CC_PLAY = 0xCD, CC_NEXT = 0xB5, CC_PREV = 0xB6, CC_VOL_UP = 0xE9, CC_VOL_DOWN = 0xEA, CC_MUTE = 0xE2,
                  CC_BRIGHT_UP = 0x6F, CC_BRIGHT_DOWN = 0x70 };
static bool consumerTap(uint16_t u) {
  Link l = activeLink();
  if (l == L_USB) { usbCc.press(u); delay(10); usbCc.release(); return true; }
  if (l == L_BLE && bleCc) {
    uint8_t r[2] = { (uint8_t)u, (uint8_t)(u >> 8) }; bleCc->setValue(r, 2); bleCc->notify(); delay(18);
    r[0] = r[1] = 0; bleCc->setValue(r, 2); bleCc->notify(); return true;
  }
  return false;
}

/* ---------- character → key (US / Turkish Q) ---------- */
struct KM { uint8_t key = 0, mods = 0; bool dead = false; };
#define SH 0x02
#define AG 0x40

static bool mapUS(uint32_t c, KM& o) {
  if (c >= 'a' && c <= 'z') { o.key = 0x04 + c - 'a'; return true; }
  if (c >= 'A' && c <= 'Z') { o.key = 0x04 + c - 'A'; o.mods = SH; return true; }
  if (c >= '1' && c <= '9') { o.key = 0x1E + c - '1'; return true; }
  if (c == '0') { o.key = 0x27; return true; }
  static const char* p = " -=[]\\;'`,./\n\t";
  static const uint8_t pk[] = {0x2C,0x2D,0x2E,0x2F,0x30,0x31,0x33,0x34,0x35,0x36,0x37,0x38,0x28,0x2B};
  for (int i = 0; p[i]; i++) if ((uint32_t)p[i] == c) { o.key = pk[i]; return true; }
  static const char* s = "!@#$%^&*()_+{}|:\"~<>?";
  static const uint8_t sk[] = {0x1E,0x1F,0x20,0x21,0x22,0x23,0x24,0x25,0x26,0x27,0x2D,0x2E,0x2F,0x30,0x31,0x33,0x34,0x35,0x36,0x37,0x38};
  for (int i = 0; s[i]; i++) if ((uint32_t)s[i] == c) { o.key = sk[i]; o.mods = SH; return true; }
  return false;
}

static bool mapTRQ(uint32_t c, KM& o) {
  if (c == 'i') { o.key = 0x34; return true; }
  if (c == 'I') { o.key = 0x0C; o.mods = SH; return true; }
  if (c >= 'a' && c <= 'z') { o.key = 0x04 + c - 'a'; return true; }
  if (c >= 'A' && c <= 'Z') { o.key = 0x04 + c - 'A'; o.mods = SH; return true; }
  if (c >= '1' && c <= '9') { o.key = 0x1E + c - '1'; return true; }
  if (c == '0') { o.key = 0x27; return true; }
  struct E { uint32_t c; uint8_t k, m; bool dead; };
  static const E T[] = {
    {' ',0x2C,0,0},{'\n',0x28,0,0},{'\t',0x2B,0,0},
    {0x131,0x0C,0,0},{0x130,0x34,SH,0},{0x11F,0x2F,0,0},{0x11E,0x2F,SH,0},{0xFC,0x30,0,0},{0xDC,0x30,SH,0},
    {0x15F,0x33,0,0},{0x15E,0x33,SH,0},{0xF6,0x36,0,0},{0xD6,0x36,SH,0},{0xE7,0x37,0,0},{0xC7,0x37,SH,0},{0xE9,0x35,SH,0},
    {'"',0x35,0,0},{'!',0x1E,SH,0},{'\'',0x1F,SH,0},{'^',0x20,SH,1},{'+',0x21,SH,0},{'%',0x22,SH,0},{'&',0x23,SH,0},
    {'/',0x24,SH,0},{'(',0x25,SH,0},{')',0x26,SH,0},{'=',0x27,SH,0},{'*',0x2D,0,0},{'?',0x2D,SH,0},{'-',0x2E,0,0},{'_',0x2E,SH,0},
    {',',0x31,0,0},{';',0x31,SH,0},{'.',0x38,0,0},{':',0x38,SH,0},{'<',0x64,0,0},{'>',0x64,SH,0},
    {'#',0x20,AG,0},{'$',0x21,AG,0},{'{',0x24,AG,0},{'[',0x25,AG,0},{']',0x26,AG,0},{'}',0x27,AG,0},
    {'\\',0x2D,AG,0},{'|',0x2E,AG,0},{'@',0x14,AG,0},{'~',0x30,AG,1},{'`',0x31,AG,1}};
  for (auto& e : T) if (e.c == c) { o.key = e.k; o.mods = e.m; o.dead = e.dead; return true; }
  return false;
}

static void typeText(const String& s) {
  const uint8_t* p = (const uint8_t*)s.c_str();
  while (*p) {
    uint32_t c = *p++;
    if (c >= 0xC0 && (*p & 0xC0) == 0x80) {
      if (c < 0xE0) { c = ((c & 0x1F) << 6) | (*p++ & 0x3F); }
      else if (c < 0xF0 && (p[1] & 0xC0) == 0x80) { c = ((c & 0x0F) << 12) | ((p[0] & 0x3F) << 6) | (p[1] & 0x3F); p += 2; }
    }
    KM k;
    if (!(S.trq ? mapTRQ(c, k) : mapUS(c, k))) continue;
    tap(k.mods, k.key);
    if (k.dead) tap(0, 0x2C);
  }
}

/* returns false when no computer is connected */
static bool runLaunch(const Launch& L, const String& name) {
  if (activeLink() == L_NONE) return false;
  if (S.hostMac && (L.method == M_RUN || L.method == M_SEARCH || L.method == M_TASKBAR)) {
    // macOS: Spotlight (Cmd+Space), type the app name, Enter
    String q = L.method == M_SEARCH ? L.value : name;
    tap(0x08, 0x2C); delay(S.launchDelay);
    typeText(q); delay(S.launchDelay); tap(0, 0x28);
    return true;
  }
  switch (L.method) {
    case M_RUN:
      tap(0x08, 0x15); delay(S.launchDelay);
      typeText(L.value); delay(60); tap(0, 0x28); break;
    case M_SEARCH:
      tap(0x08, 0); delay(S.launchDelay);
      typeText(L.value); delay(S.launchDelay); tap(0, 0x28); break;
    case M_TASKBAR:
      tap(0x08, 0x1E + constrain(L.tb, 1, 9) - 1); break;
    case M_KEY:
      tap(L.mods, L.key); break;
  }
  return true;
}
