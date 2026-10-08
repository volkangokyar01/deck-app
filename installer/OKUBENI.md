# Game Deck masaüstü uygulaması (eski adı Volkan Deck) (Windows + macOS)

Uygulama arka planda çalışır. Cihazda bir tuşa bastığında, istediğin programı bilgisayarda kendisi başlatır.

Önceden cihaz programı klavye gibi açıyordu: Win+R kutusunu açıp yazı yazıyordu. Uygulama açıkken bu olmaz; Win+R, Başlat menüsü ya da Spotlight açılmaz. Böylece oyun sırasında odak bozulmaz.

## Ne yapar
- **Bağlantı:** Kart USB ile bağlıysa kendiliğinden bağlanır, kablo çıkıp takılınca yeniden bağlanır.
- **Program açma:** Uygulamaları doğrudan başlatır:
  - **Windows:** .exe, .lnk ve .url dosyalarını, steam:// ve discord:// gibi adresleri açar. Ada göre aramada Başlat menüsü kaydından bulur; Microsoft Store uygulamaları da buna dahil.
  - **macOS:** .app uygulamalarını, adresleri ve ada göre aramayı (Spotlight dizini üzerinden) açar.
- **Ana sayfa kartları:** CPU, GPU, saat, hava durumu, döviz ve ağ verilerini cihaza kabloyla gönderir. Kartın Wi-Fi'ye bağlanmasına gerek kalmaz. Windows'ta CPU sıcaklığı için Cihaz ayarlarından sensör sürücüsü kurulur; NVIDIA GPU ayarsız çalışır.
- **Ayarlar:** Aynı pencerede bütün ayar ekranı var: uygulama ekleme, Cihaza yaz, Firmware yükle.
- **Arka plan:** Pencereyi kapatınca sistem tepsisinde (Windows) ya da menü çubuğunda (macOS) çalışmaya devam eder. Bilgisayar açılınca kendiliğinden başlar; tepsi menüsünden kapatabilirsin.
- **Uygulama kapalıysa:** Cihaz hiçbir şey yazmaz; ekranında "Game Deck uygulaması açık değil" uyarısı çıkar. İstersen Cihaz ayarlarından eski klavye yöntemini (Win+R / Başlat / Spotlight) açabilirsin.
- **Medya (firmware 1.3.0):** Spotify, Apple Music ve YouTube Music'te çalan şarkıyı cihaza gönderir; cihazdaki oynat/duraklat, ileri ve geri tuşları doğrudan o uygulamaya gider. macOS'te ilk seferde "Game Deck, Spotify'ı (Müzik'i, Chrome'u) denetlemek istiyor" izni sorulur: **İzin Ver** de.
- **Ses ve parlaklık (firmware 1.3.0):** Bilgisayarın sesini ve ekran parlaklığını okuyup cihazdan ayarlatır. Windows'ta harici monitör için monitörün menüsünde DDC/CI açık olmalı.
- **Arka planda aç:** Uygulama başına seçenek. İşaretlersen program odağı almadan açılır (Windows'ta simge durumunda, macOS'te arkada).

## Kurulum (bu klasörle)
Kurulum betiği uygulamanın çalışma motorunu (Electron 44.5.1, ~130–150 MB) GitHub'dan indirir ve uygulamayı kurar.

1. **Firmware:** `StreamDeck-Ayar.local.html` ile ya da uygulama kurulduktan sonra Cihaz ayarları → Firmware yükle. Güncel firmware sayfaya gömülüdür.
2. **Windows:** `Windows-Kur.bat` dosyasına çift tıkla.
   - SmartScreen uyarısı çıkarsa: Ek bilgi → Yine de çalıştır.
   - Uygulama `%LOCALAPPDATA%\Programs\Game Deck` klasörüne kurulur; eski `Volkan Deck` kurulumu ve kısayolları kaldırılır, ayarlar korunur. Başlat menüsüne ve masaüstüne kısayol eklenir.
3. **macOS:** Terminal'i aç ve şunu yaz: `bash ` (sonunda bir boşluk bırak). Sonra `Mac-Kur.command` dosyasını Terminal penceresine sürükle ve Enter'a bas.
   - Uygulama `/Applications/Game Deck.app` olarak kurulur (eski `Volkan Deck.app` kaldırılır, ayarlar korunur), bu Mac için imzalanır ve açılır.
4. **Güncelleme:** Uygulama, tepsi/menü çubuğundaki **Güncellemeleri kontrol et** düğmesiyle kendini günceller. Electron sürümü değiştiğinde betiği yeniden çalıştırmak gerekir; ayarlar silinmez.

## Bir uygulamayı doğrudan açtırmak
- **Windows:** "Bilgisayardan seç…" ile eklediğin .exe, .lnk ve .url dosyalarının yolu kendiliğinden kaydedilir.
- **macOS:** "Bilgisayardan seç…" Uygulamalar klasörünü açar; .app seçersin.
- **Elle ayar:** Bir uygulamayı seçince sağ panelde **"Masaüstü uygulamasıyla doğrudan aç"** kutusu çıkar. Orada Windows yolunu ve macOS uygulamasını ayrı ayrı girebilirsin; **Seç…** ve **Dene** düğmeleri var. Aynı cihazı iki bilgisayarda da kullanabilirsin.
- **Ayarları kaydet:** Değişikliklerden sonra **Cihaza yaz**'a bas. Program yolları cihazda saklanır.

## Bilinen sınırlar
- Doğrudan açma yalnızca **USB kablosu** ile çalışır. Bluetooth'ta cihaz klavye yöntemini kullanmaya devam eder.
- "Görev çubuğu sırası" (Win+1…9) ve "Kısayol tuşu" yöntemleri klavye ile gönderilmeye devam eder. Bunlar zaten Win+R gibi bir pencere açmaz.
- macOS'te CPU/GPU sıcaklığı yalnız Apple Silicon'da okunur; Intel Mac'te kartta yük % görünür.
- Firmware yükleme aracı (esptool) ilk kullanımda internetten indirilir.

## Dosyalar
- `Windows-Kur.bat`, `Mac-Kur.command`: Kurulum betikleri.
- `app/`: Uygulamanın kendisi.
- `StreamDeck-Ayar.local.html`: Tarayıcıda açılan ayar sayfası. Güncel firmware içinde gömülü.
