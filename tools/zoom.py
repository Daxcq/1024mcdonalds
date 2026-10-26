"""python3 tools/zoom.py src x0 y0 x1 y1 scale out [step]  -> cropped, enlarged, gridded debug image"""
import sys, cv2
src, x0, y0, x1, y1, sc, out = sys.argv[1], *map(int, sys.argv[2:6]), float(sys.argv[6]), sys.argv[7]
step = int(sys.argv[8]) if len(sys.argv) > 8 else 20
im = cv2.imread(src, cv2.IMREAD_UNCHANGED)
if im.shape[2] == 4:
    import numpy as np
    a = im[..., 3:4] / 255.0
    bg = np.full(im.shape[:2] + (3,), (110, 150, 110), np.uint8)
    im = (im[..., :3] * a + bg * (1 - a)).astype('uint8')
c = im[y0:y1, x0:x1].copy()
c = cv2.resize(c, None, fx=sc, fy=sc, interpolation=cv2.INTER_NEAREST)
for x in range((x0 // step + 1) * step, x1, step):
    X = int((x - x0) * sc); cv2.line(c, (X, 0), (X, c.shape[0]), (255, 0, 255), 1); cv2.putText(c, str(x), (X + 2, 11), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (255, 255, 0), 1)
for y in range((y0 // step + 1) * step, y1, step):
    Y = int((y - y0) * sc); cv2.line(c, (0, Y), (c.shape[1], Y), (255, 0, 255), 1); cv2.putText(c, str(y), (2, Y - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (255, 255, 0), 1)
cv2.imwrite(out, c)
