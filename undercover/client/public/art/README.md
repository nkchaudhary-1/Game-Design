# Art assets

Grayscale noir art, processed from the source pack with `tools/prepare-art.py` (sources are not committed).

| File | Used for |
|---|---|
| `hero-scene.jpg`, `hero-figure.webp` | Landing hero: darkened square behind, cut-out detective in front |
| `skyline.jpg` | Wide footer strip (3:1) |
| `card-table.jpg`, `card-solo.jpg` | Mode cards |
| `role-{role}-scene.jpg`, `role-{role}-figure.webp` | Role cards: scene, then `frame.png` inset, then the cut-out figure on top |
| `role-{role}.jpg` | Flattened composite for compact cards (rules page, eliminated player) |
| `avatar-01.jpg` … `avatar-11.jpg` | Seat portraits, keyed by seat number |
| `frame.png` | Ornamental card frame (transparent PNG) |
| `scene-square.jpg`, `scene-ballroom.jpg` | Spare backdrops |

Figure files are RGBA cut-outs made by `tools/cutout.py` (background transparent, body opaque, smoke soft), so
they sit solidly in front of the frame. Missing files fall back to the built-in silhouettes and initials.
