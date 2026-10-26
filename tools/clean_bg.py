"""清掉背景图中间的店员：地板按平铺周期整块复制，柜体部分整块平移复制。不用插值/模糊。"""
import cv2, numpy as np
ROOT = __import__('os').path.dirname(__import__('os').path.dirname(__import__('os').path.abspath(__file__)))
im = cv2.imread(ROOT + '/assets/scene_ref.jpg')[:, :892].copy()
H, W = im.shape[:2]
bg = im.copy()

# 店员实际覆盖范围（含脚下影子）
X0, X1, Y0, Y1 = 388, 562, 438, 672
# 柜体与地面的分界：这之上是柜门/烤箱，之下是地砖
FLOOR_Y = 500

# ---------- 地板：按周期 (180,120) 整块复制 ----------
# 洞向 (180,120) 方向平移后落在一块干净地面上（x 568..742, y 558..792 只有地砖和少量袋子）
for (sx, sy, dx, dy, hh, ww) in [
    # 主块：洞的地板部分 -> 右下 180,120
    (X0, FLOOR_Y, 180, 120, Y1 - FLOOR_Y, X1 - X0),
]:
    src = im[sy + dy:sy + dy + hh, sx + dx:sx + dx + ww]
    dst = bg[sy:sy + hh, sx:sx + ww]
    # 只替换洞内（地板区域整块换掉即可，这块本来全是地砖）
    dst[:, :] = src

# 上沿（Y0..FLOOR_Y）是柜体：整块平移复制左边同高度的柜门
dy_top = FLOOR_Y - Y0
for (sx, dx, ww) in [(X0, -186, X1 - X0)]:
    src = im[Y0:FLOOR_Y, sx + dx:sx + dx + ww]
    bg[Y0:FLOOR_Y, sx:sx + ww] = src
    # 上方接缝处用旁边柜体色补齐两行，避免露出下面的旧像素
cv2.imwrite(ROOT + '/tools/_debug/clean_try.png', bg[380:740, 300:660])
