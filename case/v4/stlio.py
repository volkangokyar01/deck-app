import numpy as np, struct
def load_stl(p):
    b=open(p,'rb').read()
    if b[:5]==b'solid' and b'facet' in b[:300]:
        v=[]
        for line in b.decode(errors='ignore').splitlines():
            line=line.strip()
            if line.startswith('vertex'): v.append([float(x) for x in line.split()[1:4]])
        return np.array(v,dtype=float).reshape(-1,3,3)
    n=struct.unpack('<I',b[80:84])[0]
    a=np.frombuffer(b[84:84+n*50],dtype=np.dtype([('n','<f4',3),('v','<f4',(3,3)),('a','<u2')]))
    return a['v'].astype(float)
def save_stl(p,tris):
    tris=np.asarray(tris,dtype=np.float32)
    n=np.cross(tris[:,1]-tris[:,0],tris[:,2]-tris[:,0]); l=np.linalg.norm(n,axis=1,keepdims=True); l[l==0]=1; n=(n/l).astype(np.float32)
    rec=np.zeros(len(tris),dtype=np.dtype([('n','<f4',3),('v','<f4',(3,3)),('a','<u2')])); rec['n']=n; rec['v']=tris
    with open(p,'wb') as f: f.write(b'\0'*80); f.write(struct.pack('<I',len(tris))); f.write(rec.tobytes())
