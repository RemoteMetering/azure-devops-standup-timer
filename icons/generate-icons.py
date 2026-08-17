#!/usr/bin/env python3
"""Generate the extension PNG icons from the same geometry as icon.svg.

Uses only the standard library so it runs anywhere. Renders with 4x
supersampling for smooth edges, then box-downsamples.
"""
import math
import struct
import zlib
from pathlib import Path

SIZES = [32, 48, 96, 128]
SS = 4  # supersample factor

BLUE = (0x00, 0x78, 0xD4, 255)
WHITE = (255, 255, 255, 255)
RED = (0xD1, 0x34, 0x38, 255)
CLEAR = (0, 0, 0, 0)

# Geometry in unit coordinates (matches icon.svg on a 128 canvas)
BODY_C = (0.5, 0.5625)   # 64,72
BODY_R = 0.375           # 48
FACE_R = 0.296875        # 38
PIN_R = 0.046875         # 6
BTN = (0.40625, 0.0625, 0.1875, 0.109375, 0.03125)  # x, y, w, h, corner radius
WEDGE_SWEEP = math.radians(120)


def in_round_rect(x, y, rect):
    rx, ry, rw, rh, r = rect
    if not (rx <= x <= rx + rw and ry <= y <= ry + rh):
        return False
    cx = min(max(x, rx + r), rx + rw - r)
    cy = min(max(y, ry + r), ry + rh - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def pixel(x, y):
    """Colour at unit-square point (x, y), painter's order."""
    dx, dy = x - BODY_C[0], y - BODY_C[1]
    d2 = dx * dx + dy * dy
    if d2 <= PIN_R * PIN_R:
        return BLUE
    if d2 <= FACE_R * FACE_R:
        # angle from 12 o'clock, clockwise
        ang = math.atan2(dx, -dy)
        if ang < 0:
            ang += 2 * math.pi
        return RED if ang <= WEDGE_SWEEP else WHITE
    if d2 <= BODY_R * BODY_R:
        return BLUE
    if in_round_rect(x, y, BTN):
        return BLUE
    return CLEAR


def render(size):
    big = size * SS
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            r = g = b = a = 0
            for sy in range(SS):
                for sx in range(SS):
                    x = (px * SS + sx + 0.5) / big
                    y = (py * SS + sy + 0.5) / big
                    cr, cg, cb, ca = pixel(x, y)
                    # accumulate premultiplied to avoid dark fringes
                    r += cr * ca
                    g += cg * ca
                    b += cb * ca
                    a += ca
            n = SS * SS
            if a:
                row += bytes((r // a, g // a, b // a, a // n))
            else:
                row += b"\x00\x00\x00\x00"
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    def chunk(tag, data):
        payload = tag + data
        return (struct.pack(">I", len(data)) + payload
                + struct.pack(">I", zlib.crc32(payload)))

    raw = b"".join(b"\x00" + r for r in rows)  # filter type 0 per scanline
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    path.write_bytes(png)


def main():
    out_dir = Path(__file__).resolve().parent
    for size in SIZES:
        path = out_dir / f"icon-{size}.png"
        write_png(path, size, render(size))
        print(f"wrote {path.name}")


if __name__ == "__main__":
    main()
