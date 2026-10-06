# Volkan Deck

LilyGO T-Display-S3 tabanlı, kendin yap (DIY) bir stream deck. Döndürgeç ve iki MX tuşla bilgisayarda uygulama açar. Ana sayfada bir animasyon ve iki seçilebilir kart (CPU, GPU, saat, hava durumu, döviz, ağ) gösterir; medya ile ses ve parlaklık sayfaları da var. Veriler masaüstü uygulamasından USB ile gelir.

| Klasör | İçerik |
|---|---|
| `firmware/VolkanDeck/` | ESP32-S3 firmware kaynağı (Arduino), **v1.6.3** |
| `firmware/bin/` | Derlenmiş firmware (`flash_args` adresleriyle) |
| `web/` | Ayar sayfası kaynağı (`head.css.html` + `body.html`) ve derlenmiş `StreamDeck-Ayar.html` |
| `app/` | Masaüstü uygulaması (Electron 44.5.1, Windows + macOS); `media.js` + `win-helper.ps1` medya, ses ve parlaklık |
| `installer/` | `Windows-Kur.bat`, `Mac-Kur.command` ve kurulum notu |
| `case/v4/` | Kasa v4 (+ arka kapak v5): parametrik kaynak, STL dosyaları, Bambu Studio 3MF projesi |
| `docs/` | Kararlar, pinler ve seri protokol |
| `tools/` | Derleme betikleri ve testler (`tools/tests/`) |
| `AGENTS.md`, `CLAUDE.md` | Yapay zekâ asistanları için çalışma yönergesi |
| `GUNCELLEME.md`, `GUNLUK.md` | Güncelleme yayınlama standardı ve imza defteri |
| `GUNCELLEME-1.4-NOTU.md` | 1.4 öncesi kurulumlar için bir kerelik geçiş notu |

## Kurulum (kullanıcı)
1. Kurulum paketini oluştur: `sh tools/make_kit.sh`. Paket `dist/VolkanDeck-kurulum.zip` olarak çıkar.
2. **Windows:** `Windows-Kur.bat` dosyasını çalıştır.
3. **macOS:** Terminal'de `bash ` yaz, sonra `Mac-Kur.command` dosyasını pencereye sürükle ve Enter'a bas.

İki kurulum betiği de Electron'u GitHub'dan indirir ve içine `app/` klasörünü koyar.

Windows’ta CPU sıcaklığı için **Cihaz ayarları → CPU sıcaklığı için sürücüyü kur** düğmesine basıp **Anladım, kur** ile onaylayın. Tek yönetici onayıyla imzalı, açık kaynaklı PawnIO çekirdek sürücüsü ve bu kullanıcı oturum açtığında SYSTEM yetkileriyle sensör okuyan, ağda dinlemeyen bir görev kurulur; **Sensör sürücüsünü kaldır → Kaldır** düğmesi görevi ve dosyaları siler, PawnIO’yu yalnız Volkan Deck kurduysa ve başka bir kullanıcının sensör görevi kalmadıysa kaldırır. Elle kaldırmak gerekirse Görev Zamanlayıcı’da `VolkanDeckSensors-<sid>` görevini durdurup silin, `%ProgramFiles%\VolkanDeckSensors\<sid>` ve `%ProgramData%\VolkanDeckSensors\<sid>` klasörlerini (boşsa ana klasörleri de) silin; başka program veya kullanıcı kullanmıyorsa PawnIO’yu **Uygulamalar ve özellikler (Apps & features)** bölümünden kaldırın (`<sid>` için `whoami /user`). Bu adım olmadan CPU yükü ve diğer kartlar çalışır, CPU sıcaklığı “—” görünür.

Firmware'i uygulamadan yükle: **Cihaz ayarları → Firmware yükle**. Firmware dosyaları ayar sayfasının içine gömülüdür. Yükleme bitince kart kendiliğinden yeniden başlar.

## Güncelleme

Kullanıcılar uygulamanın tepsi/menü çubuğundaki **Güncellemeleri kontrol et** düğmesinden veya **Cihaz ayarları → Uygulama güncellemesi** bölümünden kontrol edip **Güncelle ve yeniden başlat** ile yükleyebilir. Electron sürümü değiştiyse kurulum betiğini yeniden çalıştırmak gerekir.

Varsayılan kanal **main**. Uygulama yalnız `app/` klasörünün içeriğini karşılaştırır: `app/` altında bir dosya değiştiyse push kullanıcılara güncelleme olarak ulaşır, bu yüzden oraya yalnızca tamamlanmış iş gönderin. Yalnız belge (`*.md`, `docs/`), kasa veya araç değişikliği güncelleme sayılmaz. **Sadece yayınlanan sürümler (Releases)** seçiliyse yalnızca GitHub'da yayınlanan en son Release'in etiketindeki uygulama yüklenir; henüz Release yoksa güncelleme yapılmaz.

Uygulama hedef commit'in `app/` klasörünü indirir. Push veya Release öncesinde `python3 tools/build.py` çalıştırın ve üretilen `app/index.html` ile `web/StreamDeck-Ayar.html` dosyalarını commit edin. Firmware değiştiyse önce aşağıdaki derleme/kopyalama adımlarını ve `python3 tools/embed_firmware.py` komutunu çalıştırın; firmware ikililerini ve üretilen sayfaları da commit edin.

Ayrıntılı kontrol listesi, commit biçimi ve imza kuralları `GUNCELLEME.md`'de; her push `GUNLUK.md`'ye tarih, saat ve GitHub hesabıyla kaydedilir.

## Geliştirme

### Firmware
Arduino-ESP32 **3.3.12** gerekir. Kütüphaneler:
- LovyanGFX
- ArduinoJson 7
- NimBLE-Arduino 2.5.1

```sh
arduino-cli compile -b esp32:esp32:lilygo_t_display_s3:USBMode=default,CDCOnBoot=cdc \
  --export-binaries firmware/VolkanDeck
cp firmware/VolkanDeck/build/esp32.esp32.lilygo_t_display_s3/{VolkanDeck.ino.bin,VolkanDeck.ino.bootloader.bin,VolkanDeck.ino.partitions.bin,boot_app0.bin,flash_args} firmware/bin/
```

Bölümlendirme `partitions.csv` dosyasında tanımlı: 4 MB uygulama + 12 MB LittleFS. Sürüm numarası `Board.h` içindeki `FW_VERSION` değeridir.

### Ayar sayfası ve uygulama
```sh
python3 tools/embed_firmware.py   # firmware/bin → web/body.html içindeki FIRMWARE sabiti
python3 tools/build.py            # → web/StreamDeck-Ayar.html ve app/index.html
```

- `app/index.html` dosyası üretilir, elle düzenlenmez. Sayfanın kendisi `web/body.html` dosyasından gelir.
- Masaüstüne özel eklemeler `app/companion.js` dosyasında. Derleme bu kodu sayfanın IIFE'sinin içine yerleştirir.
- Uygulamanın ana süreci `app/main.js` dosyası. Seri port seçimi, uygulama başlatma, tepsi/menü çubuğu burada; ana sayfa verileri `app/stats.js` içinde.

Uygulamayı geliştirme modunda çalıştırmak için: `npx electron@44.5.1 app`

Testler:
```sh
node --test tools/tests/*.test.js
python3 -m unittest discover -s tools/tests
```

### Kasa
`case/v4/deck_case4.py` dosyası [manifold3d](https://github.com/elalish/manifold) ile modeller. Kartın STL'si LilyGO'nun T-Display-S3 deposunda: `dimensions/t-display-s3-full.stl`. Bu dosyayı `case/v4/` klasörüne koy ya da yolunu `TDS3_STL` ortam değişkeniyle ver. Sonra:

```sh
python3 case/v4/export4.py
```

Bu komut STL ve 3MF dosyalarını üretir. Baskı ve montaj notları `case/v4/OKUBENI_kasa_v4.md` dosyasında. v4 gövdeye takılan arka kapak v5 için `python3 case/v4/export_cover5.py`; notları `case/v4/OKUBENI_kapak_v5.md`.
