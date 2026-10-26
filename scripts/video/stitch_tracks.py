"""Stitch broken tracks (occlusions) into chains: end of A -> start of B, same team,
gap <= 10 steps (2.5 s), distance <= 2.5 m + 2.2 m per step of gap, optimal assignment.
Manual overrides (forced / forbidden links) come from a JSON file and are recorded."""
import json, sys
import numpy as np
from scipy.optimize import linear_sum_assignment

def run(tracks_path, out_path, overrides_path=None, min_len=3):
    T = json.load(open(tracks_path))
    ov = json.load(open(overrides_path)) if overrides_path else {'force': [], 'forbid': []}
    tr = [t for t in T['tracks'] if len(t['pts']) >= min_len]
    ends = tr; starts = tr
    C = np.full((len(tr), len(tr)), 1e6)
    for i, a in enumerate(tr):
        for j, b in enumerate(tr):
            if a is b or a['team'] != b['team']: continue
            gap = b['first'] - a['last']
            if gap < 1 or gap > 10: continue
            d = np.linalg.norm(np.array(a['pts'][-1][1:3]) - np.array(b['pts'][0][1:3]))
            if d <= 2.5 + 2.2 * gap and [a['id'], b['id']] not in ov['forbid']: C[i, j] = d + 0.3 * gap
    ids = [t['id'] for t in tr]
    for a, b in ov['force']:
        if a in ids and b in ids: C[ids.index(a), :] = 1e6; C[:, ids.index(b)] = 1e6; C[ids.index(a), ids.index(b)] = -1
    r, c = linear_sum_assignment(C)
    nxt = {tr[i]['id']: tr[j]['id'] for i, j in zip(r, c) if C[i, j] < 1e5}
    has_prev = set(nxt.values())
    chains = []
    for t in tr:
        if t['id'] in has_prev: continue
        chain = [t['id']]
        while chain[-1] in nxt: chain.append(nxt[chain[-1]])
        chains.append(chain)
    byid = {t['id']: t for t in tr}
    out = []
    for ch in chains:
        pts = [p for tid in ch for p in byid[tid]['pts']]
        out.append({'id': '+'.join(ch), 'team': byid[ch[0]]['team'], 'first': pts[0][0], 'last': pts[-1][0], 'pts': pts})
    T2 = {**T, 'tracks': out, 'stitch': {'links': nxt, 'overrides': ov}}
    json.dump(T2, open(out_path, 'w'))
    for t in sorted(out, key=lambda t: (t['team'], t['first'])):
        if len(t['pts']) >= 6: print(t['team'], t['id'], f"k{t['first']}-{t['last']}", len(t['pts']))

if __name__ == '__main__':
    run(*sys.argv[1:4]) if len(sys.argv) > 3 else run(*sys.argv[1:3])
