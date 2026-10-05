# Volkan Deck — kararlar ve pinler

## Donanım
- LilyGO T-Display-S3 (ESP32-S3R8, 16MB Flash / 8MB OPI PSRAM, 1.9" 320x170 ST7789 8-bit paralel, dokunmatik DEĞİL)
- KY-040 döndürgeç, 2 × MX switch + 1u tuş kapağı (A/B; henüz alınmadı), Efcell 2000 mAh 3.7V Li-Po, 2 pin JST 1.25 mm uzatma kablosu
- Kartın arkasına pin başlıkları lehimli (Dupont ile bağlanıyor)

## Kullanım modeli: uygulama başlatıcı
- Döndürgeç listesi: [Ana sayfa] + uygulamalar. Sağa/sola: gezinir; basma: seçili uygulamayı açar (ana sayfada isteğe bağlı uygulama); uzun basma (0,7 sn): ana sayfaya dön
- A ve B butonları: atanan uygulamayı doğrudan açar (hızlı açma)
- Kartın kendi tuşları (v1.1.1'den itibaren yer değiştirdi): GPIO 0 (BOOT) = güç (kısa: ekran kapat/aç, 2 sn: derin uyku, tekrar basınca uyanır), GPIO 14 = reset (bırakınca ESP.restart; yalnız firmware çalışırken, yükleme modunda etkisiz)
- Boşta kalınca ana sayfaya dönüş (varsayılan 60 sn); karartma 30 sn; pilde uyku 5 dk
- Ekran 180° çevirme: Cihaz ayarları → "Ekranı 180° çevir" (device.flip)

## Medya ve Ses/parlaklık sayfaları (v1.3.0, 2026-10-05)
- Döndürgeç listesi: [Ana sayfa] [Medya] [Ses ve parlaklık] + uygulamalar (pages.media.enabled / pages.system.enabled)
- Medya: oynatıcı çipleri (Spotify / Apple Music / YouTube Music), şarkı, sanatçı, süre çubuğu, ses. Bas: oynat/duraklat · A: önceki · B: sonraki · basılı tut: ses modu (çevir: ses, 6 sn sonra çıkar) · çift bas: oynatıcı değiştir (oto → Spotify → Apple Music → YouTube Music). Varsayılan: pages.media.player
- Ses ve parlaklık: iki satır. Bas: ayar modu ses ↔ parlaklık · çevir: değer (ses %2, parlaklık %5) · basılı tut: çık · A: sessiz · B: satır değiştir
- Masaüstü uygulaması yoksa cihaz HID tüketici tuşları gönderir (oynat/duraklat, ileri, geri, ses ±, sessiz, parlaklık ±); BLE rapor haritasına rapor 2 eklendi (Bluetooth'ta yeniden eşleştirme gerekebilir)
- Windows: win-helper.ps1 sürekli açık (SMTC medya oturumları, Core Audio, WMI + DDC/CI parlaklık; parlaklık 10 sn'de bir okunur). Tarayıcı oturumları YouTube Music sayılır
- macOS: AppleScript (Spotify, Music; Chrome/Edge/Brave/Safari'de music.youtube.com sekme adı; ses), parlaklık JXA + DisplayServices (MacBook Air'de denendi, çalışıyor). YouTube Music kontrolü medya tuşuyla
- Ekran fontlarında yalnız ASCII + Türkçe harfler var; şarkı adları uygulamada sadeleştirilir (é → e)
- Albüm kapağı (v1.3.2): macOS'te Spotify artwork URL, Music yerel artwork verisi; yoksa iTunes Search API. Windows'ta seçili Spotify/Apple Music SMTC oturumunun thumbnail'ı. Parça değişince arka planda alınır, 64×64 RGB565 olarak USB'den gönderilir; tarayıcı/YouTube Music için kapak yok

## Ana sayfa
- Sol: 128x128 animasyon alanı (hazır: fan [CPU sıcaklığıyla hızlanır], radar, nabız, ekolayzer; veya kullanıcı GIF'i → RGB565 kareler, en fazla 60, /anim.bin)
- GIF kalıcı (v1.2.1): yükleme doğrudan flash'a yazılır (/anim.tmp → /anim.bin), config'e home.anim.kind="custom" kaydedilir; açılışta PSRAM'e, olmazsa RAM'e (≤96 KB) yüklenir, o da olmazsa kareler flash'tan akıtılır
- GIF'in kendi kare süreleri (v1.3.1): kare süreleri eşit değilse (ör. hareketler arasında uzun bekleme) ayar sayfası `anim_begin` içinde `delays` (ms, kare başına) gönderir; /anim.bin başlığında bayrak bit0 = süre tablosu var (başlıktan sonra n × uint16). Süre tablosu yoksa sabit kare/sn kullanılır. GIF 60 kareden uzunsa kare atlanır ve süre tablosu gönderilmez
- Animasyonun altı: A/B tuşlarına atanmış uygulamaların ikonu + adı (v1.3.0'da harf yerine ikon; yeni yerleşimde üst üste iki satır olduğu için A/B harfi de yeniden gösteriliyor)
- Sağ: iki kart yuvası (v1.4.0, home.cards, varsayılan cpu + gpu; 186×76 / 186×75). Her yuvaya ayar sayfasında biri seçilir; veriyi masaüstü uygulaması USB'den `stats` ile gönderir. Cihaz Wi-Fi kullanmaz
  - CPU / GPU: büyük °C, ad (home.cpuLabel/gpuLabel boşsa bilgisayardan gelen ad), başlıkta güç W ve yük %, ikinci satırın sağında GPU fan % + VRAM (5,2/12 GB) / CPU GHz, son 40 sıcaklığın çizgisi, 0–110 °C çubuk; sarı/kırmızı eşikler (CPU 85/95, GPU 80/87). Sıcaklık gelmezse (sürücü yok, Intel Mac) büyük rakam yük % olur, sağda "sıcaklık okunamıyor"
  - Saat: ortada büyük SS:DD (24 saat), altında Türkçe tarih ("Pzt 5 Eki"); `time` (epoch + tz) gelir, arada millis ile ilerler
  - Hava durumu: şehir, durum adı, WMO kodundan vektör ikon (açık, parçalı bulutlu, bulutlu, sis, yağmur/çisenti, kar, gök gürültüsü; yalnız gündüz), büyük °, sağda en yüksek / en düşük (▲/▼), başlıkta yağış %. Şehir ayar sayfasında Open-Meteo şehir aramasıyla seçilir (home.weather {city, lat, lon}, varsayılan İstanbul); cihaz city'yi yalnız veri gelmeden önce etiket olarak kullanır
  - Döviz: USD ve EUR iki satır, TL karşılığı 2 ondalık (virgüllü), sağda önceki güne göre % değişim (yeşil ▲ / kırmızı ▼, değişim yoksa gri)
  - Ağ: büyük indirme hızı (Mb/s; 1 Mbit/s altında kB/s, 1000 üstünde Gb/s), altta yükleme, başlıkta ping (yeşil < 40 ms, sarı < 100, kırmızı), indirme çizgisi (0 tabanlı)
  - Eskime: cpu/gpu/net 5 sn, hava/döviz 2 saat; eski veya null alan "-" gösterir (uydurma değer yok). Uygulama kapalıysa kartta "Masaüstü uygulaması kapalı", açıksa "Veri bekleniyor…"
- Eski sıcaklık yolu v1.4.0'da kaldırıldı: cihazın Wi-Fi ile LibreHardwareMonitor data.json okuması (Sensors.h), sensors.* ayarları, sensor_test / temps komutları ve temps olayı. Eski config'teki sensors nesnesi yok sayılır; get_config yanıtından ve set_config kaydından silinir (Wi-Fi şifresi dahil)
- Ana sayfa veri kaynağı: masaüstü `app/stats.js` → USB `stats` (firmware ≥1.4.0). Windows NVIDIA GPU: sürücüyle gelen `nvidia-smi` sürekli CSV akışı; AMD/Intel GPU desteği henüz yok. CPU yükü `os.cpus()` farkları; desteklenmeyen alanlar `null`.

## Ekran yerleşimi (2026-10-05, "her pikseli kullan")
- Kural: dış kenar 2 px, paneller arası 2 px; paneller çizgiyle değil zemin tonuyla ayrılır (SC_PANEL #161A21 / SC_BG #0A0C10). Seçili/odaklı alan çerçeve yerine renk tonuyla gösterilir (amber karışımı)
- Üst renkli 3 px çizgi kaldırıldı; sayfa rengi artık sayfa sayacının önündeki 8 px noktada. Durum satırı y 0..13 (eskiden 0..23), içerik y 15..167
- Ana sayfa: animasyon 128×128 sol üst köşede (2,2), köşe yarıçapı 8 aynı; durum satırı animasyonun sağında (sayaç x 134). A/B satırları animasyonun altında üst üste (A üstte; harf + ikon + ad, 128×17). CPU/GPU kartları 186×76/75 (eskiden 174×62); sıcaklık 36 px
- Uygulama sayfası: ikon r 33 (eskiden 31), yan ikonlar r 21, ad tam genişlikte; A/B yuvaları 157×26, alt kenara yaslı
- Medya: çipler y 16, kapak 64×64 (2,37), başlık/sanatçı/süre çubuğu yanında; sabitlenen oynatıcı çipi çerçeve yerine kendi renginde soluk dolgu; ses kendi panelinde (86×62), % 18 px kalın; ses modunda panel amber tonlu
- Ses ve parlaklık: iki satır 316×76/75, değer 36 px, çubuk 8 px; odaklı satır amber tonlu (çerçeve yok)
- Bildirim (toast): çerçeveli siyah kutu yerine dolu amber hap, alt kenarda (y 142..167)
- 36 px font: Fonts.h `fN36`, Inter SemiBold, yalnız " %+,-./0-9:" (8,6 KB; v1.4.0'da saat ve ondalıklar için ":,." eklendi, eski glifler aynı); üretimde mevcut fontların VLW kuralları (asc = boy, glif genişliği = ilerleme) kullanıldı. Diğer yazılarda en küçük boy yine 9 px
- Simülatör (web/body.html) aynı koordinatları kullanır

## Uygulama ekleme
- "Bilgisayardan seç…" veya sürükle-bırak: .exe (PE'den ikon + ad), .lnk, .url
- Masaüstü uygulamasında dosya yolu da kaydedilir (app.targets.win); macOS'te .app seçilir veya Finder'dan sürüklenir (app.targets.mac)
- Uygulama başına "Arka planda aç" (app.bg): Windows start /MIN, macOS open -g

## Uygulama açma (karar 2026-10-05)
- Kullanıcı Windows arama veya Çalıştır (Win+R) kullanılmasını istemiyor: uygulamalar yalnızca masaüstü uygulaması tarafından sistem çağrısıyla açılır
- Masaüstü uygulaması kapalıyken cihaz yazmaz, "Volkan Deck uygulaması açık değil" gösterir; klavye yedeği (Win+R / Başlat / Spotlight) yalnızca device.kbFallback açılırsa (varsayılan kapalı)
- Görev çubuğu (Win+1..9) ve kısayol tuşu yöntemleri klavyeyle gönderilmeye devam eder
- Yöntem adları masaüstünde: "Dosya, adres veya komut" (run) ve "Uygulama adı" (search → Başlat menüsü kaydı, arama UI'si yok)

## Masaüstü uygulaması (Windows + macOS) — 2026-10-05
- Electron 44.5.1, tek kod tabanı; ayar sayfası pencere içinde (Web Serial; ana süreç VID 0x303A portunu kendisi seçer, 3 sn'de bir otomatik bağlanır)
- Cihaz → {"evt":"launch","app","name","method","value","path","mac"}; uygulama yerel ayardan targets/bg'yi tamamlar
- Windows: .exe → CreateProcess (cwd = klasörü); .lnk/.url → ShellExecute (openPath); adres → openExternal; komut → doğrudan exe ya da cmd start (App Paths); ad → Get-StartApps + shell:AppsFolder; bg → start /MIN
- macOS: open / open -a / mdfind; bg → open -g
- Kalp atışı {"cmd":"companion","os":"win|mac"} 2 sn'de bir; firmware 6 sn içinde aldıysa ve port açıksa (DTR) doğrudan açar
- Windows CPU sıcaklık/güç: PawnIO **2.2.0** + LibreHardwareMonitorLib **0.9.6** (.NET Framework paketi, MPL-2.0); eski web sunucusu kurulumu yok. LHM 0.9.5’te PawnIO’ya geçti. PawnIO sürücü DACL’si SYSTEM/yönetici erişimi gerektirdiği için uygulamada tek seferlik “CPU sıcaklığı için sürücüyü kur” adımı vardır. SHA-256 + Authenticode doğrulamasından sonra aynı UAC içinde SYSTEM sensör görevi oturum açılışına kaydedilir; Electron normal kullanıcı olarak kalır.
- Sensör görevi `%ProgramFiles%\VolkanDeckSensors\<SID>` içindeki yöneticiye ait salt okunur kod/DLL’lerle CPU paket sensörünü okur; `%ProgramData%\VolkanDeckSensors\<SID>\readings.json` kullanıcıya yalnız okuma izniyle sunulur. Ağ dinleyicisi/komut kanalı yok; beş saniyeden eski ya da hatalı değer `null`. Görev uygulama kapalıyken de çalışır; kaldırmak için yönetici PowerShell’de `Get-ScheduledTask 'VolkanDeckSensors-*' | Unregister-ScheduledTask -Confirm:$false`, ardından korumalı sensör klasörlerini silin. PawnIO ayrı olarak Windows uygulama listesinden kaldırılabilir.
- Apple Silicon macOS: MIT lisanslı **macmon 0.8.2**, `macmon pipe -i 1000` JSON akışı (sudo yok), CPU/GPU sıcaklık/yük/güç ve GHz; GPU adı Apple çip adı. İndirme arşivi SHA-256 ile sabitlenir, ikili ad-hoc imzalanıp `codesign --verify --strict` ile doğrulanır. Intel Mac veya sensör hatasında `os.cpus()` yükü, sıcaklıklar `null`.
- Ağ: aktif loopback dışı arayüzlerin byte farkları → Mbit/s; Mac `netstat -ibn`, Windows ayrı küçük PowerShell/.NET yardımcısı. Ping her 5 sn’de 1.1.1.1:443 TCP bağlantı süresi (yedek 8.8.8.8).
- Hava: [Open-Meteo](https://open-meteo.com/en/docs) güncel °C/WMO kodu ve bugünün max/min/yağış olasılığı, `home.weather.lat/lon` seçilince, 15 dk önbellek. Kur: [Frankfurter v2](https://frankfurter.dev/) ECB verisi, USD/TRY + EUR/TRY ve önceki yayımlanan iş gününe göre %, 30 dk önbellek. Anahtar gerekmez; Electron `net.fetch`, 10 sn timeout, hatada son iyi veri (2 saate kadar).
- İkili/DLL dosyaları ilk kullanımda kullanıcı veri klasörüne sabit SHA-256 ile indirilir; repo ve GitHub `app/` güncellemesi küçük kalır. Kaynaklar, hash’ler, bağımlılıklar ve doğrulama notları: `app/vendor/README.md`. CPU/GPU/net yaklaşık 1 sn, saat bağlantıda + 60 sn; yavaş gruplar ayrıca ilk yanıt geldiğinde gönderilir. Medya/sys/kapak akışından bağımsızdır.
- Çarpıya basınca kapanmaz, arka planda çalışır: Windows'ta sistem tepsisi simgesi (+ görev çubuğu durumu), macOS'te yalnız menü çubuğu simgesi (Dock'ta görünmez; accessory modu). Simge bağlantı durumunu gösterir (dolu / yarım / boş)
- İlk açılışta "bilgisayar açılınca başlat" açık
- Dağıtım: VolkanDeck-kurulum.zip (Windows-Kur.bat / Mac-Kur.command Electron'u GitHub'dan indirip kurar). Mac'te /Applications/Volkan Deck.app kurulu; güncellemeler Contents/Resources/app'e yazılıyor
- macOS 27'de app.getFileIcon ana süreçte çöküyordu; ikon artık plutil + sips ile .icns'ten okunuyor
- Kaynak: GitHub volkangokyar01/deck-app (app/main.js, preload.js, companion.js — ayar sayfasının IIFE'sine gömülür, tools/build.py)
- Sınır: doğrudan açma yalnız USB'de

## Firmware (v1.4.0)
- Arduino-ESP32 3.3.12, kart lilygo_t_display_s3, USB-OTG (TinyUSB) + CDC on boot, özel partitions.csv (4 MB app0 + 12 MB LittleFS)
- Kütüphaneler: LovyanGFX 1.2.x, ArduinoJson 7.4, NimBLE-Arduino 2.5.1
- Yükleme: ayar uygulamasında "Firmware yükle" (esptool-js 0.7.0, bin'ler HTML'e gömülü)
- Yükleme sonrası yeniden başlatma (2026-10-05): dfu komutu kalıcı "zorla indirme" bayrağı (RTC_CNTL_OPTION1) bırakıyordu ve esptool-js RTS ile sıfırlamıyordu → kart yükleme modunda kalıyordu. Artık bayrak temizlenip RTC watchdog ile yeniden başlatılıyor, yedek olarak RTS darbesi
- v1.0.1 / 1.0.2: USB seri okuma ayrı görevde; PSRAM yedeği; status olayında rx / satır / psram
- v1.1.0: companion / temps komutları, launch olayı, launch.path / launch.mac, device.host (win/mac)
- v1.1.1: güç ve reset tuşları yer değiştirdi (güç GPIO 0 / BOOT, reset GPIO 14)
- v1.2.0: device.kbFallback (varsayılan kapalı) — masaüstü uygulaması yoksa Win+R / arama / Spotlight yazılmaz
- v1.2.1: ana sayfa GIF'i kalıcı (flash'a akışla yazma, açılışta yükleme)
- v1.3.0: Medya ve Ses/parlaklık sayfaları, HID tüketici tuşları, ana sayfada A/B ikonları, CPU/GPU başlıkları
- v1.3.1: ana sayfa GIF'i kare başına süreleri korur
- v1.3.2: medya sayfasında albüm kapağı
- v1.4.0: ana sayfada iki kart yuvası (cpu, gpu, clock, weather, fx, net) ve `stats` komutu; Wi-Fi / LibreHardwareMonitor yolu, sensor_test, temps kaldırıldı (Wi-Fi kitaplığı çıkınca program ~1,6 MB → ~0,96 MB). Yerleşim yenilemesi ve albüm kapağı da bu sürümde
- Gözlem (2026-10-02): v1.0.0 kartta komutlara yanıt vermedi (RX). Sonraki sürümlerin kartta doğrulanması bekleniyor

## Kasa v4 (güncel) — case/v4
- Elgato Stream Deck Mini tarzı kompakt kama: bütün kontroller tek eğimli yüzde (55°); ekran üstte, altında A (x −33) / B (x −11) MX ve döndürgeç (x +27, düğme Ø30 × 18); kartın tuşları ekranın solunda
- 100 × 85 × 68 mm; ön görünüş köşeleri R10, yüz kenarı 45° pah, ekran çevresinde ince çizgi oluk, pahlı pencere
- Arka düz gömme kapak (76 × 37), 4 kanca; pil tabanda köpük bantla (62 × 37 × 14 alan)
- Pin alanı: PCB arkasından 25 mm boş; klipsler yalnız kart uçlarında
- USB-C sol duvar, 14 × 9 delik (tepesi 45° sivri) + ~13 mm kanal
- Bambu Studio (2026-10-02): 0.12mm High Quality @BBL P2S, PLA Basic, dokulu PEI; dikiş "Arka", gövde 180° çevrili; 4 sa 45 dk, 82,9 g
- Kaynak case/v4/deck_case4.py

## Eski kasalar
- v3: tek gövde kama, 5° tuş güvertesi + 60° ekran; 126 × 114 × 70
- v2: açılımlı taban + A çerçeve kule; estetik bulunmadı, kancalar pinlerle çakışıyordu
- v1.1: 74,5 × 80 × 60 mm, ekran 60°

## Pinler
| Parça | Pin | GPIO |
|---|---|---|
| KY-040 | CLK / DT / SW | 1 / 2 / 10 |
| KY-040 | + | 3V3 (5V değil) |
| Buton A / B | → GND | 11 / 12 |
| Güç tuşu (kart, BOOT) — v1.1.1+ | | 0 |
| Reset tuşu (kart) — v1.1.1+ | | 14 |
| LCD güç (pilde) | | 15 HIGH |
| Pil ölçümü | | 4 (×2 bölücü) |

## Seri protokol
115200 baud, satır başına bir JSON. Komutlar: hello, get_config, set_config, launch, companion, stats (v1.4.0+, yanıt yok; gruplar isteğe bağlı, alanlar null olabilir: cpu {name, temp, load, power, clock}, gpu {+ fan, vram, vramTotal}, net {down, up Mbit/s, ping ms}, weather {city, temp, code WMO, hi, lo, rain}, fx {usd, eur, usdChg, eurChg}, time {epoch UTC sn, tz sn}), media (player, name, title, artist, playing, pos, dur, ctl app|keys, artKey), media_art (key, w=64, h=64, data=base64 RGB565 little-endian; boş key kapağı temizler), sys (vol, mute, bright), anim_begin, anim_data, anim_end, icon_set, dfu, restart. Olaylar: evt=input, select (home/media/system/uygulama id), launch, media (action play_pause|next|prev|select, player), sys (vol | bright | mute), status (fw, rx, lines, psram).
