"""Link per-frame detections into tracks (pitch metres), per team, with Hungarian matching.

Gating: 3.2 m per 0.25 s step (~13 m/s) plus 1.5 m per missed step; tracks survive up to
6 missed steps (1.5 s). Identities are anonymous track ids; mapping to roles is a separate,
documented manual step.
"""
import json, sys
import numpy as np
from scipy.optimize import linear_sum_assignment

def run(det_path, out_path, gate=3.2, miss_max=6):
    D = json.load(open(det_path))
    tracks, nxt = [], {'att': 0, 'def': 0}
    for k, fr in enumerate(D['frames']):
        for team in ('att', 'def'):
            dets = [d for d in fr['detections'] if d['team'] == team]
            live = [t for t in tracks if t['team'] == team and k - t['last'] <= miss_max]
            C = np.full((len(live), len(dets)), 1e6)
            for i, t in enumerate(live):
                p = np.array(t['pts'][-1][1:3]); v = np.array(t.get('vel', [0, 0]))
                pred = p + v * (k - t['last'])
                g = gate + 1.5 * (k - t['last'] - 1)
                for j, d in enumerate(dets):
                    dist = np.linalg.norm(pred - np.array(d['pitch']))
                    if dist < g: C[i, j] = dist
            used = set()
            if len(live) and len(dets):
                r, c = linear_sum_assignment(C)
                for i, j in zip(r, c):
                    if C[i, j] < 1e5:
                        t = live[i]; d = dets[j]
                        prev = np.array(t['pts'][-1][1:3]); steps = k - t['last']
                        t['vel'] = ((np.array(d['pitch']) - prev) / steps * 0.5 + np.array(t.get('vel', [0, 0])) * 0.5).tolist()
                        t['pts'].append([k, *d['pitch'], d['bbox']]); t['last'] = k; used.add(j)
            for j, d in enumerate(dets):
                if j in used: continue
                tid = f"{team[0].upper()}{nxt[team]:02d}"; nxt[team] += 1
                tracks.append({'id': tid, 'team': team, 'first': k, 'last': k, 'pts': [[k, *d['pitch'], d['bbox']]]})
    for t in tracks: t.pop('vel', None)
    out = {'source': D['source'], 'step': 0.25, 'frames': [{'k': k, 'file': f['file'], 'matchClock': f['matchClock']} for k, f in enumerate(D['frames'])], 'tracks': tracks}
    json.dump(out, open(out_path, 'w'))
    long = [t for t in tracks if len(t['pts']) >= 8]
    print(f"{len(tracks)} tracks, {len(long)} with >= 8 points (2 s)")
    for t in sorted(long, key=lambda t: t['first']):
        a, b = t['pts'][0], t['pts'][-1]
        print(t['id'], f"k {t['first']}-{t['last']}", len(t['pts']), f"({a[1]:.0f},{a[2]:.0f})->({b[1]:.0f},{b[2]:.0f})")

if __name__ == '__main__':
    run(*sys.argv[1:3])
