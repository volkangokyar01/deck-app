# Güncelleme standardı

Bu dosya, `main`'e gönderilen her değişikliğin nasıl hazırlanacağını tanımlar. İnsan da asistan da aynı adımları izler. Genel kurallar `AGENTS.md`'de.

## 1. Değişikliğin türünü belirle

| Tür | Değişen yerler | Kullanıcıya güncelleme düşer mi? |
|---|---|---|
| **uygulama** | `app/` (ör. `main.js`, `stats.js`, `media.js`, `companion.js`) | Evet |
| **ayar sayfası** | `web/body.html`, `web/head.css.html`, `web/fonts/`, `web/vendor/` → `build.py` ile `app/index.html` | Evet |
| **firmware** | `firmware/VolkanDeck/`, `firmware/bin/` → `embed_firmware.py` + `build.py` ile `app/index.html` | Evet (gömüldüğü için) |
| **kurulum** | `installer/` | Electron sürümü (`V=`) değiştiyse "kurulum betiğini yeniden çalıştır" uyarısı; değişmediyse hayır |
| **belge** | `*.md`, `docs/` | Hayır |
| **kasa** | `case/` | Hayır |
| **araç** | `tools/`, testler | Hayır |

Kural basit: **`app/` altında bir dosyanın içeriği değiştiyse güncellemedir, değişmediyse değildir.** Uygulama commit'leri değil dosya özetlerini (git blob SHA) karşılaştırır; `app/build-info.json` hariç tutulur. Belge commit'i gönderdiğinde uygulama "Güncel" demeye devam eder.

Bir commit'e hem güncelleme hem belge girebilir; o zaman tür **uygulama/ayar sayfası/firmware** sayılır.

## 2. Kontrol listesi

### Her değişiklikte
- [ ] `git pull --ff-only origin main` ile başladım.
- [ ] `app/` içine belge, not veya deneme dosyası koymadım.
- [ ] Testler geçti: `node --test tools/tests/*.test.js` ve `python3 -m unittest discover -s tools/tests`.
- [ ] `GUNLUK.md`'ye satır ekledim.

### Güncelleme ise (uygulama / ayar sayfası / firmware)
- [ ] İş bitti; yarım özellik yok. `main`'e giden her `app/` değişikliği iki bilgisayara da güncelleme olarak düşer.
- [ ] `python3 tools/build.py` çalıştı; `app/index.html`, `web/StreamDeck-Ayar.html`, `app/build-info.json` commit'te.
- [ ] Platforma özgü değişiklikse diğer platformda görünmediğini kontrol ettim.
- [ ] Uygulamayı geliştirme modunda denedim: `npx electron@44.5.1 app` (kurulu uygulamaya dokunmadan).

### Firmware ise ayrıca
- [ ] `firmware/VolkanDeck/Board.h` içindeki `FW_VERSION` artırıldı (yama `x.y.Z`, özellik `x.Y.0`).
- [ ] README'deki `arduino-cli compile` + `cp` adımları çalıştı; `firmware/bin/` güncel.
- [ ] `python3 tools/embed_firmware.py`, ardından `python3 tools/build.py` çalıştı.
- [ ] README'deki firmware sürümü güncellendi.
- [ ] Yeni karar/protokol varsa `docs/kararlar-ve-pinler.md`'ye tarihle yazıldı.
- [ ] Kart üzerinde denendiyse günlükte belirtildi; denenmediyse "donanımda denenmedi" yazıldı.

### Electron sürümü değiştiyse
- [ ] `installer/Mac-Kur.command` (`V=`) ve `installer/Windows-Kur.bat` (`set "V=`) aynı sürüm.
- [ ] README ve `installer/OKUBENI.md`'deki sürüm numaraları güncellendi.

## 3. Commit

- Başlık: `Alan: ne değişti`, Türkçe, kullanıcıya anlamlı. Uygulama bu başlığı güncelleme kutusunda gösterir.
  - Firmware: `Firmware 1.5.3: …`
  - Platforma özgü: `macOS: …` / `Windows: …`
  - Ayar sayfası: `Ayarlar: …`
  - Belge: `Belgeler: …`, kasa: `Kasa: …`, araç: `Araçlar: …`
- Yazar: kişinin GitHub hesabı (`AGENTS.md` → Commit kuralları).
- Belge commit'leri güncellemeyle karışmasın diye ayrı commit olarak atılabilir; zorunlu değil.

## 4. Release (isteğe bağlı)

Ayarlarda **Sadece yayınlanan sürümler (Releases)** seçen kullanıcı yalnız Release'leri alır.

- Release yalnız iki bilgisayarda da denenmiş bir commit'ten açılır.
- Etiket firmware sürümünü izler: `v1.5.2`. Aynı firmware ile yalnız uygulama değiştiyse `v1.5.2-1`, `v1.5.2-2`.
- Release notu `GUNLUK.md`'deki ilgili satırlardan derlenir.

```sh
gh release create v1.5.2 --target main --title "Volkan Deck 1.5.2" --notes "…"
```

## 5. Günlük (imza defteri)

Her push'tan önce `GUNLUK.md` tablosunun **en üstüne** bir satır eklenir. Aynı push'taki birden çok commit tek satırda toplanabilir.

```
| 2026-10-06 09:15 | alisencerefeturk | belge | Hayır | AGENTS.md, CLAUDE.md, güncelleme standardı |
```

- **Tarih / saat:** Türkiye saati (UTC+3), `YYYY-AA-GG SS:DD`. `date '+%Y-%m-%d %H:%M'` ile al.
- **İmza:** GitHub hesap adı: `alisencerefeturk` veya `volkangokyar01`.
- **Tür:** 1. bölümdeki türlerden biri.
- **Güncelleme:** `Evet` / `Hayır` (`app/` değişti mi).
- **Özet:** Ne değişti, denendi mi. Commit kısa SHA'sı bilinmiyorsa yazılmaz; `git log` zaten tutar.
