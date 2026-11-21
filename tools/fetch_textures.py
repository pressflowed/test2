"""Fetch the game's surface textures from TextureTown and make them ready to use.

  python3 tools/fetch_textures.py

TextureTown (https://textures.neocities.org, by Melon) is a free library of textures
for websites and 3D worlds. Its API page asks developers to download the files they
need rather than link to them, because names there change. So this script
downloads the chosen ones (kept in tools/.texture-cache, not committed), resizes each
to 256 x 256, adjusts a few colours to suit the game, blends the edges of the ones that do not
tile on their own, and writes them to
assets/textures/<name>.jpg. Each one tiles: the game repeats it across the world.

Needs Pillow (pip install pillow) and network access to textures.neocities.org.
"""
import os, sys, urllib.parse, urllib.request
from PIL import Image, ImageChops, ImageEnhance, ImageFilter

BASE = 'https://textures.neocities.org/textures/'
SIZE = 256
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '.texture-cache')
OUT = os.path.join(HERE, '..', 'assets', 'textures')

# game name -> (category/file on TextureTown, colour multiplier (r, g, b) or None, brightness,
#               axes to blend so the edges meet: '', 'x', 'y' or 'xy')
CHOSEN = {
    'grass':   ('plants/GRASS2.JPG', (1.0, 1.08, 0.9), 1.5, 'xy'),
    'leaf':    ('plants/EVGREEN.JPG', None, 1.15, ''),
    'hay':     ('plants/pni50071.jpg', (1.35, 1.2, 0.8), 1.25, 'xy'),   # dry grass, made more golden
    'sand':    ('nature-and-earth/SANDSHOR.JPG', (1.2, 1.1, 0.9), 1.45, ''),
    'dirt':    ('nature-and-earth/MULCH.png', None, 1.0, 'xy'),
    'rock':    ('stone-and-brick/CONCGRAY.JPG', None, 1.1, ''),
    'stone':   ('stone-and-brick/248__wall_stone_texture-seamless.jpg', None, 1.0, ''),
    'brick':   ('stone-and-brick/BRICK49.JPG', None, 1.0, ''),
    'marble':  ('stone-and-brick/TRAVERTN.png', None, 1.0, ''),
    'plaster': ('stone-and-brick/STUCCO8.JPG', (1.08, 1.04, 0.95), 1.15, ''),
    'roof':    ('wood/ROOF_03B.GIF', (1.45, 0.8, 0.7), 1.1, ''),        # grey shingles, made terracotta
    'wood':    ('wood/BARK4.JPG', (0.9, 0.85, 0.8), 0.85, 'xy'),        # bark
    'plank':   ('wood/TEAK.JPG', None, 1.0, 'y'),
    'crate':   ('wood/PINE1.JPG', (1.0, 0.88, 0.7), 0.95, 'y'),         # the game draws a frame over it
    'metal':   ('metal/MtlPlat2.jpg', None, 1.1, ''),
}

def fetch(ref):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, ref.replace('/', '__'))
    if not os.path.exists(path):
        cat, name = ref.split('/')
        url = BASE + cat + '/' + urllib.parse.quote(name)
        print('  downloading', url)
        req = urllib.request.Request(url, headers={'User-Agent': 'texture-fetch'})
        with urllib.request.urlopen(req, timeout=60) as r, open(path, 'wb') as f:
            f.write(r.read())
    return path

def blend(img, axis, band=0.3):
    """Make the picture tile along one axis: near its edges, fade into a copy of itself that has
    been slid half way round, whose middle (which is continuous) then sits on the tile's edge."""
    w, h = img.size
    n = w if axis == 'x' else h
    slid = ImageChops.offset(img, w // 2 if axis == 'x' else 0, h // 2 if axis == 'y' else 0)
    ramp = [min(1.0, min(i, n - 1 - i) / (n * band)) for i in range(n)]
    ramp = [int(255 * (3 * t * t - 2 * t * t * t)) for t in ramp]
    mask = Image.new('L', (w, h))
    mask.putdata([ramp[x] if axis == 'x' else ramp[y] for y in range(h) for x in range(w)])
    return Image.composite(img, slid, mask)

# Photos that are lighter in some places than others, which shows as a grid once they repeat.
EVEN = {'grass': 0.9, 'rock': 0.8}

def even(img, amount):
    """Take out broad light and dark patches (keeping the detail), so repeats do not show."""
    w, h = img.size
    big = Image.new('RGB', (w * 3, h * 3))
    for a in range(3):
        for b in range(3): big.paste(img, (a * w, b * h))
    soft = big.filter(ImageFilter.GaussianBlur(w / 12)).crop((w, h, 2 * w, 2 * h))
    mean = img.resize((1, 1), Image.BOX).getpixel((0, 0))
    flat = ImageChops.add(ImageChops.subtract(img, soft, 1, 128), Image.new('RGB', (w, h), tuple(max(0, m - 128) for m in mean)))
    flat = ImageChops.subtract(flat, Image.new('RGB', (w, h), tuple(max(0, 128 - m) for m in mean)))
    return Image.blend(img, flat, amount)

def seam(img):
    """How badly the edges fail to meet when tiled: 1 is as smooth as the inside of the picture."""
    g = img.convert('L'); w, h = g.size; p = g.load()
    inside = sum(abs(p[x, y] - p[x + 1, y]) for y in range(0, h, 3) for x in range(w // 2 - 4, w // 2 + 3)) / (len(range(0, h, 3)) * 7)
    edge = sum(abs(p[w - 1, y] - p[0, y]) for y in range(0, h, 3)) / len(range(0, h, 3))
    inside2 = sum(abs(p[x, y] - p[x, y + 1]) for x in range(0, w, 3) for y in range(h // 2 - 4, h // 2 + 3)) / (len(range(0, w, 3)) * 7)
    edge2 = sum(abs(p[x, h - 1] - p[x, 0]) for x in range(0, w, 3)) / len(range(0, w, 3))
    return max(edge / max(inside, 1), edge2 / max(inside2, 1))

def main():
    os.makedirs(OUT, exist_ok=True)
    credits = []
    for name, (ref, mult, bright, axes) in CHOSEN.items():
        img = Image.open(fetch(ref)).convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)
        if mult:
            r, g, b = img.split()
            img = Image.merge('RGB', [c.point(lambda v, k=k: min(255, int(v * k))) for c, k in zip((r, g, b), mult)])
        if bright != 1.0: img = ImageEnhance.Brightness(img).enhance(bright)
        if name in EVEN: img = even(img, EVEN[name])
        for axis in axes: img = blend(img, axis)
        img.save(os.path.join(OUT, name + '.jpg'), quality=90)
        avg = img.resize((1, 1), Image.BOX).getpixel((0, 0))
        print('%-8s %-55s seam %.1f  average colour 0x%02x%02x%02x' % (name, ref, seam(img), *avg))
        credits.append('| `%s.jpg` | %s |' % (name, ref))
    with open(os.path.join(OUT, 'CREDITS.md'), 'w') as f:
        f.write('# Textures\n\nFrom [TextureTown](https://textures.neocities.org) by Melon, a free library of textures for websites and 3D worlds. Resized to %d x %d, some recoloured or blended at the edges so they tile, by `tools/fetch_textures.py`.\n\n| File | TextureTown file |\n|---|---|\n' % (SIZE, SIZE))
        f.write('\n'.join(credits) + '\n')

if __name__ == '__main__':
    sys.exit(main())
