#pragma once
#include "USB.h"
#include "USBHIDKeyboard.h"
#include "USBHIDConsumerControl.h"
#include <NimBLEDevice.h>
#include <NimBLEHIDDevice.h>
#include <Preferences.h>

// Every paired computer keeps ~5 notification subscriptions (keyboard, media keys, battery, service
// changed, data channel). NimBLE's default store holds 8, and on overflow it unpairs another computer:
// a second computer pairing silently removed the first. tools/build_firmware.sh raises the limits.
#if MYNEWT_VAL(BLE_STORE_MAX_CCCDS) < 24 || MYNEWT_VAL(BLE_STORE_MAX_BONDS) < 4
#error "NimBLE limits too small: build with tools/build_firmware.sh (MYNEWT_VAL_BLE_STORE_MAX_CCCDS=32, MAX_BONDS=4)"
#endif

USBHIDKeyboard usbKb;
USBHIDConsumerControl usbCc;
volatile bool usbMounted = false, usbSuspended = false;
volatile bool bleConnected = false;
volatile int bleConns = 0;
NimBLEServer* bleServer = nullptr;
NimBLEHIDDevice* bleHid = nullptr;
NimBLECharacteristic* bleIn = nullptr;
NimBLECharacteristic* bleCc = nullptr;   // consumer (media) report
bool bleStarted = false;

// Data channel for the desktop app over Bluetooth (same JSON lines as USB serial): RX = write, TX = notify
#define VD_SVC_UUID "7d9a0001-5c2e-4b7a-9f3d-1a6c0de5d001"
#define VD_RX_UUID  "7d9a0002-5c2e-4b7a-9f3d-1a6c0de5d001"
#define VD_TX_UUID  "7d9a0003-5c2e-4b7a-9f3d-1a6c0de5d001"
NimBLECharacteristic* bleTx = nullptr;
// Several computers can be connected at once (e.g. the Mac on Bluetooth while Windows writes):
// every connection has its own receive buffer and replies go back to the connection that asked (Proto.h).
volatile uint16_t bleHostConn = BLE_HS_CONN_HANDLE_NONE;   // the desktop app's connection: events go here
void (*bleRxHook)(uint16_t conn, uint16_t mtu, const uint8_t* p, size_t n) = nullptr;   // set by Proto.h
void (*bleDropHook)(uint16_t conn) = nullptr;
class BleRxCb : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c, NimBLEConnInfo& ci) override {
    const NimBLEAttValue& v = c->getValue();
    if (bleRxHook) bleRxHook(ci.getConnHandle(), ci.getMTU(), v.data(), v.length());
  }
};

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

/* ---------- Bluetooth computers (1.9.0): chosen on the device, Bağlantılar page ----------
   Pairing only in pairing mode (bonding is off otherwise, so a stray "Add device" can't pair).
   Mode "all": every paired computer may connect. Mode "one": only the chosen one; others are
   dropped as soon as their link is encrypted (that is when their identity address is known).
   Callbacks run on the NimBLE task: they only set plain fields, the main loop does the rest. */
struct BtHost { uint8_t a[6]; };
struct BtState {
  bool off = false;                    // Bluetooth switched off on the device (saved)
  bool hasSel = false; uint8_t sel[6]; // chosen computer (saved), else every paired one
  volatile uint32_t pairUntil = 0;     // pairing mode end (millis), 0 = off
  volatile uint8_t evt = 0;            // last event for the main loop (BTE_*)
  volatile int evtCode = 0;
  uint8_t evtAddr[6];
  volatile bool newBond = false;
  volatile bool hold = false;          // no advertising (pairings being deleted)
  uint8_t old[4][6]; uint8_t oldN = 0;  // computers paired before pairing mode started
};
enum : uint8_t { BTE_NONE = 0, BTE_CONN, BTE_DISC, BTE_PAIRED, BTE_PAIR_FAIL, BTE_REJECT, BTE_UNPAIRED };
BtState bt;

/* ---------- active computer (1.9.1) ----------
   Every desktop app reports how long its computer has been idle (no keyboard / mouse). The computer
   used most recently is "active": keys, launch and media events go there and it feeds the screen.
   Without any app the last Bluetooth computer that connected gets the keys. */
static const uint16_t HOST_USB = 0xFFFE;
struct HostSeen { uint16_t conn = BLE_HS_CONN_HANDLE_NONE; uint32_t seenAt = 0, inputAt = 0; char name[28] = ""; };
HostSeen hostSeen[4];
volatile uint16_t bleLastConn = BLE_HS_CONN_HANDLE_NONE;   // newest accepted Bluetooth computer
static bool hostAlive(const HostSeen& h) {
  if (h.conn == BLE_HS_CONN_HANDLE_NONE || !h.seenAt || (int32_t)(millis() - h.seenAt) > 6000) return false;
  if (h.conn == HOST_USB) return usbMounted && !usbSuspended;
  return true;                                   // Bluetooth entries are cleared on disconnect
}
static void hostReport(uint16_t conn, int idleSec, const char* name) {
  uint32_t now = millis();
  HostSeen* e = nullptr;
  for (auto& h : hostSeen) if (h.conn == conn) { e = &h; break; }
  if (!e) for (auto& h : hostSeen) if (!hostAlive(h)) { h = HostSeen(); h.conn = conn; e = &h; break; }
  if (!e) return;
  e->seenAt = now | 1;
  if (idleSec >= 0) { uint32_t ms = (uint32_t)min(idleSec, 86400) * 1000UL; e->inputAt = ms < now ? (now - ms) | 1 : 1; }
  if (name && *name) { strncpy(e->name, name, sizeof e->name - 1); e->name[sizeof e->name - 1] = 0; }
}
static void hostForget(uint16_t conn) { for (auto& h : hostSeen) if (h.conn == conn) h = HostSeen(); }
// HOST_USB, a Bluetooth connection, or NONE when no app reports idle time
static uint16_t activeHostConn() {
  const HostSeen* best = nullptr;
  for (auto& h : hostSeen) if (hostAlive(h) && h.inputAt && (!best || (int32_t)(h.inputAt - best->inputAt) > 0)) best = &h;
  return best ? best->conn : BLE_HS_CONN_HANDLE_NONE;
}
static const HostSeen* hostOf(uint16_t conn) { for (auto& h : hostSeen) if (h.conn == conn && hostAlive(h)) return &h; return nullptr; }
static void btEvt(uint8_t e, int code, const uint8_t* a) { if (a) memcpy(bt.evtAddr, a, 6); bt.evtCode = code; bt.evt = e; }
static bool btPairing() { return bt.pairUntil && (int32_t)(millis() - bt.pairUntil) < 0; }
static void btAdvertise() { if (bleStarted && !bt.off && !bt.hold) NimBLEDevice::startAdvertising(); }

class BleCb : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* s, NimBLEConnInfo& ci) override {
    bleConns++; bleConnected = true;
    if (bt.off || bt.hold) { s->disconnect(ci.getConnHandle()); return; }
    if (bleConns < 2) btAdvertise();   // stay visible so the desktop app can find us while the OS holds the keyboard link
  }
  void onDisconnect(NimBLEServer* s, NimBLEConnInfo& ci, int reason) override {
    if (bleConns > 0) bleConns--;
    bleConnected = bleConns > 0;
    if (ci.getConnHandle() == bleHostConn) bleHostConn = BLE_HS_CONN_HANDLE_NONE;
    hostForget(ci.getConnHandle());
    if (ci.getConnHandle() == bleLastConn) {
      bleLastConn = BLE_HS_CONN_HANDLE_NONE;
      for (uint16_t h : s->getPeerDevices()) if (h != ci.getConnHandle()) bleLastConn = h;
    }
    if (bleDropHook) bleDropHook(ci.getConnHandle());
    btEvt(BTE_DISC, reason, ci.getIdAddress().getVal());
    btAdvertise();
  }
  void onAuthenticationComplete(NimBLEConnInfo& ci) override {
    const uint8_t* id = ci.getIdAddress().getVal();
    if (!ci.isEncrypted()) { btEvt(BTE_PAIR_FAIL, 0, id); return; }
    if (!ci.isBonded()) {             // encrypted but not bonded: paired outside pairing mode
      btEvt(BTE_UNPAIRED, 0, id); bleServer->disconnect(ci.getConnHandle()); return;
    }
    if (btPairing()) {
      bool known = false;
      for (uint8_t i = 0; i < bt.oldN; i++) if (!memcmp(bt.old[i], id, 6)) known = true;
      if (!known) { bt.newBond = true; btEvt(BTE_PAIRED, 0, id); return; }
    }
    if (bt.hasSel && memcmp(id, bt.sel, 6) && !btPairing()) {
      btEvt(BTE_REJECT, 0, id); bleServer->disconnect(ci.getConnHandle()); return;
    }
    bleLastConn = ci.getConnHandle();
    btEvt(BTE_CONN, 0, id);
  }
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

// advertising: keyboard appearance + HID and Volkan Deck service UUIDs; the name goes in the scan response
static void bleAdvData(const String& name) {
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  NimBLEAdvertisementData ad, sr;
  ad.setFlags(BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP);
  ad.setAppearance(0x03C1);
  ad.addServiceUUID(NimBLEUUID((uint16_t)0x1812));
  ad.addServiceUUID(NimBLEUUID(VD_SVC_UUID));
  sr.setName(name.c_str());
  adv->setAdvertisementData(ad);
  adv->setScanResponseData(sr);
  adv->enableScanResponse(true);
}

// Store full: a bond overflow (5th computer) still drops the oldest computer, but a subscription
// record that does not fit is just not saved instead of unpairing another computer.
class BtStoreCb : public NimBLEDeviceCallbacks {
  int onStoreStatus(struct ble_store_status_event* e, void* arg) override {
    if (e->event_code == BLE_STORE_EVENT_OVERFLOW &&
        (e->overflow.obj_type == BLE_STORE_OBJ_TYPE_CCCD || e->overflow.obj_type == BLE_STORE_OBJ_TYPE_CSFC)) return BLE_HS_ESTORE_CAP;
    return ble_store_util_status_rr(e, arg);
  }
};
static void btLoad();
static void bleBegin(const String& name) {
  if (bleStarted) return;
  btLoad();
  NimBLEDevice::init(name.c_str());
  NimBLEDevice::setDeviceCallbacks(new BtStoreCb());
  NimBLEDevice::setSecurityAuth(false, false, true);   // bonding only in pairing mode (btPairStart)
  NimBLEDevice::setSecurityIOCap(BLE_HS_IO_NO_INPUT_OUTPUT);
  bleServer = NimBLEDevice::createServer();
  bleServer->setCallbacks(new BleCb());
  bleHid = new NimBLEHIDDevice(bleServer);
  bleIn = bleHid->getInputReport(1);
  bleCc = bleHid->getInputReport(2);
  bleHid->setManufacturer("Game Deck");
  bleHid->setPnp(0x02, 0x303A, 0x1001, 0x0100);
  bleHid->setHidInfo(0x00, 0x01);
  bleHid->setReportMap((uint8_t*)HID_MAP, sizeof(HID_MAP));
  bleHid->setBatteryLevel(100);
  NimBLEService* svc = bleServer->createService(VD_SVC_UUID);
  NimBLECharacteristic* rx = svc->createCharacteristic(VD_RX_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR | NIMBLE_PROPERTY::WRITE_ENC);
  rx->setCallbacks(new BleRxCb());
  bleTx = svc->createCharacteristic(VD_TX_UUID, NIMBLE_PROPERTY::NOTIFY);
  svc->start();
  NimBLEDevice::setMTU(517);
  bleServer->start();
  // New firmware may add GATT services: tell bonded computers to drop their cached service list
  // (sent now to connected ones, on reconnect to the others). Once per firmware version.
  { Preferences pr; if (pr.begin("vdble", false)) { if (pr.getString("fw", "") != FW_VERSION) { bleServer->sendServiceChangedIndication(); pr.putString("fw", FW_VERSION); } pr.end(); } }
  bleAdvData(name);
  bleStarted = true;
  btAdvertise();
}

static void bleRename(const String& name) {
  if (!bleStarted) return;
  NimBLEDevice::setDeviceName(name.c_str());
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->stop(); bleAdvData(name); btAdvertise();
}

static int bleBondCount() { return bleStarted ? NimBLEDevice::getNumBonds() : 0; }
static void btDropAll() { if (bleStarted) for (uint16_t h : bleServer->getPeerDevices()) bleServer->disconnect(h); }

// names of paired computers: NVS "vdbt", key "n" + 12 hex digits of the identity address
static String btKey(const uint8_t* a) { char k[14]; snprintf(k, sizeof k, "n%02x%02x%02x%02x%02x%02x", a[5], a[4], a[3], a[2], a[1], a[0]); return k; }
static String btName(const uint8_t* a) {
  Preferences pr; String n;
  if (pr.begin("vdbt", true)) { n = pr.getString(btKey(a).c_str(), ""); pr.end(); }
  if (!n.length()) { char d[24]; snprintf(d, sizeof d, "Bilgisayar %02X%02X", a[1], a[0]); n = d; }
  return n;
}
static bool btHasName(const uint8_t* a) { Preferences pr; bool h = false; if (pr.begin("vdbt", true)) { h = pr.isKey(btKey(a).c_str()); pr.end(); } return h; }
static void btSetName(const uint8_t* a, const String& name) {
  String n = name; n.trim(); if (!n.length()) return;
  if (n.length() > 28) n = n.substring(0, 28);
  Preferences pr; if (pr.begin("vdbt", false)) { if (pr.getString(btKey(a).c_str(), "") != n) pr.putString(btKey(a).c_str(), n); pr.end(); }
}
static void btSave() {
  Preferences pr;
  if (pr.begin("vdbt", false)) { pr.putBool("off", bt.off); if (bt.hasSel) pr.putBytes("sel", bt.sel, 6); else pr.remove("sel"); pr.end(); }
}
static void btLoad() {
  Preferences pr;
  if (pr.begin("vdbt", true)) { bt.off = pr.getBool("off", false); bt.hasSel = pr.getBytes("sel", bt.sel, 6) == 6; pr.end(); }
}
// paired computers (identity addresses), oldest first
static std::vector<BtHost> btHosts() {
  std::vector<BtHost> v; if (!bleStarted) return v;
  int n = NimBLEDevice::getNumBonds();
  for (int i = 0; i < n; i++) { BtHost h; memcpy(h.a, NimBLEDevice::getBondedAddress(i).getVal(), 6); v.push_back(h); }
  return v;
}
// connection handle of a paired computer, or NONE
static uint16_t btConnOf(const uint8_t* a) {
  if (!bleStarted) return BLE_HS_CONN_HANDLE_NONE;
  for (uint16_t h : bleServer->getPeerDevices()) {
    NimBLEConnInfo ci = bleServer->getPeerInfoByHandle(h);
    if (ci.isEncrypted() && !memcmp(ci.getIdAddress().getVal(), a, 6)) return h;
  }
  return BLE_HS_CONN_HANDLE_NONE;
}
static void btSelectAll() { bt.hasSel = false; btSave(); }
static void btSelect(const uint8_t* a) {
  memcpy(bt.sel, a, 6); bt.hasSel = true; btSave();
  if (!bleStarted) return;
  for (uint16_t h : bleServer->getPeerDevices()) {   // drop the other computers now
    NimBLEConnInfo ci = bleServer->getPeerInfoByHandle(h);
    if (memcmp(ci.getIdAddress().getVal(), a, 6)) bleServer->disconnect(h);
  }
}
static void btPairStart(uint32_t ms = 90000) {
  if (!bleStarted || bt.off) return;
  bt.newBond = false; bt.oldN = 0;
  for (auto& h : btHosts()) if (bt.oldN < 4) memcpy(bt.old[bt.oldN++], h.a, 6);
  NimBLEDevice::setSecurityAuth(true, false, true);
  bt.pairUntil = (millis() + ms) | 1;
  btAdvertise();
}
static void btPairStop() { bt.pairUntil = 0; if (bleStarted) NimBLEDevice::setSecurityAuth(false, false, true); }
static void btSetOff(bool off) {
  bt.off = off; btSave();
  if (!bleStarted) return;
  if (off) { btPairStop(); NimBLEDevice::stopAdvertising(); btDropAll(); } else btAdvertise();
}
// Delete every pairing. NimBLE refuses to delete a pairing that carries an identity key (Mac and Windows
// always send one) while advertising runs (ble_gap_unpair → BLE_HS_EBUSY), so advertising stops first and
// the links are closed; whatever is left is wiped with ble_store_clear. Returns true when no pairing is left.
static bool bleForget() {
  if (!bleStarted) return false;
  btPairStop();
  bt.hold = true;                                      // nobody reconnects while the keys go
  NimBLEDevice::stopAdvertising();
  btDropAll();                                         // the links use the old keys
  for (int i = 0; i < 60 && bleServer->getConnectedCount(); i++) delay(25);   // up to 1.5 s for the disconnects
  NimBLEDevice::stopAdvertising();
  NimBLEDevice::deleteAllBonds();
  if (NimBLEDevice::getNumBonds()) ble_store_clear();
  bool ok = NimBLEDevice::getNumBonds() == 0;
  Preferences pr; if (pr.begin("vdbt", false)) { pr.clear(); pr.putBool("off", bt.off); pr.end(); }
  bt.hasSel = false;
  for (auto& h : hostSeen) h = HostSeen();
  bleLastConn = BLE_HS_CONN_HANDLE_NONE;
  bt.hold = false;
  btAdvertise();
  return ok;
}
// computer name over GATT (Generic Access → Device Name) for a paired computer without a saved name.
// Runs on its own short task: discovery waits for the computer's answer.
static volatile bool btNameBusy = false;
static uint16_t btNameConn = BLE_HS_CONN_HANDLE_NONE;
static void btNameTask(void*) {
  NimBLEConnInfo ci = bleServer->getPeerInfoByHandle(btNameConn);
  if (ci.isEncrypted()) {
    uint8_t a[6]; memcpy(a, ci.getIdAddress().getVal(), 6);
    NimBLEClient* c = bleServer->getClient(ci);
    NimBLERemoteService* gap = c ? c->getService(NimBLEUUID((uint16_t)0x1800)) : nullptr;
    NimBLERemoteCharacteristic* dn = gap ? gap->getCharacteristic(NimBLEUUID((uint16_t)0x2A00)) : nullptr;
    if (dn && dn->canRead()) { std::string v = dn->readValue(); if (v.size()) btSetName(a, String(v.c_str())); }
  }
  btNameBusy = false;
  vTaskDelete(nullptr);
}
static void btLearnNames() {
  static uint32_t tried[4] = {0}; static uint8_t ti = 0;
  if (!bleStarted || btNameBusy) return;
  for (uint16_t h : bleServer->getPeerDevices()) {
    NimBLEConnInfo ci = bleServer->getPeerInfoByHandle(h);
    if (!ci.isEncrypted() || !ci.isBonded()) continue;
    const uint8_t* a = ci.getIdAddress().getVal();
    if (btHasName(a)) continue;
    uint32_t tag = (uint32_t)a[0] | (a[1] << 8) | (a[2] << 16) | ((uint32_t)a[3] << 24);
    bool done = false; for (uint32_t t : tried) if (t == tag) done = true;
    if (done) continue;
    tried[ti++ & 3] = tag;             // once per computer per boot
    btNameConn = h; btNameBusy = true;
    if (xTaskCreate(btNameTask, "btname", 4096, nullptr, 1, nullptr) != pdPASS) btNameBusy = false;
    return;
  }
}
// desktop app on Bluetooth told us the computer name
static void btNameFromConn(uint16_t conn, const char* name) {
  if (!bleStarted || !name || !*name) return;
  NimBLEConnInfo ci = bleServer->getPeerInfoByHandle(conn);
  if (ci.isBonded()) btSetName(ci.getIdAddress().getVal(), name);
}

static void bleBattery(uint8_t pct) { if (bleHid) bleHid->setBatteryLevel(pct, bleConnected); }

static void hidBegin() {
  usbKb.begin();
  usbCc.begin();
  USB.onEvent(usbEvent);
  USB.productName("Game Deck");
  USB.manufacturerName("Volkan");
  USB.begin();
}

static Link activeLink() {
  bool usbOk = usbMounted && !usbSuspended;
  if (S.conn == 1) return usbMounted ? L_USB : L_NONE;
  if (S.conn == 2) return bleConnected ? L_BLE : L_NONE;
  uint16_t act = activeHostConn();               // the computer in use, when the desktop apps tell us
  if (act == HOST_USB && usbOk) return L_USB;
  if (act != BLE_HS_CONN_HANDLE_NONE && act != HOST_USB && bleConnected) return L_BLE;
  if (usbOk) return L_USB;
  if (bleConnected) return L_BLE;
  return usbMounted ? L_USB : L_NONE;
}

// Bluetooth keys go to one computer only: the active one, else the newest connection
static uint16_t bleKeyConn() {
  uint16_t act = activeHostConn();
  if (act != BLE_HS_CONN_HANDLE_NONE && act != HOST_USB) return act;
  return bleLastConn;                            // NONE = every connected computer (only one is connected)
}
static void sendKey(uint8_t mods, uint8_t key) {
  Link l = activeLink();
  if (l == L_USB) {
    KeyReport r; r.modifiers = mods; r.reserved = 0; memset(r.keys, 0, 6); r.keys[0] = key;
    usbKb.sendReport(&r);
  } else if (l == L_BLE && bleIn) {
    uint8_t r[8] = { mods, 0, key, 0, 0, 0, 0, 0 };
    bleIn->setValue(r, 8); bleIn->notify(bleKeyConn());
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
    uint16_t to = bleKeyConn();
    uint8_t r[2] = { (uint8_t)u, (uint8_t)(u >> 8) }; bleCc->setValue(r, 2); bleCc->notify(to); delay(18);
    r[0] = r[1] = 0; bleCc->setValue(r, 2); bleCc->notify(to); return true;
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
