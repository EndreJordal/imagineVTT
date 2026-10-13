"""Cut the circular frames out of the border PNGs in borders/ (their 'transparency' is a
baked-in checkerboard): keep the ring between its inner and outer edge, with real alpha.
Writes public/borders/<id>.png and index.json (each ring's inside edge, for BORDERS in
src/shared/characters.ts). Run from the repo root: python scripts/clean-borders.py"""
import json, math, os, sys
import numpy as np
from PIL import Image

SRC = 'borders'
OUT = 'public/borders'
SIZE = 512
NAMES = {
    'png-clipart-round-brown-wooden-frame': ('gold', 'Gold'),
    'png-clipart-round-gray-frame-circle-silver': ('glass', 'Glass'),
    'png-clipart-silver-claw-for-gemstone-black-and-gray-metal-frame': ('iron-chain', 'Iron chain'),
    'png-clipart-silver-claw-for-gemstone-round-black-and-gray-metal-frame': ('iron-studs', 'Iron studs'),
    'png-clipart-silver-claw-for-gemstone-round-black-and-silver-analog-watch': ('steel-spikes', 'Steel spikes'),
    'png-clipart-silver-claw-for-gemstone-round-black-frame': ('black-iron', 'Black iron'),
}

os.makedirs(OUT, exist_ok=True)
index = []
for f in sorted(os.listdir(SRC)):
    key = next(k for k in NAMES if f.startswith(k))
    slug, label = NAMES[key]
    im = np.asarray(Image.open(os.path.join(SRC, f)).convert('RGB')).astype(int)
    h, w, _ = im.shape
    mx, mn = im.max(axis=2), im.min(axis=2)
    grey = (mx - mn) <= 8
    bg = grey & ((mn >= 247) | ((mn >= 222) & (mx <= 238)))
    fg = ~bg
    # The ring's centre and outer radius: from the columns/rows that are mostly frame.
    ys, xs = np.nonzero(fg)
    cols = np.bincount(xs, minlength=w)
    rows = np.bincount(ys, minlength=h)
    xi = np.nonzero(cols > 3)[0]
    yi = np.nonzero(rows > 3)[0]
    x0, x1, y0, y1 = xi[0], xi[-1], yi[0], yi[-1]
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    outer = ((x1 - x0) + (y1 - y0)) / 4
    # Inner radius: along rays from the centre, the first run of frame pixels.
    firsts = []
    for k in range(720):
        a = k * math.pi / 360
        for r in np.arange(outer * 0.3, outer, 0.5):
            x, y = int(round(cx + r * math.cos(a))), int(round(cy + r * math.sin(a)))
            if 0 <= x < w and 0 <= y < h and fg[y, x] and fg[min(h - 1, y + 1), x] and fg[y, min(w - 1, x + 1)]:
                firsts.append(r)
                break
    inner = float(np.percentile(firsts, 25))
    # Square crop around the ring, alpha by distance (antialiased edges).
    R = outer + 2
    n0 = int(round(2 * R))
    box = (int(cx - R), int(cy - R), int(cx - R) + n0, int(cy - R) + n0)
    rgb = Image.open(os.path.join(SRC, f)).convert('RGB').crop(box)
    n = rgb.size[0]
    yy, xx = np.mgrid[0:n, 0:n]
    d = np.hypot(xx + box[0] + 0.5 - cx, yy + box[1] + 0.5 - cy)
    alpha = np.clip(outer + 0.5 - d, 0, 1) * np.clip(d - (inner - 0.5), 0, 1)
    # Checkerboard showing through or around the frame (openwork, prongs): see-through. Only
    # where it's the checker's two exact greys, in squares (a pixel and its neighbours alike).
    big = np.pad(bg, n, constant_values=True)
    crop_bg = big[box[1] + n:box[1] + 2 * n, box[0] + n:box[0] + 2 * n]
    pad = np.pad(crop_bg, 1, constant_values=True)
    solid_bg = crop_bg & pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:]
    # The outer edge's light halo (anti-aliased into the white checker squares): see-through.
    big_rgb = np.pad(im, ((n, n), (n, n), (0, 0)), constant_values=255)
    crop = big_rgb[box[1] + n:box[1] + 2 * n, box[0] + n:box[0] + 2 * n]
    light = ((crop.max(axis=2) - crop.min(axis=2)) <= 14) & (crop.min(axis=2) >= 175)
    halo = light & (d > outer - 0.06 * outer)
    if slug != 'glass':  # see-through glass: the checker is baked into the glass itself
        alpha = alpha * (~solid_bg) * (~halo)
        # Light fringes wherever the frame meets the see-through: peeled a few pixels deep.
        for _ in range(4):
            clear = alpha < 0.5
            pc = np.pad(clear, 1, constant_values=True)
            touches = pc[:-2, 1:-1] | pc[2:, 1:-1] | pc[1:-1, :-2] | pc[1:-1, 2:]
            alpha = alpha * ~(light & touches)
    rgba = np.dstack([np.asarray(rgb), (alpha * 255).astype(np.uint8)])
    out = Image.fromarray(rgba.astype(np.uint8), 'RGBA').resize((SIZE, SIZE), Image.LANCZOS)
    out.save(os.path.join(OUT, f'{slug}.png'), optimize=True)
    index.append({'id': slug, 'name': label, 'inner': round(inner / R, 4)})
    print(slug, w, h, 'centre', cx, cy, 'outer', outer, 'inner', inner)

json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), indent=2)
