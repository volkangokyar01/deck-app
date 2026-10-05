import os; HERE=os.path.dirname(os.path.abspath(__file__))
import sys, numpy as np, io, contextlib; sys.path.insert(0, HERE)
with contextlib.redirect_stdout(io.StringIO()):
    import deck_case4 as D
from zrender import draw
from PIL import Image, ImageDraw
from manifold3d import Manifold, CrossSection, JoinType, OpType
def tris(m):
    mm=m.to_mesh(); v=np.array(mm.vert_properties)[:,:3]; t=np.array(mm.tri_verts); return v[t]
def rr(w,r): return CrossSection.square((w-2*r,w-2*r),center=True).offset(r,JoinType.Round,circular_segments=16)
cap=Manifold.batch_hull([rr(18,2).extrude(0.01).translate((0,0,4.5)), rr(13,2.5).extrude(0.01).translate((0,1.0,12.0))])
caps=Manifold.batch_boolean([D.on_face(cap.translate((kx,D.V_KEYS,0))) for kx in (D.KEY_A_X,D.KEY_B_X)],OpType.Add)
knob=D.on_face(D.knob.translate((D.KNOB_X,D.V_KNOB,1.0)))
body=D.body; cover=D.cover
plg=Manifold.batch_boolean([D.to_board(D.plunger.translate((bx,by,-2.55))) for bx,by in D.BTNS],OpType.Add)
mode=sys.argv[1] if len(sys.argv)>1 else 'asm'
BODY=(52,56,64); COV=(58,62,70)
if mode=='asm':
    parts=[(tris(body),BODY),(tris(cover),COV),(D.board_world,(40,90,170)),(tris(knob),(190,192,198)),(tris(caps),(225,226,230)),(tris(plg),(70,74,82))]
    views=[('on-sag',('cam',-32,24)),('oturan goz (35 derece)',('cam',0,35)),('sol yan (USB-C)',('cam',90,0)),('arka-sol',('cam',140,24))]
else:
    cut=D.box(0,80,-10,130,-5,90)
    parts=[(tris(body-cut),(150,154,162)),(D.board_world,(40,90,170)),(tris(D.pin_zone),(240,150,60)),
           (tris(D.ghost_bat),(220,190,80)),(tris(D.ky040),(40,140,80)),(tris(D.switches),(200,80,80))]
    views=[('kesit x=0, sagdan',('cam',-90,0)),('kesit, sag-on',('cam',-55,20)),('kesit, sag-arka',('cam',-130,25)),('ust',('cam',0,90))]
size=700
S=Image.new('RGB',(2*size,2*size+30),(255,255,255)); d=ImageDraw.Draw(S); d.text((10,8),'Volkan Deck kasa v4 - '+mode,fill=(0,0,0))
for i,(nm,v) in enumerate(views): S.paste(draw(parts,v,size,nm),((i%2)*size,30+(i//2)*size))
S.save(os.path.join(HERE, f'v4_{mode}.png')); print('ok')
