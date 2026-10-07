import os, sys, io, contextlib, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, '..', 'v4'))
with contextlib.redirect_stdout(io.StringIO()):
    import deck_case6 as C
D = C.D
from zrender import draw
from manifold3d import Manifold, CrossSection, JoinType, OpType
from PIL import Image, ImageDraw
def tris(m):
    mm = m.to_mesh(); v = np.array(mm.vert_properties)[:, :3]; t = np.array(mm.tri_verts); return v[t]
K = (205, 207, 212); BODY = (52, 56, 64)
half = C.knob ^ D.box(-20, 20, 0, 20, -1, 30)
def rr(w, r): return CrossSection.square((w - 2 * r, w - 2 * r), center=True).offset(r, JoinType.Round, circular_segments=16)
cap = Manifold.batch_hull([rr(18, 2).extrude(0.01).translate((0, 0, 4.5)), rr(13, 2.5).extrude(0.01).translate((0, 1.0, 12.0))])
caps = Manifold.batch_boolean([D.on_face(cap.translate((kx, D.V_KEYS, 0))) for kx in (D.KEY_A_X, D.KEY_B_X)], OpType.Add)
knob_w = D.on_face(C.knob.translate((D.KNOB_X, D.V_KNOB, 1.0)))
asm = [(tris(C.body), BODY), (D.board_world, (40, 90, 170)), (tris(knob_w), K), (tris(caps), (225, 226, 230))]
size = 700
views = [('dugme v6 (O24 x 18)', [(tris(C.knob), K)], ('cam', -30, 35)), ('ustten: canak ve isaret', [(tris(C.knob), K)], ('cam', 0, 90)),
         ('kesit: somun, burc, D delik', [(tris(half), K)], ('cam', 0, 0.01)), ('kasada (oturan goz)', asm, ('cam', 0, 35))]
S = Image.new('RGB', (2 * size, 2 * size + 30), (255, 255, 255)); d = ImageDraw.Draw(S); d.text((10, 8), 'Volkan Deck v6 - yeni dondurgec dugmesi', fill=(0, 0, 0))
for i, (nm, pp, v) in enumerate(views): S.paste(draw(pp, v, size, nm), ((i % 2) * size, 30 + (i // 2) * size))
S.save(os.path.join(HERE, 'v6_dugme.png')); print('ok')
