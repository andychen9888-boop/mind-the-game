"""Propagate the frame→pitch registration through a broadcast clip.

frame k: H_k ≈ H_{k-1} composed with the inter-frame homography (ORB + RANSAC on the whole image,
broadcast graphics masked), then refined against the pitch markings (pitchreg.register).
Output: JSON with, per frame, recording time, match clock, H (pitch metres → image px) and fit stats.
"""
import json, sys, glob, os
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(__file__))
from pitchreg import register, project, overlay

def feature_mask(shape, cfg):
    m = np.full(shape[:2], 255, np.uint8)
    for x0, y0, x1, y1 in cfg.get('graphicBoxes', []):
        m[y0:y1, x0:x1] = 0
    return m

def inter_homography(a, b, mask):
    orb = cv2.ORB_create(4000)
    ka, da = orb.detectAndCompute(cv2.cvtColor(a, cv2.COLOR_BGR2GRAY), mask)
    kb, db = orb.detectAndCompute(cv2.cvtColor(b, cv2.COLOR_BGR2GRAY), mask)
    mt = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(da, db)
    pa = np.float32([ka[m.queryIdx].pt for m in mt]); pb = np.float32([kb[m.trainIdx].pt for m in mt])
    G, inl = cv2.findHomography(pa, pb, cv2.RANSAC, 3.0)
    return G, int(inl.sum()) if inl is not None else 0

def main(cfg_path):
    cfg = json.load(open(cfg_path))
    frames = sorted(glob.glob(os.path.join(cfg['frameDir'], 'f_*.png')))
    out, H, prev = [], None, None
    model_pairs = cfg['initPairs']
    for i, f in enumerate(frames):
        t = cfg['t0'] + i * cfg['step']
        img = cv2.imread(f)
        bottom = cfg['fieldBottomUntil'][1] if t < cfg['fieldBottomUntil'][0] else None
        if H is None:
            H, rep, _ = register(img, model_pairs, cfg.get('fieldTop', 150), bottom)
            inl = None
        else:
            G, inl = inter_homography(prev, img, feature_mask(img.shape, cfg))
            Hp = G @ H
            # synthetic correspondences from the propagated estimate seed the refinement
            grid = np.array([[x, y] for x in np.linspace(0, 105, 15) for y in np.linspace(0, 68, 9)])
            uv = project(Hp, grid)
            h, w = img.shape[:2]
            ok = (uv[:, 0] > 0) & (uv[:, 0] < w) & (uv[:, 1] > 160) & (uv[:, 1] < (bottom or h))
            pairs = [[g.tolist(), u.tolist()] for g, u in zip(grid[ok], uv[ok])]
            H, rep, _ = register(img, pairs, cfg.get('fieldTop', 150), bottom)
        H = H / H[2, 2]
        out.append({'file': os.path.basename(f), 't': round(t, 3), 'matchClock': round(t + cfg['clockOffset'], 2),
                    'H': H.tolist(), 'orbInliers': inl, 'medianLineDistPx': rep['medianLineDistPx'], 'shareWithin3px': rep['shareWithin3px'],
                    'visibleModelPoints': rep['visibleModelPoints']})
        if cfg.get('overlayEvery') and i % cfg['overlayEvery'] == 0:
            overlay(img, H, os.path.join(cfg['overlayDir'], f'ov_{i:03d}.jpg'))
        print(f"{i:3d} t={t:6.2f} clock={t + cfg['clockOffset']:.2f} med={rep['medianLineDistPx']:.1f}px within3={rep['shareWithin3px']:.2f} pts={rep['visibleModelPoints']} orb={inl}", flush=True)
        prev = img
    json.dump({'source': cfg['source'], 'pitch': [105, 68], 'clockOffset': cfg['clockOffset'], 'frames': out}, open(cfg['out'], 'w'), indent=1)

if __name__ == '__main__':
    main(sys.argv[1])
