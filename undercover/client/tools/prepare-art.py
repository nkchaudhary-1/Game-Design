#!/usr/bin/env python3
"""Turn the source asset pack into the files the app expects in public/art.

    python3 tools/prepare-art.py "<folder with the source PNGs>" public/art

Needs Pillow. Figure images must have black backgrounds; the CSS screen-blends them.
"""
from PIL import Image, ImageOps, ImageChops, ImageEnhance
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from cutout import cutout

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)

def load(name):
    return ImageOps.grayscale(Image.open(os.path.join(src, name + '.png')).convert('RGB')).convert('RGB')

def fit(im, w, h, cx=0.5, cy=0.5):
    return ImageOps.fit(im, (w, h), Image.LANCZOS, centering=(cx, cy))

def save(im, name, q=80):
    im.save(os.path.join(out, name), 'JPEG', quality=q, optimize=True, progressive=True)
    print(name, os.path.getsize(os.path.join(out, name)) // 1024, 'KB')

def composite(env, figure, env_gain=0.5, w=900, h=1200):
    bg = ImageEnhance.Brightness(fit(env, w, h)).enhance(env_gain)
    return ImageChops.screen(bg, fit(figure, w, h))

def face(im, cx, cy, size):
    W, H = im.size
    s = int(W * size)
    return im.crop((int(W * cx - s / 2), int(H * cy - s / 2), int(W * cx + s / 2), int(H * cy + s / 2))).resize((256, 256), Image.LANCZOS)

ROLES = {
    'traitor':   ('Rain-Slick Noir Alleyway', 'Noir Detective with Cigarette Smoke'),
    'doctor':    ('Foggy Vintage Clinic Examination Room', 'Noir Doctor Preparing for a Procedure'),
    'police':    ('Fogbound Gothic Street Entrance', 'Noir Police Officer in Silhouette'),
    'bodyguard': ('Moonlit Gothic Mansion Entrance', 'Noir Shadow Agent in Smoke'),
    'innocent':  ('Moonlit Gothic Square in the Rain', 'Noir Trio in Smoke'),
    'unknown':   ('Fogbound Noir Alley', 'Mysterious Noir Detective Silhouette'),
}

for role, (env, fig) in ROLES.items():
    save(ImageEnhance.Brightness(fit(load(env), 900, 1200)).enhance(0.6), f'role-{role}-scene.jpg', 76)
    ImageOps.fit(cutout(os.path.join(src, fig + '.png')), (900, 1200), Image.LANCZOS).save(os.path.join(out, f'role-{role}-figure.webp'), 'WEBP', quality=84, method=6)
    save(composite(load(env), load(fig), 0.5), f'role-{role}.jpg')

square = load('Fogbound Gothic Square at Night')
detective = load('Noir Detective with Cigarette Smoke')
save(ImageEnhance.Brightness(fit(square, 900, 1200)).enhance(0.7), 'hero-scene.jpg', 76)
ImageOps.fit(cutout(os.path.join(src, 'Noir Detective with Cigarette Smoke.png')), (900, 1200), Image.LANCZOS).save(os.path.join(out, 'hero-figure.webp'), 'WEBP', quality=84, method=6)
save(fit(load('Moonlit Noir Over the Gothic City'), 1200, 400, 0.5, 0.35), 'skyline.jpg')
save(fit(load('Gothic Ballroom Beneath the Chandelier'), 800, 600, 0.5, 0.45), 'card-table.jpg')
save(fit(composite(load('Misty Noir Alleyway at Night'), load('Mysterious Noir Detective Silhouette'), 0.5), 800, 600, 0.5, 0.3), 'card-solo.jpg')
save(fit(square, 900, 1200), 'scene-square.jpg', 72)
save(ImageEnhance.Brightness(fit(load('Moonlit Gothic Square in the Rain'), 900, 1500, 0.5, 0.55)).enhance(0.8), 'bg-main.jpg', 74)
save(fit(load('Gothic Ballroom Beneath the Chandelier'), 900, 1200), 'scene-ballroom.jpg', 72)

trio = load('Noir Trio in Smoke')
avatars = [
    face(detective, 0.5, 0.2, 0.62),
    face(load('Noir Doctor Preparing for a Procedure'), 0.5, 0.16, 0.6),
    face(trio, 0.5, 0.4, 0.3),
    face(load('Noir Police Officer in Silhouette'), 0.5, 0.17, 0.6),
    face(trio, 0.2, 0.27, 0.3),
    face(load('Noir Shadow Agent in Smoke'), 0.5, 0.16, 0.58),
    face(trio, 0.79, 0.26, 0.3),
    face(load('Mysterious Noir Detective Silhouette'), 0.5, 0.18, 0.62),
    fit(load('Fogbound Gothic Street Entrance'), 256, 256, 0.3, 0.3),
    fit(load('Gothic Ballroom Beneath the Chandelier'), 256, 256, 0.5, 0.15),
    fit(load('Moonlit Noir Over the Gothic City'), 256, 256, 0.3, 0.1),
]
for i, av in enumerate(avatars):
    save(av, f'avatar-{i + 1:02d}.jpg', 82)

frame = Image.open(os.path.join(src, 'frame.png')).convert('RGBA').resize((600, 800), Image.LANCZOS)
frame.save(os.path.join(out, 'frame.png'), 'PNG', optimize=True)
print('frame.png')
