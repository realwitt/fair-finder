import math, urllib.request, io, concurrent.futures as cf
from PIL import Image
Z=17; R=6378137; O=math.pi*R; TS=512
xmin,ymin,xmax,ymax=-8763219.31,4271928.05,-8761365.87,4273070.68
res=2*O/TS/2**Z
tx0=int((xmin+O)/(res*TS)); tx1=int((xmax+O)/(res*TS))
ty0=int((O-ymax)/(res*TS)); ty1=int((O-ymin)/(res*TS))
U="https://tiles.arcgis.com/tiles/3Sj1fiIDvQtFfbvg/arcgis/rest/services/Graphic_2026_WTL1/MapServer/tile/{z}/{y}/{x}"
img=Image.new("RGB",((tx1-tx0+1)*TS,(ty1-ty0+1)*TS),"white")
def get(xy):
  x,y=xy
  try: return xy,Image.open(io.BytesIO(urllib.request.urlopen(U.format(z=Z,x=x,y=y),timeout=30).read())).convert("RGB")
  except Exception as e: return xy,None
with cf.ThreadPoolExecutor(16) as ex:
  for (x,y),t in ex.map(get,[(x,y) for x in range(tx0,tx1+1) for y in range(ty0,ty1+1)]):
    if t: img.paste(t,((x-tx0)*TS,(y-ty0)*TS))
img.save("stitch.png"); open("meta.txt","w").write(f"{Z} {tx0} {ty0} {res}\n"); print(img.size,tx0,ty0)
