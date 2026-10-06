# AGENTS.md — yapay zekâ asistanları için çalışma yönergesi

Bu depoda iki geliştirici çalışır. İkisi de değişiklikleri bir yapay zekâ asistanıyla (Claude Code, Codex vb.) yapar. Bu dosya bütün asistanlar için geçerlidir; `CLAUDE.md` buraya yönlendirir. Proje tanıtımı ve derleme komutları `README.md`'de, güncelleme yayınlama standardı `GUNCELLEME.md`'de.

## Kim kimdir
| Kişi | GitHub hesabı | İmza |
|---|---|---|
| Sencer | `alisencerefeturk` | `alisencerefeturk` |
| Volkan | `volkangokyar01` (depo sahibi) | `volkangokyar01` |

Asistan, kimin bilgisayarında çalışıyorsa o kişinin GitHub hesap adıyla imza atar. Emin değilsen `gh api user --jq .login` ile bak ya da kullanıcıya sor; tahmin etme.

## Altın kural: `app/` klasörü = kullanıcıya giden güncelleme
Kurulu uygulama, GitHub'daki hedef commit'in **yalnız `app/` klasörünü** dosya dosya karşılaştırır (`app/updater.js`, `differences`). `app/build-info.json` karşılaştırmaya girmez.

- `app/` altında en az bir dosya değiştiyse → iki bilgisayarda da **"Güncelleme var"** çıkar.
- Yalnız kök belgeler (`*.md`), `docs/`, `case/`, `tools/`, `dist/` veya `firmware/VolkanDeck/` kaynağı değiştiyse → uygulama **"Güncel"** der, güncelleme düşmez.
- İstisna: `installer/` içindeki Electron sürümü (`V=`) değişirse uygulama "kurulum betiğini yeniden çalıştır" uyarısı verir.
- Firmware ikilisi (`firmware/bin/`) tek başına güncelleme sayılmaz; kullanıcıya ancak `embed_firmware.py` + `build.py` ile `app/index.html`'e gömülünce ulaşır.

Bu yüzden:
- `app/` içine **asla** belge, not, deneme dosyası koyma.
- Yarım iş `app/`'a girip `main`'e gönderilmez. Belge/düzen işi rahatça gönderilebilir.
- `web/body.html` veya `app/companion.js` değiştiyse `python3 tools/build.py` çalıştırılmadan commit atılmaz; üretilen `app/index.html` ve `web/StreamDeck-Ayar.html` de commit'e girer.

## Yasaklar
- **Kurulu uygulamaya dokunma.** `/Applications/Volkan Deck.app` (macOS) ve `%LOCALAPPDATA%\Programs\Volkan Deck` (Windows) elle değiştirilmez, kopyalanmaz, silinmez. Kurulu uygulama yalnız kendi güncelleme düğmesiyle ya da kurulum betiğiyle güncellenir.
- `app/index.html`, `web/StreamDeck-Ayar.html` ve `app/build-info.json` elle düzenlenmez; `tools/build.py` üretir.
- Başkasının commit'ini `git push --force` ile ezme, `main`'in geçmişini yeniden yazma.
- Kullanıcı istemeden commit atma, push yapma, Release yayınlama.

## Ürün kuralları
- Arayüz platforma göre ayrılır: macOS'te yalnız macOS'e, Windows'ta yalnız Windows'a özgü seçenekler görünür.
- Uygulamalar yalnız masaüstü uygulamasının sistem çağrısıyla açılır. Klavye yöntemleri (Win+R, Başlat, Spotlight) yeni özelliklerde kullanılmaz.
- Cihaz Wi-Fi kullanmaz; ana sayfa verileri masaüstü uygulamasından USB `stats` ile gelir.
- Kullanıcıya görünen metinler Türkçe ve kısa. Ekran fontlarında yalnız ASCII + Türkçe harf var.
- Yeni donanım/protokol kararları `docs/kararlar-ve-pinler.md`'ye tarihle yazılır.

## Çalışma sırası
1. Başlamadan `git pull --ff-only origin main`.
2. Değişikliği yap. Firmware değiştiyse `Board.h` içindeki `FW_VERSION`'ı artır ve README'deki derleme adımlarını izle.
3. Testler:
   ```sh
   node --test tools/tests/*.test.js
   python3 -m unittest discover -s tools/tests
   ```
4. `GUNCELLEME.md`'deki kontrol listesini uygula ve `GUNLUK.md`'ye satır ekle.
5. Commit ve push (kullanıcı istediyse).

## Commit kuralları
- Mesaj Türkçe, tek satır başlık, `Alan: ne değişti` biçiminde. Örnekler:
  - `Firmware 1.5.2: ses sayfasında mikrofon sessize alma`
  - `Windows: Apple Music'te albüm kapağı`
  - `Ayarlar: ekran karartma kapatılabilir`
  - `Belgeler: AGENTS.md ve güncelleme standardı`
- Başlıktaki ilk kelime güncellemenin uygulamada nasıl görüneceğini belirler: uygulama, güncelleme kutusunda son commit'in başlığını gösterir. Kullanıcıya anlamlı yaz.
- Commit yazarı kişinin GitHub hesabıdır, asistan ortak yazar satırıyla eklenir:
  ```sh
  git -c user.name=alisencerefeturk \
      -c user.email=161599497+alisencerefeturk@users.noreply.github.com \
      commit -m "..."
  ```
  Volkan için `volkangokyar01` ve kendi `@users.noreply.github.com` adresi kullanılır (GitHub → Settings → Emails'de görünür).
