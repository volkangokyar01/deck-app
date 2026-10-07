# Volkan Deck – Kasa v6: güçlü ekran tutucu

v4 gövdesinin dışı aynı; ekran tutucu, USB-C girişi, ayak yuvaları ve döndürgeç düğmesi yenilendi. Arka kapak (v5) ve tuş iticileri aynen kullanılır.

## Neden
v4'te kart, ön yüze dik duran 4 ince (1,2 mm) tırnakla tutuluyordu. Gövde yüzü tablada basıldığı için bu tırnaklar katman çizgilerine dik yük alıyor ve kolayca kırılıyordu. Ekranın solundaki tuşlara basmak kartı içeri ittiği için ekran da yerinden çıkıyordu.

## Yeni sistem (vida yok, esneyen parça yok)
- Kartın 4 köşesinin yanında, ön yüzden yükselen kalın **direkler** var. Kartı yanlardan da ortalarlar (her yanda 0,12 mm boşluk).
- Kartın iki ucuna, PCB'nin arkasından **baskı çubuğu** oturur. Çubuklar düz basılır, sağlamdır.
  - **Sol çubuk:** iki köşeye ve B tuşunun tam arkasına bastırır. Ortası USB-C ile pil soketinin üstünden köprü gibi geçer.
  - **Sağ çubuk:** kartın boş olan sağ ucuna boydan boya bastırır.
- Her çubuk ucu, direğe **1,75 mm filamentten kesilmiş bir pimle** kilitlenir (4 pim). Pim deliği, çubuğu karta 0,1 mm bastıracak kadar kaydırılmıştır; bu yüzden boşluk yoktur.
- Tuşa basınca kart çubuğa, çubuk pime, pim de direğe dayanır. Yükü taşıyan hiçbir yerde ince tırnak yoktur.
- Pil fişi için USB kanalının ucunda, tünelin altında bir çentik açıldı (soket kartın ucuna bakıyor).

## USB-C girişi
Eski 14 × 9 mm'lik, üstü üçgen tepeli delik yerine **12,4 × 7,2 mm, köşeleri R1,2 düz bir dikdörtgen** açıldı. Tünel de aynı kesitte ve sokete kadar kapalı, dışarıdan kasanın içi görünmüyor. Fişin plastik başı 12 × 7 mm'ye kadar sığar. Baskıda tünelin tavanı 12,4 mm'lik bir köprüdür; P2S bunu desteksiz basar.

## Döndürgeç düğmesi
Ø30 yerine **Ø24 × 18 mm**. Yüksekliği aynı, mili kesmeye gerek yok. Alt kısımda 60 ince tırtıl, üstte düz bir bant ve aradaki V halkası var. Üst yüz 0,6 mm çanak şeklinde; mildeki D düzlüğü yönünü gösteren bir işaret çizgisi var. İç ölçüler v4 ile aynı: somun boşluğu Ø13,6, burç boşluğu Ø7,6, D delik. İçerideki geçişler 45° olduğu için düğme dik, desteksiz basılır.

## Ayaklar
Tabandaki 4 yuva **Ø15 mm yapışkanlı yuvarlak kaydırmaz pedlere** göre: Ø15,6 mm, 1 mm derin, kenardan en az 1 mm içeride (x ±37, y 15 / 72,6). Ped 1 mm'den kalınsa yuvadan taşar ve kasayı masadan kaldırır.

## Parçalar (destek yok)
| Dosya | Adet | Baskı yönü |
|---|---|---|
| v6_govde.stl | 1 | Ön yüzü tablada (v4 ile aynı) |
| v6_baski_cubugu_sol.stl | 1 | Dosyadaki gibi, bacaklar yukarı |
| v6_baski_cubugu_sag.stl | 1 | Dosyadaki gibi |
| v6_dugme.stl | 1 | Dik, alt yüzü tablada (destek yok) |
| v6_pim (3MF'te 6 adet, 2 yedek) **veya** 1,75 mm filament | 4 × 11 mm | Pim: yatık, dosyadaki gibi. Filament: makasla düz kes |

`VolkanDeck_kasa_v6.3mf`: gövde, iki çubuk, düğme ve 6 pim P2S tablasında.
Önerilen ayar: PLA, 0,2 mm katman, **4 duvar** (direkler dolu çıksın), %20 dolgu.

## Montaj
1. Tuş iticilerini ekranın solundaki iki deliğe içeriden takın (v4 ile aynı).
2. Kartı, kablolar bağlıyken, arka açıklıktan ekran yüzüne bastırın. USB-C ucu sol kanala girer, kart dört direğin arasına oturur.
3. Sol çubuğu bacakları karta bakacak şekilde sol uca, sağ çubuğu sağ uca yerleştirin. Uçları direklerin yarıklarına girer.
4. Çubuğu başparmakla karta bastırırken pimi kartın **ortası tarafından** (direğin karta bakan değil, kartın ortasına bakan yüzündeki delikten) sokun ve dibe kadar itin. Pim dışa doğru gider, kör delikte durur.
   - **Basılı pim:** başının 3 mm'lik uzun kenarı ekran yüzüne dik (kasanın içine doğru) dursun; baş direğe dayanınca pim yerindedir.
   - **Filament pim:** 11 mm kesin, ~1,5 mm dışarıda kalır.
5. Pil, arka kapak ve düğme v4'teki gibi takılır.

**Pim sıkı girmiyorsa:** Pimin ucunu biraz eğik kesin ya da çakmakla ısıtılmış bir iğneyle deliği bir kez açın.
**Sökmek için:** Pimi başından (ya da dışarıda kalan ucundan) pense ile çekin.

## Kaynak
`deck_case6.py` (geometri, v4'ü içe aktarır) ve `export6.py` (STL, 3MF ve görseller). Kartın ölçüleri ve bileşen yükseklikleri LilyGO'nun resmî T-Display-S3 3D modelinden alındı. Çubukların kartın arkasındaki hiçbir bileşene değmediği bu modelle kontrol edildi.
