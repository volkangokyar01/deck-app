
## Firmware derleme

```sh
tools/build_firmware.sh      # arduino-cli compile → firmware/bin → embed_firmware.py → build.py
```

Gerekenler: arduino-cli, esp32:esp32 3.3.12, LovyanGFX 1.2.x, ArduinoJson 7.4, NimBLE-Arduino 2.5.1. Betik Arduino'ya `BOARD_HAS_PSRAM` verir (yoksa Arduino 3.x kendi PSRAM katmanını derlemez, 8 MB ek bellek kullanılmaz) ve Arduino çekirdeğinin önbelleğini bu bayraklara göre ayırır (`firmware/VolkanDeck/build/cache-…`). Betik NimBLE'ye `MYNEWT_VAL_BLE_STORE_MAX_CCCDS=32` ve `MYNEWT_VAL_BLE_STORE_MAX_BONDS=4` verir; bunlar olmadan derleme bilerek hata verir (ayrıntı: `docs/kararlar-ve-pinler.md`, 2026-10-08). `arduino-cli` başka yerdeyse `ARDUINO_CLI=/yol/arduino-cli`, ayar dosyası için `ARDUINO_CONFIG=/yol/cli.yaml`.
