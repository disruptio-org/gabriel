"""Generates build/icon.ico from the app's own glyph geometry.

Mirrors src/components/Glyph.tsx (ring r = 0.3*size, slash extent r*1.42,
stroke 0.045*size) on the launcher tile from src/components/Desktop.tsx
(rounded square, 160deg #0B0F0C -> #060907, 1px #16211a border).
"""
import math
from PIL import Image, ImageDraw, ImageFilter

ACCENT = (0x69, 0xFF, 0x94)
BORDER = (0x16, 0x21, 0x1A)
TOP, BOT = (0x0B, 0x0F, 0x0C), (0x06, 0x09, 0x07)

S = 1024                 # render large, downsample for each ICO entry
PAD = int(S * 0.045)     # a little air so the rounded tile reads
TILE = S - 2 * PAD
RADIUS = int(TILE * 0.229)   # 22/96, the launcher's corner radius


def gradient(size, angle_deg=160):
    """Linear gradient, CSS angle convention (0deg = up, clockwise)."""
    img = Image.new("RGB", (size, size))
    px = img.load()
    a = math.radians(angle_deg)
    dx, dy = math.sin(a), -math.cos(a)
    half = (abs(dx) + abs(dy)) * (size - 1) / 2
    for y in range(size):
        for x in range(size):
            u = ((x - (size - 1) / 2) * dx + (y - (size - 1) / 2) * dy) / (2 * half) + 0.5
            px[x, y] = tuple(round(TOP[i] + (BOT[i] - TOP[i]) * u) for i in range(3))
    return img


def glyph_layer(size, width_mul=1.0, expand=0.0):
    """The Ø itself: ring plus diagonal incision, on a transparent layer."""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    # Larger than the launcher's 44/96: the icon must stay legible at 16px (§4.2),
    # and an app icon has no label beside it to lean on.
    g = size * 0.60
    mid = size / 2
    r = g * 0.3 + expand
    ext = (g * 0.3) * 1.42
    w = max(1, round(g * 0.045 * width_mul))
    d.ellipse([mid - r, mid - r, mid + r, mid + r], outline=ACCENT + (255,), width=w)
    k = ext * 0.707
    d.line([mid - k, mid + k, mid + k, mid - k], fill=ACCENT + (255,), width=w, joint="curve")
    # round the incision's caps, as strokeLinecap="round" does
    for sx, sy in ((mid - k, mid + k), (mid + k, mid - k)):
        d.ellipse([sx - w / 2, sy - w / 2, sx + w / 2, sy + w / 2], fill=ACCENT + (255,))
    return layer


tile = Image.new("RGBA", (S, S), (0, 0, 0, 0))
mask = Image.new("L", (TILE, TILE), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, TILE - 1, TILE - 1], RADIUS, fill=255)
face = gradient(TILE).convert("RGBA")
ImageDraw.Draw(face).rounded_rectangle(
    [0, 0, TILE - 1, TILE - 1], RADIUS, outline=BORDER + (255,), width=max(1, TILE // 220)
)
face.putalpha(mask)
tile.paste(face, (PAD, PAD), face)

# The phosphor glow the design carries everywhere, baked in.
glow = glyph_layer(S, width_mul=2.2, expand=S * 0.004).filter(ImageFilter.GaussianBlur(S * 0.030))
glow.putalpha(glow.getchannel("A").point(lambda v: int(v * 0.75)))
tile = Image.alpha_composite(tile, glow)
tile = Image.alpha_composite(tile, glyph_layer(S))

sizes = [256, 128, 64, 48, 32, 24, 16]
frames = [tile.resize((n, n), Image.LANCZOS) for n in sizes]
frames[0].save("build/icon.ico", format="ICO", sizes=[(n, n) for n in sizes])
frames[0].save("build/icon.png", format="PNG")
print("build/icon.ico ->", ", ".join(f"{n}x{n}" for n in sizes))
