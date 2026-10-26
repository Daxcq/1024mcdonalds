"""kitchen_ref.png -> game-ready pieces.   run:  python3 -I tools/build_fp_assets.py

  assets/fp/kitchen_bg.png      clean first-person kitchen (no hands / sleeves / burger / bun; board redrawn)
  assets/fp/hand_L.png, hand_R.png   gloved hands, RGBA, tightly trimmed (sleeves are drawn by the game)
  js/fp_layout.js               window.FP_LAYOUT: board, hand anchors, sleeve geometry, station hot zones
  tools/_debug/fp/bgclean_*.png previews

Segmentation lives in fp_masks.py, counter synthesis in fp_counter.py, the board in fp_board.py.
"""
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fp_board as B      # noqa: E402
import fp_counter as C    # noqa: E402
import fp_masks as M      # noqa: E402

ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'assets', 'fp')
DBG = os.path.join(HERE, '_debug', 'fp')

# Anchors are measured on the reference (see the analysis notes in the report); sprite-local pixels.
ANCHOR_SRC = {
    # wrist = centre of the contact segment glove/sleeve, dirIn = unit vector from wrist towards the sleeve body
    'L': {'wrist': (371.6, 911.9), 'dir': (-0.716, 0.698)},
    'R': {'wrist': (1273.1, 797.3), 'dir': (0.597, 0.802)},
}
# where an item sits when the hand holds it (scene coords in the reference): right hand holds the bun,
# left hand cups the burger at its left edge
PINCH_SRC = {'R': (940.0, 528.0), 'L': (676.0, 786.0)}
TOUCH_SRC = {'L': (694.0, 846.0)}        # left fingertips (right-most point of the left glove)

STATIONS = {   # [x, y, w, h] in scene pixels, measured from the reference by colour
    'lettuce': [0, 384, 190, 161], 'tomato': [60, 412, 379, 181], 'cheese': [398, 427, 194, 124],
    'pickle': [577, 419, 169, 137], 'buns': [0, 600, 304, 195],
    'ketchup': [1228, 285, 113, 288], 'mustard': [1338, 316, 102, 277],
    'grill': [440, 150, 560, 190], 'patties': [500, 185, 440, 78], 'fryer': [1000, 160, 300, 110],
    'trayRight': [1435, 515, 101, 175],
}


def make_all():
    S = M.load()
    H, W = S.lum.shape
    gl, lobe = M.glove_masks(S)
    sl = M.sleeve_masks(S)
    bun = M.bun_mask(S)
    hole = M.build_hole(S, gl, lobe, sl, bun)
    zone = M.wall_repair_zone(bun)

    # background: wall repair -> counter -> despeckle -> board
    S.im = M.repair_bin_wall(S.im, zone)
    fill_hole = hole.copy()
    fill_hole[zone > 0] = 0
    img, _ = C.fill_counter(S, fill_hole)
    img, n_spk = C.despeckle(img)
    img, binfo = B.draw_board(img)
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(DBG, exist_ok=True)
    cv2.imwrite(os.path.join(OUT, 'kitchen_bg.png'), img)

    # hands (R includes the peach flap that lies under the glove)
    S0 = M.load()
    sprites, meta = {}, {}
    for side, mask in (('L', gl['L']), ('R', ((gl['R'] | lobe) > 0).astype(np.uint8))):
        rgba, box, _ = M.cut_sprite(S0, mask)
        cv2.imwrite(os.path.join(OUT, 'hand_%s.png' % side), rgba)
        sprites[side], meta[side] = rgba, box
    return S0, img, sprites, meta, {'despeckled_px': n_spk, **binfo}


# Sleeve = a trapezoid that starts at the wrist and runs towards the bottom corner; fitted against the
# reference silhouettes (IoU 0.96 / 0.97).  angle in degrees (screen coords, y down), halfW0 = half width
# at the wrist, spread = extra half width per pixel of length.
SLEEVE_FIT = {'L': {'angle': 137.5, 'halfW0': 105, 'spread': 0.30},
              'R': {'angle': 55.0, 'halfW0': 110, 'spread': 0.45}}
SLEEVE_COLORS = {'red': '#e52e23', 'redDark': '#b82220', 'stripe': '#fcaa17', 'outline': '#2e1916'}


def sleeve_layout():
    out = {'colors': SLEEVE_COLORS, 'length': 520, 'stripeAt': [0.11, 0.22]}
    for side in ('L', 'R'):
        f = SLEEVE_FIT[side]
        a = np.radians(f['angle'])
        w0 = np.array(ANCHOR_SRC[side]['wrist'], np.float32)
        out[side] = {'wrist': [round(float(v), 1) for v in w0], 'angle': f['angle'],
                     'halfWidthAtWrist': f['halfW0'], 'spread': f['spread'],
                     'shoulder': [round(float(w0[0] + np.cos(a) * 520), 1), round(float(w0[1] + np.sin(a) * 520), 1)]}
    return out


def stack_base(img):
    """Place a real bottom-bun sprite on the board and return the footprint centre of the first layer.

    The bun is drawn so its bottom edge sits a little above the board front edge, roughly centred on
    the board top face (centroid of the top polygon, nudged up because the view looks down onto it)."""
    pts = np.array(B.TOP, np.float32)
    cx = float(pts[:, 0].mean())
    cy = float(pts[:, 1].mean()) + 22
    return [round(cx, 1), round(cy, 1)]


def write_layout(S0, meta, extra):
    def local(side, p):
        bx, by = meta[side][0], meta[side][1]
        return [round(p[0] - bx, 1), round(p[1] - by, 1)]
    hands = {}
    for side in ('L', 'R'):
        x, y, w, h = meta[side]
        hands[side] = {'file': 'hand_%s.png' % side, 'size': [w, h], 'rest': [x, y],
                       'wrist': local(side, ANCHOR_SRC[side]['wrist']),
                       'pinch': local(side, PINCH_SRC[side]),
                       'sleeveDir': list(ANCHOR_SRC[side]['dir'])}
    hands['L']['touch'] = local('L', TOUCH_SRC['L'])
    layout = {
        'W': 1536, 'H': 1024,
        'board': {'top': [list(p) for p in B.TOP], 'frontH': B.FRONT_H, 'stackBase': extra['stackBase']},
        'hands': hands,
        'sleeve': extra['sleeve'],
        'stations': STATIONS,
    }
    path = os.path.join(ROOT, 'js', 'fp_layout.js')
    with open(path, 'w', encoding='utf-8') as f:
        f.write('/* auto-generated by tools/build_fp_assets.py -- coordinates are in 1536x1024 scene pixels,\n'
                '   hand anchors (wrist / pinch / touch) are in the hand sprite\'s own pixels. */\n')
        f.write('window.FP_LAYOUT = ' + json.dumps(layout, indent=1) + ';\n')
    return layout


def alpha_over(dst, rgba, x, y):
    """Draw an RGBA sprite (BGRA) onto dst (BGR) with its top-left at x, y."""
    h, w = rgba.shape[:2]
    x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + w, dst.shape[1]), min(y + h, dst.shape[0])
    if x1 <= x0 or y1 <= y0:
        return
    s = rgba[y0 - y:y1 - y, x0 - x:x1 - x].astype(np.float32)
    a = s[..., 3:4] / 255.0
    dst[y0:y1, x0:x1] = (s[..., :3] * a + dst[y0:y1, x0:x1].astype(np.float32) * (1 - a)).astype(np.uint8)


def draw_sleeve(dst, lay, side):
    s = lay['sleeve'][side]
    c = lay['sleeve']['colors']
    hexbgr = lambda h: tuple(int(h[i:i + 2], 16) for i in (5, 3, 1))
    w0 = np.array(s['wrist'], np.float32)
    a = np.radians(s['angle'])
    ax, nm = np.array([np.cos(a), np.sin(a)], np.float32), np.array([-np.sin(a), np.cos(a)], np.float32)
    L = lay['sleeve']['length']
    h0, h1 = s['halfWidthAtWrist'], s['halfWidthAtWrist'] + s['spread'] * L
    quad = np.array([w0 + nm * h0, w0 - nm * h0, w0 + ax * L - nm * h1, w0 + ax * L + nm * h1])
    cv2.fillPoly(dst, [np.round(quad).astype(np.int32)], hexbgr(c['redDark']))
    inner = np.array([w0 + nm * (h0 - 9), w0 - nm * (h0 - 9), w0 + ax * L - nm * (h1 - 9), w0 + ax * L + nm * (h1 - 9)])
    cv2.fillPoly(dst, [np.round(inner).astype(np.int32)], hexbgr(c['red']))
    for t in lay['sleeve']['stripeAt']:
        p = w0 + ax * (L * t * 2.2)
        hw = h0 + s['spread'] * (L * t * 2.2)
        cv2.line(dst, tuple(np.round(p + nm * hw).astype(int)), tuple(np.round(p - nm * hw).astype(int)), hexbgr(c['stripe']), 9)
    cv2.polylines(dst, [np.round(quad).astype(np.int32)], True, hexbgr(c['outline']), 3)


def composite(layout, img, sprites, meta, with_sleeves=True):
    out = img.copy()
    if with_sleeves:
        for side in ('L', 'R'):
            draw_sleeve(out, layout, side)
    for side in ('L', 'R'):
        alpha_over(out, sprites[side], meta[side][0], meta[side][1])
    return out


if __name__ == '__main__':
    S0, img, sprites, meta, info = make_all()
    print('background written', info)
    print('hand boxes', meta)
    extra = {'stackBase': stack_base(img), 'sleeve': sleeve_layout()}
    layout = write_layout(S0, meta, extra)
    print('stackBase', layout['board']['stackBase'])
    cv2.imwrite(os.path.join(DBG, 'bgclean_clean.png'), img)
    cv2.imwrite(os.path.join(DBG, 'bgclean_composite.png'), composite(layout, img, sprites, meta))
    cv2.imwrite(os.path.join(DBG, 'bgclean_ref.png'), S0.im)
