"""Procedural cutting board in the style of kitchen_ref.png (orange wood top face, darker front face,
dark outline, soft contact shadow). Everything is in scene pixels (1536x1024)."""
import cv2
import numpy as np

# wood top face corners: TL, TR, BR, BL.  The right edge follows the measured line x = 0.2545*y + 891.1
TOP = [(574, 686), (1066, 686), (1127, 925), (480, 925)]
FRONT_H = 31                 # visible front face below the top face
CORNER_R = 11                # rounded corners
OUT_W = 3                    # outline width

# palette sampled from the reference
C_TOP = (236, 143, 62)       # RGB
C_TOP_LIGHT = (244, 160, 76)
C_TOP_DARK = (196, 98, 46)
C_TOP_DEEP = (173, 82, 43)
C_EDGE_LIGHT = (246, 170, 88)
C_FRONT = (170, 79, 40)
C_FRONT_DARK = (146, 65, 39)
C_OUT = (44, 26, 20)
C_OUT_FRONT = (96, 49, 36)


def rgb2bgr(c):
    return (c[2], c[1], c[0])


def rounded_poly(pts, r, n=6):
    """Polygon with rounded corners -> float (N,2) array."""
    pts = [np.array(p, np.float32) for p in pts]
    out = []
    for i, p in enumerate(pts):
        a, b = pts[i - 1], pts[(i + 1) % len(pts)]
        da, db = a - p, b - p
        la, lb = np.linalg.norm(da), np.linalg.norm(db)
        rr = min(r, la / 2, lb / 2)
        p0, p1 = p + da / la * rr, p + db / lb * rr
        for t in np.linspace(0, 1, n):
            out.append((1 - t) ** 2 * p0 + 2 * t * (1 - t) * p + t ** 2 * p1)
    return np.array(out, np.float32)


def poly_mask(shape, poly):
    m = np.zeros(shape, np.uint8)
    cv2.fillPoly(m, [np.round(poly).astype(np.int32)], 1)
    return m


def front_poly():
    (_, _), (_, _), br, bl = TOP
    y0, y1 = TOP[2][1] - 1, TOP[2][1] + FRONT_H
    return [(bl[0] + 2, y0), (br[0] - 2, y0), (br[0] - 5, y1), (bl[0] + 3, y1)]


def grain(shape, mask, rng, base, light, dark, deep, density=1.0):
    """Horizontal wood streaks inside mask. Returns float RGB image."""
    h, w = shape
    img = np.zeros((h, w, 3), np.float32)
    img[:] = base
    ys, xs = np.where(mask > 0)
    y_min, y_max, x_min, x_max = ys.min(), ys.max(), xs.min(), xs.max()
    # large soft tonal bands (posterised below): the planks of light/dark wood
    band = np.zeros((h, w), np.float32)
    y = y_min
    while y < y_max:
        th = int(rng.integers(5, 15))
        band[y:y + th] = rng.choice([-1.0, -0.4, 0.0, 0.0, 0.5, 1.0])
        y += th
    img += band[..., None] * np.array([9, 9, 5], np.float32)
    # streaks
    n = int((y_max - y_min) * 2.6 * density)
    for _ in range(n):
        yy = int(rng.integers(y_min, y_max))
        x0 = int(rng.integers(x_min - 40, x_max))
        ln = int(rng.integers(36, 300))
        th = int(rng.integers(1, 4))
        r = rng.random()
        col = light if r < 0.45 else dark if r < 0.88 else deep
        a = 0.55 if col is not deep else 0.85
        sl = (slice(yy, yy + th), slice(max(x0, 0), min(x0 + ln, w)))
        img[sl] = img[sl] * (1 - a) + np.array(col, np.float32) * a
    return img


def draw_board(bg, seed=11):
    """Draw the board onto bg (HxWx3 uint8 BGR), returns (bg, info)."""
    rng = np.random.default_rng(seed)
    H, W = bg.shape[:2]
    out = bg.astype(np.float32)

    top_poly = rounded_poly(TOP, CORNER_R)
    fr_poly = rounded_poly(front_poly(), 6)
    top_m = poly_mask((H, W), top_poly)
    fr_m = poly_mask((H, W), fr_poly)
    all_m = ((top_m | fr_m) > 0).astype(np.uint8)

    # ---- contact shadow: soft dark band under / right of the board, multiplied onto the counter
    sh = np.zeros((H, W), np.float32)
    shadow_poly = rounded_poly([(TOP[0][0] + 10, TOP[0][1] + 18), (TOP[1][0] + 26, TOP[1][1] + 18),
                                (TOP[2][0] + 34, TOP[2][1] + FRONT_H + 20), (TOP[3][0] - 8, TOP[3][1] + FRONT_H + 20)], 14)
    cv2.fillPoly(sh, [np.round(shadow_poly).astype(np.int32)], 1.0)
    sh = cv2.GaussianBlur(sh, (0, 0), 9.0) * 0.46
    sh *= (1 - all_m)
    out *= (1 - sh[..., None] * np.array([0.85, 0.80, 0.70], np.float32))     # BGR: a warm brown shadow

    # ---- top face
    top_img = grain((H, W), top_m, rng, C_TOP, C_TOP_LIGHT, C_TOP_DARK, C_TOP_DEEP)
    top_img = np.round(top_img / 6.0) * 6.0                                    # posterise like the reference
    # perspective shading: a bit lighter towards the back (top), darker towards the viewer
    ys = np.arange(H, dtype=np.float32)[:, None]
    shade = 1.0 + 0.045 * (1 - (ys - TOP[0][1]) / (TOP[2][1] - TOP[0][1]))
    top_img *= np.clip(shade, 0.95, 1.06)[..., None]
    # ---- front face
    fr_img = grain((H, W), fr_m, rng, C_FRONT, C_FRONT_DARK, C_FRONT_DARK, C_FRONT_DARK, density=0.35)
    fr_img = np.round(fr_img / 6.0) * 6.0

    bgr = lambda im: im[..., ::-1]
    out = np.where(fr_m[..., None] > 0, bgr(fr_img), out)
    out = np.where(top_m[..., None] > 0, bgr(top_img), out)

    # ---- light edge line where the top face meets the front face + faint top-left highlight
    edge_y = TOP[2][1]
    cv2.line(out, (TOP[3][0] + 8, edge_y), (TOP[2][0] - 8, edge_y), rgb2bgr(C_EDGE_LIGHT), 2, cv2.LINE_8)
    cv2.line(out, (TOP[3][0] + 10, edge_y + 2), (TOP[2][0] - 10, edge_y + 2), rgb2bgr(C_FRONT_DARK), 1, cv2.LINE_8)

    # ---- outline: dark brown 3 px around the whole board, lighter brown on the bottom edge like the reference
    cnts, _ = cv2.findContours(all_m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    ring = np.zeros((H, W), np.uint8)
    cv2.drawContours(ring, cnts, -1, 1, OUT_W * 2)
    ring &= (1 - cv2.erode(all_m, np.ones((3, 3), np.uint8)) * 0).astype(np.uint8)
    ring = (ring > 0) & (cv2.dilate(all_m, np.ones((3, 3), np.uint8)) > 0)
    low = (np.arange(H)[:, None] > TOP[2][1] + FRONT_H - 6) & ring
    out[ring] = rgb2bgr(C_OUT)
    out[low] = rgb2bgr(C_OUT_FRONT)
    info = {'top_mask_px': int(top_m.sum()), 'front_mask_px': int(fr_m.sum())}
    return np.clip(out, 0, 255).astype(np.uint8), info
