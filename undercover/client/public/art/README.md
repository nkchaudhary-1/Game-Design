# Art assets

Grayscale noir art, processed from the source pack with `tools/prepare-art.py` (sources are not committed).

| File | Used for |
|---|---|
| `hero-scene.jpg`, `hero-figure.jpg` | Landing hero: darkened square behind, detective screen-blended in front |
| `skyline.jpg` | Wide footer strip (3:1) |
| `card-table.jpg`, `card-solo.jpg` | Mode cards |
| `role-{role}-scene.jpg`, `role-{role}-figure.jpg` | Role cards: scene, then `frame.png` inset, then the figure on top |
| `role-{role}.jpg` | Flattened composite for compact cards (rules page, eliminated player) |
| `avatar-01.jpg` … `avatar-11.jpg` | Seat portraits, keyed by seat number |
| `frame.png` | Ornamental card frame (transparent PNG) |
| `scene-square.jpg`, `scene-ballroom.jpg` | Spare backdrops |

Figure files have black backgrounds on purpose: the CSS uses `mix-blend-mode: screen`, so black disappears and
the figure sits in front of the frame. Missing files fall back to the built-in silhouettes and initials.
