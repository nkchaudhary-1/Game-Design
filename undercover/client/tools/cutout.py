#!/usr/bin/env python3
"""Cut a figure photographed on black into an RGBA image: background transparent, body opaque, smoke soft.

    python3 tools/cutout.py "<source png>" out.webp [--preview preview.jpg --scene scene.jpg]
"""
import sys
import numpy as np
from PIL import Image, ImageFilter, ImageOps
from scipy import ndimage

def cutout(src, dark=26, bright=70, feather=2):
    im = ImageOps.grayscale(Image.open(src).convert('RGB'))
    lum = np.asarray(im, dtype=np.float32)
    h, w = lum.shape
    # Background: dark pixels reachable from the top and side borders (the figure touches the bottom).
    darkmask = lum < dark
    labels, n = ndimage.label(darkmask)
    border = set(np.unique(labels[0, :])) | set(np.unique(labels[:, 0])) | set(np.unique(labels[:, -1]))
    border.discard(0)
    background = np.isin(labels, list(border))
    # Everything else is figure or smoke. Body (dark but enclosed) -> opaque; bright pixels -> ramp.
    enclosed_dark = darkmask & ~background
    ramp = np.clip((lum - dark) / (bright - dark), 0, 1)
    alpha = np.where(enclosed_dark, 1.0, ramp)
    # Solidify the body: grow the opaque core slightly and close small gaps, then soften the edge.
    core = (alpha >= 0.999) | (lum >= bright)
    core = ndimage.binary_closing(core, iterations=6)
    core = ndimage.binary_fill_holes(core)
    core = ndimage.binary_erosion(core, iterations=1)
    alpha = np.maximum(alpha, core.astype(np.float32))
    # Everything the flood fill proved to be background stays transparent, feathered.
    alpha[background] = 0
    a = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(feather))
    rgb = Image.open(src).convert('RGB')
    rgb = ImageOps.grayscale(rgb).convert('RGB')
    out = rgb.copy()
    out.putalpha(a)
    return out

if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    img = cutout(src)
    img.save(dst, 'WEBP', quality=86, method=6)
    print(dst, img.size)
    if '--preview' in sys.argv:
        prev = sys.argv[sys.argv.index('--preview') + 1]
        scene = Image.open(sys.argv[sys.argv.index('--scene') + 1]).convert('RGB').resize(img.size)
        scene.paste(img, (0, 0), img)
        scene.save(prev, 'JPEG', quality=80)
