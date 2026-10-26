"""Steel-counter synthesis for the holes left after removing hands, sleeves, bun and burger."""
import cv2
import numpy as np

# regions that must never feed the fill: bins row, bottles, left bun tray, right tray
EXCLUDE = [(0, 380, 770, 604), (1224, 270, 1462, 590), (0, 586, 388, 872), (1436, 505, 1536, 705)]


def counter_sources(S, hole):
    """Clean, warm-steel pixels only (no saturated food/bottle colours, no black outlines)."""
    src = (hole == 0) & (S.sat < 0.66) & (S.hue >= 8) & (S.hue <= 48) & (S.val > 0.40)
    src[:368] = False
    for x0, y0, x1, y1 in EXCLUDE:
        src[y0:y1, x0:x1] = False
    near_hole = cv2.dilate(hole, np.ones((9, 9), np.uint8)) > 0       # fringe / outlines of removed things
    return src & ~near_hole


def pushpull(img, w):
    """Smooth membrane interpolation of img (HxWx3 float) from pixels with weight w (HxW 0/1)."""
    cur_i, cur_w, stack = img * w[..., None], w.astype(np.float32), []
    while min(cur_i.shape[:2]) > 3:
        stack.append((cur_i, cur_w))
        size = (cur_i.shape[1] // 2, cur_i.shape[0] // 2)
        cur_i = cv2.resize(cur_i, size, interpolation=cv2.INTER_AREA)
        cur_w = cv2.resize(cur_w, size, interpolation=cv2.INTER_AREA)
    est = cur_i / np.maximum(cur_w[..., None], 1e-6)
    for i_l, w_l in reversed(stack):
        up = cv2.resize(est, (i_l.shape[1], i_l.shape[0]), interpolation=cv2.INTER_LINEAR)
        conf = np.clip(w_l * 6.0, 0, 1)[..., None]
        est = (i_l / np.maximum(w_l[..., None], 1e-6)) * conf + up * (1 - conf)
    return est


def band_profile(S, src, side, y0, y1):
    """Row-wise median colour (per row) of source pixels on the left/right side -> (rows, 3) or NaN."""
    out = np.full((y1 - y0, 3), np.nan, np.float32)
    for y in range(y0, y1):
        xs = np.where(src[y, :768 if side == 'L' else 1100])[0] if side == 'L' else np.where(src[y, 1100:])[0] + 1100
        if len(xs) > 6:
            xs = xs[-60:] if side == 'L' else xs[:60]
            out[y - y0] = np.median(S.im[y, xs].astype(np.float32), axis=0)
    return out


def blocky_noise(shape, scale, rng):
    h, w = shape
    n = rng.normal(0, 1, (h // scale + 2, w // scale + 2)).astype(np.float32)
    n = cv2.resize(n, (w + scale * 2, h + scale * 2), interpolation=cv2.INTER_NEAREST)
    ox, oy = int(rng.integers(0, scale)), int(rng.integers(0, scale))
    return n[oy:oy + h, ox:ox + w]


def add_texture(img, alpha, rng, step=5.0):
    """Posterised tonal patches + brushed-steel streaks, only where alpha > 0 (alpha float HxW)."""
    h, w = alpha.shape
    tone = blocky_noise((h, w), 26, rng) * 4.5 + blocky_noise((h, w), 10, rng) * 2.6
    streak = np.zeros((h, w), np.float32)
    ys, xs = np.where(alpha > 0.9)
    for _ in range(260):
        k = int(rng.integers(0, len(ys)))
        y, x, ln = int(ys[k]), int(xs[k]), int(rng.integers(30, 230))
        streak[y:y + int(rng.integers(1, 3)), x:x + ln] += float(rng.choice([-7, -5, 6, 9, 12]))
    out = img + (tone + streak)[..., None]
    out = np.round(out / step) * step                     # flat tonal patches like the reference
    return img * (1 - alpha[..., None]) + out * alpha[..., None]


def despeckle(img, area_max=80, extra=((740, 396, 800, 606),)):
    """Remove tiny dark specks left on the counter (never touches bins, bottles or trays)."""
    h, w = img.shape[:2]
    ok = np.zeros((h, w), bool)
    ok[366:, 776:1224] = True
    ok[604:, :] = True
    for x0, y0, x1, y1 in [(0, 590, 392, 872), (1436, 505, 1536, 705), (1224, 270, 1462, 604)]:
        ok[y0:y1, x0:x1] = False
    for x0, y0, x1, y1 in extra:        # the pickle-bin wall under the old bun: thin vertical line stays, specks go
        ok[y0:y1, x0:x1] = True
    lum = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    dark = ((lum < 120) & ok).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(dark, connectivity=8)
    spk = np.zeros((h, w), np.uint8)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] <= area_max and st[i, cv2.CC_STAT_HEIGHT] < 40:
            spk[lab == i] = 255
    if spk.any():
        img = cv2.inpaint(img, cv2.dilate(spk, np.ones((5, 5), np.uint8)), 4, cv2.INPAINT_TELEA)
    return img, int((spk > 0).sum())


def fill_counter(S, hole, seed=7):
    rng = np.random.default_rng(seed)
    src = counter_sources(S, hole).astype(np.float32)
    base = pushpull(S.im.astype(np.float32), src)
    fill = cv2.dilate(hole, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13))).astype(np.float32)
    alpha = cv2.GaussianBlur(fill, (0, 0), 3.0)
    alpha = np.where(hole > 0, 1.0, alpha).astype(np.float32)
    mixed = S.im.astype(np.float32) * (1 - alpha[..., None]) + base * alpha[..., None]
    textured = add_texture(mixed, alpha, rng)
    return np.clip(textured, 0, 255).astype(np.uint8), base
