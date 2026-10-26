"""Turn tracks + the manual role mapping into per-role pitch positions every 0.5 s.

Per role and time: 'observed' (smoothed track sample), 'interpolated' (inside a gap of the role's
chain no longer than MAX_GAP seconds) or null (not observed). Coordinates are metres on a
105 x 68 pitch, then also given as the player's 0-100 drawing units.
"""
import json, sys
import numpy as np

MAX_GAP = 2.5

def run(tracks_path, mapping_path, camera_path, out_path, step=0.5):
    T = json.load(open(tracks_path)); M = json.load(open(mapping_path)); C = json.load(open(camera_path))
    byid = {t['id']: t for t in T['tracks']}
    clock = {f['k']: f['matchClock'] for f in T['frames']}
    t0, t1 = M['phases'][0]['start'], M['phases'][-1]['end']
    times = [round(t0 + i * step, 2) for i in range(int((t1 - t0) / step) + 1)]
    roles = {}
    for role, spec in M['roles'].items():
        samples = sorted({p[0]: p for tid in spec['chain'] for p in byid.get(tid, {'pts': []})['pts']}.values(), key=lambda p: p[0])
        manual = [m for m in M.get('manualPoints', {}).get('points', []) if m['role'] == role]
        if not samples and not manual:
            roles[role] = [None] * len(times); continue
        rows = [(clock[p[0]], p[1], p[2], 'observed') for p in samples]
        for m in manual:
            k = int(round((m['clock'] - C['frames'][0]['matchClock']) / 0.25)); H = np.array(C['frames'][k]['H'])
            v = np.linalg.inv(H) @ np.array([*m['px'], 1.0]); rows.append((m['clock'], v[0] / v[2], v[1] / v[2], 'manual'))
        rows.sort()
        ts = np.array([r[0] for r in rows]); xy = np.array([r[1:3] for r in rows], float); src = [r[3] for r in rows]
        # light smoothing (3-sample centred mean) against detection jitter
        if len(xy) >= 3:
            sm = xy.copy(); sm[1:-1] = (xy[:-2] + xy[1:-1] + xy[2:]) / 3; xy = sm
        out = []
        for t in times:
            j = np.searchsorted(ts, t)
            if j < len(ts) and abs(ts[j] - t) < 0.13:
                out.append({'xy': xy[j].round(2).tolist(), 'prov': src[j]})
            elif 0 < j < len(ts) and ts[j] - ts[j - 1] <= MAX_GAP:
                q = (t - ts[j - 1]) / (ts[j] - ts[j - 1])
                out.append({'xy': (xy[j - 1] + (xy[j] - xy[j - 1]) * q).round(2).tolist(), 'prov': 'interpolated'})
            elif j > 0 and t - ts[j - 1] < 0.13:
                out.append({'xy': xy[j - 1].round(2).tolist(), 'prov': src[j - 1]})
            else:
                out.append(None)
        roles[role] = out
    def at(role, t):
        i = int(round((t - t0) / step)); lo = roles[role][max(0, min(len(times) - 1, int(np.floor((t - t0) / step))))]
        hi = roles[role][max(0, min(len(times) - 1, int(np.ceil((t - t0) / step))))]
        if lo and hi:
            q = ((t - t0) / step) % 1
            return (np.array(lo['xy']) + (np.array(hi['xy']) - np.array(lo['xy'])) * q).round(2).tolist()
        return (lo or hi or {}).get('xy')
    ball = []
    for e in M['ball']['events']:
        xy = e.get('at') or at(e['owner'], e['t'])
        ball.append({'t': e['t'], 'xy': xy, 'what': e['what'], 'aerialToNext': bool(e.get('aerialToNext'))})
    fit = [f['medianLineDistPx'] for f in C['frames']]
    res = {'source': T['source'], 'pitch': [105, 68], 'step': step, 'times': times, 'roles': roles, 'ball': ball,
           'registration': {'frames': len(fit), 'meanMedianLineDistPx': round(float(np.mean(fit)), 2), 'maxMedianLineDistPx': round(float(np.max(fit)), 2)},
           'mappingFile': mapping_path.split('/')[-1]}
    json.dump(res, open(out_path, 'w'), indent=1)
    man = sum(1 for r in roles.values() for s in r if s and s['prov'] == 'manual'); obs = sum(1 for r in roles.values() for s in r if s and s['prov'] == 'observed'); itp = sum(1 for r in roles.values() for s in r if s and s['prov'] == 'interpolated')
    print(f"{len(times)} times x {len(roles)} roles: observed {obs}, manual {man}, interpolated {itp}, unknown {len(times) * len(roles) - obs - itp - man}")
    print('ball:', [(b['t'], b['xy']) for b in ball if b['xy'] is None] or 'all ball samples resolved')

if __name__ == '__main__':
    run(*sys.argv[1:5])
