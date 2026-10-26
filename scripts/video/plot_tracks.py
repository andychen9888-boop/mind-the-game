"""Top-down plots of tracks at chosen frames (for manual role mapping and review)."""
import json, sys
import numpy as np, cv2

def pitch_canvas(scale=10, pad=30):
    W, H = int(105 * scale + 2 * pad), int(68 * scale + 2 * pad)
    img = np.full((H, W, 3), (60, 120, 60), np.uint8)
    P = lambda x, y: (int(pad + x * scale), int(pad + y * scale))
    c = (230, 230, 230)
    cv2.rectangle(img, P(0, 0), P(105, 68), c, 2); cv2.line(img, P(52.5, 0), P(52.5, 68), c, 2)
    cv2.circle(img, P(52.5, 34), int(9.15 * scale), c, 2)
    for x0, s in ((0, 1), (105, -1)):
        cv2.rectangle(img, P(x0, 13.84), P(x0 + s * 16.5, 54.16), c, 2); cv2.rectangle(img, P(x0, 24.84), P(x0 + s * 5.5, 43.16), c, 2)
    return img, P

def plot(tracks_path, ks, out, mapping=None):
    T = json.load(open(tracks_path))
    panels = []
    for k in ks:
        img, P = pitch_canvas()
        clock = T['frames'][k]['matchClock']
        for t in T['tracks']:
            pts = [p for p in t['pts'] if k - 8 <= p[0] <= k]
            if not pts or pts[-1][0] != k: continue
            col = (200, 80, 40) if t['team'] == 'att' else (250, 250, 250)
            for a, b in zip(pts[:-1], pts[1:]): cv2.line(img, P(*a[1:3]), P(*b[1:3]), col, 1)
            cv2.circle(img, P(*pts[-1][1:3]), 7, col, -1)
            label = (mapping or {}).get(t['id'], t['id'])
            cv2.putText(img, label, (P(*pts[-1][1:3])[0] + 8, P(*pts[-1][1:3])[1] - 6), 0, 0.5, (0, 255, 255), 1)
        cv2.putText(img, f"17:{clock - 1020:05.2f}", (40, 60), 0, 1, (0, 255, 255), 2)
        panels.append(img)
    while len(panels) % 2: panels.append(np.zeros_like(panels[0]))
    cv2.imwrite(out, np.vstack([np.hstack(panels[i:i + 2]) for i in range(0, len(panels), 2)]))

if __name__ == '__main__':
    plot(sys.argv[1], [int(x) for x in sys.argv[2].split(',')], sys.argv[3], json.load(open(sys.argv[4])) if len(sys.argv) > 4 else None)
