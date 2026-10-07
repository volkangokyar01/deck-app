#pragma once
#include "Fonts.h"
#include "Icons.h"

LGFX lcd;
LGFX_Sprite spr(&lcd);

constexpr uint16_t C(uint32_t h) { return (((h >> 16) & 0xF8) << 8) | (((h >> 8) & 0xFC) << 3) | ((h & 0xFF) >> 3); }
uint16_t SC_BG = C(0x000000), SC_PANEL = C(0x0F1012), SC_LINE = C(0x222326), SC_TEXT = C(0xF2F3F5),
         SC_SUB = C(0x8E9199), SC_DIM = C(0x4A4C52), SC_HL = C(0xF2A93B), SC_RED = C(0xF06A6A),
         SC_ACC = C(0x7D9BFF), ICON_BG = C(0x18191C), SC_GREEN = C(0x3DD68C), SC_SUN = C(0xF2C94C), SC_RAIN = C(0x5AB0FF);
const uint16_t HOME_COL = C(0x3B6CF6), WHITE = 0xFFFF, INK = C(0x17181B);
bool lightTheme = false, ecoActive = false;
int ecoAnimFps = 4;
bool homeFrameShown = false;   // LCD contains a complete home animation frame

void applyTheme(bool light) {
  lightTheme = light;
  SC_BG = C(light ? 0xFAF8F3 : 0x000000); SC_PANEL = C(light ? 0xECE8E0 : 0x0F1012);
  SC_LINE = C(light ? 0xD9D4CA : 0x222326); ICON_BG = C(light ? 0xE2DDD3 : 0x18191C);
  SC_TEXT = C(light ? 0x17181B : 0xF2F3F5); SC_SUB = C(light ? 0x5C5F66 : 0x8E9199); SC_DIM = C(light ? 0xA29F98 : 0x4A4C52);
  SC_HL = C(light ? 0xD4850A : 0xF2A93B); SC_RED = C(light ? 0xD64545 : 0xF06A6A); SC_ACC = C(light ? 0x3B5BDB : 0x7D9BFF);
  SC_GREEN = C(light ? 0x1E9E5A : 0x3DD68C); SC_SUN = C(light ? 0xC08A00 : 0xF2C94C); SC_RAIN = C(light ? 0x2B7FD9 : 0x5AB0FF);
}

static bool effectiveLight() {
  if (S.theme == "light") return true;
  if (S.theme == "dark") return false;
  struct tm t; if (!localTime(t)) return false;
  int m = t.tm_hour * 60 + t.tm_min;
  return S.lightFrom <= S.darkFrom ? m >= S.lightFrom && m < S.darkFrom : m >= S.lightFrom || m < S.darkFrom;
}

// Choose readable ink on page / player / user colours, without changing their fills.
static float linear(float v) { return v <= .04045f ? v / 12.92f : powf((v + .055f) / 1.055f, 2.4f); }
static uint16_t onColor(uint16_t c) {
  float y = .2126f * linear((c >> 11) / 31.0f) + .7152f * linear(((c >> 5) & 63) / 63.0f) + .0722f * linear((c & 31) / 31.0f);
  return y > .20f ? INK : WHITE;
}

struct UFont { lgfx::PointerWrapper pw; lgfx::VLWfont vf; void load(const uint8_t* a, size_t n) { pw.set(a, n); vf.loadFont(&pw); } };
UFont FM9, FM10, FM16, FSB11, FSB12, FB10, FB11, FB18, FB26, FN36;

static void fontsBegin() {
  FM9.load(fM9, sizeof(fM9)); FM10.load(fM10, sizeof(fM10)); FM16.load(fM16, sizeof(fM16));
  FSB11.load(fSB11, sizeof(fSB11)); FSB12.load(fSB12, sizeof(fSB12));
  FB10.load(fB10, sizeof(fB10)); FB11.load(fB11, sizeof(fB11)); FB18.load(fB18, sizeof(fB18)); FB26.load(fB26, sizeof(fB26));
  FN36.load(fN36, sizeof(fN36));
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

enum ItemKind : uint8_t { K_HOME = 0, K_MEDIA, K_SYS, K_APP, K_WIDGETS, K_CONN, K_MENU };
struct Item { bool home; App* app; uint8_t kind; };
std::vector<Item> items;
// Medya, Ses ve parlaklık and Bağlantılar live in one "Menü" item (1.9.4): the wheel holds home, cards and
// apps; the menu sits last, one step back from home. subPage = the page open inside the menu (0 = the list).
uint8_t subPage = 0;
// One knob step from item i (dir +1 right, -1 left). The menu (always the last item) is reached only by
// turning left on the first item (home); turning right past the last app goes back to home, not the menu.
static int wheelStep(int i, int dir) {
  int n = items.size(); if (n < 2) return i;
  bool hasMenu = items[n - 1].kind == K_MENU;
  int last = hasMenu ? n - 2 : n - 1;              // last item of the normal ring
  if (hasMenu && i == n - 1) return dir > 0 ? 0 : (S.wrap ? last : i);
  if (dir < 0) return i > 0 ? i - 1 : (hasMenu ? n - 1 : (S.wrap ? last : i));
  return i < last ? i + 1 : (S.wrap ? 0 : i);
}

static void buildItems() {
  items.clear();
  if (S.homeOn) items.push_back({ true, nullptr, K_HOME });
  if (S.widgetsOn) items.push_back({ false, nullptr, K_WIDGETS });
  for (auto& a : S.apps) if (a.inWheel) items.push_back({ false, &a, K_APP });
  if (S.mediaOn || S.sysOn || S.connOn) items.push_back({ false, nullptr, K_MENU });
  subPage = 0;
}
static String itemId(const Item& it) {
  switch (it.kind) { case K_HOME: return "home"; case K_MEDIA: return "media"; case K_SYS: return "system"; case K_WIDGETS: return "widgets"; case K_CONN: return "connections"; case K_MENU: return "menu"; default: return it.app->id; }
}

const uint16_t MEDIA_COL = C(0xE0457B), SYS_COL = C(0x0EA5A4), WIDG_COL = C(0x8B5CF6), CONN_COL = C(0x2563EB), MENU_COL = C(0x475569);
// Bluetooth rune, h = height
static void gBt(int cx, int cy, int h, uint16_t c, float w = 1.6f) {
  int t = h / 2, q = h / 4;
  spr.drawWideLine(cx - q, cy - q, cx + q, cy + q, w, c); spr.drawWideLine(cx + q, cy + q, cx, cy + t, w, c);
  spr.drawWideLine(cx, cy + t, cx, cy - t, w, c);         spr.drawWideLine(cx, cy - t, cx + q, cy - q, w, c);
  spr.drawWideLine(cx + q, cy - q, cx - q, cy + q, w, c);
}
// Wi-Fi fan, about 18 x 13
static void gWifi(int cx, int cy, uint16_t c) {
  spr.drawArc(cx, cy + 6, 13, 11, 225, 315, c); spr.drawArc(cx, cy + 6, 8, 6, 225, 315, c); spr.fillSmoothCircle(cx, cy + 5, 2, c);
}
static void bubble(bool home, App* a, int x, int y, int r, float alpha, uint8_t kind = 255) {
  if (kind == K_MENU) {                      // 2 x 2 tiles
    uint16_t fill = mix(MENU_COL, SC_BG, alpha), fg = mix(onColor(MENU_COL), SC_BG, alpha);
    spr.fillSmoothCircle(x, y, r, fill);
    int t = r >= 25 ? 9 : r >= 15 ? 6 : 3, g = r >= 25 ? 3 : 2;
    for (int i = 0; i < 4; i++) spr.fillRoundRect(x - t - g / 2 + (i & 1) * (t + g), y - t - g / 2 + (i >> 1) * (t + g), t, t, t > 4 ? 2 : 1, fg);
    return;
  }
  if (kind == K_CONN) {
    uint16_t fill = mix(CONN_COL, SC_BG, alpha);
    spr.fillSmoothCircle(x, y, r, fill);
    gBt(x, y, r >= 25 ? 30 : r >= 15 ? 18 : 10, mix(onColor(CONN_COL), SC_BG, alpha), r >= 25 ? 2.4f : r >= 15 ? 1.6f : 1.0f);
    return;
  }
  if (kind == K_MEDIA || kind == K_SYS || kind == K_WIDGETS) {      // page bubbles use a line icon on their own colour
    uint16_t col = kind == K_MEDIA ? MEDIA_COL : kind == K_SYS ? SYS_COL : WIDG_COL, fill = mix(col, SC_BG, alpha);
    spr.fillSmoothCircle(x, y, r, fill);
    const LineIcon* li = lineIcon(kind == K_MEDIA ? String("music") : kind == K_SYS ? String("gear") : String("activity"));
    const uint8_t* m = r >= 25 ? li->a34 : r >= 15 ? li->a21 : li->a11;
    blendMask(m, (r >= 25 ? 34 : r >= 15 ? 21 : 11) + 4, x, y, mix(onColor(col), SC_BG, alpha), fill);
    return;
  }
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
    blendMask(m, W, x, y, mix(onColor(col), SC_BG, alpha), fill);
  }
}

/* ---------- state shared with main ---------- */
int sel = 0;
float launchP = -1;           // 0..1 while launching
String toastMsg; uint32_t toastUntil = 0;
uint8_t batPct = 0; bool charging = false, extPower = false;

static void toast(const String& m, uint32_t ms = 1800) { toastMsg = m; toastUntil = millis() + ms; }

// Layout: 2 px outer margin, 2 px between panels, panels separated by tone only (no outlines).
// Status row is y 0..13, content y 15..167. x0: where the row starts (home: right of the animation).
static void drawStatus(uint16_t dot, const char* link, int x0 = 2) {
  spr.fillSmoothCircle(x0 + 4, 7, 4, dot);     // page colour (was a 3 px bar across the top)
  text(items.size() ? String(sel + 1) + "/" + String(items.size()) : String("0/0"), x0 + 12, 7, FSB11, SC_SUB);
  text(link, 254, 7, FSB11, SC_SUB, textdatum_t::middle_right);
  spr.drawRoundRect(260, 2, 22, 10, 2, SC_SUB); spr.fillRect(282, 5, 2, 4, SC_SUB);
  spr.fillRect(262, 4, max(1, 18 * batPct / 100), 6, batPct < 20 && !charging ? SC_RED : SC_TEXT);
  if (charging) {   // lightning bolt across the cell while charging; the level stays visible
    spr.fillTriangle(273, 2, 266, 8, 271, 8, SC_BG); spr.fillTriangle(270, 6, 276, 6, 269, 12, SC_BG);
    spr.fillTriangle(272, 3, 268, 7, 271, 7, SC_TEXT); spr.fillTriangle(271, 7, 274, 7, 270, 11, SC_TEXT);
  }
  text(String(batPct) + "%", 318, 7, FM9, SC_SUB, textdatum_t::middle_right);
}

static void drawQuickSlots() {
  const String* q[2] = { &S.quickA, &S.quickB };
  for (int i = 0; i < 2; i++) {
    int x = i ? 161 : 2;
    spr.fillRoundRect(x, 142, 157, 26, 6, SC_PANEL);
    text(i ? "B" : "A", x + 8, 155, FB11, SC_DIM);
    App* a = appById(*q[i]);
    if (a) { bubble(false, a, x + 28, 155, 10, 1); text(fit(a->name, 108, FSB12), x + 43, 155, FSB12, SC_TEXT); }
    else text("Atanmadı", x + 24, 155, FSB12, SC_DIM);
  }
}

static String itemName(const Item& i) {
  switch (i.kind) { case K_HOME: return "Ana sayfa"; case K_MEDIA: return "Medya"; case K_SYS: return "Ses ve parlaklık"; case K_WIDGETS: return "Widgetlar"; case K_CONN: return "Bağlantılar"; case K_MENU: return "Menü"; default: return i.app->name; }
}
static void drawAppView() {
  int n = items.size();
  Item& it = items[sel];
  Item* prev = nullptr; Item* next = nullptr;
  if (n > 1) {
    int p = wheelStep(sel, -1), q = wheelStep(sel, 1);
    prev = p != sel ? &items[p] : nullptr;
    next = q != sel ? &items[q] : nullptr;
  }
  auto nm = [](Item* i) { return itemName(*i); };
  if (prev && prev != &it) { bubble(prev->home, prev->app, 52, 58, 21, .42f, prev->kind); text(fit(nm(prev), 92, FM10), 52, 92, FM10, SC_DIM, textdatum_t::middle_center); text("‹", 10, 58, FM16, SC_SUB, textdatum_t::middle_center); }
  if (next && next != &it) { bubble(next->home, next->app, 268, 58, 21, .42f, next->kind); text(fit(nm(next), 92, FM10), 268, 92, FM10, SC_DIM, textdatum_t::middle_center); text("›", 310, 58, FM16, SC_SUB, textdatum_t::middle_center); }
  bubble(false, it.app, 160, 56, 33, 1);
  uint16_t col = it.app->color;
  if (launchP >= 0) spr.fillArc(160, 56, 37, 40, -90, -90 + 360 * launchP, col);
  text(fit(it.app->name, 296, FB18), 160, 107, FB18, SC_TEXT, textdatum_t::middle_center);   // below the side names, so it can use the full width
  text(launchP >= 0 ? String("Açılıyor…") : String("çevir: gez  ·  bas: aç"), 160, 126, FM10, launchP >= 0 ? col : SC_SUB, textdatum_t::middle_center);
  drawQuickSlots();
}

/* ---------- small 14 px app icon (box-filtered from the 40 px image) ---------- */
static void miniIcon(App* a, int cx, int cy) {
  const int N = 14; int x0 = cx - N / 2, y0 = cy - N / 2;
  if (a->pix) {
    for (int y = 0; y < N; y++) for (int x = 0; x < N; x++) {
      int sx0 = x * 40 / N, sx1 = (x + 1) * 40 / N, sy0 = y * 40 / N, sy1 = (y + 1) * 40 / N, r = 0, g = 0, b = 0, n = 0;
      for (int yy = sy0; yy < sy1; yy++) for (int xx = sx0; xx < sx1; xx++) { uint16_t c = a->pix[yy * 40 + xx]; r += c >> 11; g += (c >> 5) & 63; b += c & 31; n++; }
      spr.drawPixel(x0 + x, y0 + y, ((r / n) << 11) | ((g / n) << 5) | (b / n));
    }
  } else {
    spr.fillSmoothCircle(cx, cy, 7, a->color);
    blendMask(lineIcon(a->icon)->a11, 15, cx, cy, onColor(a->color), a->color);
  }
}

/* ---------- home: two widget slots ---------- */
static bool companionOn();
static const char* DAY_TR[7] = { "Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt" };
static const char* MON_TR[12] = { "Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara" };

static uint16_t tempColor(float v, int warn, int crit) { return v >= crit ? SC_RED : v >= warn ? SC_HL : SC_TEXT; }
static String fmtNum(float v, int dec) {          // Turkish decimal comma
  char b[16]; snprintf(b, sizeof b, "%.*f", dec, v);
  for (char* p = b; *p; p++) if (*p == '.') *p = ',';
  return b;
}
static String waitText() { return companionOn() ? "Veri bekleniyor…" : "Masaüstü uygulaması kapalı"; }
static void tri(int cx, int cy, bool up, uint16_t c) {   // small ▲ / ▼
  if (up) spr.fillTriangle(cx - 4, cy + 2, cx + 4, cy + 2, cx, cy - 3, c);
  else spr.fillTriangle(cx - 4, cy - 2, cx + 4, cy - 2, cx, cy + 3, c);
}
// big value (36 px) with a small unit raised beside it, like "54 °C"
static void bigValue(const String& v, const String& unit, int x, int y, uint16_t col) {
  text(v, x, y, FN36, col);
  if (unit.length()) text(unit, x + 2 + textW(v, FN36), y - 8, FSB12, col);
}
// trend line, newest sample at the right; NAN samples leave a gap. zero: scale from 0 (rates), else around the values
static void trend(const Hist& h, int sx, int sy, int sw, int sh, uint16_t col, bool zero) {
  float mn = 1e9, mx = -1e9; int n = 0;
  for (int i = 0; i < h.n; i++) if (!isnan(h.v[i])) { mn = min(mn, h.v[i]); mx = max(mx, h.v[i]); n++; }
  if (n < 2) return;
  if (zero) { mn = 0; mx = max(mx * 1.15f, 1.0f); } else { mn -= 2; mx += 2; }
  float step = sw / 39.0f, x0 = sx + (40 - h.n) * step;
  for (int i = 1; i < h.n; i++) {
    if (isnan(h.v[i - 1]) || isnan(h.v[i])) continue;
    spr.drawWideLine(x0 + (i - 1) * step, sy + sh - (h.v[i - 1] - mn) / (mx - mn) * sh,
                     x0 + i * step, sy + sh - (h.v[i] - mn) / (mx - mn) * sh, 0.7f, col);
  }
}

// cpu / gpu: big temperature, name, load %, power, trend, 0–110 °C bar; no temperature (no driver) → load big
static void drawPcCard(int x, int y, int w, int h, bool gpu) {
  const PcStat& p = gpu ? st.gpu : st.cpu;
  bool ok = gpu ? gpuFresh() : cpuFresh();
  bool hasT = ok && !isnan(p.temp), hasL = ok && !isnan(p.load);
  int warn = gpu ? S.gpuWarn : S.cpuWarn, crit = gpu ? S.gpuCrit : S.cpuCrit;
  uint16_t col = hasT ? tempColor(p.temp, warn, crit) : hasL ? SC_TEXT : SC_DIM;
  uint16_t lineCol = col == SC_TEXT || col == SC_DIM ? SC_ACC : col;
  spr.fillRoundRect(x, y, w, h, 8, SC_PANEL);
  String right;
  if (ok && !isnan(p.power)) right = String((int)roundf(p.power)) + " W";
  if (S.showLoad && hasT && hasL) right += (right.length() ? "  ·  %" : "%") + String((int)roundf(p.load));
  text(gpu ? "GPU" : "CPU", x + 8, y + 9, FB10, SC_SUB);
  if (right.length()) text(right, x + w - 8, y + 9, FSB11, SC_SUB, textdatum_t::middle_right);
  // second line: name on the left, details on the right (gpu fan + VRAM, cpu clock)
  String extra;
  if (ok) {
    if (gpu) {
      if (!isnan(p.fan)) extra = "fan %" + String((int)roundf(p.fan));
      if (!isnan(p.vram)) extra += (extra.length() ? " · " : "") + fmtNum(p.vram, 1) + (!isnan(p.vramTotal) ? "/" + String((int)roundf(p.vramTotal)) : String("")) + " GB";
    } else if (!isnan(p.clock)) extra = fmtNum(p.clock, 1) + " GHz";
  }
  String name = gpu ? S.gpuLabel : S.cpuLabel;
  if (!name.length()) name = p.name;
  if (!ok) name = waitText();
  int ew = extra.length() ? textW(extra, FM9) + 8 : 0;
  if (extra.length()) text(extra, x + w - 8, y + 20, FM9, SC_DIM, textdatum_t::middle_right);
  text(fit(name, w - 16 - ew, FM9), x + 8, y + 20, FM9, SC_DIM);
  if (hasT) bigValue(String((int)roundf(p.temp)), "°C", x + 7, y + 45, col);
  else if (hasL) { bigValue(String((int)roundf(p.load)), "%", x + 7, y + 45, col); text("sıcaklık okunamıyor", x + w - 8, y + 45, FM9, SC_DIM, textdatum_t::middle_right); }
  else bigValue("--", "°C", x + 7, y + 45, SC_DIM);
  if (hasT) trend(gpu ? st.gpuT : st.cpuT, x + w - 78, y + 30, 70, 26, lineCol, false);
  int bx = x + 8, bw = w - 16, by = y + h - 9;
  spr.fillRoundRect(bx, by, bw, 4, 2, SC_LINE);
  float frac = hasT ? p.temp / 110.0f : hasL ? p.load / 100.0f : -1;
  if (frac >= 0) spr.fillRoundRect(bx, by, max(4, (int)(bw * min(1.0f, frac))), 4, 2, lineCol);
}

// clock: HH:MM (24 h) centred, Turkish date below ("Pzt 5 Eki")
static void drawClockCard(int x, int y, int w, int h) {
  spr.fillRoundRect(x, y, w, h, 8, SC_PANEL);
  struct tm t;
  if (localTime(t)) {
    char b[8]; snprintf(b, sizeof b, "%02d:%02d", t.tm_hour, t.tm_min);
    text(b, x + w / 2, y + 31, FN36, SC_TEXT, textdatum_t::middle_center);
    text(String(DAY_TR[t.tm_wday]) + " " + String(t.tm_mday) + " " + MON_TR[t.tm_mon], x + w / 2, y + 60, FSB12, SC_SUB, textdatum_t::middle_center);
  } else {
    text("--:--", x + w / 2, y + 31, FN36, SC_DIM, textdatum_t::middle_center);
    text(fit(waitText(), w - 16, FM9), x + w / 2, y + 60, FM9, SC_DIM, textdatum_t::middle_center);
  }
}

/* weather icon from the WMO code (Open-Meteo), about 30 x 30 centred at (cx, cy) */
enum WxKind : uint8_t { WX_CLEAR, WX_PARTLY, WX_CLOUDY, WX_FOG, WX_RAIN, WX_SNOW, WX_THUNDER, WX_NONE };
static uint8_t wxKind(int code) {
  if (code < 0) return WX_NONE;
  if (code == 0) return WX_CLEAR;
  if (code <= 2) return WX_PARTLY;
  if (code == 3) return WX_CLOUDY;
  if (code == 45 || code == 48) return WX_FOG;
  if ((code >= 71 && code <= 77) || code == 85 || code == 86) return WX_SNOW;
  if (code >= 95) return WX_THUNDER;
  if (code >= 51 && code <= 82) return WX_RAIN;
  return WX_CLOUDY;
}
static const char* WX_NAME[8] = { "Açık", "Parçalı bulutlu", "Bulutlu", "Sisli", "Yağmurlu", "Karlı", "Gök gürültülü", "" };
static void cloud(int cx, int cy, uint16_t c) {   // about 26 x 17 around (cx, cy)
  spr.fillSmoothCircle(cx - 6, cy + 1, 6, c);
  spr.fillSmoothCircle(cx + 2, cy - 3, 8, c);
  spr.fillSmoothCircle(cx + 8, cy + 2, 5, c);
  spr.fillSmoothRoundRect(cx - 12, cy + 1, 25, 7, 3, c);
}
static void sun(int cx, int cy, int r, uint16_t c) {
  spr.fillSmoothCircle(cx, cy, r, c);
  for (int i = 0; i < 8; i++) { float a = i * PI / 4; spr.drawWideLine(cx + cosf(a) * (r + 3), cy + sinf(a) * (r + 3), cx + cosf(a) * (r + 6), cy + sinf(a) * (r + 6), 1.0f, c); }
}
static void wxIcon(uint8_t k, int cx, int cy) {
  const uint16_t CL = mix(SC_TEXT, SC_SUB, .6f), CD = SC_SUB;
  switch (k) {
    case WX_CLEAR: sun(cx, cy, 7, SC_SUN); break;
    case WX_PARTLY: sun(cx + 5, cy - 6, 5, SC_SUN); cloud(cx - 2, cy + 4, SC_PANEL); cloud(cx - 2, cy + 5, CL); break;
    case WX_CLOUDY: cloud(cx + 5, cy - 5, CD); cloud(cx - 2, cy + 3, CL); break;
    case WX_FOG: cloud(cx, cy - 6, CD); for (int i = 0; i < 3; i++) spr.fillSmoothRoundRect(cx - 12 + (i & 1) * 3, cy + 5 + i * 4, 21, 2, 1, CL); break;
    case WX_RAIN: cloud(cx, cy - 5, CL); for (int i = 0; i < 3; i++) spr.drawWideLine(cx - 5 + i * 6, cy + 6, cx - 8 + i * 6, cy + 13, 1.1f, SC_RAIN); break;
    case WX_SNOW: cloud(cx, cy - 5, CL); for (int i = 0; i < 3; i++) spr.fillSmoothCircle(cx - 7 + i * 7, cy + 9 + (i & 1) * 3, 2, SC_TEXT); break;
    case WX_THUNDER: cloud(cx, cy - 5, CD);
      spr.fillTriangle(cx + 2, cy + 2, cx - 5, cy + 10, cx, cy + 10, SC_SUN); spr.fillTriangle(cx + 2, cy + 8, cx - 2, cy + 8, cx - 4, cy + 16, SC_SUN); break;
    default: cloud(cx, cy, SC_LINE);
  }
}

// weather: icon, big temperature, city, condition, hi / lo, chance of rain
static void drawWeatherCard(int x, int y, int w, int h) {
  bool ok = wxFresh();
  spr.fillRoundRect(x, y, w, h, 8, SC_PANEL);
  String city = st.wx.city.length() ? st.wx.city : S.wxCity.length() ? S.wxCity : String("Hava durumu");
  String rain = ok && !isnan(st.wx.rain) ? "yağış %" + String((int)roundf(st.wx.rain)) : String("yağış -");
  text(rain, x + w - 8, y + 9, FSB11, SC_SUB, textdatum_t::middle_right);
  text(fit(city, w - 24 - textW(rain, FSB11), FB10), x + 8, y + 9, FB10, SC_SUB);
  uint8_t k = ok ? wxKind(st.wx.code) : (uint8_t)WX_NONE;
  text(fit(ok ? String(WX_NAME[k]) : waitText(), w - 16, FM9), x + 8, y + 20, FM9, SC_DIM);
  wxIcon(k, x + 23, y + 47);
  bool hasT = ok && !isnan(st.wx.temp);
  bigValue(hasT ? String((int)roundf(st.wx.temp)) : String("--"), "°", x + 45, y + 47, hasT ? SC_TEXT : SC_DIM);
  auto deg = [&](float v) { return ok && !isnan(v) ? String((int)roundf(v)) + "°" : String("-"); };
  String hi = deg(st.wx.hi), lo = deg(st.wx.lo);
  int cw = max(textW(hi, FSB12), textW(lo, FSB12));
  text(hi, x + w - 8, y + 38, FSB12, SC_TEXT, textdatum_t::middle_right);
  text(lo, x + w - 8, y + 56, FSB12, SC_SUB, textdatum_t::middle_right);
  tri(x + w - 15 - cw, y + 38, true, SC_HL);
  tri(x + w - 15 - cw, y + 56, false, SC_ACC);
}

// fx: USD and EUR in TRY (2 decimals) with the change vs the previous day
static void drawFxCard(int x, int y, int w, int h) {
  bool ok = fxFresh();
  spr.fillRoundRect(x, y, w, h, 8, SC_PANEL);
  for (int i = 0; i < 2; i++) {
    int ry = i ? y + h - 20 : y + 20;
    float v = i ? st.fx.eur : st.fx.usd, chg = i ? st.fx.eurChg : st.fx.usdChg;
    text(i ? "EUR" : "USD", x + 8, ry, FB11, SC_SUB);
    bool has = ok && !isnan(v);
    String vs = has ? fmtNum(v, 2) : String("-");
    bool narrow = w < 180;                       // half-width card on the widgets page
    UFont& vf = narrow ? FB18 : FB26;
    text(vs, x + 42, ry, vf, has ? SC_TEXT : SC_DIM);
    if (has && !narrow) text("TL", x + 45 + textW(vs, vf), ry + 4, FM9, SC_DIM);
    if (ok && !isnan(chg)) {
      bool up = chg > 0.004f, down = chg < -0.004f;
      uint16_t c = up ? SC_GREEN : down ? SC_RED : SC_DIM;
      String cs = "%" + fmtNum(fabsf(chg), 2);
      text(cs, x + w - 8, ry, FSB12, c, textdatum_t::middle_right);
      if (up || down) tri(x + w - 15 - textW(cs, FSB12), ry, up, c);
    } else text("-", x + w - 8, ry, FSB12, SC_DIM, textdatum_t::middle_right);
  }
  if (!ok) text(fit(waitText(), w - 16, FM9), x + w / 2, y + h / 2, FM9, SC_DIM, textdatum_t::middle_center);
}

// net: download big (Mb/s, kB/s when small), upload, ping coloured by quality, download trend
static void rate(float mbps, String& v, String& unit) {
  unit = "Mb/s";
  if (isnan(mbps)) { v = "--"; return; }
  if (mbps < 1) { float kb = mbps * 125; unit = "kB/s"; v = kb < 10 ? fmtNum(kb, 1) : String((int)roundf(kb)); }
  else if (mbps < 10) v = fmtNum(mbps, 1);
  else if (mbps < 1000) v = String((int)roundf(mbps));
  else { v = fmtNum(mbps / 1000, 1); unit = "Gb/s"; }
}
static void drawNetCard(int x, int y, int w, int h) {
  bool ok = netFresh();
  spr.fillRoundRect(x, y, w, h, 8, SC_PANEL);
  text("AĞ", x + 8, y + 9, FB10, SC_SUB);
  if (ok && !isnan(st.net.ping)) {
    float p = st.net.ping;
    String ps = String((int)roundf(p)) + " ms";
    text(ps, x + w - 8, y + 9, FSB11, p < 40 ? SC_GREEN : p < 100 ? SC_HL : SC_RED, textdatum_t::middle_right);
    text("ping", x + w - 12 - textW(ps, FSB11), y + 9, FM9, SC_DIM, textdatum_t::middle_right);
  } else text("ping -", x + w - 8, y + 9, FSB11, SC_DIM, textdatum_t::middle_right);
  if (!ok) text(fit(waitText(), w - 16, FM9), x + 8, y + 20, FM9, SC_DIM);
  else { tri(x + 11, y + 20, false, SC_ACC); text("indirme", x + 18, y + 20, FM9, SC_DIM); }
  String v, u;
  rate(ok ? st.net.down : NAN, v, u);
  bigValue(v, u, x + 7, y + 43, ok && !isnan(st.net.down) ? SC_TEXT : SC_DIM);
  if (ok) trend(st.netD, x + w - 72, y + 28, 64, 28, SC_ACC, true);
  rate(ok ? st.net.up : NAN, v, u);
  String up = v == "--" ? String("-") : v + " " + u;
  tri(x + 11, y + h - 10, true, SC_SUB);
  text(up, x + 18, y + h - 10, FSB12, SC_SUB);
  text("yükleme", x + 22 + textW(up, FSB12), y + h - 10, FM9, SC_DIM);
}

static void drawCard(uint8_t wdg, int x, int y, int w, int h) {
  switch (wdg) {
    case W_GPU: drawPcCard(x, y, w, h, true); break;
    case W_CLOCK: drawClockCard(x, y, w, h); break;
    case W_WEATHER: drawWeatherCard(x, y, w, h); break;
    case W_FX: drawFxCard(x, y, w, h); break;
    case W_NET: drawNetCard(x, y, w, h); break;
    default: drawPcCard(x, y, w, h, false);
  }
}

static void drawAnim(int x, int y, int w, int h, uint32_t t) {
  if (ecoActive && ecoAnimFps == 0 && homeFrameShown) return;
  if (ecoActive && ecoAnimFps > 0) { uint32_t gap = 1000 / ecoAnimFps; t -= t % gap; }
  uint16_t c = S.animColor;
  spr.fillRoundRect(x, y, w, h, 8, SC_PANEL);
  spr.setClipRect(x, y, w, h);
  int mx = x + w / 2, my = y + h / 2; float s = t / 1000.0f;
  switch (S.animKind) {
    case A_FAN: {
      float cpu = cpuFresh() && !isnan(st.cpu.temp) ? st.cpu.temp : 45;
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
      if (Anim& A = themeAnim(lightTheme); A.frames) {
        int f = animIndex(A, t, &A == &anim ? S.animFps : A.fps);   // the dark slot follows the speed setting
        const uint16_t* px = animFrame(A, f);
        if (px) spr.pushImage(x, y, 128, 128, (const lgfx::rgb565_t*)px);
      } else text("Animasyon yüklenmedi", mx, my, FM10, SC_DIM, textdatum_t::middle_center);
      break;
    default:
      text("Animasyon kapalı", mx, my, FM10, SC_DIM, textdatum_t::middle_center);
  }
  spr.clearClipRect();
}

// widgets page: 1 = full screen, 2 = stacked, 3 = wide top + two below, 4 = 2×2 (same rects as the settings preview)
static void drawWidgets() {
  static const int16_t RF[4] = { 2, 15, 316, 153 }, RT[4] = { 2, 15, 316, 76 }, RB[4] = { 2, 93, 316, 75 },
    RTL[4] = { 2, 15, 157, 76 }, RTR[4] = { 161, 15, 157, 76 }, RBL[4] = { 2, 93, 157, 75 }, RBR[4] = { 161, 93, 157, 75 };
  const int16_t* L1[1] = { RF }; const int16_t* L2[2] = { RT, RB }; const int16_t* L3[3] = { RT, RBL, RBR }; const int16_t* L4[4] = { RTL, RTR, RBL, RBR };
  uint8_t n = constrain(S.wcount, 1, 4);
  const int16_t* const* L = n == 1 ? L1 : n == 2 ? L2 : n == 3 ? L3 : L4;
  for (uint8_t i = 0; i < n; i++) {
    const int16_t* r = L[i];
    if (r[3] > 100) { spr.fillRoundRect(r[0], r[1], r[2], r[3], 8, SC_PANEL); drawCard(S.wcards[i], r[0], r[1] + (r[3] - 76) / 2, r[2], 76); }   // single card: centred
    else drawCard(S.wcards[i], r[0], r[1], r[2], r[3]);
  }
}

static void drawHome() {
  drawAnim(2, 2, 128, 128, millis());               // top-left corner; the status row sits to its right
  drawCard(S.cards[0], 132, 15, 186, 76);   // the two widget slots (home.cards)
  drawCard(S.cards[1], 132, 93, 186, 75);
  // A / B under the animation, one row each (A on top): letter, the app's icon, name
  const String* q[2] = { &S.quickA, &S.quickB };
  for (int i = 0; i < 2; i++) {
    int y = i ? 151 : 132; App* a = appById(*q[i]);
    spr.fillRoundRect(2, y, 128, 17, 4, SC_PANEL);
    text(i ? "B" : "A", 7, y + 8, FB10, SC_DIM);
    if (a) { miniIcon(a, 22, y + 8); text(fit(a->name, 94, FSB11), 32, y + 8, FSB11, SC_SUB); }
    else text("-", 18, y + 8, FSB11, SC_DIM);
  }
}

// Keep periodic eco updates inside their own LCD regions.
static void pushRegion(int x, int y, int w, int h) {
  lcd.setClipRect(x, y, w, h); spr.pushSprite(0, 0); lcd.clearClipRect();
}
static void renderEcoAnim(uint32_t now) {
  if (ecoAnimFps <= 0) return;
  drawAnim(2, 2, 128, 128, now); pushRegion(2, 2, 128, 128);
}
static void renderEcoClock() {
  if (items.empty() || mailActive()) return;
  if (items[sel].home) {
    for (int i = 0; i < 2; i++) if (S.cards[i] == W_CLOCK) { int y = i ? 93 : 15; drawClockCard(132, y, 186, 76); pushRegion(132, y, 186, 76); }
  } else if (items[sel].kind == K_WIDGETS) {
    // drawWidgets shares the layout; only clock rectangles reach the LCD.
    drawWidgets();
    static const int16_t r[4][4] = { {2,15,157,76}, {161,15,157,76}, {2,93,157,75}, {161,93,157,75} };
    for (int i = 0; i < S.wcount; i++) if (S.wcards[i] == W_CLOCK) {
      if (S.wcount == 1) pushRegion(2, 15, 316, 153);
      else if (S.wcount == 2) pushRegion(2, i ? 93 : 15, 316, i ? 75 : 76);
      else if (S.wcount == 3 && i == 0) pushRegion(2, 15, 316, 76);
      else { int k = S.wcount == 3 ? i + 1 : i; pushRegion(r[k][0], r[k][1], r[k][2], r[k][3]); }
    }
  }
}


/* ---------- media & system pages ---------- */
uint8_t adjust = 0;            // 0 off · media: 1 volume · system: 1 volume, 2 brightness
uint32_t adjustAt = 0;
int8_t keyFlash = 0; uint8_t keyFlashWhat = 0; uint32_t keyFlashAt = 0;   // feedback when only media keys are available
uint32_t mediaFlashAt = 0; const char* mediaFlashAct = "";

static bool mediaLive() { return companionOn() && media.stamp && millis() - media.stamp < 6000; }
static bool sysLive() { return companionOn() && sysSt.stamp && millis() - sysSt.stamp < 12000; }

static const char* PLAYER_IDS[3] = { "spotify", "music", "ytmusic" };
static const char* PLAYER_NAMES[3] = { "Spotify", "Apple Music", "YouTube Music" };
static uint16_t playerColor(const String& p) {
  if (p == "spotify") return C(0x1DB954);
  if (p == "music") return C(0xFA2D48);
  if (p == "ytmusic") return C(0xFF2D2D);
  return MEDIA_COL;
}

static uint16_t itemColor(const Item& it) {
  switch (it.kind) {
    case K_HOME: return HOME_COL;
    case K_MEDIA: return mediaLive() && media.player.length() ? playerColor(media.player) : MEDIA_COL;
    case K_SYS: return SYS_COL;
    case K_WIDGETS: return WIDG_COL;
    case K_CONN: return CONN_COL;
    case K_MENU: return subPage == K_MEDIA ? (mediaLive() && media.player.length() ? playerColor(media.player) : MEDIA_COL)
                      : subPage == K_SYS ? SYS_COL : subPage == K_CONN ? CONN_COL : MENU_COL;
    default: return it.app->color;
  }
}

// --- vector glyphs ---
static void gPlay(int cx, int cy, int s, uint16_t c) { spr.fillTriangle(cx - s * 2 / 5, cy - s / 2, cx - s * 2 / 5, cy + s / 2, cx + s / 2, cy, c); }
static void gPause(int cx, int cy, int s, uint16_t c) { int w = max(2, s / 3); spr.fillRoundRect(cx - s / 2, cy - s / 2, w, s, 1, c); spr.fillRoundRect(cx + s / 2 - w, cy - s / 2, w, s, 1, c); }
static void gSkip(int cx, int cy, int s, uint16_t c, bool fwd) {
  int d = fwd ? 1 : -1, h = s / 2;
  spr.fillTriangle(cx - d * h, cy - h, cx - d * h, cy + h, cx, cy, c);
  spr.fillTriangle(cx, cy - h, cx, cy + h, cx + d * h, cy, c);
  spr.fillRect(fwd ? cx + h : cx - h - 2, cy - h, 2, s, c);
}
static void gSpeaker(int cx, int cy, uint16_t c, bool muted, int level) {
  spr.fillRect(cx - 9, cy - 3, 4, 7, c);
  spr.fillTriangle(cx - 6, cy, cx - 1, cy - 7, cx - 1, cy + 7, c);
  spr.fillRect(cx - 6, cy - 3, 5, 7, c);
  if (muted) { spr.drawWideLine(cx + 2, cy - 4, cx + 9, cy + 4, 1.2f, SC_RED); spr.drawWideLine(cx + 2, cy + 4, cx + 9, cy - 4, 1.2f, SC_RED); return; }
  if (level != 0) spr.drawArc(cx, cy, 5, 4, -45, 45, c);
  if (level > 33 || level < 0) spr.drawArc(cx, cy, 9, 8, -50, 50, c);
}
static void gSun(int cx, int cy, uint16_t c) {
  spr.fillSmoothCircle(cx, cy, 4, c);
  for (int i = 0; i < 8; i++) { float a = i * PI / 4; spr.drawWideLine(cx + cosf(a) * 7, cy + sinf(a) * 7, cx + cosf(a) * 10, cy + sinf(a) * 10, 0.9f, c); }
}
static String mmss(float s) { int t = max(0, (int)s); char b[12]; snprintf(b, sizeof b, "%d:%02d", t / 60, t % 60); return b; }

static void drawMedia() {
  bool live = mediaLive();
  uint32_t now = millis();
  // player chips: which app the controls go to
  int x = 2;
  for (int i = 0; i < 3; i++) {
    String id = PLAYER_IDS[i];
    int w = textW(PLAYER_NAMES[i], FSB11) + 16;
    bool active = live && media.player == id, target = mediaTarget == id;
    uint16_t pc = playerColor(id);
    spr.fillRoundRect(x, 16, w, 18, 9, active ? pc : target ? mix(pc, SC_PANEL, .3f) : SC_PANEL);   // chosen player: tinted, not outlined
    text(PLAYER_NAMES[i], x + w / 2, 25, FSB11, active ? onColor(pc) : target ? SC_TEXT : SC_SUB, textdatum_t::middle_center);
    x += w + 4;
  }
  if (companionOn()) text(mediaTarget == "auto" ? "oto" : "sabit", 318, 25, FM9, SC_DIM, textdatum_t::middle_right);

  // now playing
  String title, sub;
  if (live && media.title.length()) { title = media.title; sub = media.artist.length() ? media.artist : media.name; }
  else if (live) { title = "Çalan bir şey yok"; sub = mediaTarget == "auto" ? String("Bir müzik uygulaması aç") : String(PLAYER_NAMES[mediaTarget == "spotify" ? 0 : mediaTarget == "music" ? 1 : 2]) + " açık değil"; }
  else { title = "Medya tuşları"; sub = companionOn() ? "Bilgi bekleniyor…" : "Masaüstü uygulaması kapalı: çalan uygulamayı bilgisayar seçer"; }
  bool cover = live && media.hasArt;
  int tx = cover ? 72 : 4, tw = 318 - tx;
  if (cover) spr.pushImage(2, 37, 64, 64, (const lgfx::rgb565_t*)media.art);
  text(fit(title, tw, FB18), tx, 47, FB18, SC_TEXT);
  text(fit(sub, tw, FSB12), tx, 67, FSB12, SC_SUB);
  uint16_t pc = live && media.player.length() ? playerColor(media.player) : MEDIA_COL;
  if (live && media.dur > 0) {
    float pos = media.pos + (media.playing ? (now - media.posAt) / 1000.0f : 0);
    pos = constrain(pos, 0, media.dur);
    spr.fillRoundRect(tx, 80, tw, 4, 2, SC_LINE);
    spr.fillRoundRect(tx, 80, max(4, (int)(tw * pos / media.dur)), 4, 2, pc);
    text(mmss(pos), tx, 93, FM9, SC_DIM); text(mmss(media.dur), 318, 93, FM9, SC_DIM, textdatum_t::middle_right);
  }

  // transport: A = previous, press = play/pause, B = next
  bool fl = now - mediaFlashAt < 250;
  bool playing = live ? media.playing : false;
  gSkip(112, 132, 16, fl && !strcmp(mediaFlashAct, "prev") ? pc : SC_TEXT, false);
  text("A", 112, 154, FM9, SC_DIM, textdatum_t::middle_center);
  uint16_t playBg = fl && !strcmp(mediaFlashAct, "play_pause") ? mix(pc, SC_PANEL, .7f) : pc;
  spr.fillSmoothCircle(160, 132, 21, playBg);
  if (playing) gPause(160, 132, 16, onColor(playBg)); else gPlay(162, 132, 18, onColor(playBg));
  gSkip(208, 132, 16, fl && !strcmp(mediaFlashAct, "next") ? pc : SC_TEXT, true);
  text("B", 208, 154, FM9, SC_DIM, textdatum_t::middle_center);

  // volume: its own panel, amber-tinted while the knob sets the volume
  bool vlive = sysLive() && sysSt.vol >= 0;
  uint16_t vbg = adjust == 1 ? mix(SC_HL, SC_PANEL, .2f) : SC_PANEL;
  spr.fillRoundRect(232, 106, 86, 62, 8, vbg);
  gSpeaker(250, 124, adjust == 1 ? SC_HL : SC_SUB, vlive && sysSt.mute, vlive ? sysSt.vol : -1);
  if (vlive) {
    text(String(sysSt.vol) + "%", 312, 124, FB18, sysSt.mute ? SC_DIM : SC_TEXT, textdatum_t::middle_right);
    spr.fillRoundRect(240, 150, 72, 6, 3, SC_LINE);
    spr.fillRoundRect(240, 150, max(3, 72 * sysSt.vol / 100), 6, 3, sysSt.mute ? SC_DIM : (adjust == 1 ? SC_HL : SC_TEXT));
  } else if (keyFlashWhat == 1 && now - keyFlashAt < 700) text(keyFlash > 0 ? "ses +" : "ses -", 312, 124, FSB12, SC_HL, textdatum_t::middle_right);
  else text("ses", 312, 124, FSB12, SC_DIM, textdatum_t::middle_right);
  text(adjust == 1 ? "çevir: ses" : "basılı tut: ses", 4, 125, FM9, adjust == 1 ? SC_HL : SC_DIM);
  if (companionOn()) text("çift bas: oynatıcı", 4, 140, FM9, SC_DIM);
}

static void gMic(int cx, int cy, uint16_t c, bool muted) {
  spr.fillRoundRect(cx - 3, cy - 9, 7, 11, 3, c);                 // capsule
  spr.drawArc(cx, cy - 2, 7, 6, 0, 180, c);                       // holder
  spr.drawFastVLine(cx, cy + 5, 3, c); spr.drawFastHLine(cx - 3, cy + 8, 7, c);
  if (muted) spr.drawWideLine(cx - 8, cy - 9, cx + 8, cy + 8, 1.3f, SC_RED);
}

static void sysRow(int y, int h, bool vol, bool focus) {
  bool live = sysLive() && (vol ? sysSt.vol >= 0 : sysSt.bright >= 0);
  int v = vol ? sysSt.vol : sysSt.bright;
  bool muted = vol && live && sysSt.mute;
  int cy = y + h * 5 / 8;                                          // number / bar line
  spr.fillRoundRect(2, y, 316, h, 8, focus ? mix(SC_HL, SC_PANEL, .16f) : SC_PANEL);   // focused row: amber tint, not an outline
  uint16_t ic = focus ? SC_HL : SC_SUB;
  if (vol) gSpeaker(26, cy, ic, muted, live ? v : -1); else gSun(24, cy, ic);
  text(vol ? "SES" : "PARLAKLIK", 46, y + 10, FB10, SC_SUB);
  uint32_t now = millis();
  if (live) {
    String t = String(v);
    text(t, 45, cy, FN36, muted ? SC_DIM : SC_TEXT);
    text("%", 47 + textW(t, FN36), cy - 8, FSB12, muted ? SC_DIM : SC_TEXT);
  } else {
    bool fl = keyFlashWhat == (vol ? 1 : 2) && now - keyFlashAt < 700;
    String t = fl ? (keyFlash > 0 ? "+" : "-") : "+/-";
    text(t, 45, cy, FN36, fl ? SC_HL : SC_DIM);
    text(companionOn() ? (vol ? "okunamadı · tuşla" : "bu ekranda yok · tuşla") : "tuşla ayarlanır", 55 + textW("+/-", FN36), cy, FM9, SC_DIM);
  }
  int bx = 132, bw = 178, by = cy - 4;
  if (live) {
    spr.fillRoundRect(bx, by, bw, 8, 4, SC_LINE);
    spr.fillRoundRect(bx, by, max(6, bw * constrain(v, 0, 100) / 100), 8, 4, muted ? SC_DIM : focus ? SC_HL : (vol ? SC_TEXT : SC_SUN));
  }
  String hint;
  if (vol) hint = muted ? "SESSİZ · A: aç" : "A: sessiz";
  else hint = focus ? "çevir: ayarla" : adjust ? "bas: buraya geç" : "bas: ayarla";
  if (vol && focus && !muted) hint = "çevir: ayarla · A: sessiz";
  text(hint, 310, y + 10, FM9, muted ? SC_RED : focus ? SC_HL : SC_DIM, textdatum_t::middle_right);
}

// microphone: on / muted, toggled with B (desktop app only)
static void micRow(int y, int h) {
  bool live = sysLive() && sysSt.mic >= 0, muted = live && sysSt.mic == 1;
  spr.fillRoundRect(2, y, 316, h, 8, muted ? mix(SC_RED, SC_PANEL, .14f) : SC_PANEL);
  gMic(24, y + h / 2 + 1, muted ? SC_RED : SC_SUB, muted);
  text("MİKROFON", 46, y + h / 2, FB10, SC_SUB);
  String st = live ? (muted ? "Kapalı" : "Açık") : (companionOn() ? "bulunamadı" : "masaüstü uygulaması gerekli");
  text(st, 120, y + h / 2, live ? FSB12 : FM9, muted ? SC_RED : live ? SC_TEXT : SC_DIM);
  if (live) text(muted ? "B: aç" : "B: kapat", 310, y + h / 2, FM9, muted ? SC_RED : SC_DIM, textdatum_t::middle_right);
}

static void drawSystem() {
  sysRow(15, 56, true, adjust == 1);
  sysRow(73, 56, false, adjust == 2);
  micRow(131, 37);
}

/* ---------- Bağlantılar (1.9.0): Bluetooth computers chosen on the device; Wi-Fi row reserved ---------- */
enum : uint8_t { CR_ALL = 0, CR_HOST, CR_PAIR, CR_FORGET };
struct ConnRow { uint8_t type; uint8_t a[6]; };
bool connEdit = false; int connCur = 0; uint32_t connAt = 0, connConfirmAt = 0;
// name of a computer the deck talks to: the one its desktop app sent, else the Bluetooth name
static String hostName(uint16_t conn) {
  const HostSeen* h = hostOf(conn);
  if (h && h->name[0]) return h->name;
  if (conn == HOST_USB) return "USB bilgisayar";
  if (bleStarted && conn != BLE_HS_CONN_HANDLE_NONE) {
    NimBLEConnInfo ci = bleServer->getPeerInfoByHandle(conn);
    if (ci.isBonded()) return btName(ci.getIdAddress().getVal());
  }
  return "Bilgisayar";
}
static std::vector<ConnRow> connRows() {
  std::vector<ConnRow> v;
  v.push_back({ CR_ALL, {0} });
  for (auto& h : btHosts()) { ConnRow r{ CR_HOST, {0} }; memcpy(r.a, h.a, 6); v.push_back(r); }
  v.push_back({ CR_PAIR, {0} });
  v.push_back({ CR_FORGET, {0} });
  return v;
}
static int connActiveRow(const std::vector<ConnRow>& rows) {
  if (!bt.hasSel) return 0;
  for (int i = 0; i < (int)rows.size(); i++) if (rows[i].type == CR_HOST && !memcmp(rows[i].a, bt.sel, 6)) return i;
  return 0;
}
static void connRow(int y, const ConnRow& r, bool focus, bool active) {
  const int h = 20;
  spr.fillRoundRect(2, y, 316, h, 6, focus ? mix(SC_HL, SC_PANEL, .16f) : SC_PANEL);
  int cy = y + h / 2;
  uint16_t ic = focus ? SC_HL : SC_SUB;
  String label, right; uint16_t rc = SC_DIM;
  if (r.type == CR_ALL || r.type == CR_HOST) {      // radio: which computers may connect
    if (active) { spr.fillSmoothCircle(14, cy, 5, focus ? SC_HL : CONN_COL); spr.fillSmoothCircle(14, cy, 2, SC_PANEL); }
    else spr.drawCircle(14, cy, 5, SC_DIM);
  }
  if (r.type == CR_ALL) { label = "Aktif bilgisayar · otomatik"; right = String(btHosts().size()) + " cihaz"; }
  else if (r.type == CR_HOST) {
    label = btName(r.a);
    uint16_t c = btConnOf(r.a);
    if (c != BLE_HS_CONN_HANDLE_NONE) { bool act = activeHostConn() == c; right = act ? "aktif" : "bağlı"; rc = act ? SC_HL : SC_GREEN; }
  } else if (r.type == CR_PAIR) {
    spr.drawWideLine(9, cy, 19, cy, 1.6f, ic); spr.drawWideLine(14, cy - 5, 14, cy + 5, 1.6f, ic);
    label = "Yeni cihaz eşleştir";
  } else {
    spr.drawWideLine(10, cy - 4, 18, cy + 4, 1.6f, focus ? SC_RED : SC_SUB); spr.drawWideLine(18, cy - 4, 10, cy + 4, 1.6f, focus ? SC_RED : SC_SUB);
    bool confirm = connConfirmAt && millis() - connConfirmAt < 4000;
    label = confirm ? "Silmek için tekrar bas" : "Eşleşmeleri sil";
    if (confirm) rc = SC_RED;
  }
  text(fit(label, right.length() ? 230 : 280, FSB11), 26, cy, FSB11, r.type == CR_FORGET && focus ? SC_RED : SC_TEXT);
  if (right.length()) text(right, 310, cy, FM9, rc, textdatum_t::middle_right);
}
static void drawConn() {
  // header: Bluetooth state
  spr.fillRoundRect(2, 15, 316, 24, 8, SC_PANEL);
  gBt(16, 27, 14, bt.off ? SC_DIM : CONN_COL);
  text("BLUETOOTH", 28, 27, FB10, SC_SUB);
  String st; uint16_t sc = SC_TEXT;
  if (!bleStarted) { st = "kapalı (Sadece USB)"; sc = SC_DIM; }
  else if (bt.off) { st = "Kapalı"; sc = SC_DIM; }
  else if (btPairing()) { uint32_t left = (bt.pairUntil - millis()) / 1000; st = "Eşleştirme " + String(left / 60) + ":" + (left % 60 < 10 ? "0" : "") + String(left % 60); sc = SC_HL; }
  else {
    uint16_t act = activeHostConn();
    st = act != BLE_HS_CONN_HANDLE_NONE ? "Aktif: " + hostName(act) : bt.hasSel ? "Yalnız seçili" : "Açık";
  }
  text(fit(st, connEdit ? 120 : 110, FSB11), 104, 27, FSB11, sc);
  text(!bleStarted ? "" : connEdit ? "basılı tut: çık" : (bt.off ? "A: aç" : "A: kapat · bas: seç"), 310, 27, FM9, SC_DIM, textdatum_t::middle_right);

  if (bleStarted && btPairing()) {           // pairing mode: what to do on the computer
    spr.fillRoundRect(2, 41, 316, 102, 8, mix(CONN_COL, SC_PANEL, .12f));
    text("Bilgisayarda:", 14, 56, FSB11, SC_SUB);
    text("Bluetooth → Cihaz ekle", 14, 76, FSB12, SC_TEXT);
    text(fit("Listeden \"" + S.name + "\" seç", 292, FSB12), 14, 98, FSB12, SC_TEXT);
    text("bas: iptal", 14, 124, FM9, SC_DIM);
    uint32_t left = bt.pairUntil - millis();
    spr.fillRoundRect(100, 121, 206, 4, 2, SC_LINE);
    spr.fillRoundRect(100, 121, max(4, (int)(206.0f * min(1.0f, left / 90000.0f))), 4, 2, CONN_COL);
  } else if (bleStarted && !bt.off) {
    auto rows = connRows();
    int act = connActiveRow(rows);
    if (connCur >= (int)rows.size()) connCur = rows.size() - 1;
    int first = 0; const int vis = 5;
    int focusRow = connEdit ? connCur : act;
    if (focusRow >= vis) first = focusRow - vis + 1;
    for (int i = 0; i < vis && first + i < (int)rows.size(); i++)
      connRow(41 + i * 21, rows[first + i], connEdit && first + i == connCur, first + i == act);
    if ((int)rows.size() > vis) {           // scroll mark
      int th = 100 * vis / rows.size(), ty = 42 + (100 - th) * first / max(1, (int)rows.size() - vis);
      spr.fillRoundRect(316, ty, 2, th, 1, SC_DIM);
    }
  } else {
    spr.fillRoundRect(2, 41, 316, 102, 8, SC_PANEL);
    text(bleStarted ? "Bluetooth kapalı" : "Bluetooth bu ayarda kapalı", 160, 80, FSB12, SC_SUB, textdatum_t::middle_center);
    text(bleStarted ? "A: aç" : "Uygulama → Cihaz → Bağlantı: Otomatik", 160, 104, FM9, SC_DIM, textdatum_t::middle_center);
  }
  // Wi-Fi: reserved row (the device does not use Wi-Fi yet)
  spr.fillRoundRect(2, 145, 316, 23, 8, SC_PANEL);
  gWifi(16, 155, SC_DIM);
  text("WI-FI", 28, 157, FB10, SC_DIM);
  text("Kapalı · yakında", 310, 157, FM9, SC_DIM, textdatum_t::middle_right);
}

/* ---------- Menü: the pages, each one key away ---------- */
static std::vector<uint8_t> menuPages() {
  std::vector<uint8_t> v;
  if (S.mediaOn) v.push_back(K_MEDIA);
  if (S.sysOn) v.push_back(K_SYS);
  if (S.connOn) v.push_back(K_CONN);
  return v;
}
// Menü list: press → pick mode (cursor), turn → move, press → open, hold or 15 s idle → leave pick mode
bool menuPick = false; int menuCur = 0; uint32_t menuAt = 0;
static void drawMenu() {
  auto pages = menuPages(); int n = pages.size();
  if (menuCur >= n) menuCur = n - 1; if (menuCur < 0) menuCur = 0;
  const int h = 44, gap = 3, vis = 3;
  int first = menuPick && menuCur >= vis ? menuCur - vis + 1 : 0;
  for (int r = 0; r < vis && first + r < n; r++) {
    int i = first + r, y = 15 + r * (h + gap), cy = y + h / 2;
    uint8_t k = pages[i];
    bool focus = menuPick && i == menuCur;
    spr.fillRoundRect(2, y, 316, h, 8, focus ? mix(SC_HL, SC_PANEL, .16f) : SC_PANEL);   // focused row: amber tint
    bubble(false, nullptr, 24, cy, 15, 1, k);
    String title = k == K_MEDIA ? "Medya" : k == K_SYS ? "Ses ve parlaklık" : "Bağlantılar", sub;
    if (k == K_MEDIA) sub = mediaLive() && media.title.length() ? media.title : String("Çalan müzik ve medya tuşları");
    else if (k == K_SYS) sub = sysLive() && sysSt.vol >= 0 ? "Ses %" + String(sysSt.vol) + (sysSt.bright >= 0 ? "  ·  Parlaklık %" + String(sysSt.bright) : String("")) : String("Ses, parlaklık, mikrofon");
    else { uint16_t act = activeHostConn(); sub = bt.off ? String("Bluetooth kapalı") : act != BLE_HS_CONN_HANDLE_NONE ? "Aktif: " + hostName(act) : String("Bluetooth bilgisayarları"); }
    text(title, 48, cy - 8, FSB12, focus ? SC_HL : SC_TEXT);
    text(fit(sub, 240, FM9), 48, cy + 9, FM9, SC_DIM);
    text("›", 306, cy, FM16, focus ? SC_HL : SC_DIM, textdatum_t::middle_center);
  }
  if (n > vis) {                              // scroll mark
    int th = 141 * vis / n, ty = 15 + (141 - th) * first / max(1, n - vis);
    spr.fillRoundRect(316, ty, 2, th, 1, SC_DIM);
  }
  text(menuPick ? "çevir: seç  ·  bas: aç  ·  basılı tut: çık" : "bas: seç  ·  çevir: gez", 160, 161, FM9, menuPick ? SC_HL : SC_SUB, textdatum_t::middle_center);
}

/* ---------- new mail note (1.8.0): full screen, A / B / press opens Outlook on the computer ---------- */
const uint16_t OUTLOOK_COL = C(0x0F6CBD);
// two lines at most, broken between words; a word wider than a line is cut, the rest ends with …
static void wrap2(const String& s, int max, UFont& f, String& a, String& b) {
  a = s; b = "";
  if (textW(s, f) <= max) return;
  int cut = -1;
  for (int i = 1; i < (int)s.length(); i++) {
    if (s[i] != ' ') continue;
    if (textW(s.substring(0, i), f) > max) break;
    cut = i;
  }
  if (cut > 0) { a = s.substring(0, cut); b = s.substring(cut + 1); }
  else {
    cut = s.length();
    while (cut > 1 && textW(s.substring(0, cut), f) > max) { cut--; while (cut > 1 && ((uint8_t)s[cut] & 0xC0) == 0x80) cut--; }
    a = s.substring(0, cut); b = s.substring(cut);
  }
  a.trim(); b.trim(); b = fit(b, max, f);
}
static void gMail(int cx, int cy, uint16_t c, uint16_t bg) {   // envelope, about 24 x 17
  spr.fillRoundRect(cx - 12, cy - 8, 24, 17, 3, c);
  spr.drawWideLine(cx - 10, cy - 6, cx, cy + 2, 1.3f, bg);
  spr.drawWideLine(cx + 10, cy - 6, cx, cy + 2, 1.3f, bg);
}
static void drawMail() {
  uint16_t acc = lightTheme ? OUTLOOK_COL : C(0x479EF5);
  spr.fillRoundRect(2, 2, 316, 166, 10, SC_PANEL);
  spr.fillSmoothCircle(34, 36, 24, OUTLOOK_COL);
  gMail(34, 36, WHITE, OUTLOOK_COL);
  text("Yeni posta", 70, 26, FB18, SC_TEXT);
  String sub = "Outlook";
  if (mailNote.unread >= 0) sub += "  ·  " + String(mailNote.unread) + " okunmamış";
  text(fit(sub, 240, FSB12), 70, 48, FSB12, SC_SUB);
  if (mailNote.subject.length()) {
    if (!mailNote.wrapped) { wrap2(mailNote.subject, 292, FB18, mailNote.l1, mailNote.l2); mailNote.wrapped = true; }
    text(mailNote.l1, 14, mailNote.l2.length() ? 84 : 96, FB18, SC_TEXT);
    if (mailNote.l2.length()) text(mailNote.l2, 14, 108, FB18, SC_TEXT);
  } else text(mailNote.fresh > 1 ? String(mailNote.fresh) + " yeni posta geldi" : String("Gelen kutusuna posta geldi"), 14, 96, FSB12, SC_SUB);
  text("A · B · bas: Outlook'u aç", 14, 138, FSB11, SC_SUB);
  text("çevir: kapat", 306, 138, FSB11, SC_DIM, textdatum_t::middle_right);
  // time left on screen
  uint32_t left = mailActive() ? mailNote.until - millis() : 0;
  spr.fillRoundRect(14, 154, 292, 4, 2, SC_LINE);
  spr.fillRoundRect(14, 154, max(4, (int)(292.0f * min(1.0f, (float)left / (float)(mailNote.ms ? mailNote.ms : 1)))), 4, 2, acc);
}

static void drawToast() {
  if (millis() > toastUntil) return;
  int w = min(316, textW(toastMsg, FSB11) + 24);
  spr.fillRoundRect(160 - w / 2, 142, w, 26, 8, mix(SC_HL, SC_BG, .3f));   // filled amber pill, no outline
  text(fit(toastMsg, w - 12, FSB11), 160, 155, FSB11, SC_TEXT, textdatum_t::middle_center);
}

static void render(const char* link) {
  if (mailActive()) {                      // the note covers every page; the next normal render redraws them whole
    spr.fillSprite(SC_BG); drawMail(); drawToast(); spr.pushSprite(0, 0);
    homeFrameShown = false;
    return;
  }
  spr.fillSprite(SC_BG);
  if (items.empty()) {
    drawStatus(SC_DIM, link);
    text("Döndürgeç listesi boş", 160, 91, FSB12, SC_SUB, textdatum_t::middle_center);
  } else {
    if (sel >= (int)items.size()) sel = items.size() - 1;
    Item& it = items[sel];
    drawStatus(itemColor(it), link, it.kind == K_HOME ? 134 : 2);
    uint8_t k = it.kind == K_MENU && subPage ? subPage : it.kind;
    switch (k) { case K_HOME: drawHome(); break; case K_MEDIA: drawMedia(); break; case K_SYS: drawSystem(); break; case K_WIDGETS: drawWidgets(); break; case K_CONN: drawConn(); break; case K_MENU: drawMenu(); break; default: drawAppView(); }
  }
  drawToast();
  if (ecoActive && ecoAnimFps == 0 && homeFrameShown && !items.empty() && items[sel].home) {
    // Preserve the complete LCD frame, even when stats/theme/link dirty the rest.
    pushRegion(0, 0, 320, 2); pushRegion(0, 2, 2, 128);
    pushRegion(130, 2, 190, 128); pushRegion(0, 130, 320, 40);
  } else spr.pushSprite(0, 0);
  homeFrameShown = !items.empty() && items[sel].home;
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
