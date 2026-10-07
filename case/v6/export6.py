import os, sys, io, contextlib, zipfile, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, '..', 'v4'))
with contextlib.redirect_stdout(io.StringIO()):
    import deck_case6 as C
D = C.D
from manifold3d import Manifold, OpType
from stlio import save_stl
from zrender import draw
from PIL import Image, ImageDraw
def tris(m):
    mm = m.to_mesh(); v = np.array(mm.vert_properties)[:, :3]; t = np.array(mm.tri_verts); return v, t
def on_bed(m): b = m.bounding_box(); return m.translate((-b[0], -b[1], -b[2]))
M4 = np.vstack([D.board_M(), [0, 0, 0, 1]]); Bi = np.linalg.inv(M4)[:3]          # world -> board frame
to_b = lambda m: m.transform(Bi)
parts = {
    'v6_govde': on_bed(C.body.transform(np.array([[-1, 0, 0, 0], [0, D.u[0], D.u[1], 0], [0, -D.n[0], -D.n[1], 0]], float))),  # face on the bed
    'v6_baski_cubugu_sol': on_bed(C.lbar if False else to_b(C.lbar)),   # board frame: back face is the lowest -> on the bed
    'v6_baski_cubugu_sag': on_bed(to_b(C.rbar)),
}
for k, m in parts.items():
    v, t = tris(m); save_stl(os.path.join(HERE, k + '.stl'), v[t]); b = m.bounding_box()
    print(f"{k:22s} bodies={len(m.decompose())} ext=({b[3]-b[0]:.1f},{b[4]-b[1]:.1f},{b[5]-b[2]:.1f}) vol={m.volume()/1000:.2f}cm3 zmin={b[2]:.2f}")
# plate (P2S 256 x 256)
place = {'v6_govde': (8, 8), 'v6_baski_cubugu_sol': (130, 10), 'v6_baski_cubugu_sag': (145, 10)}
def P(nm): return parts[nm].translate((place[nm][0], place[nm][1], 0))
for nm in place:
    b = P(nm).bounding_box(); assert b[3] <= 250 and b[4] <= 250, (nm, b)
names = list(place)
for i in range(len(names)):
    for j in range(i + 1, len(names)):
        assert (P(names[i]) ^ P(names[j])).volume() == 0
xml = ''; items = []
for oid, name in enumerate(place, 1):
    v, t = tris(P(name))
    vs = ''.join(f'<vertex x="{a:.4f}" y="{b:.4f}" z="{c:.4f}"/>' for a, b, c in v)
    ts = ''.join(f'<triangle v1="{i}" v2="{j}" v3="{k}"/>' for i, j, k in t)
    xml += f'<object id="{oid}" name="{name}" type="model"><mesh><vertices>{vs}</vertices><triangles>{ts}</triangles></mesh></object>'
    items.append(f'<item objectid="{oid}"/>')
model = f'<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">Volkan Deck kasa v6</metadata><resources>{xml}</resources><build>{"".join(items)}</build></model>'
with zipfile.ZipFile(os.path.join(HERE, 'VolkanDeck_kasa_v6.3mf'), 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')
    z.writestr('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')
    z.writestr('3D/3dmodel.model', model)
mode = sys.argv[1] if len(sys.argv) > 1 else 'all'
if mode in ('all', 'views'):
    # inside view around the screen, in the board frame (z toward the face)
    crop = D.box(-14, 76, -24, 24, -18, 3.0)
    body_b = to_b(C.body) ^ crop
    bt = D.bt; R = np.array([[0, 1, 0], [1, 0, 0], [0, 0, -1]], float); brd = bt @ R.T; brd[..., 2] -= 6.38
    pins_b = to_b(C.pins)
    v1, t1 = tris(body_b); v2, t2 = tris(to_b(C.lbar + C.rbar)); v3, t3 = tris(pins_b)
    pp = [(v1[t1], (150, 154, 162)), (brd, (40, 90, 170)), (v2[t2], (230, 120, 40)), (v3[t3], (240, 220, 60))]
    views = [('kasanin icinden (arka kapak yonu)', ('cam', 180, -90 + 1e-3)), ('ic, sol-ust', ('cam', 150, -50)), ('ic, sag-ust', ('cam', -150, -50)), ('yan (x yonunden)', ('cam', 90, 0.01))]
    size = 700
    S = Image.new('RGB', (2 * size, 2 * size + 30), (255, 255, 255)); d = ImageDraw.Draw(S)
    d.text((10, 8), 'Volkan Deck kasa v6 - ekran tutucu (gri govde, mavi kart, turuncu baski cubuklari, sari filament pimler)', fill=(0, 0, 0))
    for i, (nm, vw) in enumerate(views): S.paste(draw(pp, vw, size, nm), ((i % 2) * size, 30 + (i // 2) * size))
    S.save(os.path.join(HERE, 'v6_ekran_tutucu.png'))
if mode in ('all', 'section'):
    # sections across the pins (y-z plane) at the middle of each bar
    Pm = np.array([[0, 1, 0, 0], [0, 0, 1, 0], [1, 0, 0, 0]], float)     # (x,y,z) -> (y,z,x): slice at x
    def sec(m, x): return m.transform(Pm).slice(x).to_polygons()
    brd_m = D.board_proxy()
    def panel(x, title, S=22, yr=(-20, 20), zr=(-16, 2)):
        W_, H_ = int((yr[1] - yr[0]) * S), int((zr[1] - zr[0]) * S)
        im = Image.new('RGB', (W_, H_ + 24), 'white'); dd = ImageDraw.Draw(im)
        tf = lambda y, z: ((y - yr[0]) * S, 24 + (zr[1] - z) * S)
        real = D.box(-1.2, 60.78, -12.98, 12.98, -6.38, -5.18) + D.box(6.66, 56.53, -12.98, 12.98, -5.18, -0.02)   # PCB + display
        for m, col in ((to_b(C.body), (150, 155, 165)), (real, (40, 90, 170)), (to_b(C.lbar + C.rbar), (230, 120, 40)), (to_b(C.pins), (240, 210, 40))):
            for p in sec(m, x): dd.polygon([tf(*q) for q in p], fill=col, outline=(40, 40, 40))
        dd.text((6, 4), title, fill=(0, 0, 0)); return im
    a = panel(2.5, 'sol cubuk kesiti (x=2.5): ust = yuz (tablada), asagi = kasanin ici')
    b = panel(58.0, 'sag cubuk kesiti (x=58)')
    o = Image.new('RGB', (a.width, a.height + b.height + 10), 'white'); o.paste(a, (0, 0)); o.paste(b, (0, a.height + 10))
    o.save(os.path.join(HERE, 'v6_kesit.png'))
if mode in ('all', 'plate'):
    pp = [(lambda v, t: v[t])(*tris(P(nm))) for nm in place]
    v, t = tris(D.box(0, 256, 0, 256, -1.0, 0))
    draw([(v[t], (215, 218, 222))] + [(x, (90, 94, 102)) for x in pp], ('cam', -25, 45), 900, 'v6 baski tablasi (P2S) - destek yok').save(os.path.join(HERE, 'v6_plate.png'))
print('ok')
