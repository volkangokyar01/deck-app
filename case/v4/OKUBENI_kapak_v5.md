# Volkan Deck – Arka kapak v5 (v4 gövdeye takılır)

Gövde değişmedi. Sadece `v5_arka_kapak.stl` dosyasını bas.

## Neden yeni kapak
v4 kapağının 4 tırnağında kanca, kökün hemen dibindeydi. Kapak takılırken tırnağın ~%4 esnemesi gerekiyordu; PLA %2 civarında kırılır. Tırnaklar katman yönüne dik de esniyordu, bu yüzden kırıldılar. Boşluk da yalnızca 0,2 mm'ydi.

## v5'te ne değişti
- **Alt kenar:** 2 sabit dil. Esnemezler. Duvarın arkasına 2,2 mm girerler.
- **Üst kenar:** Kapağın içine açılmış 2 yaylı kol (19 mm). Kapak düzleminde, yani katmanlar boyunca esnerler. Gereken esneme ~%0,7. Kanca 0,7 mm takılır; giriş rampası 30°, tutma yüzü 60°.
- **Dış çerçeve:** Üst ve yan kenarlarda 0,8 mm. Kapağın içeri kaçmasını önler, aralıkları örter. Kapak yüzeyden 0,8 mm çıkıntılı durur.
- **Boşluk:** Kapak ile delik arası her kenarda 0,35 mm.
- **Görünüş:** Dış yüzde üst kenara paralel iki ince yarık var; bunlar yayların boşluğu.

## Baskı (PLA)
- **Yön:** Dış yüz tablada (STL bu yönde). Destek yok.
- **Ayar:** 0,2 mm katman, **4 duvar**. 1,6 mm'lik kol tamamen duvar çizgisinden oluşsun, dolgu olmasın. %20 dolgu yeterli.
- **Tabla:** Dokulu PEI ile dış yüz gövdeyle aynı dokuda çıkar.

## Takma
1. Kapağı üst kenarı dışarı doğru eğik tut, alttaki iki dili gövde açıklığının alt kenarının arkasına sok.
2. Kapağı alt kenar üzerinde döndürerek kapat.
3. Üst kenara bastır; iki kol "tık" diye yerine oturur.

## Sökme
Tırnağını üst kenardaki çerçevenin altına sok ve üst kenarı dışarı çek. Kancalar 60° yüzle tutar, kırılmadan bırakır. Sonra kapağı yukarı kaldırıp alttaki dilleri çıkar.

## Kaynak
`deck_cover5.py`: model ve kontroller (gövde/kart/pil/döndürgeçle çakışma, takarken eğme hareketi).
`export_cover5.py`: STL ve görseller. `section_cover5.py`: kesit görüntüsü.
