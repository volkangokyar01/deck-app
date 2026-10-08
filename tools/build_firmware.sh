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
# Two builds (1.12.0): the board's PSRAM decides which one the settings page flashes (eFuse PSRAM_CAP):
#   firmware/bin       octal PSRAM (ESP32-S3R8, 8 MB OPI; LilyGO's own board)  — memory type qio_opi
#   firmware/bin-qspi  quad PSRAM (ESP32-S3R2, 2 MB) or none                   — memory type qio_qspi
build() {   # $1 memory type (opi / qspi), $2 output dir
  B="firmware/VolkanDeck/build/$1"
  $CLI $CFG compile -b esp32:esp32:lilygo_t_display_s3:USBMode=default,CDCOnBoot=cdc \
    --build-property "compiler.c.extra_flags=$NIMBLE" --build-property "compiler.cpp.extra_flags=$NIMBLE" \
    --build-property "build.psram_type=$1" --build-path "$B/tmp" --output-dir "$B" firmware/VolkanDeck
  mkdir -p "$2"
  for f in VolkanDeck.ino.bin VolkanDeck.ino.bootloader.bin VolkanDeck.ino.partitions.bin boot_app0.bin flash_args; do
    if [ -f "$B/$f" ]; then cp "$B/$f" "$2/"; else cp "$B/tmp/$f" "$2/"; fi
  done
}
build opi firmware/bin
build qspi firmware/bin-qspi
python3 tools/embed_firmware.py
python3 tools/build.py
