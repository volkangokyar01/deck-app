#!/bin/bash
# Game Deck (eski adı Volkan Deck) — macOS kurulumu (Apple Silicon)
set -e
cd "$(dirname "$0")"
# Kurulum paketinde app/ betiğin yanında; depodaki installer/ klasöründen çalıştırılınca bir üst klasörde
if [ -d app ]; then SRC=app
elif [ -d ../app ]; then SRC=../app
else echo "HATA: app klasörü bulunamadı. Betiği kurulum paketinin içinden çalıştır." >&2; exit 1
fi
V=44.5.1
T=$(mktemp -d)
echo "Game Deck kuruluyor (Electron $V indiriliyor, ~130 MB)…"
curl -L --fail --progress-bar -o "$T/e.zip" "https://github.com/electron/electron/releases/download/v$V/electron-v$V-darwin-arm64.zip"
ditto -x -k "$T/e.zip" "$T"
A="$T/Game Deck.app"
mv "$T/Electron.app" "$A"
rm -f "$A/Contents/Resources/default_app.asar"
cp -R "$SRC" "$A/Contents/Resources/app"
rm -f "$A/Contents/Resources/app/icon.ico"
cp electron.icns "$A/Contents/Resources/electron.icns"
P="$A/Contents/Info.plist"
plutil -replace CFBundleName -string "Game Deck" "$P"
plutil -replace CFBundleDisplayName -string "Game Deck" "$P"
plutil -replace CFBundleIdentifier -string "com.volkan.deck" "$P"
plutil -replace NSAppleEventsUsageDescription -string "Game Deck, çalan şarkıyı göstermek ve Spotify / Müzik uygulamasını cihazdaki tuşlarla kontrol etmek için izin ister." "$P"
plutil -replace NSBluetoothAlwaysUsageDescription -string "Game Deck, kablo takılı değilken cihaza Bluetooth ile bağlanmak için izin ister." "$P"
/usr/libexec/PlistBuddy -c 'Set :NSLocationUsageDescription Game Deck hava durumu için konumunu kullanır.' "$P" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c 'Add :NSLocationUsageDescription string Game Deck hava durumu için konumunu kullanır.' "$P"
/usr/libexec/PlistBuddy -c 'Set :NSLocationWhenInUseUsageDescription Game Deck hava durumu için konumunu kullanır.' "$P" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c 'Add :NSLocationWhenInUseUsageDescription string Game Deck hava durumu için konumunu kullanır.' "$P"
# BEGIN local signing — keep in sync with app/mac-sign.js
find_signing_identity() {
  /usr/bin/security find-identity -p codesigning "$SIGN_KC" 2>/dev/null |
    awk '/"Volkan Deck Yerel"/{print $2; exit}'
}
ensure_signing_identity() (
  umask 077
  mkdir -p "$SIGN_DIR" && chmod 700 "$SIGN_DIR" || return 1
  local PASSWORD ID P12PASS CERT_TMP='' CREATED=0 READY=0
  cleanup_signing_identity() {
    [ -z "$CERT_TMP" ] || rm -rf "$CERT_TMP"
    if [ "$CREATED" = 1 ] && [ "$READY" = 0 ]; then
      /usr/bin/security delete-keychain "$SIGN_KC" >/dev/null 2>&1 || true
    fi
  }
  trap cleanup_signing_identity EXIT
  if [ -f "$SIGN_KC" ]; then
    PASSWORD=$(cat "$SIGN_DIR/keychain-pass" 2>/dev/null) || PASSWORD=''
    if [[ "$PASSWORD" =~ ^[a-f0-9]{32}$ ]] &&
      chmod 600 "$SIGN_DIR/keychain-pass" &&
      /usr/bin/security unlock-keychain -p "$PASSWORD" "$SIGN_KC" >/dev/null 2>&1; then
      ID=$(find_signing_identity)
      if [[ "$ID" =~ ^[a-fA-F0-9]{40}$ ]]; then printf '%s\n' "$ID"; return 0; fi
    fi
    /usr/bin/security delete-keychain "$SIGN_KC" >/dev/null 2>&1 || return 1
  fi
  PASSWORD=$(/usr/bin/openssl rand -hex 16) || return 1
  P12PASS=$(/usr/bin/openssl rand -hex 16) || return 1
  printf '%s' "$PASSWORD" > "$SIGN_DIR/keychain-pass" && chmod 600 "$SIGN_DIR/keychain-pass" || return 1
  CERT_TMP=$(mktemp -d "$SIGN_DIR/identity-XXXXXX") || return 1
  /usr/bin/openssl req -x509 -newkey rsa:2048 -keyout "$CERT_TMP/key.pem" -out "$CERT_TMP/cert.pem" \
    -days 3650 -nodes -subj "/CN=Volkan Deck Yerel" \
    -addext "extendedKeyUsage=critical,codeSigning" -addext "keyUsage=critical,digitalSignature" \
    -addext "basicConstraints=critical,CA:false" >/dev/null 2>&1 || return 1
  /usr/bin/openssl pkcs12 -export -inkey "$CERT_TMP/key.pem" -in "$CERT_TMP/cert.pem" \
    -out "$CERT_TMP/id.p12" -passout "pass:$P12PASS" >/dev/null 2>&1 || return 1
  /usr/bin/security create-keychain -p "$PASSWORD" "$SIGN_KC" >/dev/null 2>&1 || return 1
  CREATED=1
  /usr/bin/security unlock-keychain -p "$PASSWORD" "$SIGN_KC" >/dev/null 2>&1 || return 1
  local IMPORTED=0
  /usr/bin/security import "$CERT_TMP/id.p12" -k "$SIGN_KC" -P "$P12PASS" -T /usr/bin/codesign >/dev/null 2>&1 && IMPORTED=1
  rm -rf "$CERT_TMP"; CERT_TMP=''
  [ "$IMPORTED" = 1 ] || return 1
  /usr/bin/security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$PASSWORD" "$SIGN_KC" >/dev/null 2>&1 || return 1
  ID=$(find_signing_identity)
  [[ "$ID" =~ ^[a-fA-F0-9]{40}$ ]] || return 1
  READY=1
  printf '%s\n' "$ID"
)
sign_mac_app() {
  local SIGN_DIR="$HOME/Library/Application Support/Volkan Deck/signing"
  local SIGN_KC="$SIGN_DIR/volkan-deck.keychain-db" ID DR
  if ID=$(ensure_signing_identity); then
    /usr/bin/security unlock-keychain -p "$(cat "$SIGN_DIR/keychain-pass")" "$SIGN_KC" >/dev/null 2>&1 || return 1
    /usr/bin/codesign --force --deep --keychain "$SIGN_KC" --sign "$ID" "$1" || return 1
    /usr/bin/codesign --verify --deep --strict "$1" || return 1
    DR=$(/usr/bin/codesign -dr - "$1" 2>&1) || return 1
    DR=$(printf '%s' "$DR" | tr '[:upper:]' '[:lower:]')
    ID=$(printf '%s' "$ID" | tr '[:upper:]' '[:lower:]')
    [[ "$DR" == *'identifier "com.volkan.deck"'* && "$DR" == *"certificate leaf = h\"$ID\""* ]] || return 1
  else
    /usr/bin/codesign --force --deep --sign - "$1" || return 1
    /usr/bin/codesign --force --sign - -r='designated => identifier "com.volkan.deck"' "$1" || return 1
    /usr/bin/codesign --verify --deep --strict "$1" || return 1
  fi
}
# END local signing
sign_mac_app "$A" || { echo "HATA: Uygulama imzası doğrulanamadı." >&2; exit 1; }
pkill -f "Volkan Deck.app/Contents/MacOS" 2>/dev/null || true
pkill -f "Game Deck.app/Contents/MacOS" 2>/dev/null || true
# 2026-10-08: uygulamanın adı Game Deck oldu; eski Volkan Deck.app kaldırılır (ayarlar ve imza anahtarı yerinde kalır)
rm -rf "/Applications/Volkan Deck.app"
rm -rf "/Applications/Game Deck.app"
mv "$A" /Applications/
xattr -cr "/Applications/Game Deck.app" 2>/dev/null || true
rm -rf "$T"
open "/Applications/Game Deck.app"
echo "Kuruldu: /Applications/Game Deck.app"
