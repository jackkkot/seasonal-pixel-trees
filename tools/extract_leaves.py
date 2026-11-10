#!/usr/bin/env python3
"""Build layered art for the autumn tree.

    python3 tools/extract_leaves.py path/to/autumn-reference.png

Writes sky, land, a solid bare tree, drifting clouds, and leaf sprites.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets"
SRC_DEFAULT = "/home/ubuntu/.cursor/projects/workspace/uploads/autumn-tree-reference_9e4d.png"
SPACING = 18


def colors(arr):
    r = arr[:, :, 0].astype(np.int16)
    g = arr[:, :, 1].astype(np.int16)
    b = arr[:, :, 2].astype(np.int16)
    mn = np.minimum(np.minimum(r, g), b)
    mx = np.maximum(np.maximum(r, g), b)
    return r, g, b, mn, mx


def classify(arr):
    h, w = arr.shape[:2]
    r, g, b, mn, mx = colors(arr)
    yy, xx = np.ogrid[:h, :w]
    pale = (mn > 150) & ((mx - mn) < 100) & (b > 100) & (g > 125)
    warm = (r > 70) & (r + 12 >= g) & (r > b + 14) & ((mx - mn) > 26) & ~pale
    warm &= ~((b > 125) & (g > 145) & (r > 175))
    cool = (b > 70) & (b + 26 >= g) & (b + 36 >= r)
    sun = ((xx - 1168) ** 2 + (yy - 236) ** 2) < 100 ** 2
    bark0 = (
        (r > 42) & (g > 32) & (b > 24) & (r < 190) & (g > r * 0.45)
        & (r + 4 > g) & (g + 16 > b) & ((r - g) < 72) & ((g - b) < 58) & ~pale
    )
    bridged = ndimage.binary_dilation(bark0, iterations=5)
    labels, _ = ndimage.label(bridged)
    zone = np.zeros((h, w), bool)
    zone[820:1220, 340:980] = True
    ids = np.unique(labels[zone & bridged])
    ids = ids[ids != 0]
    bark = bark0 & np.isin(labels, ids)
    return warm, pale, cool, sun, bark, yy, xx


def masks(h, w):
    poly = [
        (340, 36), (560, 8), (780, 4), (1000, 36), (1120, 110),
        (1200, 230), (1210, 420), (1140, 590), (1060, 730),
        (960, 830), (820, 860), (660, 820), (530, 870),
        (390, 850), (270, 750), (180, 600), (140, 440),
        (160, 280), (230, 150), (290, 70),
    ]
    crown_img = Image.new("L", (w, h), 0)
    ImageDraw.Draw(crown_img).polygon(poly, fill=255)
    crown = np.array(crown_img) > 0
    blocked = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(blocked)
    draw.polygon([(0, 760), (70, 820), (110, 960), (150, 1180), (0, 1240)], fill=255)
    draw.polygon([(1253, 860), (1080, 910), (1020, 1020), (1253, 1180)], fill=255)
    draw.rectangle((0, 1030, w, h), fill=255)
    forest = np.array(blocked) > 0
    return crown, forest, poly


def solid_wood(arr, bark, yy, xx):
    """Thicken the real brown limbs without adopting the red leaf masses."""
    r = arr[:, :, 0].astype(np.int16)
    g = arr[:, :, 1].astype(np.int16)
    b = arr[:, :, 2].astype(np.int16)
    pale = (np.minimum(np.minimum(r, g), b) > 150)
    loose0 = (
        (r > 38) & (g > 28) & (b > 22) & (r < 210) & (g > r * 0.34)
        & (r + 6 > g) & (g + 20 > b) & ((r - g) < 110) & ~pale
    )
    bridged = ndimage.binary_dilation(loose0, iterations=4)
    labels, _ = ndimage.label(bridged)
    zone = np.zeros(arr.shape[:2], bool)
    zone[820:1220, 340:980] = True
    ids = np.unique(labels[zone & bridged])
    ids = ids[ids != 0]
    loose = loose0 & np.isin(labels, ids)

    limb = ndimage.binary_dilation(bark, iterations=4)
    limb = ndimage.binary_closing(limb, iterations=2)
    holes = ndimage.binary_fill_holes(limb) & ~limb
    hlab, _ = ndimage.label(holes)
    hs = np.bincount(hlab.ravel())
    hs[0] = 0
    limb |= np.isin(hlab, np.where((hs > 0) & (hs < 800))[0])
    # A little of the looser brown, but only where it touches a real limb.
    limb |= loose & ndimage.binary_dilation(bark, iterations=7)

    trunk = ndimage.binary_dilation(bark & (yy > 780), iterations=9)
    trunk = ndimage.binary_closing(trunk, iterations=3)
    trunk &= ndimage.binary_dilation(bark, iterations=18)
    tholes = ndimage.binary_fill_holes(trunk) & ~trunk
    tlab, _ = ndimage.label(tholes)
    ts = np.bincount(tlab.ravel())
    ts[0] = 0
    trunk |= np.isin(tlab, np.where((ts > 0) & (ts < 20000))[0])
    solid = limb | (trunk & (yy > 760) & (xx > 280) & (xx < 1060))

    near = ndimage.distance_transform_edt(~bark, return_distances=False, return_indices=True)
    dist = ndimage.distance_transform_edt(~bark)
    wood = arr[near[0], near[1]].astype(np.float32)
    shade = np.clip(1 - dist / 14.0, 0.7, 1)
    extra = solid & ~bark
    for channel in range(3):
        wood[:, :, channel] = np.where(
            extra,
            np.clip(wood[:, :, channel] * (0.82 + 0.18 * shade), 0, 255),
            wood[:, :, channel],
        )
    return solid, wood.astype(np.uint8)


def build_sky(arr, cool, pale, sun, warm):
    h, w = arr.shape[:2]
    sample = cool | pale | sun
    left = np.zeros((h, 3), np.float64)
    right = np.zeros((h, 3), np.float64)
    left_ok = np.zeros(h, bool)
    right_ok = np.zeros(h, bool)
    for y in range(h):
        cols_l = np.where(sample[y, :280])[0]
        cols_r = np.where(sample[y, w - 320 :])[0]
        if cols_l.size > 10:
            left[y] = np.median(arr[y, cols_l], axis=0)
            left_ok[y] = True
        if cols_r.size > 10:
            right[y] = np.median(arr[y, w - 320 + cols_r], axis=0)
            right_ok[y] = True

    def smooth(column, ok):
        known = np.where(ok)[0]
        out = column.copy()
        for y in range(h):
            if ok[y]:
                continue
            j = int(np.searchsorted(known, y))
            a = known[max(0, j - 1)]
            c = known[min(known.size - 1, j)]
            if a == c:
                out[y] = column[a]
            else:
                t = (y - a) / (c - a)
                out[y] = column[a] * (1 - t) + column[c] * t
        tile = np.clip(out, 0, 255).astype(np.uint8).reshape(h, 1, 3).repeat(24, axis=1)
        blurred = np.array(Image.fromarray(tile).filter(ImageFilter.GaussianBlur(16)))
        return blurred[:, 0].astype(np.float32)

    left_s = smooth(left, left_ok)
    right_s = smooth(right, right_ok)
    xs = np.arange(w, dtype=np.float32)
    blend = np.clip((xs - 160) / (w - 380), 0, 1)
    gradient = left_s[:, None, :] * (1 - blend)[None, :, None] + right_s[:, None, :] * blend[None, :, None]
    sky = np.clip(gradient, 0, 255).astype(np.uint8)
    cell = 8
    small = Image.fromarray(sky).resize((w // cell, h // cell), Image.BOX)
    sky = np.array(small.resize((w, h), Image.NEAREST))
    sky[sun & ~warm] = arr[sun & ~warm]
    return sky


def pack(sprites, atlas_w=2048):
    sprites = sorted(sprites, key=lambda s: (-s["h"], -s["w"]))
    x = y = row_h = used_h = 0
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
    if used_h < 1:
        used_h = 1
    atlas = np.zeros((used_h, atlas_w, 4), np.uint8)
    for sprite in sprites:
        ax, ay, sw, sh = sprite["ax"], sprite["ay"], sprite["w"], sprite["h"]
        atlas[ay : ay + sh, ax : ax + sw] = sprite["patch"]
    records = [
        [s["x"], s["y"], s["w"], s["h"], s["ax"], s["ay"], s["cx"], s["cy"]]
        for s in sprites
    ]
    return atlas, records


def sprites_from_mask(arr, mask, spacing):
    ys, xs = np.where(mask)
    if ys.size == 0:
        return []
    h, w = arr.shape[:2]
    gy = ys // spacing
    gx = xs // spacing
    gw = int(gx.max()) + 3
    cell = gy.astype(np.int64) * gw + gx
    uniq, inv = np.unique(cell, return_inverse=True)
    count = np.bincount(inv)
    seedx = np.bincount(inv, weights=xs) / count
    seedy = np.bincount(inv, weights=ys) / count
    rng = np.random.default_rng(11)
    jitter = (rng.random((uniq.size, 2)) - 0.5) * spacing * 0.85
    seedx = seedx + jitter[:, 0]
    seedy = seedy + jitter[:, 1]
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
            dist = (xs - seedx[np.clip(idx, 0, None)]) ** 2 + (ys - seedy[np.clip(idx, 0, None)]) ** 2
            dist = np.where(known, dist, np.inf)
            take = dist < best_d
            best_d[take] = dist[take]
            best_i[take] = idx[take]
    order = np.argsort(best_i, kind="mergesort")
    ys, xs, best_i = ys[order], xs[order], best_i[order]
    splits = np.flatnonzero(np.diff(best_i)) + 1
    groups = np.split(np.arange(best_i.size), splits)
    sprites = []
    for group in groups:
        if group.size < 6:
            continue
        py = ys[group]
        px = xs[group]
        x0, x1 = int(px.min()), int(px.max())
        y0, y1 = int(py.min()), int(py.max())
        sw, sh = x1 - x0 + 1, y1 - y0 + 1
        if sw > 96 or sh > 96:
            continue
        patch = np.zeros((sh, sw, 4), np.uint8)
        patch[py - y0, px - x0, :3] = arr[py, px]
        patch[py - y0, px - x0, 3] = 255
        coords = np.argwhere(patch[:, :, 3] > 0)
        sprites.append({
            "x": x0,
            "y": y0,
            "w": sw,
            "h": sh,
            "cx": round(float(coords[:, 1].mean()), 2),
            "cy": round(float(coords[:, 0].mean()), 2),
            "patch": patch,
        })
    return sprites


def component_sprites(arr, mask, min_size, max_size, max_side=220):
    labels, _ = ndimage.label(mask)
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    sprites = []
    for idx in np.where((sizes >= min_size) & (sizes <= max_size))[0]:
        ys, xs = np.where(labels == idx)
        x0, x1 = int(xs.min()), int(xs.max())
        y0, y1 = int(ys.min()), int(ys.max())
        sw, sh = x1 - x0 + 1, y1 - y0 + 1
        if sw > max_side or sh > max_side:
            continue
        patch = np.zeros((sh, sw, 4), np.uint8)
        patch[ys - y0, xs - x0, :3] = arr[ys, xs]
        patch[ys - y0, xs - x0, 3] = 255
        coords = np.argwhere(patch[:, :, 3] > 0)
        sprites.append({
            "x": x0,
            "y": y0,
            "w": sw,
            "h": sh,
            "cx": round(float(coords[:, 1].mean()), 2),
            "cy": round(float(coords[:, 0].mean()), 2),
            "patch": patch,
        })
    return sprites


def main():
    src = Path(sys.argv[1] if len(sys.argv) > 1 else SRC_DEFAULT)
    arr = np.array(Image.open(src).convert("RGB"))
    h, w = arr.shape[:2]
    warm, pale, cool, sun, bark, yy, xx = classify(arr)
    crown, forest, poly = masks(h, w)
    solid, wood = solid_wood(arr, bark, yy, xx)
    sky = build_sky(arr, cool, pale, sun, warm)

    # Follow the foliage itself so the crown is not sliced on a straight edge.
    passable = warm & ~solid & ~forest & (yy < 930)
    labels, _ = ndimage.label(passable)
    seed_ids = np.unique(labels[crown & passable])
    seed_ids = seed_ids[seed_ids != 0]
    canopy = np.isin(labels, seed_ids)
    r, g, b, _mn, _mx = colors(arr)
    tree_box = (xx > 220) & (xx < 1140) & (yy > 40) & (yy < 980) & ~forest
    reddish = (r > 96) & (r > g) & (r > b + 10)
    canopy |= (warm | reddish) & tree_box & ~solid
    # Leaves already loose in the painting become the ambient drift.
    air_mask = warm & ~crown & ~forest & ~solid & (yy < 860) & (yy > 8)
    air_sprites = component_sprites(arr, air_mask, 24, 4200, 80)
    air_sprites = [s for s in air_sprites if s["y"] + s["cy"] < 820 and not (s["x"] < 200 and s["y"] > 500)]
    air_cover = np.zeros((h, w), bool)
    for sprite in air_sprites:
        patch = sprite["patch"]
        alpha = patch[:, :, 3] > 0
        air_cover[sprite["y"] : sprite["y"] + sprite["h"], sprite["x"] : sprite["x"] + sprite["w"]] |= alpha

    leaf_sprites = sprites_from_mask(arr, canopy & ~air_cover, SPACING)
    # Fold tiny canopy crumbs into the cleared area even if they missed a sprite.
    canopy_cover = np.zeros((h, w), bool)
    for sprite in leaf_sprites:
        patch = sprite["patch"]
        alpha = patch[:, :, 3] > 0
        canopy_cover[sprite["y"] : sprite["y"] + sprite["h"], sprite["x"] : sprite["x"] + sprite["w"]] |= alpha

    clear = (canopy | air_cover | (crown & ~solid & ~forest)) & ~solid
    # Heal leaf crumbs stuck to the limbs: close ones become wood, the rest
    # take the landscape or sky color behind them.
    crumbs = warm & ndimage.binary_dilation(solid, iterations=12) & ~canopy_cover & ~air_cover & ~solid & ~forest & (yy < 990) & (yy > 60)
    near_limb = ndimage.binary_dilation(solid, iterations=3)
    wood_crumbs = crumbs & near_limb
    open_crumbs = crumbs & ~near_limb
    solid = solid | wood_crumbs
    backdrop = (~warm | forest) & ~wood_crumbs
    source = ndimage.distance_transform_edt(~backdrop, return_distances=False, return_indices=True)
    healed = arr.copy()
    healed[open_crumbs] = arr[source[0][open_crumbs], source[1][open_crumbs]]
    # High crumbs open onto sky. Lower ones are the landscape seen between limbs.
    sky_crumbs = open_crumbs & (yy < 640)
    land_crumbs = open_crumbs & ~sky_crumbs
    arr = healed
    clear |= sky_crumbs

    cloud_mask = pale & ~sun & ~clear & ~solid & (yy < 760) & ~warm
    cloud_sprites = component_sprites(arr, cloud_mask, 80, 90000, 520)
    # A few extra clouds parked behind the crown so the bare tree is not an empty disc.
    extras = []
    donors = [s for s in cloud_sprites if s["w"] > 40][:4]
    shifts = [(180, 40), (420, 90), (700, 30), (260, 160)]
    for donor, (dx, dy) in zip(donors, shifts):
        extras.append({
            **{k: donor[k] for k in ("w", "h", "cx", "cy", "patch")},
            "x": dx,
            "y": dy,
        })
    cloud_sprites = cloud_sprites + extras

    land = np.zeros((h, w, 4), np.uint8)
    land_keep = (~clear & ~solid & ~(cool | pale | sun)) | land_crumbs
    land[land_keep, :3] = arr[land_keep]
    land[land_keep, 3] = 255

    tree = np.zeros((h, w, 4), np.uint8)
    tree[solid, :3] = wood[solid]
    tree[solid, 3] = 255

    combined = leaf_sprites + air_sprites
    leaf_atlas, combined_records = pack(combined)
    leaves = combined_records[: len(leaf_sprites)]
    ambient = combined_records[len(leaf_sprites) :]
    cloud_atlas, clouds = pack(cloud_sprites, atlas_w=1024)

    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(sky).save(OUT / "sky.png", optimize=True, compress_level=9)
    Image.fromarray(land).save(OUT / "land.png", optimize=True, compress_level=9)
    Image.fromarray(tree).save(OUT / "tree.png", optimize=True, compress_level=9)
    Image.fromarray(leaf_atlas).save(OUT / "leaves.png", optimize=True, compress_level=9)
    Image.fromarray(cloud_atlas).save(OUT / "clouds.png", optimize=True, compress_level=9)
    payload = {
        "width": w,
        "height": h,
        "root": [648, 1140],
        "crown": poly,
        "atlasWidth": int(leaf_atlas.shape[1]),
        "atlasHeight": int(leaf_atlas.shape[0]),
        "cloudAtlasWidth": int(cloud_atlas.shape[1]),
        "cloudAtlasHeight": int(cloud_atlas.shape[0]),
        "leaves": leaves,
        "ambient": ambient,
        "clouds": clouds,
    }
    (OUT / "leaves.json").write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")

    # Bare preview: sky, clouds at rest, land, tree.
    preview = sky.copy()
    for x, y, sw, sh, ax, ay, _cx, _cy in clouds:
        patch = cloud_atlas[ay : ay + sh, ax : ax + sw]
        alpha = patch[:, :, 3] > 0
        y1, x1 = min(h, y + sh), min(w, x + sw)
        if y >= h or x >= w or y1 <= y or x1 <= x:
            continue
        sub = alpha[: y1 - y, : x1 - x]
        preview[y:y1, x:x1][sub] = patch[: y1 - y, : x1 - x, :3][sub]
    land_a = land[:, :, 3] > 0
    preview[land_a] = land[:, :, :3][land_a]
    tree_a = tree[:, :, 3] > 0
    preview[tree_a] = tree[:, :, :3][tree_a]
    Image.fromarray(preview).resize((900, 900), Image.BOX).save("/tmp/bare_check.png")
    print(f"canopy {len(leaves)} ambient {len(ambient)} clouds {len(clouds)} solid {int(solid.sum())}")
    for name in ("sky.png", "land.png", "tree.png", "leaves.png", "clouds.png", "leaves.json"):
        print(f"{name:12} {(OUT / name).stat().st_size / 1024 / 1024:.2f} MB")


if __name__ == "__main__":
    main()
