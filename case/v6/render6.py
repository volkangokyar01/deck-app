import os, sys, io, contextlib, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, '..', 'v4'))
with contextlib.redirect_stdout(io.StringIO()):
    import deck_case6 as C
D = C.D
from zrender import draw
from PIL import Image, ImageDraw
def tris(m):
    mm = m.to_mesh(); v = np.array(mm.vert_properties)[:, :3]; t = np.array(mm.tri_verts); return v[t]
body = tris(C.body)
pads = tris(D.Manifold.batch_boolean([D.Manifold.cylinder(3.0, 10.0, circular_segments=64).translate((fx, fy, -3.0)) for fx, fy in C.FEET], D.OpType.Add)) if hasattr(D, 'Manifold') else None
size = 700
views = [('sol yan: USB-C', ('cam', -90, 0.01)), ('USB-C yakin, kart takili (deligin icinden bakis)', ('cam', -90, 0.01)), ('alt: 20 mm pedler', ('cam', 0, -90 + 1e-3)), ('alt, sag-on', ('cam', -30, -35))]
S = Image.new('RGB', (2 * size, 2 * size + 30), (255, 255, 255)); d = ImageDraw.Draw(S); d.text((10, 8), 'Volkan Deck kasa v6 - USB-C ve ayaklar (koyu: 20 mm pedler)', fill=(0, 0, 0))
for i, (nm, v) in enumerate(views):
    parts = [(body, (52, 56, 64))]
    if i >= 2: parts.append((pads, (20, 20, 22)))
    if i == 1:   # close-up: only the left end region
        crop = D.box(-60, 60, 35, 72, 20, 62)
        parts = [(tris(C.body ^ crop), (52, 56, 64)), (D.board_world, (40, 90, 170))]
    S.paste(draw(parts, v, size, nm), ((i % 2) * size, 30 + (i // 2) * size))
S.save(os.path.join(HERE, 'v6_usb_ayak.png')); print('ok')
