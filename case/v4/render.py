# Minimal flat-shaded orthographic renderer (painter's algorithm) -> PNG contact sheet
import numpy as np, sys
from PIL import Image, ImageDraw, ImageFont
def rot(rx,ry,rz):
    rx,ry,rz=np.radians([rx,ry,rz])
    X=np.array([[1,0,0],[0,np.cos(rx),-np.sin(rx)],[0,np.sin(rx),np.cos(rx)]])
    Y=np.array([[np.cos(ry),0,np.sin(ry)],[0,1,0],[-np.sin(ry),0,np.cos(ry)]])
    Z=np.array([[np.cos(rz),-np.sin(rz),0],[np.sin(rz),np.cos(rz),0],[0,0,1]])
    return Z@Y@X
VIEWS={'iso':(-60,0,-35),'front':(-90,0,0),'right':(-90,0,-90),'top':(0,0,0),'bottom':(180,0,0),'back':(-90,0,180),'iso_back':(-60,0,145)}
def cam(yaw,pitch):
    """yaw: 0 = looking from the front (-y), +90 = from the right. pitch: degrees above horizon."""
    rz=np.radians(yaw); rx=np.radians(-(90-pitch))
    Z=np.array([[np.cos(rz),-np.sin(rz),0],[np.sin(rz),np.cos(rz),0],[0,0,1]])
    X=np.array([[1,0,0],[0,np.cos(rx),-np.sin(rx)],[0,np.sin(rx),np.cos(rx)]])
    return X@Z
def draw(parts,view,size=700,label=None,pad=30,bounds=None):
    """parts: list of (tris, rgb); view: name | (rx,ry,rz) | ('cam',yaw,pitch)"""
    if isinstance(view,tuple) and view[0]=='cam': R=cam(view[1],view[2])
    else: R=rot(*VIEWS[view]) if isinstance(view,str) else rot(*view)
    allp=np.concatenate([p[0].reshape(-1,3) for p in parts])
    P=allp@R.T
    mn,mx=P.min(0),P.max(0)
    if bounds is not None: mn,mx=bounds
    sc=(size-2*pad)/max(mx[0]-mn[0],mx[1]-mn[1],1e-6)
    img=Image.new('RGB',(size,size),(245,246,248)); d=ImageDraw.Draw(img)
    polys=[]
    L=np.array([0.35,-0.45,0.82]); L/=np.linalg.norm(L)
    for tris,col in parts:
        T=tris@R.T
        n=np.cross(T[:,1]-T[:,0],T[:,2]-T[:,0]); ln=np.linalg.norm(n,axis=1); ok=ln>1e-12
        T=T[ok]; n=n[ok]/ln[ok,None]
        vis=n[:,2]>0
        T=T[vis]; n=n[vis]
        sh=0.35+0.65*np.clip(n@L,0,1)
        z=T[:,:,2].mean(1)
        for t,s,zz in zip(T,sh,z):
            polys.append((zz,[((p[0]-mn[0])*sc+pad,size-((p[1]-mn[1])*sc+pad)) for p in t],tuple(int(c*s) for c in col)))
    polys.sort(key=lambda a:a[0])
    for _,pts,c in polys: d.polygon(pts,fill=c,outline=c)
    if label: d.text((10,8),label,fill=(40,40,40))
    return img
def sheet(parts,out,views=('iso','front','right','top'),size=700,title=''):
    ims=[draw(parts,v,size,v) for v in views]
    cols=2; rows=(len(ims)+1)//2
    S=Image.new('RGB',(cols*size,rows*size+30),(255,255,255)); dd=ImageDraw.Draw(S); dd.text((10,8),title,fill=(0,0,0))
    for i,im in enumerate(ims): S.paste(im,((i%cols)*size,30+(i//cols)*size))
    S.save(out)
