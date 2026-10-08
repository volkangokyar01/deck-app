
## Firmware derleme

```sh
tools/build_firmware.sh      # iki derleme (OPI → firmware/bin, QSPI → firmware/bin-qspi) → embed_firmware.py → build.py
```

Gerekenler: arduino-cli, esp32:esp32 3.3.12, LovyanGFX 1.2.x, ArduinoJson 7.4, NimBLE-Arduino 2.5.1. Ayar sayfası ikisini de gömer; "Firmware yükle" çipin eFuse'undaki ek bellek bilgisine göre birini yükler (8 MB OPI → OPI, 2 MB QSPI ya da yok → QSPI). Betik NimBLE'ye `MYNEWT_VAL_BLE_STORE_MAX_CCCDS=32` ve `MYNEWT_VAL_BLE_STORE_MAX_BONDS=4` verir; bunlar olmadan derleme bilerek hata verir (ayrıntı: `docs/kararlar-ve-pinler.md`, 2026-10-08). `arduino-cli` başka yerdeyse `ARDUINO_CLI=/yol/arduino-cli`, ayar dosyası için `ARDUINO_CONFIG=/yol/cli.yaml`.
