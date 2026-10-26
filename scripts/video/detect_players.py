"""Detect players in calibrated broadcast frames and convert foot points to pitch metres.

Colour rules are tuned for one clip (defending team in white, attacking team in dark blue/claret,
referee in fluorescent yellow); adjust them for other footage. Output is a list of detections per frame; identities are NOT assigned here.
"""
import json, sys, os
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(__file__))
from pitchreg import project, white_line_mask

def field_mask(shape, H, top, bottom, margin=2.5):
    """Pixels whose back-projection lands on the pitch (works when corners are behind the camera)."""
    h, w = shape[:2]
    ys, xs = np.mgrid[0:h:4, 0:w:4]
    P = np.stack([xs.ravel(), ys.ravel(), np.ones(xs.size)], 1) @ np.linalg.inv(H).T
    ok = P[:, 2] > 0 if np.median(P[:, 2]) > 0 else P[:, 2] < 0
    X, Y = P[:, 0] / P[:, 2], P[:, 1] / P[:, 2]
    inside = ok & (X > -margin) & (X < 105 + margin) & (Y > -margin) & (Y < 68 + margin)
    m = cv2.resize(inside.reshape(ys.shape).astype(np.uint8), (w, h), interpolation=cv2.INTER_NEAREST)
    m[:top] = 0
    if bottom: m[bottom:] = 0
    return m

def classify(patch_hsv, _=None):
    """White-dominant = defending team (def label); coloured claret/blue = attacking team (att label); fluorescent = referee."""
    h, s, v = [patch_hsv[..., i].astype(int) for i in range(3)]
    n = max(1, len(h))
    white = ((v > 160) & (s < 55)).sum() / n
    yellow = ((h > 22) & (h < 40) & (s > 120) & (v > 150)).sum() / n
    claret = (((h < 10) | (h > 155)) & (s > 40) & (v > 40)).sum() / n
    blue = ((h > 100) & (h < 150) & (s > 30) & (v > 30) & (v < 190)).sum() / n
    if yellow > 0.18: return 'ref', yellow
    if white > 0.28 and white > claret + blue: return 'def', white
    if claret + blue > 0.15: return 'att', claret + blue
    return 'unknown', 0.0

def detect(img, H, top=150, bottom=None):
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    grass = cv2.inRange(hsv, (32, 45, 45), (88, 255, 255)) > 0
    fm = field_mask(img.shape, H, top, bottom) > 0
    lines = cv2.dilate(white_line_mask(img, top, bottom), np.ones((3, 3), np.uint8)) > 0
    fg = (~grass & fm & ~lines).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 11)))
    n, lab, st, _ = cv2.connectedComponentsWithStats(fg, 8)
    Hinv = np.linalg.inv(H)
    out = []
    for i in range(1, n):
        x, y, w, h, a = st[i]
        if a < 120 or h < 22 or h > 260 or w > 140 or w > 1.6 * h:
            continue
        ys, xs = np.nonzero(lab[y:y + h, x:x + w] == i)
        upper = ys < h * 0.65  # shirt/shorts region, not legs and boots
        team, score = classify(hsv[y:y + h, x:x + w][ys[upper], xs[upper]], None)
        foot = np.array([[x + w / 2, y + h - 1]], float)
        X, Y = project(Hinv, foot)[0]
        if not (-3 < X < 108 and -3 < Y < 71):
            continue
        out.append({'team': team, 'score': round(float(score), 2), 'bbox': [int(x), int(y), int(w), int(h)],
                    'foot': [round(float(foot[0, 0]), 1), round(float(foot[0, 1]), 1)], 'pitch': [round(float(X), 2), round(float(Y), 2)]})
    return out

def draw(img, dets, path):
    o = img.copy()
    col = {'att': (180, 60, 30), 'def': (255, 255, 255), 'ref': (0, 230, 255), 'unknown': (0, 0, 255)}
    for k, d in enumerate(dets):
        x, y, w, h = d['bbox']
        cv2.rectangle(o, (x, y), (x + w, y + h), col[d['team']], 2)
        cv2.putText(o, str(k), (x, y - 4), 0, 0.7, (0, 255, 255), 2)
    cv2.imwrite(path, o)

if __name__ == '__main__':
    cam_path, frame_dir, out_path = sys.argv[1:4]
    draw_dir = sys.argv[4] if len(sys.argv) > 4 else None
    cam = json.load(open(cam_path))
    res = []
    for k, fr in enumerate(cam['frames']):
        img = cv2.imread(os.path.join(frame_dir, fr['file']))
        bottom = 990 if fr['t'] < 0.8 else None
        dets = detect(img, np.array(fr['H']), 150, bottom)
        res.append({'file': fr['file'], 't': fr['t'], 'matchClock': fr['matchClock'], 'detections': dets})
        if draw_dir and k % 4 == 0: draw(img, dets, os.path.join(draw_dir, f'det_{k:03d}.jpg'))
        c = {t: sum(d['team'] == t for d in dets) for t in ('att', 'def', 'ref', 'unknown')}
        print(k, fr['matchClock'], c, flush=True)
    json.dump({'source': cam['source'], 'frames': res}, open(out_path, 'w'), indent=1)
