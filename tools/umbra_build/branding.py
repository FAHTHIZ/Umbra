"""Umbra identity: names, icons and attribution."""
from __future__ import annotations

import io
import re

from PIL import Image, ImageDraw, ImageFilter

BRAND = {
    "-brand-shorter-name": "Umbra",
    "-brand-short-name": "Umbra",
    "-brand-full-name": "Umbra",
    "-brand-product-name": "Umbra",
    "-vendor-short-name": "Umbra Project",
}
TRADEMARK = ("Umbra is built on Tor Browser by The Tor Project. Umbra is an independent project and is "
             "not affiliated with or endorsed by The Tor Project. “Tor” is a registered trademark of The Tor Project, Inc.")


def brand_ftl(src: str) -> str:
    out = []
    for line in src.splitlines():
        key = line.split("=", 1)[0].strip()
        if key in BRAND:
            line = f"{key} = {BRAND[key]}"
        elif key == "trademarkInfo":
            line = f"trademarkInfo = {TRADEMARK}"
        out.append(line)
    return "\n".join(out) + "\n"


def brand_properties(src: str) -> str:
    def sub(m):
        k = m.group(1)
        v = {"brandShorterName": "Umbra", "brandShortName": "Umbra", "brandFullName": "Umbra",
             "vendorShortName": "Umbra Project", "brandProductName": "Umbra"}.get(k)
        return f"{k}={v}" if v else m.group(0)
    return re.sub(r"^(\w+)=.*$", sub, src, flags=re.M)


def icon_png(size: int) -> bytes:
    """Eclipse mark: dark disc with an amber corona. Rendered at 4x then downsampled."""
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    corona = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(corona)
    pad = int(s * 0.06)
    d.ellipse([pad, pad, s - pad, s - pad], fill=(246, 185, 74, 255))
    corona = corona.filter(ImageFilter.GaussianBlur(s * 0.035))
    img.alpha_composite(corona)
    d2 = ImageDraw.Draw(img)
    r = int(s * 0.33)
    c = s // 2
    d2.ellipse([c - r, c - r, c + r, c + r], fill=(11, 13, 18, 255))
    img = img.resize((size, size), Image.LANCZOS)
    b = io.BytesIO()
    img.save(b, "PNG", optimize=True)
    return b.getvalue()


