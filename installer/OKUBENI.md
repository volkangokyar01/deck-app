# Volkan Deck masaüstü uygulaması (Windows + macOS)

Uygulama arka planda çalışır. Cihazda bir tuşa bastığında, istediğin programı bilgisayarda kendisi başlatır.

Önceden cihaz programı klavye gibi açıyordu: Win+R kutusunu açıp yazı yazıyordu. Uygulama açıkken bu olmaz; Win+R, Başlat menüsü ya da Spotlight açılmaz. Böylece oyun sırasında odak bozulmaz.

## Ne yapar
- **Bağlantı:** Kart USB ile bağlıysa kendiliğinden bağlanır, kablo çıkıp takılınca yeniden bağlanır.
- **Program açma:** Uygulamaları doğrudan başlatır:
  - **Windows:** .exe, .lnk ve .url dosyalarını, steam:// ve discord:// gibi adresleri açar. Ada göre aramada Başlat menüsü kaydından bulur; Microsoft Store uygulamaları da buna dahil.
  - **macOS:** .app uygulamalarını, adresleri ve ada göre aramayı (Spotlight dizini üzerinden) açar.
- **Sıcaklıklar (yalnızca Windows):** LibreHardwareMonitor bu bilgisayarda çalışıyorsa sıcaklıkları cihaza kabloyla gönderir. Kartın Wi-Fi'ye bağlanmasına gerek kalmaz.
- **Ayarlar:** Aynı pencerede bütün ayar ekranı var: uygulama ekleme, Cihaza yaz, Firmware yükle.
- **Arka plan:** Pencereyi kapatınca sistem tepsisinde (Windows) ya da menü çubuğunda (macOS) çalışmaya devam eder. Bilgisayar açılınca kendiliğinden başlar; tepsi menüsünden kapatabilirsin.
- **Uygulama kapalıysa:** Cihaz hiçbir şey yazmaz; ekranında "Volkan Deck uygulaması açık değil" uyarısı çıkar. İstersen Cihaz ayarlarından eski klavye yöntemini (Win+R / Başlat / Spotlight) açabilirsin.
- **Arka planda aç:** Uygulama başına seçenek. İşaretlersen program odağı almadan açılır (Windows'ta simge durumunda, macOS'te arkada).

## Kurulum (bu klasörle)
Kurulum betiği uygulamanın çalışma motorunu (Electron 44.5.1, ~130–150 MB) GitHub'dan indirir ve uygulamayı kurar.

1. **Önce firmware v1.2.0:** `StreamDeck-Ayar.local.html` ile ya da uygulama kurulduktan sonra Cihaz ayarları → Firmware yükle. Doğrudan açma bu sürümle çalışır.
2. **Windows:** `Windows-Kur.bat` dosyasına çift tıkla.
   - SmartScreen uyarısı çıkarsa: Ek bilgi → Yine de çalıştır.
   - Uygulama `%LOCALAPPDATA%\Programs\Volkan Deck` klasörüne kurulur. Başlat menüsüne ve masaüstüne kısayol eklenir.
3. **macOS:** Terminal'i aç ve şunu yaz: `bash ` (sonunda bir boşluk bırak). Sonra `Mac-Kur.command` dosyasını Terminal penceresine sürükle ve Enter'a bas.
   - Uygulama `/Applications/Volkan Deck.app` olarak kurulur, bu Mac için imzalanır ve açılır.
4. **Aynı betikle güncelleme:** Betiği yeniden çalıştırmak uygulamayı günceller. Ayarlar silinmez.

## Bir uygulamayı doğrudan açtırmak
- **Windows:** "Bilgisayardan seç…" ile eklediğin .exe, .lnk ve .url dosyalarının yolu kendiliğinden kaydedilir.
- **macOS:** "Bilgisayardan seç…" Uygulamalar klasörünü açar; .app seçersin.
- **Elle ayar:** Bir uygulamayı seçince sağ panelde **"Masaüstü uygulamasıyla doğrudan aç"** kutusu çıkar. Orada Windows yolunu ve macOS uygulamasını ayrı ayrı girebilirsin; **Seç…** ve **Dene** düğmeleri var. Aynı cihazı iki bilgisayarda da kullanabilirsin.
- **Ayarları kaydet:** Değişikliklerden sonra **Cihaza yaz**'a bas. Program yolları cihazda saklanır.

## Bilinen sınırlar
- Doğrudan açma yalnızca **USB kablosu** ile çalışır. Bluetooth'ta cihaz klavye yöntemini kullanmaya devam eder.
- "Görev çubuğu sırası" (Win+1…9) ve "Kısayol tuşu" yöntemleri klavye ile gönderilmeye devam eder. Bunlar zaten Win+R gibi bir pencere açmaz.
- macOS'te sıcaklık bilgisi gönderilmez. Apple Silicon sıcaklıklarını okumak yönetici izni ister.
- Firmware yükleme aracı (esptool) ilk kullanımda internetten indirilir.

## Dosyalar
- `Windows-Kur.bat`, `Mac-Kur.command`: Kurulum betikleri.
- `app/`: Uygulamanın kendisi.
- `StreamDeck-Ayar.local.html`: Tarayıcıda açılan ayar sayfası. Firmware v1.2.0 içinde gömülü.
- `fw/`: Firmware v1.2.0 dosyaları ve kaynak kodu.
- `companion-src.tgz`: Uygulamanın kaynak kodu.
