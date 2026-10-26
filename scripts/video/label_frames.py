"""Draw track ids on the video frames (for manual role mapping)."""
import json, sys, os
import numpy as np, cv2

def run(tracks_path, frame_dir, ks, out, crop=None):
    T = json.load(open(tracks_path))
    tiles = []
    for k in ks:
        img = cv2.imread(os.path.join(frame_dir, T['frames'][k]['file']))
        for t in T['tracks']:
            for p in t['pts']:
                if p[0] == k:
                    x, y, w, h = p[3]
                    col = (255, 120, 40) if t['team'] == 'att' else (255, 255, 255)
                    cv2.rectangle(img, (x, y), (x + w, y + h), col, 2)
                    cv2.putText(img, t['id'], (x - 4, y - 6), 0, 0.9, (0, 255, 255), 2)
        cv2.putText(img, f"17:{T['frames'][k]['matchClock'] - 1020:05.2f}", (30, 230), 0, 1.6, (0, 255, 255), 4)
        if crop: x0, y0, x1, y1 = crop; img = img[y0:y1, x0:x1]
        tiles.append(cv2.resize(img, (1000, int(1000 * img.shape[0] / img.shape[1]))))
    while len(tiles) % 2: tiles.append(np.zeros_like(tiles[0]))
    cv2.imwrite(out, np.vstack([np.hstack(tiles[i:i + 2]) for i in range(0, len(tiles), 2)]))

if __name__ == '__main__':
    run(sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3].split(',')], sys.argv[4], [int(v) for v in sys.argv[5].split(',')] if len(sys.argv) > 5 else None)
