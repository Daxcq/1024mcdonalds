"""Cut the 52 ingredient sprites (I01..I52) and 20 burger sprites (B01..B20) out of the
transparent sheets in assets/fp_src, clean the alpha, trim, and write:

    assets/fp/ing/I01.png ... I52.png
    assets/fp/burger/B01.png ... B20.png
    js/fp_sprites.js          (window.FP_SPR = { I01: {w,h}, ... }  -- JS so it works from file://)
    tools/_debug/fp/contact_*.png  (contact sheets for eyeballing)

usage:  python3 -I tools/extract_fp_sprites.py
"""
import json
import os

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'fp_src')
OUT = os.path.join(ROOT, 'assets', 'fp')
DBG = os.path.join(ROOT, 'tools', '_debug', 'fp')

# file, id prefix, first number, items per row (row-major reading order)
SHEETS = [
    ('sheet_buns.png',         'I', 1,  [4, 4, 3]),
    ('sheet_patties.png',      'I', 12, [4, 4, 4]),
    ('sheet_cheese_veg.png',   'I', 24, [4, 4, 4, 4]),
    ('sheet_sauces.png',       'I', 40, [4, 4, 4, 1]),
    ('sheet_combos.png',       'B', 1,  [4, 4, 4]),
    ('sheet_combos_extra.png', 'B', 13, [4, 4]),
]

ALPHA_ON = 150          # pixels at least this opaque are "ink"; everything below is halo/noise
MERGE_PX = 17           # dilation radius used only to group the pieces of one item together
MIN_AREA = 1500         # ignore specks (area of the dilated group)


def clean_sheet(path, counts):
    im = np.array(Image.open(path).convert('RGBA'))
    a = im[..., 3]
    ink = (a >= ALPHA_ON).astype(np.uint8)
    # thin grid lines / hairlines (sauce sheet) vanish under a 5x5 opening, outlines (>=3px) survive
    ink = cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    want = sum(counts)
    # Grow the grouping radius until the group count matches; start large (keeps loose piles like
    # sesame / salt together) and shrink when neighbouring items touch each other.
    chosen = None
    for r in range(MERGE_PX, 2, -1):
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (r * 2 + 1, r * 2 + 1))
        grp = cv2.dilate(ink, k)
        n, lab, st, cen = cv2.connectedComponentsWithStats(grp, connectivity=8)
        groups = [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] >= MIN_AREA]
        if len(groups) == want:
            chosen = r
            break
    if chosen is None:
        # fall back to the largest radius and keep the biggest `want` groups
        r = MERGE_PX
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (r * 2 + 1, r * 2 + 1))
        grp = cv2.dilate(ink, k)
        n, lab, st, cen = cv2.connectedComponentsWithStats(grp, connectivity=8)
        groups = [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] >= MIN_AREA]
        groups.sort(key=lambda i: -st[i, cv2.CC_STAT_AREA])
        print('  !! %s: found %d groups, expected %d (no radius matched)' % (os.path.basename(path), len(groups), want))
        groups = groups[:want]
    else:
        print('  %s: grouping radius %d' % (os.path.basename(path), chosen))
    # reading order: split by rows using the expected counts
    groups.sort(key=lambda i: cen[i][1])
    ordered, p = [], 0
    for c in counts:
        row = sorted(groups[p:p + c], key=lambda i: cen[i][0])
        ordered += row
        p += c
    sprites = []
    for gi in ordered:
        sel = (lab == gi)
        px = sel & (ink > 0)
        ys, xs = np.where(px)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        crop = im[y0:y1, x0:x1].copy()
        m = px[y0:y1, x0:x1]
        crop[..., 3] = np.where(m, 255, 0).astype(np.uint8)
        crop[~m, :3] = 0
        sprites.append(crop)
    return sprites


def contact_sheet(items, name, cols=6, cell=190):
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * cell, rows * (cell + 20)), (96, 100, 108))
    d = ImageDraw.Draw(sheet)
    for i, (key, arr) in enumerate(items):
        im = Image.fromarray(arr)
        s = min((cell - 16) / im.width, (cell - 16) / im.height, 1.0)
        im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS)
        cx, cy = (i % cols) * cell, (i // cols) * (cell + 20)
        sheet.paste(im, (cx + (cell - im.width) // 2, cy + (cell - im.height) // 2), im)
        d.text((cx + 6, cy + cell), key, fill=(255, 255, 255))
    sheet.save(os.path.join(DBG, name))


def main():
    os.makedirs(os.path.join(OUT, 'ing'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'burger'), exist_ok=True)
    os.makedirs(DBG, exist_ok=True)
    manifest, ing_items, bur_items = {}, [], []
    for fn, pre, first, counts in SHEETS:
        sprites = clean_sheet(os.path.join(SRC, fn), counts)
        print('%-24s -> %d sprites' % (fn, len(sprites)))
        for j, arr in enumerate(sprites):
            key = '%s%02d' % (pre, first + j)
            sub = 'ing' if pre == 'I' else 'burger'
            Image.fromarray(arr).save(os.path.join(OUT, sub, key + '.png'), optimize=True)
            manifest[key] = {'w': int(arr.shape[1]), 'h': int(arr.shape[0])}
            (ing_items if pre == 'I' else bur_items).append((key, arr))
    contact_sheet(ing_items, 'contact_ing.png', cols=8)
    contact_sheet(bur_items, 'contact_burger.png', cols=5, cell=240)
    with open(os.path.join(ROOT, 'js', 'fp_sprites.js'), 'w', encoding='utf-8') as f:
        f.write('/* auto-generated by tools/extract_fp_sprites.py */\n')
        f.write('window.FP_SPR = ' + json.dumps(manifest, separators=(',', ':')) + ';\n')
    print('total', len(manifest))


if __name__ == '__main__':
    main()
