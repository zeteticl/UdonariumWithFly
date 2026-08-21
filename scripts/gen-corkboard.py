"""Generate a procedural corkboard texture (project-authored; no third-party asset)."""
import os
import random
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

W, H = 1600, 1200
rng = random.Random(42)
base = Image.new("RGB", (W, H), (120, 78, 48))
px = base.load()

for y in range(H):
    for x in range(W):
        n = rng.randint(-28, 28)
        r = max(40, min(200, 118 + n + (x % 7) - 3))
        g = max(30, min(160, 76 + int(n * 0.7) + (y % 5) - 2))
        b = max(20, min(120, 46 + int(n * 0.45)))
        if rng.random() < 0.012:
            r, g, b = r - 35, g - 28, b - 20
        px[x, y] = (r, g, b)

rgba = base.convert("RGBA")
for _ in range(180):
    cx, cy = rng.randint(0, W), rng.randint(0, H)
    rad = rng.randint(8, 40)
    col = (rng.randint(90, 140), rng.randint(55, 95), rng.randint(30, 60), rng.randint(20, 55))
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(overlay).ellipse((cx - rad, cy - rad, cx + rad, cy + rad), fill=col)
    rgba = Image.alpha_composite(rgba, overlay)

vign = Image.new("RGBA", (W, H), (0, 0, 0, 0))
vd = ImageDraw.Draw(vign)
for i in range(80):
    t = i / 80
    alpha = int(55 * (t ** 1.4))
    inset = int(t * 220)
    vd.rectangle((inset, inset, W - 1 - inset, H - 1 - inset), outline=(20, 0, 0, alpha))

glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
for i in range(60):
    t = i / 60
    y0 = int(t * H * 0.55)
    a = int(70 * (1 - t) ** 1.8)
    gd.rectangle((0, y0, W, y0 + 24), fill=(180, 30, 20, a))

out = Image.alpha_composite(Image.alpha_composite(rgba, vign), glow)
out = out.filter(ImageFilter.GaussianBlur(radius=0.6))
out = ImageEnhance.Contrast(out).enhance(1.08).convert("RGB")

path = os.path.join(os.path.dirname(__file__), "..", "src", "assets", "images", "clue-board")
os.makedirs(path, exist_ok=True)
out_path = os.path.join(path, "corkboard.jpg")
out.save(out_path, "JPEG", quality=85)
print("saved", out_path, out.size)
