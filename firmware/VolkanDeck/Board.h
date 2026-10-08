#pragma once
// LilyGO T-Display-S3 + KY-040 + 2 buttons
#define FW_VERSION "1.10.1"

// CPU scaling (240 <-> 80 MHz) is off since 1.8.1: the switch back to 240 MHz happened right before the
// config write and the board restarted ("Cihaza yaz" on Windows). Idle redraw saving stays enabled.
#ifndef VOLKAN_ECO_CPU
#define VOLKAN_ECO_CPU 0
#endif

#define PIN_LCD_POWER 15
#define PIN_LCD_BL    38
#define PIN_BAT       4
#define BAT_MAH       2000     // Efcell 2000 mAh Li-Po
#define BAT_CHARGE_MA 500      // TP4065, R_PROG (R13) 2 kOhm -> 1000 V / 2 kOhm = 0.5 A (LilyGO: 500 mA)
#define BAT_STEP_V    0.06f    // voltage step that marks a charger plugged in / pulled out
#define BAT_IR_V      0.10f    // voltage lift while charging (charge current x cell/wiring resistance)

#define PIN_ENC_CLK   1
#define PIN_ENC_DT    2
#define PIN_ENC_SW    10
#define PIN_BTN_A     11
#define PIN_BTN_B     12
#define PIN_KEY_PWR   0    // board BOOT key: power (swapped in 1.1.1)
#define PIN_KEY_RST   14   // board key: restart (swapped in 1.1.1)

#include <LovyanGFX.hpp>

class LGFX : public lgfx::LGFX_Device {
  lgfx::Panel_ST7789  _panel;
  lgfx::Bus_Parallel8 _bus;
  lgfx::Light_PWM     _light;
public:
  LGFX() {
    { auto c = _bus.config();
      c.freq_write = 20000000;
      c.pin_wr = 8; c.pin_rd = 9; c.pin_rs = 7;
      c.pin_d0 = 39; c.pin_d1 = 40; c.pin_d2 = 41; c.pin_d3 = 42;
      c.pin_d4 = 45; c.pin_d5 = 46; c.pin_d6 = 47; c.pin_d7 = 48;
      _bus.config(c); _panel.setBus(&_bus); }
    { auto c = _panel.config();
      c.pin_cs = 6; c.pin_rst = 5; c.pin_busy = -1;
      c.panel_width = 170; c.panel_height = 320;
      c.offset_x = 35; c.offset_y = 0; c.offset_rotation = 0;
      c.readable = false; c.invert = true; c.rgb_order = false;
      c.dlen_16bit = false; c.bus_shared = false;
      _panel.config(c); }
    { auto c = _light.config();
      c.pin_bl = PIN_LCD_BL; c.invert = false; c.freq = 22000; c.pwm_channel = 7;
      _light.config(c); _panel.setLight(&_light); }
    setPanel(&_panel);
  }
};
