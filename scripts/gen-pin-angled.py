"""
Active oblique push-pin styles used in-game: 2, 3, 6, 7.
Writes: src/assets/images/clue-board/pins/angled/style-{N}.png
"""
from __future__ import annotations

import math
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "assets", "images", "clue-board", "pins", "angled")
S = 160


def shadow(cx, cy, rx=36, ry=14, a=150):
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=(20, 10, 0, a))
    return im.filter(ImageFilter.GaussianBlur(5))


def sphere_head(im, cx, cy, rx, ry, rgb, gloss=True):
    px = im.load()
    for y in range(max(0, int(cy - ry - 1)), min(S, int(cy + ry + 2))):
        for x in range(max(0, int(cx - rx - 1)), min(S, int(cx + rx + 2))):
            dx = (x - cx) / rx
            dy = (y - cy) / ry
            rr = dx * dx + dy * dy
            if rr > 1:
                continue
            nz = math.sqrt(max(0.0, 1 - rr))
            nd = max(0.0, -0.4 * dx - 0.55 * dy + 0.7 * nz)
            spec = (nd ** 20) * (0.85 if gloss else 0.25)
            base = [c / 255 for c in rgb]
            out = [int(max(0, min(255, (0.25 + 0.7 * nd) * c * 255 + spec * 255))) for c in base]
            a = 255 if rr < 0.88 else int(255 * (1 - rr) / 0.12)
            px[x, y] = (*out, max(0, min(255, a)))
    d = ImageDraw.Draw(im)
    d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), outline=(25, 18, 12, 210), width=2)


def collar_and_tip(d: ImageDraw.ImageDraw, cx, cy_neck, tip_y):
    d.ellipse((cx - 18, cy_neck - 6, cx + 18, cy_neck + 10), fill=(245, 245, 240), outline=(70, 70, 70), width=2)
    d.ellipse((cx - 12, cy_neck - 3, cx + 12, cy_neck + 7), fill=(255, 255, 252))
    d.polygon([(cx - 2, tip_y - 8), (cx + 2, tip_y - 8), (cx, tip_y)], fill=(150, 150, 155), outline=(80, 80, 85))


def pin_flat(rgb, rim_hi) -> Image.Image:
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    cx, cy = S // 2, 60
    im = Image.alpha_composite(im, shadow(cx + 3, 118, 34, 13, 150))
    d = ImageDraw.Draw(im)
    collar_and_tip(d, cx, 94, 118)
    rx, ry = 40, 28
    d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=rgb, outline=(40, 25, 20), width=2)
    d.ellipse((cx - rx + 5, cy - ry + 4, cx + rx - 5, cy + ry - 4), outline=rim_hi, width=2)
    return im


def pin_classic_collar() -> Image.Image:
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    cx, cy = S // 2, 56
    im = Image.alpha_composite(im, shadow(cx + 2, 116, 36, 14, 160))
    d = ImageDraw.Draw(im)
    collar_and_tip(d, cx, 90, 116)
    rx, ry = 42, 34
    d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=(210, 42, 36), outline=(20, 15, 12), width=3)
    d.ellipse((cx - 14, cy - 12, cx + 14, cy + 10), fill=(198, 180, 150), outline=(90, 75, 55), width=2)
    return im


def pin_brass() -> Image.Image:
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    cx, cy = S // 2, 60
    im = Image.alpha_composite(im, shadow(cx + 4, 116, 32, 12, 170))
    d = ImageDraw.Draw(im)
    collar_and_tip(d, cx, 94, 116)
    rx, ry = 40, 28
    d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=(198, 160, 70), outline=(90, 65, 30), width=2)
    for i in range(6, int(rx) - 2, 3):
        tone = 210 - (i % 6) * 8
        d.ellipse((cx - i, cy - int(i * ry / rx), cx + i, cy + int(i * ry / rx)),
                  outline=(tone, tone - 35, 50, 100), width=1)
    d.ellipse((cx - rx + 5, cy - ry + 4, cx + rx - 5, cy + ry - 4), outline=(235, 210, 140), width=2)
    return im


STYLES = [
    ("2", lambda: pin_flat((210, 48, 42), (255, 190, 180))),
    ("3", pin_classic_collar),
    ("6", lambda: pin_flat((72, 128, 72), (150, 185, 150))),
    ("7", pin_brass),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    for num, fn in STYLES:
        im = fn()
        path = os.path.join(OUT, f"style-{num}.png")
        im.save(path, "PNG")
        print("wrote", path)


if __name__ == "__main__":
    main()
