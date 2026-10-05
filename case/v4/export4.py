import os; HERE=os.path.dirname(os.path.abspath(__file__))
import sys, numpy as np, zipfile, os, io, contextlib; sys.path.insert(0, HERE)
with contextlib.redirect_stdout(io.StringIO()):
    import deck_case4 as D
from stlio import save_stl
out=HERE; os.makedirs(out,exist_ok=True)
def T(m,M): return m.transform(np.array(M,float))
def on_bed(m): b=m.bounding_box(); return m.translate((-b[0],-b[1],-b[2]))
parts={
 'v4_govde':     on_bed(T(D.body, [[-1,0,0,0],[0,D.u[0],D.u[1],0],[0,-D.n[0],-D.n[1],0]])),   # face on the bed
 'v4_arka_kapak': on_bed(T(D.cover,[[1,0,0,0],[0,D.wv[0],D.wv[1],0],[0,-D.mv[0],-D.mv[1],0]])),   # outer face on the bed
 'v4_dugme':     on_bed(T(D.knob, [[1,0,0,0],[0,-1,0,0],[0,0,-1,0]])),    # top face on the bed
 'v4_tus_itici': on_bed(D.plunger),
}
def tris(m):
    mm=m.to_mesh(); v=np.array(mm.vert_properties)[:,:3]; t=np.array(mm.tri_verts); return v,t
for k,m in parts.items():
    v,t=tris(m); save_stl(f'{out}/{k}.stl', v[t]); b=m.bounding_box()
    print(f"{k:14s} bodies={len(m.decompose())} ext=({b[3]-b[0]:.1f},{b[4]-b[1]:.1f},{b[5]-b[2]:.1f}) vol={m.volume()/1000:.1f}cm3")
place={'v4_govde':(8,8),'v4_arka_kapak':(120,8),'v4_dugme':(120,70),'v4_tus_itici':(160,70),'v4_tus_itici_2':(172,70)}
def P(nm): return parts['v4_tus_itici' if nm.startswith('v4_tus_itici') else nm].translate((place[nm][0],place[nm][1],0))
for nm in place:
    b=P(nm).bounding_box(); assert b[3]<=250 and b[4]<=250, (nm,b)
xml=''; items=[]
for oid,name in enumerate(place,1):
    v,t=tris(P(name))
    vs=''.join(f'<vertex x="{a:.4f}" y="{b:.4f}" z="{c:.4f}"/>' for a,b,c in v)
    ts=''.join(f'<triangle v1="{i}" v2="{j}" v3="{k}"/>' for i,j,k in t)
    xml+=f'<object id="{oid}" name="{name}" type="model"><mesh><vertices>{vs}</vertices><triangles>{ts}</triangles></mesh></object>'
    items.append(f'<item objectid="{oid}"/>')
model=f'<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">Volkan Deck kasa v4</metadata><resources>{xml}</resources><build>{"".join(items)}</build></model>'
with zipfile.ZipFile(f'{out}/VolkanDeck_kasa_v4.3mf','w',zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')
    z.writestr('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')
    z.writestr('3D/3dmodel.model',model)
print('3mf', os.path.getsize(f'{out}/VolkanDeck_kasa_v4.3mf'))
from zrender import draw
cols={'v4_govde':(60,64,72),'v4_arka_kapak':(80,84,92),'v4_dugme':(160,160,165),'v4_tus_itici':(200,120,60),'v4_tus_itici_2':(200,120,60)}
pp=[(tris(P(nm))[0][tris(P(nm))[1]],cols[nm]) for nm in place]
v,t=tris(D.box(0,256,0,256,-1.0,0)); pp.insert(0,(v[t],(215,218,222)))
draw(pp,('cam',-25,45),900,'v4 baski tablasi (P2S 256x256) - destek yok').save(f'{out}/v4_plate.png')
