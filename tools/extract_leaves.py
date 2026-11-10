#!/usr/bin/env python3
"""Split the autumn reference into a bare landscape plus tumbling leaf sprites.

The page loads the generated files in assets/. Re-run only if the source
painting changes:

    python3 tools/extract_leaves.py path/to/autumn-reference.png
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets"
SPACING = 18


def classify(arr):
    h, w = arr.shape[:2]
    r = arr[:, :, 0].astype(np.int16)
    g = arr[:, :, 1].astype(np.int16)
    b = arr[:, :, 2].astype(np.int16)
    mn = np.minimum(np.minimum(r, g), b)
    mx = np.maximum(np.maximum(r, g), b)
    yy, xx = np.ogrid[:h, :w]

    pale = (mn > 148) & ((mx - mn) < 102) & (b > 98) & (g > 120)
    warm = (r > 68) & (r + 12 >= g) & (r > b + 12) & ((mx - mn) > 24) & ~pale
    warm &= ~((b > 125) & (g > 145) & (r > 175))

    # Brown limbs, not the red leaf shadows. Connected through small gaps
    # back to the trunk so stray dark pixels in the crown are not kept.
    bark0 = (
        (r > 42) & (g > 34) & (b > 28) & (r < 205) & (g > r * 0.36)
        & (r > g - 2) & (g + 16 > b) & ((r - g) < 115) & ((g - b) < 70) & ~pale
    )
    bridged = ndimage.binary_dilation(bark0, iterations=3)
    labels, _ = ndimage.label(bridged)
    zone = np.zeros((h, w), bool)
    zone[860:1210, 380:920] = True
    ids = np.unique(labels[zone & bridged])
    ids = ids[ids != 0]
    bark = bark0 & np.isin(labels, ids)
    return warm, pale, bark, yy, xx


def crown_and_barriers(h, w, yy, xx):
    poly = [
        (400, 70), (560, 30), (740, 20), (920, 50), (1060, 120),
        (1140, 220), (1160, 380), (1100, 520), (1020, 650),
        (920, 760), (800, 800), (680, 760), (600, 820),
        (480, 820), (360, 740), (260, 620), (200, 480),
        (210, 340), (270, 200), (340, 110),
    ]
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).polygon(poly, fill=255)
    crown = np.array(mask) > 0

    blocked = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(blocked)
    # Left woods and the gap beside the crown, traced through sky rather than
    # through the canopy.
    # Stay in the gap beside the woods so the crown's left edge can fall away.
    draw.polygon(
        [(0, 680), (120, 740), (155, 860), (210, 1040), (0, 1120)],
        fill=255,
    )
    # Far shore and the right foreground bushes.
    draw.polygon(
        [(1253, 830), (1040, 860), (990, 940), (1100, 1100), (1253, 1100)],
        fill=255,
    )
    draw.rectangle((0, 990, w, h), fill=255)
    forest = np.array(blocked) > 0
    # Keep the polygon around for click-testing documentation.
    return crown, forest, poly


def foliage_mask(warm, bark, forest):
    h, w = warm.shape
    crown, forest_poly, poly = crown_and_barriers(h, w, None, None)
    forest = forest | forest_poly
    seed = crown & warm & ~bark & ~forest
    passable = warm & ~bark & ~forest
    labels, _ = ndimage.label(passable)
    ids = np.unique(labels[seed])
    ids = ids[ids != 0]
    canopy = np.isin(labels, ids)

    outside = warm & ~ndimage.binary_dilation(canopy, iterations=2) & ~forest
    labels, _ = ndimage.label(outside)
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    keep = []
    ys_all, xs_all = np.indices((h, w))
    for idx in np.where((sizes >= 28) & (sizes <= 3600))[0]:
        sel = labels == idx
        ys = ys_all[sel]
        xs = xs_all[sel]
        if ys.mean() > 760 or ys.max() > 840:
            continue
        if xs.mean() < 190 and ys.mean() > 500:
            continue
        keep.append(idx)
    air = np.isin(labels, np.array(keep, np.int32)) if keep else np.zeros((h, w), bool)
    return canopy | air, poly


def sky_plate(arr, remove, bark, pale):
    h, w = remove.shape
    r = arr[:, :, 0].astype(np.int16)
    g = arr[:, :, 1].astype(np.int16)
    b = arr[:, :, 2].astype(np.int16)
    yy = np.arange(h)[:, None]
    cool = (b > 68) & (b + 28 >= g) & (b + 40 >= r)
    sun = (r > 210) & (g > 170) & (b > 110) & (yy < 540)
    sky = (cool | pale | sun) & ~remove & ~bark
    cell = 22
    gh, gw = (h + cell - 1) // cell, (w + cell - 1) // cell
    total = np.zeros((gh, gw, 3), np.float64)
    count = np.zeros((gh, gw), np.float64)
    ys, xs = np.where(sky)
    np.add.at(total, (ys // cell, xs // cell), arr[ys, xs])
    np.add.at(count, (ys // cell, xs // cell), 1)
    filled = count > 6
    plate = np.zeros((gh, gw, 3), np.float64)
    plate[filled] = total[filled] / count[filled, None]
    for _ in range(500):
        if filled.all():
            break
        pad = np.pad(plate, ((1, 1), (1, 1), (0, 0)), mode="edge")
        pc = np.pad(filled.astype(np.float64), 1, mode="constant")
        acc = np.zeros_like(plate)
        hits = np.zeros((gh, gw))
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if not dy and not dx:
                    continue
                acc += pad[1 + dy : 1 + dy + gh, 1 + dx : 1 + dx + gw]
                hits += pc[1 + dy : 1 + dy + gh, 1 + dx : 1 + dx + gw]
        need = ~filled & (hits > 0)
        if not need.any():
            break
        plate[need] = acc[need] / hits[need, None]
        filled |= need
    small = Image.fromarray(np.clip(plate, 0, 255).astype(np.uint8))
    full = np.array(
        small.resize((w, h), Image.BILINEAR).filter(ImageFilter.GaussianBlur(radius=5))
    )
    return full


def pack_sprites(arr, remove):
    h, w = remove.shape
    ys, xs = np.where(remove)
    gy = ys // SPACING
    gx = xs // SPACING
    gw = int(gx.max()) + 3
    cell = gy.astype(np.int64) * gw + gx
    uniq, inv = np.unique(cell, return_inverse=True)
    count = np.bincount(inv)
    sumx = np.bincount(inv, weights=xs)
    sumy = np.bincount(inv, weights=ys)
    rng = np.random.default_rng(11)
    jitter = (rng.random((uniq.size, 2)) - 0.5) * SPACING * 0.9
    seedx = sumx / count + jitter[:, 0]
    seedy = sumy / count + jitter[:, 1]
    # Nearest jittered seed among the 3x3 neighboring cells, so pieces
    # meet on irregular edges instead of a square grid.
    seed_index = np.full(int(uniq.max()) + 1, -1, np.int32)
    seed_index[uniq] = np.arange(uniq.size, dtype=np.int32)
    best_d = np.full(ys.shape, np.inf)
    best_i = np.zeros(ys.shape, np.int32)
    gy_max = int(gy.max())
    gx_max = int(gx.max())
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            ny = gy + oy
            nx = gx + ox
            valid = (ny >= 0) & (nx >= 0) & (ny <= gy_max) & (nx <= gx_max)
            keys = np.clip(ny.astype(np.int64) * gw + nx, 0, seed_index.size - 1)
            idx = seed_index[keys]
            known = valid & (idx >= 0)
            dx = xs - seedx[np.clip(idx, 0, None)]
            dy = ys - seedy[np.clip(idx, 0, None)]
            dist = dx * dx + dy * dy
            dist[~known] = np.inf
            take = dist < best_d
            best_d[take] = dist[take]
            best_i[take] = idx[take]
    order = np.argsort(best_i, kind="mergesort")
    ys, xs, best_i = ys[order], xs[order], best_i[order]
    splits = np.flatnonzero(np.diff(best_i)) + 1
    groups = np.split(np.arange(best_i.size), splits)

    sprites = []
    for group in groups:
        if group.size < 1:
            continue
        py = ys[group]
        px = xs[group]
        x0, x1 = int(px.min()), int(px.max())
        y0, y1 = int(py.min()), int(py.max())
        sw, sh = x1 - x0 + 1, y1 - y0 + 1
        patch = np.zeros((sh, sw, 4), np.uint8)
        patch[py - y0, px - x0, :3] = arr[py, px]
        patch[py - y0, px - x0, 3] = 255
        weight = patch[:, :, 3] > 0
        coords = np.argwhere(weight)
        cy = float(coords[:, 0].mean())
        cx = float(coords[:, 1].mean())
        sprites.append({
            "x": x0,
            "y": y0,
            "w": sw,
            "h": sh,
            "cx": round(cx, 2),
            "cy": round(cy, 2),
            "patch": patch,
        })

    sprites.sort(key=lambda s: (-s["h"], -s["w"]))
    atlas_w = 2048
    x = y = row_h = 0
    used_h = 0
    for sprite in sprites:
        if x + sprite["w"] > atlas_w:
            y += row_h + 1
            x = 0
            row_h = 0
        sprite["ax"] = x
        sprite["ay"] = y
        row_h = max(row_h, sprite["h"])
        used_h = max(used_h, y + sprite["h"])
        x += sprite["w"] + 1
    atlas = np.zeros((used_h, atlas_w, 4), np.uint8)
    for sprite in sprites:
        ax, ay, sw, sh = sprite["ax"], sprite["ay"], sprite["w"], sprite["h"]
        atlas[ay : ay + sh, ax : ax + sw] = sprite["patch"]
    leaves = [
        [s["x"], s["y"], s["w"], s["h"], s["ax"], s["ay"], s["cx"], s["cy"]]
        for s in sprites
    ]
    return atlas, leaves


def main():
    src = Path(sys.argv[1] if len(sys.argv) > 1 else "/home/ubuntu/.cursor/projects/workspace/uploads/autumn-tree-reference_9e4d.png")
    arr = np.array(Image.open(src).convert("RGB"))
    h, w = arr.shape[:2]
    warm, pale, bark, _, _ = classify(arr)
    remove, poly = foliage_mask(warm, bark, np.zeros((h, w), bool))
    print(f"foliage pixels {int(remove.sum())} bark {int(bark.sum())}")
    plate = sky_plate(arr, remove, bark, pale)
    bare = arr.copy()
    bare[remove] = plate[remove]
    bare[bark] = arr[bark]

    # Sprites carry the original pixels, so the resting composite matches.
    atlas, leaves = pack_sprites(arr, remove)
    recon = bare.copy()
    # rebuild from the atlas to verify
    atlas_img = atlas
    for x, y, sw, sh, ax, ay, _cx, _cy in leaves:
        patch = atlas_img[ay : ay + sh, ax : ax + sw]
        alpha = patch[:, :, 3] > 0
        block = recon[y : y + sh, x : x + sw]
        block[alpha] = patch[:, :, :3][alpha]
        recon[y : y + sh, x : x + sw] = block
    diff = np.abs(recon.astype(np.int16) - arr.astype(np.int16)).max()
    print(f"sprites {len(leaves)} reconstruction max diff {int(diff)}")

    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(bare).save(OUT / "bare.png", optimize=True, compress_level=9)
    Image.fromarray(atlas).save(OUT / "leaves.png", optimize=True, compress_level=9)
    # Idle frame is the painting itself, so the first view is exact.
    Image.fromarray(arr).save(OUT / "scene.png", optimize=True, compress_level=9)
    payload = {
        "width": w,
        "height": h,
        "atlasWidth": int(atlas.shape[1]),
        "atlasHeight": int(atlas.shape[0]),
        "crown": poly,
        "leaves": leaves,
    }
    (OUT / "leaves.json").write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    for name in ("bare.png", "leaves.png", "scene.png", "leaves.json"):
        size = (OUT / name).stat().st_size
        print(f"{name:12} {size/1024/1024:.2f} MB")
    Image.fromarray(bare).resize((800, 800), Image.BOX).save("/tmp/bare_final.png")


if __name__ == "__main__":
    main()
