import os, sys, io, contextlib, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
with contextlib.redirect_stdout(io.StringIO()):
    import deck_cover5 as C
D = C.D
from PIL import Image, ImageDraw
B = np.vstack([D.back_M(), [0, 0, 0, 1]]); Bi = np.linalg.inv(B)
# local (x, m, w) -> (w, m, x) so slicing at z = x gives the (w, m) section
P = np.array([[0, 0, 1, 0], [0, 1, 0, 0], [1, 0, 0, 0], [0, 0, 0, 1]], float)
def sec(m, x): return m.transform((P @ Bi)[:3]).slice(x).to_polygons()
def panel(x, wr, mr, title, S=40):
    W_, H_ = int((wr[1] - wr[0]) * S), int((mr[1] - mr[0]) * S)
    im = Image.new('RGB', (W_, H_ + 24), 'white'); d = ImageDraw.Draw(im)
    tf = lambda w, m: ((w - wr[0]) * S, 24 + (mr[1] - m) * S)
    for polys, col in ((sec(D.body, x), (150, 155, 165)), (sec(C.cover, x), (230, 120, 50))):
        for p in polys: d.polygon([tf(*q) for q in p], fill=col, outline=(40, 40, 40))
    d.text((6, 4), title, fill=(0, 0, 0)); return im
a = panel(23.0, (40, 49), (-6.5, 2), 'x=23 ust kol + kanca (gri: govde duvari, turuncu: kapak) - yukari: disari')
b = panel(22.0, (3, 12), (-6.5, 2), 'x=22 alt dil (duvarin arkasina girer)')
o = Image.new('RGB', (a.width + b.width + 10, max(a.height, b.height)), 'white'); o.paste(a, (0, 0)); o.paste(b, (a.width + 10, 0))
o.save(os.path.join(HERE, 'v5_kapak_kesit.png')); print(o.size)
