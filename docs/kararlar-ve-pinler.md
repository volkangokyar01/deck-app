# Volkan Deck — kararlar ve pinler

## Donanım
- LilyGO T-Display-S3 (ESP32-S3R8, 16MB Flash / 8MB OPI PSRAM, 1.9" 320x170 ST7789 8-bit paralel, dokunmatik DEĞİL)
- KY-040 döndürgeç, 2 × MX switch + 1u tuş kapağı (A/B; henüz alınmadı), Efcell 2000 mAh 3.7V Li-Po, 2 pin JST 1.25 mm uzatma kablosu
- Kartın arkasına pin başlıkları lehimli (Dupont ile bağlanıyor)

## Kullanım modeli: uygulama başlatıcı
- Döndürgeç listesi: [Ana sayfa] + uygulamalar. Sağa/sola: gezinir; basma: seçili uygulamayı açar (ana sayfada isteğe bağlı uygulama); uzun basma (0,7 sn): ana sayfaya dön
- A ve B butonları: atanan uygulamayı doğrudan açar (hızlı açma)
- Kartın kendi tuşları (v1.1.1'den itibaren yer değiştirdi): GPIO 0 (BOOT) = güç (kısa: ekran kapat/aç, 2 sn: derin uyku, tekrar basınca uyanır), GPIO 14 = reset (bırakınca ESP.restart; yalnız firmware çalışırken, yükleme modunda etkisiz)
- Kapanma (2026-10-05): yazılımsal güç kesici yok; kapalı durum derin uykudur, USB takılıyken kart hâlâ güç çeker. GPIO0 RTC pull-up açık / pull-down kapalı, RTC çevre birimi açık; tuş kesintisiz 80 ms bırakılmadan EXT0 (LOW) kurulmaz. Arka ışık GPIO38 ve LCD güç GPIO15 LOW tutulur; diğer uyandırma kaynakları temizlenir, BLE durdurulur, USB bağlantısı kesilir
- Kapalı durum RTC_NOINIT_ATTR içindeki 32 bit işaretle korunur: setup'ın ilk kontrolü, işaret varken POWERON ve EXT0 dışındaki reset/uyanışlarda ekranı açmadan sessizce yeniden uyutur (USB-Serial-JTAG DTR/RTS, watchdog, RTC belleği korunmuş brownout dahil). Gerçek EXT0 veya POWERON işareti temizler; GPIO0/LCD RTC hold ve RTC yapılandırması, arka ışık hold normal açılışta bırakılır. CDCOnBoot nedeniyle Arduino çekirdeği USB'yi setup'tan önce başlatır; sessiz yolda hemen bağlantısı kesilir, firmware HID/seri başlatmasına ulaşılmaz. ROM yükleme modu veya RTC belleğini kaybettiren güç düşüşü yazılımla engellenemez
- Donanım doğrulaması bekliyor: pil/USB'de uzun basma → kapalı kalma → tekrar tuşla uyanma, masaüstünün 3 sn bağlantı denemeleri, DTR/RTS resetleri, watchdog/brownout sonrası RTC işareti ve ekran/arka ışık seviyeleri; kapalı akımı ölçülmeli
- Boşta kalınca ana sayfaya dönüş (varsayılan 60 sn). Karartma ve otomatik kapanma kabloda ve pilde ayrı (v1.5.1): device.dimAfterUsb / sleepAfterUsb (varsayılan 30 sn / kapalı), device.dimAfter / sleepAfter (pilde, varsayılan 30 sn / 5 dk); 0 = kapalı. Kablo = USB'ye bağlı ya da şarj oluyor
- Ekran teması (2026-10-05): device.theme = auto (varsayılan) / dark / light. Koyu: saf siyah zemin, nötr griler; açık: kırık beyaz kasaya uygun sıcak beyaz. device.lightFrom = 420 (07:00), device.darkFrom = 1140 (19:00), yerel gece yarısından sonraki dakika; 0..1439 ile sınırlı. Eski config bu varsayılanları alır.
- Otomatik tema: açık başlangıcı dahil, koyu başlangıcı hariç; açık başlangıcı daha geçse gece yarısını aşan aralık, başlangıçlar aynıysa tüm gün koyu. Saat masaüstünün `stats.time` (epoch + tz) verisinden, arada millis ile ilerler; ilk saat gelene kadar koyu. Açılışta ve ayar değişince uygulanır, döngüde 3 sn’de bir denetlenir; değişince tam ekran çizilir (kapatma/reset yazıları da aynı palet).
- Ekran 180° çevirme: Cihaz ayarları → "Ekranı 180° çevir" (device.flip)

## Medya ve Ses/parlaklık sayfaları (v1.3.0, 2026-10-05)
- 2026-10-06 (v1.5.3): Döndürgeç ve A/B ile Spotify, Apple Music veya YouTube Music açılınca etkin Medya sayfasına geçilir; oynatıcı yalnız oturum için sabitlenir, pages.media.player değişmez. Ad ve launch.value/path/mac üzerinde büyük-küçük harf duyarsız tanıma cihazda yapılır. pages.media.launch (none / spotify / music / ytmusic, eski ayarda none) çalan uygulama yokken masaüstü uygulamasının açacağı oynatıcıdır; oturum sabiti önce gelir. Oynatıcı yokken açma seçilmişse masaüstü ctl:app bildirir; yeni masaüstü companion.mediaLaunch:true yeteneğini bildirir, böylece ilk durum yanıtından önce de sabit oynatıcıya oynat iletilir; eski masaüstünde eksik yetenek false sayılır. Mevcut evt media ve HID yolu korunur, masaüstü yokken kararı işletim sistemi verir.
- Döndürgeç listesi: [Ana sayfa] [Medya] [Ses ve parlaklık] + uygulamalar (pages.media.enabled / pages.system.enabled)
- Medya: oynatıcı çipleri (Spotify / Apple Music / YouTube Music), şarkı, sanatçı, süre çubuğu, ses. Bas: oynat/duraklat · A: önceki · B: sonraki · basılı tut: ses modu (çevir: ses, 6 sn sonra çıkar) · çift bas: oynatıcı değiştir (oto → Spotify → Apple Music → YouTube Music). Varsayılan: pages.media.player
- Medya sayfasında kalma: pages.media.stay (bool, varsayılan true; eski config'te eksikse de true). Medya ayarındaki "Medya sayfasındayken ana sayfaya dönme" açıkken yalnız Medya sayfasında home.returnAfter atlanır; karartma ve pilde otomatik kapanma aynen devam eder. Kapatılırsa normal ana sayfaya dönüş süresi uygulanır
- Ses ve parlaklık: iki satır. Bas: ayar modu ses ↔ parlaklık · çevir: değer (ses %2, parlaklık %5) · basılı tut: çık · A: sessiz · B: satır değiştir
- Masaüstü uygulaması yoksa cihaz HID tüketici tuşları gönderir (oynat/duraklat, ileri, geri, ses ±, sessiz, parlaklık ±); BLE rapor haritasına rapor 2 eklendi (Bluetooth'ta yeniden eşleştirme gerekebilir)
- Windows: win-helper.ps1 sürekli açık (SMTC medya oturumları, Core Audio, WMI + DDC/CI parlaklık; parlaklık 10 sn'de bir okunur). Tarayıcı oturumları YouTube Music sayılır
- macOS: AppleScript (Spotify, Music; Chrome/Edge/Brave/Safari'de music.youtube.com sekme adı; ses), parlaklık JXA + DisplayServices (MacBook Air'de denendi, çalışıyor). YouTube Music kontrolü medya tuşuyla
- Ekran fontlarında yalnız ASCII + Türkçe harfler var; şarkı adları uygulamada sadeleştirilir (é → e)
- Albüm kapağı (v1.3.2): macOS'te Spotify artwork URL, Music yerel artwork verisi; yoksa iTunes Search API. Windows'ta seçili Spotify/Apple Music SMTC oturumunun thumbnail'ı. Parça değişince arka planda alınır, 64×64 RGB565 olarak USB'den gönderilir; tarayıcı/YouTube Music için kapak yok

## Ana sayfa
- Sol: 128x128 animasyon alanı (hazır: fan [CPU sıcaklığıyla hızlanır], radar, nabız, ekolayzer; veya kullanıcı GIF'i → RGB565 kareler, en fazla 60, /anim.bin)
- GIF kalıcı (v1.2.1): yükleme doğrudan flash'a yazılır (/anim.tmp → /anim.bin), config'e home.anim.kind="custom" kaydedilir; açılışta PSRAM'e, olmazsa RAM'e (≤96 KB) yüklenir, o da olmazsa kareler flash'tan akıtılır
- GIF'in kendi kare süreleri (v1.3.1): kare süreleri eşit değilse (ör. hareketler arasında uzun bekleme) ayar sayfası `anim_begin` içinde `delays` (ms, kare başına) gönderir; /anim.bin başlığında bayrak bit0 = süre tablosu var (başlıktan sonra n × uint16). Süre tablosu yoksa sabit kare/sn kullanılır. Süre tablosu varken `fps` yalnız tasarruf hızını sınırlar (`ecoAnimFps = min(animFps, ecoFps)`); 2026-10-06'dan beri ayar sayfası onu ortalamadan değil en kısa kareden hesaplar, yoksa uzun beklemeler ortalamayı ~1 kare/sn'ye düşürüp tasarrufta animasyonu donduruyordu. GIF 60 kareden uzunsa kare atlanır ve süre tablosu gönderilmez
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
- Kural: dış kenar 2 px, paneller arası 2 px; paneller çizgiyle değil zemin tonuyla ayrılır (koyu SC_PANEL #0F1012 / SC_BG #000000; açık #ECE8E0 / #FAF8F3). Seçili/odaklı alan çerçeve yerine renk tonuyla gösterilir (amber karışımı)
- Üst renkli 3 px çizgi kaldırıldı; sayfa rengi artık sayfa sayacının önündeki 8 px noktada. Durum satırı y 0..13 (eskiden 0..23), içerik y 15..167
- Ana sayfa: animasyon 128×128 sol üst köşede (2,2), köşe yarıçapı 8 aynı; durum satırı animasyonun sağında (sayaç x 134). A/B satırları animasyonun altında üst üste (A üstte; harf + ikon + ad, 128×17). CPU/GPU kartları 186×76/75 (eskiden 174×62); sıcaklık 36 px
- Uygulama sayfası: ikon r 33 (eskiden 31), yan ikonlar r 21, ad tam genişlikte; A/B yuvaları 157×26, alt kenara yaslı
- Medya: çipler y 16, kapak 64×64 (2,37), başlık/sanatçı/süre çubuğu yanında; sabitlenen oynatıcı çipi çerçeve yerine kendi renginde soluk dolgu; ses kendi panelinde (86×62), % 18 px kalın; ses modunda panel amber tonlu
- Ses ve parlaklık: iki satır 316×76/75, değer 36 px, çubuk 8 px; odaklı satır amber tonlu (çerçeve yok)
- Bildirim (toast): çerçeveli siyah kutu yerine dolu amber hap, alt kenarda (y 142..167)
- 36 px font: Fonts.h `fN36`, Inter SemiBold, yalnız " %+,-./0-9:" (8,6 KB; v1.4.0'da saat ve ondalıklar için ":,." eklendi, eski glifler aynı); üretimde mevcut fontların VLW kuralları (asc = boy, glif genişliği = ilerleme) kullanıldı. Diğer yazılarda en küçük boy yine 9 px
- Simülatör (web/body.html) aynı koordinatları ve koyu/açık paletleri kullanır; otomatik tema tarayıcının yerel saatine göre 3 sn’de bir denetlenir. Cihaz ayarları → Ekran teması; otomatik seçilince iki HH:MM başlangıç alanı açılır. Sayfa/marka, oynatıcı ve kullanıcı uygulama renkleri sabit; dolgularda kontrasta göre beyaz/koyu yazı, soluk renklerde mevcut zemin/panel ile karışım. Hazır Icons.h ikonları alfa maskesi; albüm kapağı, uygulama ikon görselleri ve kullanıcı GIF kareleri değiştirilmez

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
- Sınır: doğrudan açma USB'de; v1.6.0'dan itibaren kablo bu bilgisayara takılı değilse Bluetooth veri kanalıyla da (aşağıda)

## Bluetooth veri kanalı (v1.6.0, 2026-10-06)
- Önceden Bluetooth yalnız HID klavye + medya tuşuydu; ayarlar, stats, medya ve launch olayları yalnız USB seri porttan gidiyordu
- Yeni GATT servisi 7d9a0001-5c2e-4b7a-9f3d-1a6c0de5d001: RX 7d9a0002 (write / write without response, şifreli bağlantı ister), TX 7d9a0003 (notify). İçerik USB ile aynı satır başına bir JSON
- Yanıt komutun geldiği yola gider; olaylar (launch, media, sys, input, select, status) USB'deki masaüstü uygulamasına, yoksa Bluetooth'takine
- İki bilgisayar aynı anda (biri USB, biri Bluetooth): ekranı USB'deki besler; Bluetooth'tan gelen stats / media / media_art / sys yok sayılır
- Cihaz bağlıyken de yayın yapar (en fazla 2 bağlantıya kadar), Windows'ta Web Bluetooth taraması bağlı cihazı bulabilsin diye. Yayın: görünüm 0x03C1 + HID ve Volkan Deck servis UUID'leri; ad tarama yanıtında
- hello yanıtında via ("usb" / "ble") ve Bluetooth'ta mtu; uygulama yazmaları mtu-3'e (en çok 240) böler, hello'dan önce 20 bayt
- Masaüstü uygulaması: önce USB; kablo yoksa 12 sn'de bir Web Bluetooth ile servis UUID'si üzerinden arar (ana süreç seçiciyi kendisi kapatır, 8 sn'de bulamazsa vazgeçer). Kablo takılınca USB'ye geçer. Bağlantı ayarı "Sadece USB" ise Bluetooth denenmez
- Bluetooth'ta yapılmayanlar: firmware yükleme (dfu → usb_only), animasyon yükleme (uygulama engeller)
- macOS: Electron'un Info.plist'inde NSBluetoothAlwaysUsageDescription var; Mac-Kur.command Türkçe açıklama yazar

## Firmware (v1.9.2)
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
- v1.4.1: döndürgeç yön değiştirince ilk tık kaybolmuyor (açılışta gerçek pin durumu, her tık yuvasında sayaç sıfırlanır)
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
- v1.5.1: karartma ve otomatik kapanma kabloda / pilde ayrı ayarlanır, ikisi de kapatılabilir (dimAfterUsb, sleepAfterUsb; eski config'te kablo = eski karartma süresi, kapanma yok)
- v1.5.2: Ses ve parlaklık sayfasında mikrofon satırı, B tuşu varsayılan mikrofonu kapatır / açar (sys.micMute / evt sys micMute; Windows Core Audio capture mute, macOS giriş seviyesi 0 ↔ önceki seviye). Yeni "Widgetlar" sayfası (pages.widgets.enabled / cards, 1–4 kart; yerleşim 1: tam, 2: alt alta, 3: üst geniş + alt iki, 4: 2×2), döndürgeçte ana sayfadan hemen sonra, boşta ana sayfaya dönmez
- v1.6.0: Bluetooth veri kanalı (masaüstü uygulaması kablosuz da bağlanır)
- v1.6.1: Bluetooth gönderimi ayrı görevde (kuyruk 24); BLE alma geri çağrısı kuyrukta beklemez. 1.6.0'da ana döngü notify için bekliyor, NimBLE görevi de kuyrukta beklediği için menüler yavaşlıyor, stats/sys satırları düşüyordu
- v1.6.2: firmware sürümü değişince eşleşmiş bilgisayarlara GATT "service changed" bildirimi (NVS vdble/fw); macOS eski servis listesini önbellekte tutuyordu. Uygulama Bluetooth'u USB'den önce dener (requestDevice taze kullanıcı etkinliği ister) ve hataları günlüğe yazar

## Pinler
| Parça | Pin | GPIO |
|---|---|---|
| KY-040 | CLK / DT / SW | 1 / 2 / 10 |
| KY-040 | + | 3V3 (5V değil) |
| Buton A / B | → GND | 11 / 12 |
| Güç tuşu (kart, BOOT) — v1.1.1+ | | 0 |
| Reset tuşu (kart) — v1.1.1+ | | 14 |
| LCD güç (pilde) | | 15 HIGH |
| LCD arka ışık (PWM; uykuda LOW) | | 38 |
| Pil ölçümü | | 4 (×2 bölücü) |

## Seri protokol
115200 baud, satır başına bir JSON. Komutlar: hello, get_config, set_config, launch, companion, stats (v1.4.0+, yanıt yok; gruplar isteğe bağlı, alanlar null olabilir: cpu {name, temp, load, power, clock}, gpu {+ fan, vram, vramTotal}, net {down, up Mbit/s, ping ms}, weather {city, temp, code WMO, hi, lo, rain}, fx {usd, eur, usdChg, eurChg}, time {epoch UTC sn, tz sn}), media (player, name, title, artist, playing, pos, dur, ctl app|keys, artKey), media_art (key, w=64, h=64, data=base64 RGB565 little-endian; boş key kapağı temizler), sys (vol, mute, bright), anim_begin, anim_data, anim_end, icon_set, dfu, restart. Olaylar: evt=input, select (home/media/system/uygulama id), launch, media (action play_pause|next|prev|select, player), sys (vol | bright | mute), status (fw, rx, lines, psram).

## 2026-10-06 — Boşta tasarruf (firmware 1.6.3)

Kabloda `device.ecoAfterUsb=60`, pilde `device.ecoAfter=30` saniye; 0 kapalı, sınır 3600. Karartma/kapanmadan bağımsızdır. Masaüstü verisi kullanıcı girdisi sayılmaz. `device.dimLevelUsb` / `device.dimLevel`: normal parlaklığın %5–90’ı, varsayılan %17; karartılmış parlaklık en az %5, güç kaynağı değişince yeniden uygulanır (2026-10-06). `device.ecoFpsUsb` / `device.ecoFps`: 0–15 kare/sn (seçenekler 15, 10, 8, 4, 2, 1, Durdur; firmware 1.7.1 öncesi en çok 8), varsayılan 4; 0 son tamamlanan kareyi dondurur ve animasyon alanı yeniden çizilmez (2026-10-06). Eski ayarlarda da bu varsayılanlar geçerlidir. Boşta ana sayfa animasyonu seçilen hızla sınırlı ve yalnız kendi bölgesinde; periyodik tam ekran çizimi durur, saat dakika sınırında güncellenir. Encoder, A/B ve kısa güç girdisi önce CPU'yu 240 MHz'e döndürür; ilk eylem yutulmaz. Aktarım, ayarlama ve bildirim tasarrufu engeller. Döngü beklemesi 2 ms; light sleep yok.

ESP32-S3 için 80/240 MHz aynı 480 MHz PLL'den bölünür ve APB 80 MHz kalır ([IDF saat kodu](https://github.com/espressif/esp-idf/blob/v5.5.4/components/esp_hw_support/port/esp32s3/rtc_clk.c)). Arduino 3.3.12 saat değişimi FreeRTOS tick bölücüsünü günceller ([CPU HAL](https://github.com/espressif/arduino-esp32/blob/3.3.12/cores/esp32/esp32-hal-cpu.c)); S3 UART varsayılanı XTAL'dir ([UART HAL](https://github.com/espressif/arduino-esp32/blob/3.3.12/cores/esp32/esp32-hal-uart.c)). Bu cihazda `Serial` TinyUSB CDC'dir, UART baud ayarı gerekmez. PLL kapatılmadığından USB saatinin korunması beklenir; BLE için 80 MHz altına inilmez. Donanımda süreklilik henüz doğrulanmadığı için CPU geçişi varsayılanı açık `VOLKAN_ECO_CPU` bayrağıyla kapatılabilir. Sıcaklık ve ilk girdi gecikmesi README kontrol listesinde gerçek cihazla ölçülecek.

## 2026-10-06 — Tema başına animasyon (firmware 1.7.0)

"Kendi GIF'im" için iki yuva: koyu tema `/anim.bin`, açık tema `/anim_light.bin`. Cihaz temayı saate göre kendisi değiştirdiği için iki dosya da kartta saklanır ve çizim anında `themeAnim(lightTheme)` seçer; bir yuva boşsa iki temada diğeri oynar. `anim_begin` isteğe bağlı `"slot":"light"` alır (yoksa koyu), `anim_clear` bir yuvayı siler, `hello` yanıtında `anim` / `animLight` kare sayıları var. Koyu yuva hız ayarını (`home.anim.fps`) izler, açık yuva dosyadaki hızı ya da GIF'in kendi kare sürelerini kullanır. Eski firmware `slot`'u bilmediği ve koyu animasyonun üstüne yazacağı için ayar sayfası açık tema animasyonunu yalnız 1.7.0+ karta gönderir. Bellek: iki animasyon PSRAM'e sığar (en çok 2 × 60 × 32 KB); PSRAM yoksa her yuva kendi dosyasından kare kare okunur.

## 2026-10-06 — Outlook yeni posta bildirimi (firmware 1.8.0)

Masaüstü uygulaması Outlook'u izler; okunmamış sayısı artınca cihaza `{"cmd":"mail","subject":"…","unread":5,"new":1,"ms":10000}` gönderir. Cihaz tüm ekranı kaplayan bir bildirim gösterir ve bildirim `ms` kadar (en çok 120 sn) kalır. Bildirim açıkken A, B ve döndürgece basmak `{"evt":"mail","action":"open"}` gönderir, masaüstü uygulaması Outlook'u öne getirir. Çevirmek ya da uzun basmak bildirimi kapatır. Güç ve yeniden başlatma tuşları her zamanki gibi çalışır. `"ms":0` bildirimi kaldırır.

- Bildirim ekranı karartmadan ve tasarruftan çıkarır, ama kullanıcı girdisi sayılmaz: boşta sayaçları arkada işler, bildirim bitince ekran yine kararır. Bildirim sürerken karartma, tasarruf ve kapanma beklemeye alınır. Güç tuşuyla kapatılmış ekran açılmaz.
- İki bilgisayar aynı anda bağlıysa Bluetooth'tan gelen `mail` yok sayılır (ekranı USB'deki bilgisayar besler).
- macOS: Outlook'un Dock rozetindeki okunmamış sayısı `lsappinfo` ile 3 sn'de bir okunur. İzin gerekmez; klasik ve yeni Outlook'ta çalışır. Konu okunamaz, çünkü yeni Mac Outlook'ta AppleScript yok (Microsoft Ağustos 2026'da iptal etti). Outlook'ta Dock rozeti kapalıysa bildirim gelmez.
- Windows: ayrı bir PowerShell yardımcısı (`app/win-mail.ps1`) çalışan klasik Outlook'a COM ile bağlanır (Outlook'u hiçbir zaman kendisi başlatmaz). 3 sn'de bir tüm hesapların Gelen Kutusu okunmamış sayısını okur; konu yalnız sayı artınca, en yeni okunmamış postadan alınır. Yalnız `Subject`, `ReceivedTime`, `UnRead`, `UnReadItemCount` okunur; bunlar Outlook güvenlik uyarısı açmaz. Yeni Outlook (olk.exe) başka uygulamalara posta bilgisi vermez; desteklenmez, ayarlarda belirtilir. Outlook'u açmak: App Paths'te OUTLOOK.EXE varsa `outlook.exe /recycle` (açık pencereyi öne getirir), yoksa Başlat menüsündeki Outlook.
- İzleme yalnız özellik açıkken ve 1.8.0+ bir kart doğrudan açma modunda bağlıyken çalışır. Outlook açıldıktan sonraki ilk 20 sn eşitleme sayılır, bildirim verilmez. Bağlantı yokken gelen posta sonradan gösterilmez.
- Ayarlar masaüstü uygulamasında (`state.json` → `mail`: `enabled`, `seconds` 5/10/15/30/60, `subject`), cihaz ayarına girmez. Konu `devText` ile cihaz fontlarına indirgenir (en çok 90 karakter), cihazda iki satıra kelime sınırından bölünür.

## 2026-10-06 — "Cihaza yaz" kartı yeniden başlatıyordu (firmware 1.8.1)

Windows'ta ayar yazınca kart yeniden başlıyor, ayar kaydedilmiyordu. Kart boşta tasarruftayken (80 MHz) gelen `set_config` önce `ecoSuspend()` ile CPU'yu 240 MHz'e çeviriyor, hemen ardından LittleFS'e yazıyordu; CPU geçişi donanımda doğrulanmamıştı. `VOLKAN_ECO_CPU` varsayılanı 0: tasarrufta çizim azaltma sürer, CPU frekansı değişmez.

Aynı sürümde:
- Bluetooth'ta her bağlantının kendi alma tamponu var; yanıt komutun geldiği bağlantıya, olaylar masaüstü uygulamasının bağlantısına (son `companion`) gider. Önceden iki bilgisayar (ör. Mac Bluetooth'ta, Windows yazarken) aynı tampona yazınca satırlar karışabiliyordu.
- Kırıntı: RTC_NOINIT'te son komut / aşama (`cmd:<ad>`, `apply`, `input`, `render`). Panik / watchdog / brownout sonrası `hello` yanıtında `crash` ("panic @ cmd:set_config" gibi) ve her zaman `reset`; uygulama günlüğe yazar ve bildirir.
- Uygulama her zaman önce USB'yi dener; `getPorts()` boşsa ana sürecin seçicisiz `requestPort` yanıtıyla kabloyu algılar. Bluetooth yalnız kablo yokken.

## 2026-10-06 — Bellek: "Cihaza yaz" panik veriyordu (firmware 1.8.2)

1.8.1'in kırıntısı Windows'ta `crash: "panic @ cmd:set_config"` gösterdi; aynı kayıtta `psram: 0`. Kartta PSRAM başlamıyor (qio_opi yapılandırması, `CONFIG_SPIRAM_IGNORE_NOTFOUND`), her şey ~320 KB iç RAM'de: 108 KB ekran sprite'ı, NimBLE, uygulama ikonları (uygulama başına 3,2 KB), kalıcı 24 KB seri tampon, 1.6.0'dan beri Bluetooth bağlantısı başına 24 KB tampon, 16 KB sabit dizi. `set_config` sırasında yeni `Settings` kurulurken eski ikonlar hâlâ bellekteydi ve `S = N` kopyası ikinci bir vektör ayırıyordu; vektör ayırması başarısız olunca firmware abort ediyordu.

Değişiklikler: `applyConfig` ikonları en başta bırakır ve `S = std::move(N)` kullanır; seri ve Bluetooth satır tamponları 1 KB'tan başlayıp yalnız uzun satırda büyür, satır bitince küçülür ve kuyruğa kopyalanmadan devredilir; Bluetooth bağlantısı kopunca tamponu serbest kalır; `anim_data` için 8 KB yalnız yükleme sırasında ayrılır, kapak doğrudan kapak tamponuna çözülür. Global RAM 90,8 KB → 74,4 KB. `status` ve `hello` artık `heap` / `block` (KB) bildirir; `set_config` kırıntısı aşama gösterir (save / apply / prune / reply). PSRAM'in neden başlamadığı donanımda ayrıca incelenmeli.

## 2026-10-06 — Komut dosyaları

Uygulama listesine komut dosyası eklenebilir; çalıştırmayı masaüstü uygulaması yapar (cihaz yalnız launch olayı gönderir). Windows: `.ps1` → `powershell -NoProfile -ExecutionPolicy Bypass -File` ("Arka planda aç" ile gizli pencere), `.bat` / `.cmd` → `cmd start` (klasörü çalışma dizini), `.vbs` → `wscript`. macOS: `.sh` / `.bash` → bash, `.zsh` → zsh, `.py` → `/usr/bin/python3`, `.scpt` / `.applescript` → osascript, hepsi Terminal açmadan; `.command` Finder gibi Terminal'de açılır. Klavye yedeğinde Windows komut dosyası Çalıştır kutusuna tam yolla yazılır.

## 2026-10-07 — Pil seviyesi kablodayken de gerçek (firmware 1.8.3)
- Sorun: kabloda şarj devresi pil ucundaki gerilimi yükseltiyor (şarj akımı × iç direnç, sonra 4,2 V sabit), ölçüm >4,25 V olunca seviye doğrudan %100 yazılıyordu.
- Pilde: filtrelenmiş gerilim doğrusal değil Li-Po deşarj eğrisiyle yüzdeye çevrilir (3,30 V = %0, 4,16 V = %100); düşüşler yumuşak izlenir, kablo çıkınca 3 dk gevşeme süresince seviye yükselmez.
- Kabloda: seviye takılmadan önceki değerden başlar, şarj hızıyla artar (BAT_CHARGE_MA 500 mA / BAT_MAH 2000 mAh ≈ %25/saat, %80 üstünde yavaşlar). Üst sınır ölçülen gerilimin eğrideki karşılığı, alt sınır 0,10 V (BAT_IR_V) düşülmüş karşılığı (yalnız 4,12 V altında). %100'e varınca "şarj" biter.
- Kablo = USB host bağlı ya da gerilim >4,22 V (duvar şarjı). Seviye RTC belleğinde tutulur; güncelleme/yeniden başlatma sonrası sıfırdan tahmin edilmez. Soğuk açılış kabloda ise ilk değer gerilimden tahmin edilir.
- Durum çubuğunda "şarj" yazısı yerine yüzde + pil simgesinde şimşek.
- Şarj akımı: kartta TP4065 doğrusal şarj entegresi, programlama direnci R13 = 2 kΩ → 1000 V / 2 kΩ ≈ 500 mA (LilyGO wiki: varsayılan 500 mA; GitHub T-Display-S3 #230: en kötü durumda ≈ 520 mA). Kartta akım sensörü yok; firmware akımı ölçemez, yalnız pil gerilimini (GPIO4, ×2 bölücü) görür. Gerçek akım ısınmayla (doğrusal entegre, ~0,6 W) ve kart yükünden dolayı biraz düşük olabilir; USB-C ölçerle ya da pil kablosuna seri multimetreyle doğrulanmalı.

## 2026-10-07 — Kablo çıkınca "şarj" kalıyordu (firmware 1.8.4)
- Kartta VBUS algılama hattı yok: kablo bilgisayardan çekilince TinyUSB yalnız "suspend" verir, "mounted" bayrağı açık kalır. 1.8.3 bunu kablo sayıyordu.
- Artık kablo = USB host bağlı ve uykuda değil, ya da şarj cihazı. Şarj cihazı gerilim sıçramasından bulunur: hızlı ortalama yavaş ortalamanın 0,06 V (BAT_STEP_V) üstüne çıkınca takıldı, altına inince çekildi sayılır; USB suspend de şarj cihazı bayrağını siler. Açılışta gerilim >4,25 V ise şarj cihazıyla açıldı sayılır.
- Bilinen sınır: bilgisayar uykudayken (USB suspend) kablo takılı olsa da "şarj" görünmez, seviye pil hesabıyla devam eder.

## 2026-10-07 — Windows'ta "Cihazınızı yeniden bağlamayı deneyin" (firmware 1.8.5)
- Belirti: Windows'ta Bluetooth ayarları sürekli "yeniden bağlamayı deneyin" uyarısı veriyordu; cihaz yalnız Mac mini ile eşleşmişti.
- Neden (büyük olasılıkla): kablo Windows'a takılı değilken masaüstü uygulaması 12 sn'de bir Web Bluetooth ile cihaza bağlanıyordu. Cihaz Windows'la eşleşmemişken her bağlantı Windows'un kendi eşleştirmesini başlatıyor, bağlantı kapanınca eşleştirme yarıda kalıyor ve uyarı tekrar tekrar çıkıyordu; Ayarlar'dan elle eşleştirme de bu denemelerle çakışıyordu.
- Uygulama: Windows'ta Bluetooth ancak cihaz Windows'ta eşleşmiş görünüyorsa (Get-PnpDevice, sınıf Bluetooth, BTHLE\DEV_*, ad = cihaz adı; 60 sn önbellek) denenir; değilse kayda bir kez "Windows Ayarlar → Bluetooth ve cihazlar → Cihaz ekle" notu düşer. Başarısız denemelerden sonra bekleme 12 sn → 30 sn → 1 dk → 5 dk. Windows sorgulanamazsa engellenmez. macOS'ta değişiklik yok.
- Firmware: `{"cmd":"ble_forget"}` bütün Bluetooth eşleşmelerini siler, bağlı bilgisayarları düşürür (yalnız USB'den). hello yanıtında `bonds` (eşleşme sayısı). Ayar sayfasında Cihaz kartında "Bluetooth eşleşmelerini sil" düğmesi (USB'de, 1.8.5+).
- NimBLE en fazla 3 eşleşme tutar (CONFIG_BT_NIMBLE_MAX_BONDS 3); dördüncü bilgisayar en eskisini siler.

## 2026-10-07 — Bağlantılar sayfası: Bluetooth bilgisayarı cihazdan seçilir (firmware 1.9.0)
- Kullanıcı isteği: eşleştirme ve bilgisayar seçimi cihazdan, elle yapılsın; Bluetooth ve Wi-Fi aynı sayfada olsun (ayrı ekran yok).
- Döndürgeç listesinde yeni sayfa "Bağlantılar" (pages.connections.enabled, varsayılan açık; Ses ve parlaklık'tan sonra). Üstte Bluetooth durumu, ortada liste, altta Wi-Fi satırı.
- Liste: "Otomatik · eşleşmiş hepsi", eşleşmiş her bilgisayar (ad + "bağlı"), "Yeni cihaz eşleştir", "Eşleşmeleri sil". Bas → seçim modu, çevir → satır, bas → uygula; basılı tut veya 20 sn → çık. A: Bluetooth aç / kapat (NVS vdbt/off). B: hızlı uygulama.
- Eşleştirme yalnız eşleştirme modunda (90 sn): açılışta NimBLE bonding kapalı, modda açılır. Mod dışında eşleşmeye çalışan bilgisayar düşürülür ve cihazda "Eşleştirme kapalı" yazar. Yeni bilgisayar eşleşince mod kapanır; bir bilgisayar seçiliyse seçim yenisine geçer.
- Bilgisayar seçilince (NVS vdbt/sel, kimlik adresi) diğer bağlantılar düşürülür; diğer eşleşmiş bilgisayarlar bağlanınca şifreleme biter bitmez (kimlik adresi o an belli) düşürülür. Yayın sürer (Windows Web Bluetooth taraması için).
- Bilgisayar adı: masaüstü uygulaması Bluetooth'ta ilk companion mesajında `host` gönderir (Mac: ComputerName, Windows: COMPUTERNAME); yoksa cihaz kendi görevinde bilgisayarın GATT Device Name (0x1800/0x2A00) değerini okur; o da yoksa "Bilgisayar XXXX". NVS vdbt/n<adres>.
- Wi-Fi satırı yalnız yer tutucu ("Kapalı · yakında"): cihaz Wi-Fi kullanmıyor (PSRAM yok, ~50–70 KB RAM gerekir). Wi-Fi gelirse ağ adı ve şifre masaüstü uygulamasından USB ile gönderilecek (kullanıcı tercihi).
- hello: `btOff`.

## 2026-10-07 — Aktif bilgisayar: cihaz en son kullanılan bilgisayarı izler (firmware 1.9.1)
- Kullanıcı isteği: bilgisayarlar arası geçiş için eşleşme kaldırılmasın, hangi bilgisayar kullanılıyorsa cihaz ona gitsin.
- Masaüstü uygulaması her companion mesajında `idle` (Electron powerMonitor.getSystemIdleTime, saniye) gönderir; ilk (ack) mesajda `host` (bilgisayar adı) USB'de de gider.
- Cihaz bilgisayar başına (USB = 0xFFFE, Bluetooth = bağlantı tutamacı) son mesaj ve son kullanıcı girişi zamanını tutar; 6 sn mesaj gelmeyen, USB'si askıda olan ya da Bluetooth'u kopan düşer. En son girişi olan "aktif"tir.
- Aktif bilgisayara giden: HID tuşları ve medya tuşları (Bluetooth'ta yalnız o bağlantıya notify; önceden iki bilgisayar bağlıysa tuşlar ikisine birden gidiyordu), olaylar (launch, media, sys, input, select, status). Ekran verisi (stats, media, media_art, sys, mail) yalnız aktiften alınır; idle bildiren uygulama yoksa eski kural (USB'deki besler).
- Uygulama yoksa: tuşlar USB'ye, USB yoksa en son bağlanan Bluetooth bilgisayarına.
- Aktif değişince cihaz "Aktif: <ad>" gösterir, medya/ses verisini sıfırlayıp yeni bilgisayara status/select/media select gönderir. Bağlantılar başlığında "Aktif: <ad>", listede aktif bilgisayarın yanında "aktif"; ilk satır "Aktif bilgisayar · otomatik".

## 2026-10-08 — Asıl neden: ikinci bilgisayar eşleşince ilki siliniyordu (firmware 1.9.2)
- Windows sürekli "Cihazınızı yeniden bağlamayı deneyin" diyordu. Neden NimBLE'nin bağ deposu: Arduino-ESP32 3.3.12 sdkconfig'i CONFIG_BT_NIMBLE_MAX_CCCDS 8 ve MAX_BONDS 3 veriyor. Eşleşmiş her bilgisayar ~5 bildirim aboneliği (CCCD) saklar: HID rapor 1, rapor 2 (medya), pil, GATT service changed, Volkan Deck TX. İki bilgisayar 10 kayıt ister.
- Depo dolunca NimBLE'nin varsayılan store_status_cb'si (ble_store_util_status_rr) CCCD taşmasında "şimdiki hariç en eski eşi" eşleşmeden çıkarır. Windows eşleşip abone olurken Mac mini'nin bağı siliniyor, Mac yeniden eşleşince Windows'unki gidiyordu; Windows eski anahtarla bağlanamayınca uyarıyı veriyordu.
- Düzeltme: derlemede -DMYNEWT_VAL_BLE_STORE_MAX_CCCDS=32 -DMYNEWT_VAL_BLE_STORE_MAX_BONDS=4 (NimBLE'nin esp_nimble_cfg.h'si bu değerleri #ifndef ile alır; sdkconfig'e dokunmak gerekmez). Derlenmiş ELF'te ble_store_config_cccds 512 bayt (32 × 16), peer_secs 352 bayt (4 × 88). `tools/build_firmware.sh` bayrakları verir; Hid.h bayraksız derlemede #error verir.
- Ek güvenlik: kendi onStoreStatus'umuz CCCD taşmasında başka bilgisayarı silmez, yalnız o kaydı saklamaz (BLE_HS_ESTORE_CAP). Bağ taşması (5. bilgisayar) en eskiyi silmeye devam eder.
- Güncellemeden sonra cihazdaki ve bilgisayarlardaki eski eşleşmeler bir kez temizlenip yeniden eşleştirilmeli (eski sürümde biri zaten silinmiş olabilir).
