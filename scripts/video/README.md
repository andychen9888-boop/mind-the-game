# Video position estimation (research tooling)

Estimates player positions every 0.5 s from a broadcast recording, as used for the anonymized real-match case. Requires Python with numpy, opencv-python-headless, scipy and imageio-ffmpeg in a private virtual environment; these are not project dependencies. No footage is included in this repository, and intermediate frames must never be committed.

1. `track_camera.py`: homography per frame from the pitch markings (coarse-to-fine alignment of a 105 x 68 m pitch model to white line pixels), propagated between frames with ORB features.
2. `detect_players.py`: colour-based player detection, foot points projected onto the pitch.
3. `track_players.py`, `stitch_tracks.py`: anonymous tracks per team, joined across short occlusions.
4. `label_frames.py`, `plot_tracks.py`: review images for the manual mapping of tracks to roles.
5. `build_positions.py`: per-role positions every 0.5 s with provenance (observed, manual, interpolated, not observed).

Known limits: the pitch size is assumed; the real-world error is not independently measured (only the line-alignment error in pixels); goalkeepers in green kits are not detected; the ball is not tracked; the mapping of tracks to roles is a manual judgement.
