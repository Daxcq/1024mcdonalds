"""Segmentation of assets/fp_src/kitchen_ref.png (gloves, sleeves, bun, burger). Used by build_fp_assets.py."""
import os
import types

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'fp_src', 'kitchen_ref.png')

# pixels that are certainly glove / sleeve-opening (kitchen_ref.png coordinates)
SEEDS = {
    'R': [(1100, 560), (1010, 440), (1220, 650), (1040, 500), (1000, 610)],
    'L': [(540, 760), (600, 680), (500, 720), (450, 800), (400, 870)],
}
LOBE_SEEDS = [(1240, 745), (1200, 800), (1285, 730)]     # peach cuff flap under the right glove
CUFF_L_SEEDS = [(380, 890), (405, 920), (410, 945)]      # orange band around the left glove opening
S_MAX, S_MAX_LOBE, V_MIN, DARK = 0.62, 0.72, 0.50, 78
# bins / bottles: never part of a hole (the bin row ends at x=776, its bottom rim at y=604)
PROTECT = [(0, 380, 776, 604), (1224, 270, 1462, 586)]
# the tray at the left: keep its rim even when a sleeve outline touches it
TRAY = (0, 590, 392, 848)
BOARD_X0 = 891.1      # measured right edge of the old board: x = 0.2545 * y + 891.1
BOARD_K = 0.2545
EXTRA_HOLES = [(0, 912, 130, 1024)]      # orphan counter-lip piece left of the left sleeve: becomes plain counter
OUTLINE_BGR = (22, 25, 46)               # #2e1916, the glove outline colour
K3 = np.ones((3, 3), np.uint8)


def load():
    im = cv2.imread(SRC)
    hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV).astype(np.float32)
    return types.SimpleNamespace(
        im=im, hue=hsv[..., 0] * 2.0, sat=hsv[..., 1] / 255.0, val=hsv[..., 2] / 255.0,
        lum=cv2.cvtColor(im, cv2.COLOR_BGR2GRAY))


def fill_holes(m):
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    out = np.zeros_like(m)
    cv2.drawContours(out, cnts, -1, 1, -1)
    return out


def flood(allowed, seeds):
    n, lab = cv2.connectedComponents(allowed, connectivity=4)
    labs = sorted({int(lab[y, x]) for x, y in seeds if lab[y, x] > 0})
    return np.isin(lab, labs).astype(np.uint8)


def grow_outline(region, dark, steps=4):
    """Win the black outline back, one pixel per step.

    The flood region stops 1 px short of the outline (it excludes pixels next to dark ones), so growth
    may cross dark pixels AND their 1-px anti-aliased neighbours (dilated dark = 'wall')."""
    wall = cv2.dilate(dark, K3)
    ring = region.copy()
    for _ in range(steps):
        d = cv2.dilate(ring, K3)
        ring = np.where((d > 0) & ((wall > 0) | (region > 0)), 1, ring).astype(np.uint8)
    return ring


def glove_masks(S):
    """-> ({'R','L'} glove masks incl. black outline, lobe mask of the right sleeve opening)"""
    dark = (S.lum < DARK).astype(np.uint8)
    wall = cv2.dilate(dark, K3)
    allowed = ((S.sat <= S_MAX) & (S.val >= V_MIN) & (wall == 0)).astype(np.uint8)
    allowed = cv2.morphologyEx(allowed, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    out = {}
    for grp, pts in SEEDS.items():
        out[grp] = grow_outline(fill_holes(flood(allowed, pts)), dark)
    allowed_l = ((S.sat <= S_MAX_LOBE) & (S.val >= V_MIN) & (wall == 0)).astype(np.uint8)
    allowed_l = cv2.morphologyEx(allowed_l, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    # the left glove's cuff band is more saturated than its palm: it joins the glove (it belongs to the sprite)
    cuff = flood(allowed_l, CUFF_L_SEEDS) & (1 - out['R'])
    out['L'] = grow_outline(fill_holes(((out['L'] | cuff) > 0).astype(np.uint8)), dark) & (1 - out['R'])
    lobe = flood(allowed_l, LOBE_SEEDS) & (1 - out['R']) & (1 - out['L'])
    lobe = grow_outline(fill_holes(lobe.astype(np.uint8)), dark) & (1 - out['R']) & (1 - out['L'])
    return out, lobe.astype(np.uint8)


def sleeve_masks(S):
    """Red sleeves (+ gold stripe) touching the bottom edge in the two corners."""
    b, g, r = [S.im[..., i].astype(np.float32) for i in range(3)]
    red = (r >= 90) & (g < 0.38 * r) & (b < 0.38 * r)
    gold = (r >= 200) & (g > 0.55 * r) & (g < 0.88 * r) & (b < 0.28 * r)
    red[:700] = False
    gold[:700] = False
    near = cv2.dilate(red.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (41, 41))) > 0
    cand = (red | (gold & near)).astype(np.uint8)
    cand = cv2.morphologyEx(cand, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(cand, connectivity=8)
    out = {}
    for grp, (cx, cy) in {'L': (120, 1000), 'R': (1400, 960)}.items():
        l = int(lab[cy, cx])
        if l == 0:
            raise SystemExit('sleeve seed %s is not on a sleeve' % grp)
        out[grp] = cv2.dilate(fill_holes((lab == l).astype(np.uint8)), np.ones((9, 9), np.uint8))
    return out


def bun_mask(S):
    """The top bun held in the right hand: flood inside its black outline, then win the outline back."""
    dark = (S.lum < DARK).astype(np.uint8)
    wall = cv2.dilate(dark, K3)
    orange = (S.hue >= 8) & (S.hue <= 52) & (S.sat >= 0.52) & (S.val >= 0.42)
    roi = np.zeros(S.lum.shape, np.uint8)
    cv2.ellipse(roi, (884, 498), (190, 128), 8, 0, 360, 1, -1)
    roi[:, :732] = 0
    allowed = (orange & (roi > 0) & (wall == 0)).astype(np.uint8)
    allowed = cv2.morphologyEx(allowed, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    reg = flood(allowed, [(880, 500), (800, 470), (960, 540), (830, 540)])
    reg = fill_holes(cv2.morphologyEx(reg, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)))
    return grow_outline(reg, dark, steps=5)


def burger_mask(shape):
    """Burger on the board (bottom bun, lettuce frills, patty, cheese, bun crown peeking at y~600)."""
    m = np.zeros(shape, np.uint8)
    cv2.ellipse(m, (788, 742), (218, 172), 0, 0, 360, 1, -1)
    m[:588] = 0
    return m


def board_zone(shape, margin=16, shadow=84):
    """Old board footprint: its remnants (and the grey shadow band right of it) are replaced.

    Right edge follows the measured line x = BOARD_K * y + BOARD_X0 (+ margin, + shadow band below y=700)."""
    m = np.zeros(shape, np.uint8)
    y0, y1 = 684 - margin, 976
    xr = lambda y, extra: int(BOARD_K * y + BOARD_X0 + extra)
    pts = np.array([(540 - margin, y0), (xr(y0, margin), y0), (xr(700, margin + shadow), 700),
                    (xr(y1, margin + shadow), y1), (480 - margin, y1)], np.int32)
    cv2.fillPoly(m, [pts], 1)
    return m


def merge_islands(hole, max_area=9000):
    """Small clean-looking pockets enclosed by the hole (e.g. the board's old shadow) join the hole."""
    free = (1 - hole).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(free, connectivity=4)
    out = hole.copy()
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] < max_area:
            out[lab == i] = 1
    return out


def build_hole(S, gloves, lobe, sleeves, bun):
    H, W = S.lum.shape
    hole = np.zeros((H, W), np.uint8)
    for g in gloves.values():
        hole |= cv2.dilate(g, np.ones((11, 11), np.uint8))
    hole |= cv2.dilate(lobe, np.ones((9, 9), np.uint8))
    for s in sleeves.values():
        hole |= s
    hole |= burger_mask((H, W)) | board_zone((H, W))
    for x0, y0, x1, y1 in PROTECT:       # the bins stay as they are ...
        hole[y0:y1, x0:x1] = 0
    hole |= bun                          # ... except where the bun hides their wall (repaired separately)
    for x0, y0, x1, y1 in EXTRA_HOLES:
        hole[y0:y1, x0:x1] = 1
    hole[:366] = 0
    return merge_islands(hole)


def cut_sprite(S, mask):
    """Glove mask -> (RGBA crop, (x, y, w, h), cleaned mask).

    Binary alpha (it is pixel art).  Closes 1-px notches, fills holes, and repaints light pixels of the
    1-px border ring with the outline colour so the sprite keeps a continuous dark edge on any backdrop."""
    m = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3)))
    m = fill_holes(m)
    img = S.im.copy()
    ring = (m > 0) & (cv2.erode(m, K3) == 0)
    img[ring & (S.lum > 100)] = OUTLINE_BGR
    ys, xs = np.where(m > 0)
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
    rgba = np.dstack([img, (m * 255).astype(np.uint8)])[y0:y1, x0:x1].copy()
    rgba[rgba[..., 3] == 0, :3] = 0
    return rgba, (x0, y0, x1 - x0, y1 - y0), m


def wall_repair_zone(bun):
    """Part of the bun that sits on top of the pickle bin's right wall (+ its outline halo)."""
    z = np.zeros_like(bun)
    z[396:608, 726:790] = 1
    grown = cv2.dilate(bun, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
    return (z & grown).astype(np.uint8)


WALL_ROWS = (410, 552)     # clean reference rows above / below the stretch of the bin wall hidden by the bun


def repair_bin_wall(img, zone):
    """The bin's right wall is a vertical structure (rim, shading, dark outline), so it is rebuilt by
    blending two clean reference rows (above and below the hidden stretch) instead of per-column
    neighbours, which would copy the bun's own outline."""
    out = img.copy()
    ya, yb = WALL_ROWS
    top, bot = img[ya].astype(np.float32), img[yb].astype(np.float32)
    ys, xs = np.where(zone > 0)
    for y, x in zip(ys, xs):
        t = float(np.clip((y - ya) / (yb - ya), 0.0, 1.0))
        out[y, x] = np.clip(top[x] * (1 - t) + bot[x] * t, 0, 255).astype(np.uint8)
    return out
