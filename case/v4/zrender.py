import numpy as np
from PIL import Image, ImageDraw
from render import cam, rot, VIEWS
def draw(parts, view, size=700, label=None, pad=24, ss=2):
    if isinstance(view,tuple) and view[0]=='cam': R=cam(view[1],view[2])
    else: R=rot(*VIEWS[view]) if isinstance(view,str) else rot(*view)
    S=size*ss
    allp=np.concatenate([p[0].reshape(-1,3) for p in parts])@R.T
    mn,mx=allp.min(0),allp.max(0)
    sc=(S-2*pad*ss)/max(mx[0]-mn[0],mx[1]-mn[1],1e-6)
    ox=(S-(mx[0]-mn[0])*sc)/2; oy=(S-(mx[1]-mn[1])*sc)/2
    img=np.full((S,S,3),(245,246,248),np.float32); zb=np.full((S,S),-1e9,np.float32)
    L=np.array([0.3,0.5,0.81]); L/=np.linalg.norm(L)
    for tris,col in parts:
        T=tris@R.T
        nrm=np.cross(T[:,1]-T[:,0],T[:,2]-T[:,0]); ln=np.linalg.norm(nrm,axis=1); ok=ln>1e-12
        T=T[ok]; nrm=nrm[ok]/ln[ok,None]
        sh=0.30+0.70*np.abs(nrm@L)
        P=np.empty_like(T); P[...,0]=(T[...,0]-mn[0])*sc+ox; P[...,1]=S-((T[...,1]-mn[1])*sc+oy); P[...,2]=T[...,2]
        col=np.array(col,np.float32)
        for (a,b,c),s in zip(P,sh):
            x0=int(max(0,np.floor(min(a[0],b[0],c[0])))); x1=int(min(S-1,np.ceil(max(a[0],b[0],c[0]))))
            y0=int(max(0,np.floor(min(a[1],b[1],c[1])))); y1=int(min(S-1,np.ceil(max(a[1],b[1],c[1]))))
            if x1<x0 or y1<y0: continue
            xs,ys=np.meshgrid(np.arange(x0,x1+1)+0.5,np.arange(y0,y1+1)+0.5)
            d=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
            if abs(d)<1e-9: continue
            w0=((b[1]-c[1])*(xs-c[0])+(c[0]-b[0])*(ys-c[1]))/d
            w1=((c[1]-a[1])*(xs-c[0])+(a[0]-c[0])*(ys-c[1]))/d
            w2=1-w0-w1
            m=(w0>=-1e-4)&(w1>=-1e-4)&(w2>=-1e-4)
            if not m.any(): continue
            z=w0*a[2]+w1*b[2]+w2*c[2]
            sub=zb[y0:y1+1,x0:x1+1]; upd=m&(z>sub)
            sub[upd]=z[upd]; img[y0:y1+1,x0:x1+1][upd]=col*s
    im=Image.fromarray(img.clip(0,255).astype(np.uint8)).resize((size,size),Image.LANCZOS)
    if label: ImageDraw.Draw(im).text((8,6),label,fill=(30,30,30))
    return im
