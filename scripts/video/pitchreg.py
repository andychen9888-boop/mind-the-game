"""Broadcast-frame → pitch registration for Mind the Game (research tooling, optional deps).

Requires numpy, opencv-python-headless, scipy (install in a private venv; not project deps).
Pitch model: 105 x 68 m (assumed standard size). Pitch coordinates: X metres from the left goal line (attacking team plays to the right, X=105),
Y metres from the FAR touchline (top of the broadcast image).

Method: a few hand-picked landmark correspondences give an initial homography; it is then refined
by aligning every projected pitch marking with white line pixels (truncated distance transform).
The result is an estimate. Residuals are reported so each frame can be judged.
"""
import json, sys
import numpy as np, cv2
from scipy.optimize import least_squares

L, W = 105.0, 68.0
BOX_D, BOX_W = 16.5, 40.32
SIX_D, SIX_W = 5.5, 18.32
R = 9.15
SPOT = 11.0

def _seg(a, b, n=None):
    a, b = np.array(a, float), np.array(b, float)
    n = n or max(2, int(np.linalg.norm(b - a) / 0.5))
    t = np.linspace(0, 1, n)[:, None]
    return a + (b - a) * t

def _arc(c, r, t0, t1, n=None):
    n = n or max(4, int(abs(t1 - t0) * r / 0.5))
    t = np.linspace(t0, t1, n)
    return np.stack([c[0] + r * np.cos(t), c[1] + r * np.sin(t)], 1)

def pitch_model(L=105.0, W=68.0):
    """Sampled pitch markings for an L x W pitch, each tagged with a name."""
    m = {}
    m['touch_far'] = _seg((0, 0), (L, 0)); m['touch_near'] = _seg((0, W), (L, W))
    m['goal_left'] = _seg((0, 0), (0, W)); m['goal_right'] = _seg((L, 0), (L, W))
    m['halfway'] = _seg((L / 2, 0), (L / 2, W))
    m['centre_circle'] = _arc((L / 2, W / 2), R, 0, 2 * np.pi)
    for side, x0, s in (('left', 0, 1), ('right', L, -1)):
        y0, y1 = W / 2 - BOX_W / 2, W / 2 + BOX_W / 2
        xb = x0 + s * BOX_D
        m[f'box_{side}'] = np.vstack([_seg((x0, y0), (xb, y0)), _seg((xb, y0), (xb, y1)), _seg((xb, y1), (x0, y1))])
        y0, y1 = W / 2 - SIX_W / 2, W / 2 + SIX_W / 2
        xs = x0 + s * SIX_D
        m[f'six_{side}'] = np.vstack([_seg((x0, y0), (xs, y0)), _seg((xs, y0), (xs, y1)), _seg((xs, y1), (x0, y1))])
        spot = (x0 + s * SPOT, W / 2)
        half = np.arccos((BOX_D - SPOT) / R)
        base = 0.0 if s == 1 else np.pi
        m[f'd_{side}'] = _arc(spot, R, base - half, base + half)
    return m

def project(H, pts):
    p = np.hstack([pts, np.ones((len(pts), 1))]) @ H.T
    return p[:, :2] / p[:, 2:3]

def white_line_mask(img, field_top=150, field_bottom=None):
    """Thin, bright, low-saturation ridges on grass; player-shaped blobs removed."""
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    s = hsv[..., 1].astype(np.int16)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.int16)
    ridge = gray - cv2.medianBlur(gray.astype(np.uint8), 21).astype(np.int16)
    mask = ((ridge > 10) & (s < 110)).astype(np.uint8)
    green = cv2.inRange(hsv, (30, 40, 40), (90, 255, 255))
    green = cv2.dilate(green, np.ones((31, 31), np.uint8))
    mask &= (green > 0).astype(np.uint8)
    mask[:field_top] = 0
    if field_bottom: mask[field_bottom:] = 0
    # Players: dilate kit-coloured blobs and remove them from the line mask.
    white_kit = ((hsv[..., 2] > 170) & (s < 45)).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(white_kit, 8)
    players = np.zeros_like(mask)
    for i in range(1, n):
        x, y, w, h, a = st[i]
        if a > 80 and h > 18 and w < 70 and h < 200 and a / (w * h) > 0.25:
            players[lab == i] = 1
    players = cv2.dilate(players, np.ones((15, 15), np.uint8))
    mask[players > 0] = 0
    n, lab, st, _ = cv2.connectedComponentsWithStats(mask, 8)
    keep = np.zeros(n, bool)
    for i in range(1, n):
        x, y, w, h, a = st[i]
        keep[i] = a >= 12 and max(w, h) >= 12
    return keep[lab].astype(np.uint8)

def register(img, init_pairs, field_top=150, field_bottom=None, trunc=12.0, fit_size=False, size=(105.0, 68.0)):
    """init_pairs: list of [[X,Y],[u,v]]. Returns (H, report)."""
    src = np.array([p[0] for p in init_pairs], float); dst = np.array([p[1] for p in init_pairs], float)
    H0, _ = cv2.findHomography(src, dst, 0)
    mask = white_line_mask(img, field_top, field_bottom)
    dt = cv2.distanceTransform((1 - mask).astype(np.uint8), cv2.DIST_L2, 3)
    h, w = mask.shape
    TR = [trunc]
    NPAD = len(np.vstack(list(pitch_model(130, 90).values())))
    def params(H): Hn = H / H[2, 2]; return Hn.ravel()[:8]
    def unpack(p): return np.append(p[:8], 1).reshape(3, 3)
    def model_for(p): return np.vstack(list(pitch_model(*(p[8:10] if fit_size else size)).values()))
    def residuals(p):
        H = unpack(p)
        model = model_for(p)
        uv = project(H, model)
        ok = (uv[:, 0] > 2) & (uv[:, 0] < w - 3) & (uv[:, 1] > field_top + 2) & (uv[:, 1] < (field_bottom or h) - 3)
        r = np.full(len(model), 0.0)
        if ok.sum():
            u, v = uv[ok, 0], uv[ok, 1]
            d = cv2.remap(dt, u.astype(np.float32).reshape(-1, 1), v.astype(np.float32).reshape(-1, 1), cv2.INTER_LINEAR).ravel()
            r[ok] = np.minimum(d, TR[0])
        anchor = (project(H, src) - dst).ravel() * 0.2  # weak pull toward the hand-picked points
        r = np.concatenate([r, np.zeros(max(0, NPAD - len(r)))])[:NPAD]  # fixed length when L, W vary
        return np.concatenate([r, anchor])
    x0 = np.concatenate([params(H0), size]) if fit_size else params(H0)
    # coarse-to-fine: wide truncation first so far-off markings still pull, then tight
    for tr, fs in ((60.0, 15.0), (25.0, 6.0), (trunc, 3.0)):
        TR[0] = tr
        sol = least_squares(residuals, x0, loss='soft_l1', f_scale=fs, x_scale='jac', max_nfev=3000)
        x0 = sol.x
    H = unpack(sol.x)
    model = model_for(sol.x)
    uv = project(H, model)
    ok = (uv[:, 0] > 2) & (uv[:, 0] < w - 3) & (uv[:, 1] > field_top + 2) & (uv[:, 1] < (field_bottom or h) - 3)
    d = cv2.remap(dt, uv[ok, 0].astype(np.float32).reshape(-1, 1), uv[ok, 1].astype(np.float32).reshape(-1, 1), cv2.INTER_LINEAR).ravel()
    rep = {'visibleModelPoints': int(ok.sum()), 'medianLineDistPx': float(np.median(d)) if len(d) else None,
           'shareWithin3px': float((d < 3).mean()) if len(d) else None,
           'anchorErrPx': [float(e) for e in np.linalg.norm(project(H, src) - dst, axis=1)], 'size': [float(v) for v in (sol.x[8:10] if fit_size else size)]}
    return H, rep, mask

def overlay(img, H, path, mask=None, size=(105.0, 68.0)):
    o = img.copy()
    if mask is not None: o[mask > 0] = (0, 0, 255)
    for name, pts in pitch_model(*size).items():
        uv = project(H, pts)
        for a, b in zip(uv[:-1], uv[1:]):
            if np.all(np.isfinite([*a, *b])) and np.linalg.norm(a - b) < 200:
                cv2.line(o, tuple(int(x) for x in a), tuple(int(x) for x in b), (0, 255, 255), 2)
    cv2.imwrite(path, o)

if __name__ == '__main__':
    cfg = json.load(open(sys.argv[1]))
    img = cv2.imread(cfg['frame'])
    H, rep, mask = register(img, cfg['pairs'], cfg.get('fieldTop', 150), cfg.get('fieldBottom'))
    overlay(img, H, cfg['overlay'], mask)
    print(json.dumps({'H': H.tolist(), **rep}, indent=1))
