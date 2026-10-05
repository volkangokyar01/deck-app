#!/bin/bash
# Volkan Deck — macOS kurulumu (Apple Silicon)
set -e
cd "$(dirname "$0")"
# Kurulum paketinde app/ betiğin yanında; depodaki installer/ klasöründen çalıştırılınca bir üst klasörde
if [ -d app ]; then SRC=app
elif [ -d ../app ]; then SRC=../app
else echo "HATA: app klasörü bulunamadı. Betiği kurulum paketinin içinden çalıştır." >&2; exit 1
fi
V=44.5.1
T=$(mktemp -d)
echo "Volkan Deck kuruluyor (Electron $V indiriliyor, ~130 MB)…"
curl -L --fail --progress-bar -o "$T/e.zip" "https://github.com/electron/electron/releases/download/v$V/electron-v$V-darwin-arm64.zip"
ditto -x -k "$T/e.zip" "$T"
A="$T/Volkan Deck.app"
mv "$T/Electron.app" "$A"
rm -f "$A/Contents/Resources/default_app.asar"
cp -R "$SRC" "$A/Contents/Resources/app"
rm -f "$A/Contents/Resources/app/icon.ico"
cp electron.icns "$A/Contents/Resources/electron.icns"
P="$A/Contents/Info.plist"
plutil -replace CFBundleName -string "Volkan Deck" "$P"
plutil -replace CFBundleDisplayName -string "Volkan Deck" "$P"
plutil -replace CFBundleIdentifier -string "com.volkan.deck" "$P"
plutil -replace NSAppleEventsUsageDescription -string "Volkan Deck, çalan şarkıyı göstermek ve Spotify / Müzik uygulamasını cihazdaki tuşlarla kontrol etmek için izin ister." "$P"
codesign --force --deep --sign - "$A"
pkill -f "Volkan Deck.app/Contents/MacOS" 2>/dev/null || true
rm -rf "/Applications/Volkan Deck.app"
mv "$A" /Applications/
xattr -cr "/Applications/Volkan Deck.app" 2>/dev/null || true
rm -rf "$T"
open "/Applications/Volkan Deck.app"
echo "Kuruldu: /Applications/Volkan Deck.app"
