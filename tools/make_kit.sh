#!/bin/sh
# Build the installer kit: dist/VolkanDeck-kurulum.zip (Windows-Kur.bat / Mac-Kur.command + app + settings page)
set -e
cd "$(dirname "$0")/.."
python3 tools/build.py
rm -rf dist/VolkanDeck-kurulum dist/VolkanDeck-kurulum.zip
mkdir -p dist/VolkanDeck-kurulum
cp installer/* dist/VolkanDeck-kurulum/
cp -R app dist/VolkanDeck-kurulum/app
rm -f dist/VolkanDeck-kurulum/app/companion.js   # already inside index.html
cp web/StreamDeck-Ayar.html dist/VolkanDeck-kurulum/StreamDeck-Ayar.local.html
chmod +x dist/VolkanDeck-kurulum/Mac-Kur.command
(cd dist && zip -qr -X VolkanDeck-kurulum.zip VolkanDeck-kurulum)
echo "dist/VolkanDeck-kurulum.zip"
