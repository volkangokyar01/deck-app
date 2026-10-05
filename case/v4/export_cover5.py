import os, sys, io, contextlib, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
with contextlib.redirect_stdout(io.StringIO()):
    import deck_cover5 as C
D = C.D
from stlio import save_stl
from manifold3d import Manifold
def tris(m):
    mm = m.to_mesh(); v = np.array(mm.vert_properties)[:, :3]; t = np.array(mm.tri_verts); return v, t
def on_bed(m): b = m.bounding_box(); return m.translate((-b[0], -b[1], -b[2]))
part = on_bed(C.cover.transform(np.array([[1, 0, 0, 0], [0, D.wv[0], D.wv[1], 0], [0, -D.mv[0], -D.mv[1], 0]], float)))  # outer face on the bed
v, t = tris(part); save_stl(os.path.join(HERE, 'v5_arka_kapak.stl'), v[t])
b = part.bounding_box(); print('v5_arka_kapak ext', [round(b[i+3]-b[i], 2) for i in range(3)], 'bodies', len(part.decompose()))
# slice test: arm free from plug along its length
for x in (10.0, 20.0):
    sl = C.cover ^ D.back_prism(C.rect(x - 0.1, x + 0.1, -10, 80), -40, 10)
    print('slice x', x, 'components', len(sl.decompose()))
from zrender import draw
gv, gt = tris(part)
draw([(gv[gt], (80, 84, 92))], ('cam', -35, 50), 800, 'v5 arka kapak - baski yonu (dis yuz tablada)').save(os.path.join(HERE, 'v5_kapak_baski.png'))
inner = part.transform(np.array([[1,0,0,0],[0,1,0,0],[0,0,-1,0]], float))
iv, it = tris(on_bed(inner))
draw([(iv[it], (80, 84, 92))], ('cam', -30, 40), 800, 'v5 arka kapak - dis yuz (ustte yay yariklari, altta diller)').save(os.path.join(HERE, 'v5_kapak_dis.png'))
