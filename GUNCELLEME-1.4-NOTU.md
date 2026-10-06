# Volkan Deck 1.4 — bir kerelik geçiş notu

Bu not, depoyu çeken kişi ve onun yapay zekâ asistanı (Claude Code vb.) için yazıldı. 1.4'ten önceki bir sürüm kuruluysa aşağıdaki adımları **bir kez** uygula. Sonraki sürümler uygulamanın içindeki **Güncellemeleri kontrol et** düğmesiyle gelir.

## Neden yeniden kurulum gerekiyor
Eski uygulamada güncelleme düğmesi yok. Yeni sürümü almak için kurulum betiğini bir kez daha çalıştırmak gerekiyor. Ayarlar silinmez.

## Adımlar

### 1. Depoyu güncelle
```sh
git pull origin main
```
`app/index.html`, `web/StreamDeck-Ayar.html` ve `firmware/bin/` dosyaları depoda hazır gelir. Derleme ya da Arduino kurulumu gerekmez.

### 2. Uygulamayı yeniden kur
- **Windows:** `installer\Windows-Kur.bat` dosyasına çift tıkla. Depodaki `installer` klasöründen çalıştırılabilir. Betik `app` klasörünü bulamazsa hiçbir şeyi silmeden durur.
- **macOS:** Terminal'de şunu çalıştır:
  ```sh
  bash installer/Mac-Kur.command
  ```

Kurulum bitince uygulama açılır.

**Kontrol et:** **Cihaz ayarları** sekmesinde **Uygulama güncellemesi** bölümü görünmeli ve **Güncel** yazmalı.

### 3. Cihaz yazılımını 1.4.1'e güncelle
1. Kartı USB ile bağla.
2. Uygulamada **Cihaz ayarları → Firmware yükle** yolunu izle. Bitince kart kendiliğinden yeniden başlar.

Yeni widget'lar, kompakt ekran ve albüm kapağı 1.4 ister.

### 4. Ana sayfa kartlarını seç
1. Ana sayfa ayarlarında **Kart 1** ve **Kart 2** için şunlardan birini seç: CPU, GPU, Saat, Hava durumu, Döviz, Ağ.
2. Hava durumunu seçtiysen şehri ara ve listeden seç.
3. **Cihaza yaz**'a bas.

Veriler bilgisayardaki uygulamadan USB ile gelir. Cihazda Wi-Fi ayarı gerekmez. Eski LibreHardwareMonitor / IP ayarları kaldırıldı; LibreHardwareMonitor'ü artık çalıştırmana gerek yok.

### 5. (İsteğe bağlı, Windows) CPU sıcaklığı
CPU yükü ayarsız çalışır. GPU (NVIDIA) sıcaklığı, yükü, gücü ve fanı da ayarsız çalışır. **CPU sıcaklığı** ise Windows'ta bir sürücü ister.

**Kurulum:** **Cihaz ayarları** sekmesindeki **CPU sıcaklığı** bölümünde **CPU sıcaklığı için sürücüyü kur** düğmesine bas. Bir kez yönetici izni (UAC) ister ve şunları kurar:
- **PawnIO** çekirdek sürücüsü (imzalı, açık kaynak).
- Her oturum açılışında sensörü yönetici yetkisiyle okuyan bir zamanlanmış görev: `VolkanDeckSensors-<kullanıcı SID>`.

Ağa hiçbir şey açılmaz.

**Kaldırma:**
- Aynı yerdeki **Sensör sürücüsünü kaldır** düğmesiyle kaldırılır. PawnIO'yu yalnızca bu uygulama kurduysa kaldırır.
- Elle kaldırma:
  1. Görev Zamanlayıcı'dan `VolkanDeckSensors-*` görevini sil.
  2. `C:\Program Files\VolkanDeckSensors` ve `C:\ProgramData\VolkanDeckSensors` klasörlerini sil.
  3. Gerekirse "Uygulamalar ve özellikler"den PawnIO'yu kaldır.

**Bu kısım henüz gerçek bir Windows bilgisayarda denenmedi.** Önce aşağıdaki listeyi dene.

## Windows'ta denenecekler (sonucu geri bildir)
- [ ] Uygulama açılıyor; ayarlarda **Güncel** yazıyor.
- [ ] NVIDIA GPU kartı ad, sıcaklık, yük, güç ve fan gösteriyor.
- [ ] Ağ kartında indirme/yükleme hızı ve ping geliyor.
- [ ] Hava durumu, döviz ve saat geliyor.
- [ ] Medya sayfası Spotify'da şarkı adını ve kapağı gösteriyor.
- [ ] CPU sürücüsü:
  - [ ] Onay penceresi çıkıyor.
  - [ ] UAC'ı iptal edince düzgün bir hata veriyor.
  - [ ] Kabul edince CPU sıcaklığı geliyor.
  - [ ] Bilgisayar yeniden başlayınca tekrar UAC sormadan sıcaklık geliyor.
  - [ ] **Kaldır** düğmesi görevi ve klasörleri siliyor; kart "-" gösteriyor.

Bir şey çalışmazsa şunları not al ve depoya issue aç ya da haber ver:
- Uygulamadaki hata mesajı
- Windows sürümü
- Ekran kartı

## Bundan sonra: güncelleme yayınlamak (iki geliştirici için)
- Uygulama, GitHub'daki `main` dalında bulunan `app/` klasörünü indirir. `app/` altında değişen her şey diğer kişiye güncelleme olarak gider; yalnız belge değişikliği gitmez. Ayrıntılar `GUNCELLEME.md`'de.
- Ayarlardan **Sadece yayınlanan sürümler (Releases)** seçilirse, yalnızca GitHub'da Release olarak yayınlanan sürümler kurulur.
- Göndermeden önce `python3 tools/build.py` çalıştır ve üretilen dosyaları commit'le. Firmware değiştiyse README'deki derleme adımlarını ve `python3 tools/embed_firmware.py` adımını da uygula.
- Uygulama, kendisinden daha eski bir sürümü güncelleme olarak önermez. Yerel sürümde GitHub'da olmayan değişiklikler varsa "Bu bilgisayardaki sürüm GitHub'dakinden yeni" yazar.
