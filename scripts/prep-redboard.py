"""Upscale clue-board redboard to HD JPEG for the default 2D map."""
from __future__ import annotations

import os
import shutil
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_CANDIDATES = [
    os.path.join(ROOT, "src", "assets", "images", "clue-board", "redboard.png"),
    os.path.join(
        os.environ.get("USERPROFILE", ""),
        ".cursor",
        "projects",
        "e-github-UdonariumWithFly",
        "assets",
        "c__Users_Couga_AppData_Roaming_Cursor_User_workspaceStorage_b0b7fe521927053a13d463449e3474ea_images_redboard-cf990c1e-4076-4597-92fb-729c3c4dbae4.png",
    ),
]
OUT_DIR = os.path.join(ROOT, "src", "assets", "images", "clue-board")
# Target ~2K+ so a 20×15 grid (1000×750 css px, often scaled up) stays sharp.
TARGET_W = 2560


def main() -> None:
    src = next((p for p in SRC_CANDIDATES if os.path.isfile(p)), None)
    if not src:
        raise SystemExit("redboard source not found")
    im = Image.open(src).convert("RGB")
    w, h = im.size
    scale = TARGET_W / w
    tw, th = TARGET_W, max(1, int(round(h * scale)))
    if (tw, th) != (w, h):
        im = im.resize((tw, th), Image.Resampling.LANCZOS)
    # Keep original small file as archive reference
    archive = os.path.join(OUT_DIR, "redboard-src-1024.jpg")
    if not os.path.isfile(archive):
        Image.open(src).convert("RGB").save(archive, "JPEG", quality=92, optimize=True)
    out_jpg = os.path.join(OUT_DIR, "redboard.jpg")
    im.save(out_jpg, "JPEG", quality=95, optimize=True, progressive=True)
    # Also refresh redboard.png as HD for any old references
    im.save(os.path.join(OUT_DIR, "redboard.png"), "PNG", optimize=True)
    print("wrote", out_jpg, im.size, os.path.getsize(out_jpg))


if __name__ == "__main__":
    main()
