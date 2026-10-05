#pragma once
#include "Fonts.h"
#include "Icons.h"

LGFX lcd;
LGFX_Sprite spr(&lcd);

constexpr uint16_t C(uint32_t h) { return (((h >> 16) & 0xF8) << 8) | (((h >> 8) & 0xFC) << 3) | ((h & 0xFF) >> 3); }
const uint16_t SC_BG = C(0x0A0C10), SC_PANEL = C(0x161A21), SC_LINE = C(0x262B35), SC_TEXT = C(0xF2F4F8),
               SC_SUB = C(0x8B93A3), SC_DIM = C(0x4A5160), SC_HL = C(0xF2A93B), SC_RED = C(0xF06A6A),
               SC_ACC = C(0x7D9BFF), ICON_BG = C(0x1E232C), HOME_COL = C(0x3B6CF6), WHITE = 0xFFFF;

struct UFont { lgfx::PointerWrapper pw; lgfx::VLWfont vf; void load(const uint8_t* a, size_t n) { pw.set(a, n); vf.loadFont(&pw); } };
UFont FM9, FM10, FM16, FSB11, FSB12, FB10, FB11, FB18, FB26;

static void fontsBegin() {
  FM9.load(fM9, sizeof(fM9)); FM10.load(fM10, sizeof(fM10)); FM16.load(fM16, sizeof(fM16));
  FSB11.load(fSB11, sizeof(fSB11)); FSB12.load(fSB12, sizeof(fSB12));
  FB10.load(fB10, sizeof(fB10)); FB11.load(fB11, sizeof(fB11)); FB18.load(fB18, sizeof(fB18)); FB26.load(fB26, sizeof(fB26));
}

static uint16_t mix(uint16_t a, uint16_t b, float t) {   // t = weight of a
  if (t >= 1) return a; if (t <= 0) return b;
  int ar = a >> 11, ag = (a >> 5) & 63, ab = a & 31, br = b >> 11, bg = (b >> 5) & 63, bb = b & 31;
  return ((int)(br + (ar - br) * t) << 11) | ((int)(bg + (ag - bg) * t) << 5) | (int)(bb + (ab - bb) * t);
}

static void text(const String& s, int x, int y, UFont& f, uint16_t col, textdatum_t d = textdatum_t::middle_left) {
  spr.setFont(&f.vf); spr.setTextColor(col); spr.setTextDatum(d); spr.drawString(s, x, y);
}
static int textW(const String& s, UFont& f) { spr.setFont(&f.vf); return spr.textWidth(s); }
static String fit(String t, int max, UFont& f) {
  if (textW(t, f) <= max) return t;
  while (t.length() > 1) {
    int n = t.length() - 1;
    while (n > 0 && ((uint8_t)t[n] & 0xC0) == 0x80) n--;
    t.remove(n);
    if (textW(t + "…", f) <= max) break;
  }
  return t + "…";
}

static const LineIcon* lineIcon(const String& id) {
  for (int i = 0; i < LINE_ICON_COUNT; i++) if (id == LINE_ICONS[i].id) return &LINE_ICONS[i];
  for (int i = 0; i < LINE_ICON_COUNT; i++) if (!strcmp(LINE_ICONS[i].id, "star")) return &LINE_ICONS[i];
  return &LINE_ICONS[0];
}

// alpha mask (W x W) centred at (cx,cy), drawn over a known background colour
static void blendMask(const uint8_t* m, int W, int cx, int cy, uint16_t col, uint16_t bg) {
  int x0 = cx - W / 2, y0 = cy - W / 2;
  for (int y = 0; y < W; y++) for (int x = 0; x < W; x++) {
    uint8_t a = pgm_read_byte(m + y * W + x);
    if (a > 8) spr.drawPixel(x0 + x, y0 + y, mix(col, bg, a / 255.0f));
  }
}

// 40x40 RGB565 icon scaled to size, faded toward bg by alpha
static void drawPix(const uint16_t* pix, int cx, int cy, int size, float alpha, uint16_t bg) {
  int x0 = cx - size / 2, y0 = cy - size / 2;
  if (size == 40 && alpha >= 1) { spr.pushImage(x0, y0, 40, 40, (const lgfx::rgb565_t*)pix); return; }
  for (int y = 0; y < size; y++) for (int x = 0; x < size; x++) {
    uint16_t c = pix[(y * 40 / size) * 40 + (x * 40 / size)];
    spr.drawPixel(x0 + x, y0 + y, alpha >= 1 ? c : mix(c, bg, alpha));
  }
}

struct Item { bool home; App* app; };
std::vector<Item> items;

static void buildItems() {
  items.clear();
  if (S.homeOn) items.push_back({ true, nullptr });
  for (auto& a : S.apps) if (a.inWheel) items.push_back({ false, &a });
}

static void bubble(bool home, App* a, int x, int y, int r, float alpha) {
  uint16_t col = home ? HOME_COL : a->color;
  if (!home && a->pix) {
    uint16_t bgc = mix(ICON_BG, SC_BG, alpha);
    spr.fillSmoothCircle(x, y, r, bgc);
    if (r >= 15) spr.fillArc(x, y, r - (r > 20 ? 2 : 1), r, 0, 360, mix(col, SC_BG, alpha));
    int sz = r >= 25 ? 40 : (int)(r * 1.3f);
    drawPix(a->pix, x, y, sz, alpha, SC_BG);
  } else {
    uint16_t fill = mix(col, SC_BG, alpha);
    spr.fillSmoothCircle(x, y, r, fill);
    const LineIcon* li = lineIcon(home ? String("home") : a->icon);
    const uint8_t* m = r >= 25 ? li->a34 : r >= 15 ? li->a21 : li->a11;
    int W = (r >= 25 ? 34 : r >= 15 ? 21 : 11) + 4;
    blendMask(m, W, x, y, mix(WHITE, SC_BG, alpha), fill);
  }
}

/* ---------- state shared with main ---------- */
int sel = 0;
float launchP = -1;           // 0..1 while launching
String toastMsg; uint32_t toastUntil = 0;
float hist[2][40]; int histN = 0; uint32_t histStamp = 0;
uint8_t batPct = 0; bool charging = false;

static void toast(const String& m, uint32_t ms = 1800) { toastMsg = m; toastUntil = millis() + ms; }

static void drawStatus(uint16_t accent, const char* link) {
  spr.fillRect(0, 0, 320, 3, accent);
  text(items.size() ? String(sel + 1) + "/" + String(items.size()) : String("0/0"), 8, 15, FSB11, SC_SUB);
  text(link, 252, 15, FSB11, SC_SUB, textdatum_t::middle_right);
  spr.drawRoundRect(258, 10, 22, 10, 2, SC_SUB); spr.fillRect(280, 13, 2, 4, SC_SUB);
  spr.fillRect(260, 12, max(1, 18 * batPct / 100), 6, batPct < 20 ? SC_RED : SC_TEXT);
  text(charging ? String("şarj") : String(batPct) + "%", 316, 15, FM9, SC_SUB, textdatum_t::middle_right);
}

static void drawQuickSlots() {
  const String* q[2] = { &S.quickA, &S.quickB };
  for (int i = 0; i < 2; i++) {
    int x = i ? 164 : 4;
    spr.fillRoundRect(x, 134, 152, 32, 7, SC_PANEL);
    text(i ? "B" : "A", x + 8, 150, FB11, SC_DIM);
    App* a = appById(*q[i]);
    if (a) { bubble(false, a, x + 31, 150, 10, 1); text(fit(a->name, 100, FSB12), x + 47, 150, FSB12, SC_TEXT); }
    else text("Atanmadı", x + 24, 150, FSB12, SC_DIM);
  }
}

static void drawAppView() {
  int n = items.size();
  Item& it = items[sel];
  Item* prev = nullptr; Item* next = nullptr;
  if (n > 1) {
    prev = sel > 0 ? &items[sel - 1] : (S.wrap ? &items[n - 1] : nullptr);
    next = sel < n - 1 ? &items[sel + 1] : (S.wrap ? &items[0] : nullptr);
  }
  auto nm = [](Item* i) { return i->home ? String("Ana sayfa") : i->app->name; };
  if (prev && prev != &it) { bubble(prev->home, prev->app, 54, 62, 19, .42f); text(fit(nm(prev), 84, FM10), 54, 94, FM10, SC_DIM, textdatum_t::middle_center); text("‹", 14, 62, FM16, SC_SUB, textdatum_t::middle_center); }
  if (next && next != &it) { bubble(next->home, next->app, 266, 62, 19, .42f); text(fit(nm(next), 84, FM10), 266, 94, FM10, SC_DIM, textdatum_t::middle_center); text("›", 306, 62, FM16, SC_SUB, textdatum_t::middle_center); }
  bubble(false, it.app, 160, 60, 31, 1);
  uint16_t col = it.app->color;
  if (launchP >= 0) spr.fillArc(160, 60, 35, 38, -90, -90 + 360 * launchP, col);
  text(fit(it.app->name, 150, FB18), 160, 104, FB18, SC_TEXT, textdatum_t::middle_center);
  text(launchP >= 0 ? String("Açılıyor…") : String("çevir: gez  ·  bas: aç"), 160, 120, FM10, launchP >= 0 ? col : SC_SUB, textdatum_t::middle_center);
  drawQuickSlots();
}

/* ---------- home ---------- */
static uint16_t tempColor(float v, int warn, int crit) { return v >= crit ? SC_RED : v >= warn ? SC_HL : SC_TEXT; }

static void drawTempCard(int x, int y, int w, int h, bool cpu) {
  float v = cpu ? temps.cpu : temps.gpu, load = cpu ? temps.cpuLoad : temps.gpuLoad;
  int warn = cpu ? S.cpuWarn : S.gpuWarn, crit = cpu ? S.cpuCrit : S.gpuCrit;
  bool fresh = temps.stamp && millis() - temps.stamp < (uint32_t)max(10, S.interval * 4) * 1000;
  bool ok = fresh && !isnan(v);
  uint16_t col = ok ? tempColor(v, warn, crit) : SC_DIM;
  uint16_t lineCol = col == SC_TEXT ? SC_ACC : col;
  spr.fillRoundRect(x, y, w, h, 8, SC_PANEL);
  text(cpu ? "İŞLEMCİ" : "EKRAN KARTI", x + 10, y + 11, FB10, SC_SUB);
  String sub = cpu ? S.cpuLabel : S.gpuLabel;
  if (!ok) sub = !S.ssid.length() ? "Wi-Fi ayarlı değil" : WiFi.status() != WL_CONNECTED ? "Wi-Fi bağlanıyor…" : !S.host.length() ? "Bilgisayar IP'si yok" : "Veri bekleniyor…";
  text(fit(sub, w - 20, FM9), x + 10, y + 22, FM9, SC_DIM);
  String tv = ok ? String((int)roundf(v)) : String("--");
  text(tv, x + 10, y + 42, FB26, col);
  text("°C", x + 12 + textW(tv, FB26), y + 37, FSB12, col);
  if (S.showLoad && ok && !isnan(load)) text("%" + String((int)roundf(load)), x + w - 10, y + 11, FM10, SC_SUB, textdatum_t::middle_right);
  int k = cpu ? 0 : 1;
  if (ok && histN > 1) {
    float mn = 999, mx = -999; for (int i = 0; i < histN; i++) { mn = min(mn, hist[k][i]); mx = max(mx, hist[k][i]); }
    mn -= 2; mx += 2;
    int sx = x + w - 74, sy = y + 30, sh = 18;
    for (int i = 1; i < histN; i++) {
      float x0 = sx + (i - 1) * (64.0f / 39), x1 = sx + i * (64.0f / 39);
      float y0 = sy + sh - (hist[k][i - 1] - mn) / (mx - mn) * sh, y1 = sy + sh - (hist[k][i] - mn) / (mx - mn) * sh;
      spr.drawWideLine(x0, y0, x1, y1, 0.7f, lineCol);
    }
  }
  int bx = x + 10, bw = w - 20, by = y + h - 9;
  spr.fillRoundRect(bx, by, bw, 4, 2, SC_LINE);
  if (ok) spr.fillRoundRect(bx, by, max(4, (int)(bw * min(1.0f, v / 110.0f))), 4, 2, lineCol);
}

static void drawAnim(int x, int y, int w, int h, uint32_t t) {
  uint16_t c = S.animColor;
  spr.fillRoundRect(x, y, w, h, 8, SC_PANEL);
  spr.setClipRect(x, y, w, h);
  int mx = x + w / 2, my = y + h / 2; float s = t / 1000.0f;
  switch (S.animKind) {
    case A_FAN: {
      float cpu = isnan(temps.cpu) ? 45 : temps.cpu;
      float speed = 0.6f + max(0.0f, cpu - 35) / 25;
      float ang = s * speed * TWO_PI;
      spr.fillArc(mx, my, 50, 52, 0, 360, SC_LINE);
      for (int b = 0; b < 5; b++) {
        float a0 = ang + b * TWO_PI / 5;
        float px[18], py[18]; int n = 0;
        float c1x = mx + cosf(a0 - .5f) * 44, c1y = my + sinf(a0 - .5f) * 44;
        float p2x = mx + cosf(a0 + .35f) * 46, p2y = my + sinf(a0 + .35f) * 46;
        float c2x = mx + cosf(a0 + .2f) * 22, c2y = my + sinf(a0 + .2f) * 22;
        for (int i = 0; i <= 8; i++) { float u = i / 8.0f, v = 1 - u; px[n] = v*v*mx + 2*v*u*c1x + u*u*p2x; py[n++] = v*v*my + 2*v*u*c1y + u*u*p2y; }
        for (int i = 1; i <= 8; i++) { float u = i / 8.0f, v = 1 - u; px[n] = v*v*p2x + 2*v*u*c2x + u*u*mx; py[n++] = v*v*p2y + 2*v*u*c2y + u*u*my; }
        for (int i = 1; i < n - 1; i++) spr.fillTriangle(px[0], py[0], px[i], py[i], px[i + 1], py[i + 1], c);
      }
      spr.fillSmoothCircle(mx, my, 11, SC_BG);
      spr.fillArc(mx, my, 10, 12, 0, 360, c);
      break; }
    case A_RADAR: {
      for (int r : { 18, 34, 50 }) spr.drawCircle(mx, my, r, SC_LINE);
      spr.drawFastHLine(mx - 54, my, 108, SC_LINE); spr.drawFastVLine(mx, my - 54, 108, SC_LINE);
      float a = fmodf(s * 1.6f, TWO_PI), deg = a * RAD_TO_DEG;
      for (int i = 17; i >= 0; i--) spr.fillArc(mx, my, 0, 50, deg - (i + 1) * 2.865f, deg - i * 2.865f, mix(c, SC_PANEL, (1 - i / 18.0f) * .5f));
      spr.drawWideLine(mx, my, mx + cosf(a) * 50, my + sinf(a) * 50, 1.0f, c);
      const float bl[3][2] = { { .7f, 24 }, { 2.4f, 40 }, { 4.1f, 30 } };
      for (auto& b : bl) {
        float d = fmodf(a - b[0] + TWO_PI * 2, TWO_PI), al = max(0.0f, 1 - d / 3);
        if (al > 0) spr.fillSmoothCircle(mx + cosf(b[0]) * b[1], my + sinf(b[0]) * b[1], 3, mix(c, SC_PANEL, al));
      }
      break; }
    case A_PULSE: {
      for (int i = 0; i < 3; i++) {
        float p = fmodf(s * .6f + i / 3.0f, 1), r = 10 + p * 48, lw = 3 * (1 - p) + 1;
        spr.fillArc(mx, my, r - lw / 2, r + lw / 2, 0, 360, mix(c, SC_PANEL, 1 - p));
      }
      spr.fillSmoothCircle(mx, my, 9 + 2 * sinf(s * 6), c);
      break; }
    case A_EQ: {
      float bw = (w - 28) / 9.0f;
      for (int i = 0; i < 9; i++) {
        float v = .25f + .75f * fabsf(sinf(s * (1.3f + i * .37f) + i * 1.7f) * cosf(s * .7f + i));
        int bh = v * (h - 36);
        spr.fillRoundRect(x + 14 + i * bw + 2, y + h - 16 - bh, bw - 4, bh, 2, mix(c, SC_PANEL, .35f + .65f * v));
      }
      break; }
    case A_CUSTOM:
      if (anim.frames) {
        int f = (int)(s * S.animFps) % anim.frames;
        const uint16_t* px = animFrame(f);
        if (px) spr.pushImage(x, y, 128, 128, (const lgfx::rgb565_t*)px);
      } else text("Animasyon yüklenmedi", mx, my, FM10, SC_DIM, textdatum_t::middle_center);
      break;
    default:
      text("Animasyon kapalı", mx, my, FM10, SC_DIM, textdatum_t::middle_center);
  }
  spr.clearClipRect();
}

static void drawHome() {
  drawAnim(6, 24, 128, 128, millis());
  drawTempCard(140, 24, 174, 62, true);
  drawTempCard(140, 90, 174, 62, false);
  const String* q[2] = { &S.quickA, &S.quickB };
  for (int i = 0; i < 2; i++) {
    int x = i ? 164 : 8; App* a = appById(*q[i]);
    text(i ? "B" : "A", x, 162, FM10, SC_DIM);
    text(a ? fit(a->name, 130, FM10) : String("—"), x + 12, 162, FM10, a ? SC_SUB : SC_DIM);
  }
}

static void drawToast() {
  if (millis() > toastUntil) return;
  int w = min(300, textW(toastMsg, FSB11) + 28);
  spr.fillRoundRect(160 - w / 2, 138, w, 26, 8, SC_BG);
  spr.drawRoundRect(160 - w / 2, 138, w, 26, 8, SC_HL);
  text(toastMsg, 160, 151, FSB11, SC_TEXT, textdatum_t::middle_center);
}

static void render(const char* link) {
  spr.fillSprite(SC_BG);
  if (items.empty()) {
    drawStatus(SC_DIM, link);
    text("Döndürgeç listesi boş", 160, 80, FSB12, SC_SUB, textdatum_t::middle_center);
  } else {
    if (sel >= (int)items.size()) sel = items.size() - 1;
    Item& it = items[sel];
    drawStatus(it.home ? HOME_COL : it.app->color, link);
    if (it.home) drawHome(); else drawAppView();
  }
  drawToast();
  spr.pushSprite(0, 0);
}

static void uiBegin() {
  lcd.init();
  lcd.setRotation(S.flip ? 3 : 1);
  lcd.setBrightness(0);
  spr.setColorDepth(16);
  spr.setPsram(psramFound());
  if (!spr.createSprite(320, 170)) { spr.setPsram(false); spr.createSprite(320, 170); }
  fontsBegin();
}
