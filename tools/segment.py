import sys, json
import numpy as np, cv2
src, out = sys.argv[1], sys.argv[2]
im = cv2.imread(src)
h, w = im.shape[:2]
hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
# background: bright & low saturation (white / light-gray checker / cream)
bg = (hsv[...,1] < 40) & (hsv[...,2] > 215)
fg = (~bg).astype(np.uint8)*255
k = cv2.getStructuringElement(cv2.MORPH_RECT,(9,9))
d = cv2.dilate(fg,k)
n, lab, stats, cent = cv2.connectedComponentsWithStats(d, 8)
boxes=[]
for i in range(1,n):
    x,y,bw,bh,a = stats[i]
    if bw*bh < 400: continue
    boxes.append([int(x),int(y),int(bw),int(bh)])
boxes.sort(key=lambda b:(b[1]//60, b[0]))
vis = im.copy()
for i,(x,y,bw,bh) in enumerate(boxes):
    cv2.rectangle(vis,(x,y),(x+bw,y+bh),(255,0,255),1)
    cv2.putText(vis,str(i),(x+2,y+12),cv2.FONT_HERSHEY_SIMPLEX,0.4,(255,0,0),1)
cv2.imwrite(out+'_vis.png', vis)
json.dump(boxes, open(out+'_boxes.json','w'))
print(len(boxes))
