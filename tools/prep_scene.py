"""scene_ref.jpg -> kitchen_bg.png（纯背景，不含店员）+ worker.png（店员精灵）

背景修补：不模糊、不插值拉丝。按“整块地砖复制”的思路做——
  1) 每行找出洞的左右边界，从同行的干净地砖里取整段，按地砖周期横向平铺
  2) 洞内的地砖缝（深色细线）用左右两侧的缝位置续上，保证纹理连贯
  3) 洞的上半部分（帽子上沿压到柜门/烤箱）单独处理：从柜体左侧的同高度面板整块平移复制
"""
import os, numpy as np, cv2
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
im = cv2.imread(os.path.join(ROOT, 'assets', 'scene_ref.jpg'))[:, :892].copy()
H, W = im.shape[:2]

# ---------- 1. 抠店员 ----------
rx, ry, rw, rh = 392, 448, 168, 210
mask = np.zeros((H, W), np.uint8)
bgm = np.zeros((1, 65)); fgm = np.zeros((1, 65))
cv2.grabCut(im, mask, (rx, ry, rw, rh), bgm, fgm, 8, cv2.GC_INIT_WITH_RECT)
fg = ((mask == 1) | (mask == 3)).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(fg, connectivity=8)
fg = (lab == (1 + np.argmax(st[1:, 4]))).astype(np.uint8)
fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
cnts, _ = cv2.findContours(fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
filled = np.zeros_like(fg); cv2.drawContours(filled, cnts, -1, 1, -1)
fg = filled
ys, xs = np.where(fg > 0)
x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
rgba = np.dstack([im, fg * 255])[y0:y1, x0:x1]
cv2.imwrite(os.path.join(ROOT, 'assets', 'sprites', 'worker.png'), rgba)
print('worker bbox', x0, y0, x1, y1)

# ---------- 2. 洞的掩膜（店员 + 脚下影子 + 气泡）----------
hole = cv2.dilate(fg, np.ones((11, 11), np.uint8))
cv2.ellipse(hole, (470, 648), (52, 20), 0, 0, 360, 1, -1)          # 脚下阴影
bub = np.zeros((H, W), np.uint8)
cv2.rectangle(bub, (500, 362), (612, 448), 255, -1)                  # 气泡
cv2.fillPoly(bub, [np.array([[520, 440], [556, 440], [528, 470]])], 255)
hole = np.maximum(hole, bub)

bg = im.copy()

# ---------- 3. 地面部分：整段复制 + 续地砖缝 ----------
# 地面区域从 y≈505 往下（柜体下沿）；地砖周期约 96px（横向）
FLOOR_TOP = 500
GY = 118          # 垂直方向取同一块地面的偏移（向下复制，纹理一致）
for y in range(FLOOR_TOP, H):
    hx = np.where(hole[y] > 0)[0]
    if len(hx) == 0:
        continue
    a, b = hx.min(), hx.max()
    pw = b - a + 1
    # 源：洞右侧的干净地面（同一行，右移 96 的整数倍，保证跨过地砖缝也对得上）
    src_l = b + 4
    if src_l + pw <= W:
        src = im[y, src_l:src_l + pw].copy()
    else:                                  # 右侧不够就往下挪一层
        src = im[min(H - 1, y + GY), a:b + 1].copy()
    # 用左右两侧的地面颜色做轻微校正，避免拼缝色差
    lo = im[y, max(0, a - 6):a].mean(0); li = im[y, b + 1:min(W, b + 7)].mean(0)
    so = src[:4].mean(0); si = src[-4:].mean(0)
    ramp = np.linspace(0, 1, pw)[:, None]
    src = src + (lo - so) * (1 - ramp) + (li - si) * ramp
    # 只在洞内替换，边界羽化 3px
    bg[y, a:b + 1] = src.clip(0, 255).astype(np.uint8)

# 地砖缝：把洞内断开的那几条缝补上（缝的颜色取自同一条缝在洞外的颜色）
grout = cv2.cvtColor(bg, cv2.COLOR_BGR2GRAY)
for y in range(FLOOR_TOP, H):
    hx = np.where(hole[y] > 0)[0]
    if len(hx) == 0:
        continue
    a, b = hx.min(), hx.max()
    for x in range(a, b + 1):
        if grout[y, x] < grout[y, max(0, x - 12)] - 12 and grout[y, x] < grout[y, min(W - 1, x + 12)] - 12:
            bg[y, x] = bg[y, max(0, x - 12)] * 0.5 + bg[y, min(W - 1, x + 12)] * 0.5

# ---------- 4. 柜体部分（y < 500）：整块平移复制左侧同高度的柜门 ----------
sub = hole[:FLOOR_TOP]
ys2, xs2 = np.where(sub > 0)
if len(xs2):
    Y0, Y1, X0, X1 = ys2.min(), ys2.max() + 1, xs2.min(), xs2.max() + 1
    m = (sub[Y0:Y1, X0:X1] > 0)
    # 往左平移一个柜门宽（约 96px），逐列挑一个最匹配的偏移
    best = None
    for dx in range(60, 200, 4):
        if X0 - dx < 0:
            break
        src = im[Y0:Y1, X0 - dx:X1 - dx]
        diff = np.abs(src[m].astype(int) - im[Y0:Y1, X0:X1][m].astype(int)).mean()
        if best is None or diff < best[1]:
            best = (dx, diff)
    dx = best[0] if best else 96
    src = im[Y0:Y1, X0 - dx:X1 - dx]
    reg = bg[Y0:Y1, X0:X1]
    reg[m] = src[m]
    print('cabinet patch dx=', dx)

# ---------- 5. 气泡残留（在地面与柜体交界）：同高度右侧整块复制 ----------
by0, by1, bx0, bx1 = 358, 476, 496, 618
m2 = hole[by0:by1, bx0:bx1] > 0
src2 = im[by0:by1, bx0 - 122:bx1 - 122]
reg2 = bg[by0:by1, bx0:bx1]
reg2[m2] = src2[m2]

# 边缘柔化一圈，避免硬接缝
soft = cv2.GaussianBlur(bg, (5, 5), 0)
edge = cv2.dilate(hole, np.ones((3, 3), np.uint8)) - cv2.erode(hole, np.ones((3, 3), np.uint8))
e = (edge > 0)
bg[e] = soft[e]

cv2.imwrite(os.path.join(ROOT, 'assets', 'kitchen_bg.png'), bg)
cv2.imwrite(os.path.join(ROOT, 'tools', '_debug', 'bg_check.png'), bg)
print('bg saved')
