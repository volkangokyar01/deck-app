#!/bin/sh
# Firmware derleme: arduino-cli compile + firmware/bin + uygulamaya gömme + build.py
# Kullanım: tools/build_firmware.sh   (ARDUINO_CLI ve ARDUINO_CONFIG ile yol değiştirilebilir)
# NimBLE sınırları (2026-10-08): kütüphanenin varsayılanı 8 bildirim kaydı (CCCD) ve 3 eşleşme.
# Her bilgisayar ~5 kayıt kullandığı için ikinci bilgisayar eşleşince ilki siliniyordu.
set -e
cd "$(dirname "$0")/.."
CLI="${ARDUINO_CLI:-arduino-cli}"
CFG="${ARDUINO_CONFIG:+--config-file $ARDUINO_CONFIG}"
NIMBLE="-DMYNEWT_VAL_BLE_STORE_MAX_CCCDS=32 -DMYNEWT_VAL_BLE_STORE_MAX_BONDS=4"
$CLI $CFG compile -b esp32:esp32:lilygo_t_display_s3:USBMode=default,CDCOnBoot=cdc \
  --build-property "compiler.c.extra_flags=$NIMBLE" --build-property "compiler.cpp.extra_flags=$NIMBLE" \
  --export-binaries firmware/VolkanDeck
OUT=$(ls -d firmware/VolkanDeck/build/*/ | head -1)
for f in VolkanDeck.ino.bin VolkanDeck.ino.bootloader.bin VolkanDeck.ino.partitions.bin boot_app0.bin flash_args; do cp "$OUT$f" firmware/bin/; done
python3 tools/embed_firmware.py
python3 tools/build.py
