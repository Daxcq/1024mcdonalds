import cv2, numpy as np, sys

def exemplar_fill(img, mask, patch=9, search=90, seed=0):
    """Criminisi-lite: repeatedly fill the most-constrained masked pixel from the best matching clean patch."""
    rng = np.random.default_rng(seed)
    H, W = mask.shape
    half = patch // 2
    work = img.astype(np.float32).copy()
    known = ~mask
    # 预计算所有干净 patch 的中心
    # 只对洞附近 ±search 的干净块搜索，提速
    ys, xs = np.where(mask)
    if len(xs) == 0: return work.astype(np.uint8)
    y0, y1 = max(half, ys.min()-search), min(H-half, ys.max()+search+1)
    x0, x1 = max(half, xs.min()-search), min(W-half, xs.max()+search+1)
    cand = [(y, x) for y in range(y0, y1, 3) for x in range(x0, x1, 3) if known[y, x]]
    cand = np.array(cand)
    if len(cand) == 0: return work.astype(np.uint8)
    # 按“已填充邻居数”降序逐个填
    order = list(zip(ys, xs))
    order.sort(key=lambda p: -np.count_nonzero(known[max(0,p[0]-3):p[0]+4, max(0,p[1]-3):p[1]+4]))
    for (y, x) in order:
        if known[y, x]: continue
        # 目标块已知像素
        ty0, ty1 = y-half, y+half+1
        tx0, tx1 = x-half, x+half+1
        if ty0 < 0 or tx0 < 0 or ty1 > H or tx1 > W: 
            work[y,x] = np.array([180,200,220],np.float32); known[y,x]=True; continue
        tgt = work[ty0:ty1, tx0:tx1]
        tknown = known[ty0:ty1, tx0:tx1]
        if tknown.sum() < 6:
            work[y,x] = tgt[tknown].mean(0); known[y,x] = True; continue
        # 在候选里做块匹配
        best, bd = None, 1e18
        for (cy, cx) in cand:
            sy0, sy1 = cy-half, cy+half+1
            sx0, sx1 = cx-half, cx+half+1
            if sy0 < 0 or sx0 < 0 or sy1 > H or sx1 > W: continue
            if not known[sy0:sy1, sx0:sx1].all(): continue
            d = ((work[sy0:sy1, sx0:sx1] - tgt)[tknown]**2).mean()
            if d < bd: bd, best = d, (sy0, sx0)
        if best is None:
            work[y,x] = tgt[tknown].mean(0)
        else:
            work[y,x] = work[best[0]+half, best[1]+half]
        known[y,x] = True
    return work.clip(0,255).astype(np.uint8)
