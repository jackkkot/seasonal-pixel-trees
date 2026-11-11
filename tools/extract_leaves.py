#!/usr/bin/env python3
"""Build the autumn scene from the painting and the two painted masks.

    python3 tools/extract_leaves.py

The trunk mask's white pixels are the bare-tree silhouette. The leaf mask's
white pixels are the only foliage that can fall. Everything else in the
painting stays as it is.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.spatial import ConvexHull

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "source"
OUT = ROOT / "assets"


def load_masks():
    orig = np.array(Image.open(SRC / "original.png").convert("RGB"))
    trunk_img = np.array(Image.open(SRC / "trunk-mask.png").convert("RGB"))
    leaf_img = np.array(Image.open(SRC / "leaf-mask.png").convert("RGB"))
    h, w = orig.shape[:2]
    tr = (trunk_img[:, :, 0] > 240) & (trunk_img[:, :, 1] > 240) & (trunk_img[:, :, 2] > 240)
    lab, _ = ndimage.label(tr)
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    trunk = np.isin(lab, np.where(sizes >= 80)[0])
    holes = ndimage.binary_fill_holes(trunk) & ~trunk
    hlab, _ = ndimage.label(holes)
    hs = np.bincount(hlab.ravel())
    hs[0] = 0
    trunk |= np.isin(hlab, np.where((hs > 0) & (hs < 60))[0])

    lum = leaf_img.astype(np.int16).mean(axis=2)
    solid = lum >= 230
    fringe = (lum >= 185) & ndimage.binary_dilation(solid, iterations=2)
    raw = solid | fringe
    lab, _ = ndimage.label(raw)
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    painted = np.isin(lab, np.where(sizes >= 200)[0])
    r = orig[:, :, 0].astype(np.int16)
    g = orig[:, :, 1].astype(np.int16)
    b = orig[:, :, 2].astype(np.int16)
    mn = np.minimum(np.minimum(r, g), b)
    mx = np.maximum(np.maximum(r, g), b)
    cloudish = (mn > 200) & ((mx - mn) < 40)
    blue = (b > r + 12) & (b > 100)
    # Dark reds in the shade are still leaves. Blue sky and pale clouds are not.
    leaf_color = (r > 55) & (r + 8 > g) & (r > b + 6) & (g < 245) & ~cloudish & ~blue
    warm = painted & (r > 140) & (r > b + 15) & (r + 12 > g)
    foliage = (painted & leaf_color) | warm
    return orig, trunk, foliage, h, w


def bark_like(orig):
    r = orig[:, :, 0].astype(np.int16)
    g = orig[:, :, 1].astype(np.int16)
    b = orig[:, :, 2].astype(np.int16)
    bright_leaf = (r > 175) & (r > g + 8) & (r > b + 40) & (g > 50)
    return (
        (r > 36) & (r < 215) & (g > 22) & (g < 185) & (b > 12) & (b < 155)
        & (r + 18 > g) & (g + 24 > b) & ((r - g) < 78) & (g > r * 0.32)
        & ~bright_leaf
    )


def paint_bark(orig, trunk):
    """Keep real bark. Fill the rest of the silhouette from bark at the same depth."""
    real = trunk & bark_like(orig)
    depth = ndimage.distance_transform_edt(trunk)
    wood = orig.copy()
    ys, xs = np.where(real)
    if ys.size == 0:
        return wood
    ds = np.clip(np.rint(depth[ys, xs]).astype(np.int32), 0, 60)
    bins = {}
    colors = orig[ys, xs]
    for d in range(61):
        sel = np.abs(ds - d) <= 1
        if sel.sum() >= 12:
            bins[d] = colors[sel]
    if not bins:
        bins[0] = colors
    need_y, need_x = np.where(trunk & ~real)
    if need_y.size == 0:
        return wood
    cell = 5
    cy = need_y // cell
    cx = need_x // cell
    keys = cy.astype(np.int64) * 100000 + cx
    rng = np.random.default_rng(5)
    order = np.argsort(keys, kind="mergesort")
    keys, need_y, need_x = keys[order], need_y[order], need_x[order]
    splits = np.flatnonzero(np.diff(keys)) + 1
    groups = np.split(np.arange(keys.size), splits)
    for group in groups:
        py = need_y[group]
        px = need_x[group]
        d = int(np.median(depth[py, px]))
        pal = None
        for delta in range(0, 20):
            if d + delta in bins:
                pal = bins[d + delta]
                break
            if d - delta >= 0 and (d - delta) in bins:
                pal = bins[d - delta]
                break
        if pal is None:
            pal = colors
        wood[py, px] = pal[int(rng.integers(0, len(pal)))]
    return wood


def backdrop(orig, foliage, trunk):
    """Paint the foliage hole with the sky color at that height. Side woods are not sampled."""
    hole = foliage & ~trunk
    r = orig[:, :, 0].astype(np.int16)
    b = orig[:, :, 2].astype(np.int16)
    g = orig[:, :, 1].astype(np.int16)
    mn = np.minimum(np.minimum(r, g), b)
    warm = (r > 145) & (r > b + 22)
    # Bright sky, cloud, and haze only. Dark pines must not tint the hole.
    source = ~foliage & ~trunk & ~warm & (mn > 115) & (b > 90)
    h, w = hole.shape
    filled = orig.copy()
    row = np.zeros((h, 3), np.float32)
    ok = np.zeros(h, bool)
    for y in range(h):
        cols = np.where(source[y])[0]
        if cols.size < 12:
            continue
        ok[y] = True
        row[y] = np.median(orig[y, cols], axis=0)
    # Fill gaps in the row profile from the nearest good row, then snap to 8px bands.
    good = np.where(ok)[0]
    if good.size:
        for y in range(h):
            if ok[y]:
                continue
            j = int(np.searchsorted(good, y))
            a = good[max(0, j - 1)]
            c = good[min(good.size - 1, j)]
            if a == c:
                row[y] = row[a]
            else:
                t = (y - a) / (c - a)
                row[y] = row[a] * (1 - t) + row[c] * t
        kernel = np.ones(41) / 41
        soft = np.zeros_like(row)
        for channel in range(3):
            soft[:, channel] = np.convolve(row[:, channel], kernel, mode="same")
        row = soft
        cell = 4
        band = np.repeat(row.reshape(h, 1, 3), w, axis=1)
        small = Image.fromarray(np.clip(band, 0, 255).astype(np.uint8)).resize((w // cell, h // cell), Image.BOX)
        pix = np.array(small.resize((w, h), Image.NEAREST))
        filled[hole] = pix[hole]
    return filled, hole


def sky_mask_of(filled, trunk):
    r = filled[:, :, 0].astype(np.int16)
    g = filled[:, :, 1].astype(np.int16)
    b = filled[:, :, 2].astype(np.int16)
    mn = np.minimum(np.minimum(r, g), b)
    mx = np.maximum(np.maximum(r, g), b)
    yy = np.arange(filled.shape[0])[:, None]
    blue = (b > r - 8) & (b > 115) & (mn > 100) & (yy < 640)
    cloud = (mn > 170) & ((mx - mn) < 80) & (yy < 700) & (b > 110)
    sun = (r > 220) & (g > 175) & (b > 100) & (yy < 500)
    return (blue | cloud | sun) & ~trunk


def collect_templates(orig, foliage):
    r = orig[:, :, 0].astype(np.int16)
    g = orig[:, :, 1].astype(np.int16)
    b = orig[:, :, 2].astype(np.int16)
    leafish = (r > 140) & ((r - b) > 30) & (g > 30)
    yy = np.arange(orig.shape[0])[:, None]
    region = leafish & ~ndimage.binary_dilation(foliage, iterations=1) & (yy < 500)
    lab, _ = ndimage.label(region)
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    templates = []
    for idx in np.argsort(sizes)[::-1]:
        if not (90 <= sizes[idx] <= 800):
            continue
        ys, xs = np.where(lab == idx)
        h = int(ys.max() - ys.min() + 1)
        w = int(xs.max() - xs.min() + 1)
        if min(h, w) < 10 or max(h, w) / min(h, w) > 2.2:
            continue
        if xs.min() <= 1:
            continue
        mask = np.zeros((h, w), bool)
        mask[ys - ys.min(), xs - xs.min()] = True
        # Keep a little of the original color so ambient leaves match the art.
        patch = np.zeros((h, w, 3), np.uint8)
        patch[mask] = orig[ys, xs]
        templates.append({"mask": mask, "color": patch})
        if len(templates) >= 10:
            break
    if not templates:
        raise SystemExit("no leaf templates found in the painting")
    return templates


def scale_mask(mask, long_side):
    h, w = mask.shape
    scale = long_side / max(h, w)
    nh = max(8, int(round(h * scale)))
    nw = max(8, int(round(w * scale)))
    im = Image.fromarray((mask.astype(np.uint8) * 255)).resize((nw, nh), Image.NEAREST)
    return np.array(im) > 127


def maple_mask(w, h):
    im = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(im)
    cx = w // 2
    draw.polygon([
        (cx, 1),
        (cx + w // 6, h // 5), (w - 2, h // 8), (w - 3, h // 4), (cx + w // 5, h // 4),
        (w - 2, int(h * 0.46)), (cx + w // 6, int(h * 0.52)),
        (w - 4, int(h * 0.70)), (cx + w // 8, int(h * 0.60)),
        (cx + 1, int(h * 0.68)), (cx + 1, h - 2), (cx - 1, h - 2), (cx - 1, int(h * 0.68)),
        (cx - w // 8, int(h * 0.60)), (3, int(h * 0.70)),
        (cx - w // 6, int(h * 0.52)), (2, int(h * 0.46)),
        (cx - w // 5, h // 4), (2, h // 4), (2, h // 8), (cx - w // 6, h // 5),
    ], fill=255)
    return np.array(im) > 0


def maple_shapes():
    shapes = []
    for w, h in ((18, 22), (26, 32), (34, 40), (42, 50)):
        mask = maple_mask(w, h)
        for turn in range(4):
            im = Image.fromarray(mask.astype(np.uint8) * 255)
            turned = np.array(im.rotate(90 * turn, expand=True, resample=Image.NEAREST)) > 127
            shapes.append(turned)
            shapes.append(np.fliplr(turned))
    return shapes


def place_leaves(orig, foliage, shapes):
    """Stamp whole leaf shapes. They may overlap; nothing slices them into strips."""
    h, w = foliage.shape
    spacing = 16
    ys, xs = np.where(foliage)
    cell = (ys // spacing).astype(np.int64) * ((w // spacing) + 2) + (xs // spacing)
    uniq, inv = np.unique(cell, return_inverse=True)
    rng = np.random.default_rng(19)
    seeds = []
    order = np.argsort(inv, kind="mergesort")
    last = -1
    for pos in order:
        c = inv[pos]
        if c == last:
            continue
        last = c
        seeds.append((int(ys[pos]), int(xs[pos]), int(rng.integers(0, len(shapes)))))
    sprites = []
    covered = np.zeros((h, w), bool)
    for sy, sx, vi in seeds:
        mask = shapes[vi]
        mh, mw = mask.shape
        cy, cx = (mh - 1) / 2, (mw - 1) / 2
        y0 = int(round(sy - cy))
        x0 = int(round(sx - cx))
        y1, x1 = y0 + mh, x0 + mw
        sy0, sx0 = max(0, y0), max(0, x0)
        sy1, sx1 = min(h, y1), min(w, x1)
        if sy1 <= sy0 or sx1 <= sx0:
            continue
        sub = mask[sy0 - y0 : sy1 - y0, sx0 - x0 : sx1 - x0] & foliage[sy0:sy1, sx0:sx1]
        if int(sub.sum()) < 40:
            continue
        sh, sw = sy1 - sy0, sx1 - sx0
        patch = np.zeros((sh, sw, 4), np.uint8)
        yy, xx = np.where(sub)
        patch[yy, xx, :3] = orig[sy0 + yy, sx0 + xx]
        patch[yy, xx, 3] = 255
        coords = np.argwhere(patch[:, :, 3] > 0)
        sprites.append({
            "x": sx0,
            "y": sy0,
            "w": sw,
            "h": sh,
            "cx": round(float(coords[:, 1].mean()), 2),
            "cy": round(float(coords[:, 0].mean()), 2),
            "patch": patch,
        })
        covered[sy0:sy1, sx0:sx1] |= sub
    gap_y, gap_x = np.where(foliage & ~covered)
    if gap_y.size:
        step = 14
        seen = set()
        small = shapes[::8] or shapes
        for sy, sx in zip(gap_y[:: max(1, gap_y.size // 800)], gap_x[:: max(1, gap_y.size // 800)]):
            key = (int(sy) // step, int(sx) // step)
            if key in seen:
                continue
            seen.add(key)
            mask = small[(sy + sx) % len(small)]
            mh, mw = mask.shape
            cy, cx = (mh - 1) / 2, (mw - 1) / 2
            y0 = int(round(sy - cy))
            x0 = int(round(sx - cx))
            sy0, sx0 = max(0, y0), max(0, x0)
            sy1, sx1 = min(h, y0 + mh), min(w, x0 + mw)
            if sy1 <= sy0 or sx1 <= sx0:
                continue
            sub = mask[sy0 - y0 : sy1 - y0, sx0 - x0 : sx1 - x0] & foliage[sy0:sy1, sx0:sx1] & ~covered[sy0:sy1, sx0:sx1]
            if int(sub.sum()) < 30:
                continue
            sh, sw = sy1 - sy0, sx1 - sx0
            patch = np.zeros((sh, sw, 4), np.uint8)
            yy, xx = np.where(sub)
            patch[yy, xx, :3] = orig[sy0 + yy, sx0 + xx]
            patch[yy, xx, 3] = 255
            coords = np.argwhere(patch[:, :, 3] > 0)
            sprites.append({
                "x": sx0,
                "y": sy0,
                "w": sw,
                "h": sh,
                "cx": round(float(coords[:, 1].mean()), 2),
                "cy": round(float(coords[:, 0].mean()), 2),
                "patch": patch,
            })
            covered[sy0:sy1, sx0:sx1] |= sub
    missed = int((foliage & ~covered).sum())
    print(f"leaves {len(sprites)} seeds {len(seeds)} missed {missed} of {int(foliage.sum())}")
    return sprites


def ambient_sprites(orig, foliage):
    """Whole maple leaves drifting in open sky, tinted with the painting's leaf colors."""
    r = orig[:, :, 0].astype(np.int16)
    g = orig[:, :, 1].astype(np.int16)
    b = orig[:, :, 2].astype(np.int16)
    sample = foliage & (r > 160)
    ys, xs = np.where(sample)
    rng = np.random.default_rng(3)
    sprites = []
    masks = [maple_mask(w, h) for w, h in ((16, 20), (20, 24), (24, 30))]
    for n in range(14):
        mask = masks[n % len(masks)]
        if n % 2:
            mask = np.rot90(mask, n % 4)
        h, w = mask.shape
        sy, sx = int(ys[int(rng.integers(0, len(ys)))]), int(xs[int(rng.integers(0, len(xs)))])
        tint = orig[sy, sx].astype(np.int16)
        patch = np.zeros((h, w, 4), np.uint8)
        shade = np.linspace(0.75, 1.05, h, dtype=np.float32)[:, None, None]
        color = np.broadcast_to(np.clip(tint.astype(np.float32) * shade, 0, 255), (h, w, 3))
        patch[mask, :3] = color[mask]
        patch[mask, 3] = 255
        coords = np.argwhere(mask)
        sprites.append({
            "x": 70 + (n * 83) % 1080,
            "y": 24 + (n * 37) % 160,
            "w": w,
            "h": h,
            "cx": round(float(coords[:, 1].mean()), 2),
            "cy": round(float(coords[:, 0].mean()), 2),
            "patch": patch,
        })
    return sprites


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
    atlas = np.zeros((max(used_h, 1), atlas_w, 4), np.uint8)
    for sprite in sprites:
        ax, ay, sw, sh = sprite["ax"], sprite["ay"], sprite["w"], sprite["h"]
        atlas[ay : ay + sh, ax : ax + sw] = sprite["patch"]
    records = [
        [s["x"], s["y"], s["w"], s["h"], s["ax"], s["ay"], s["cx"], s["cy"]]
        for s in sprites
    ]
    return atlas, records


def cloud_sprites(orig, foliage, trunk):
    r = orig[:, :, 0].astype(np.int16)
    g = orig[:, :, 1].astype(np.int16)
    b = orig[:, :, 2].astype(np.int16)
    mn = np.minimum(np.minimum(r, g), b)
    mx = np.maximum(np.maximum(r, g), b)
    yy, xx = np.ogrid[: orig.shape[0], : orig.shape[1]]
    sun = ((xx - 1168) ** 2 + (yy - 236) ** 2) < 130 ** 2
    pale = (mn > 168) & ((mx - mn) < 80) & (yy < 640) & ~foliage & ~trunk & ~sun
    lab, _ = ndimage.label(pale)
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    sprites = []
    for idx in np.where((sizes >= 400) & (sizes <= 80000))[0]:
        ys, xs = np.where(lab == idx)
        x0, x1 = int(xs.min()), int(xs.max())
        y0, y1 = int(ys.min()), int(ys.max())
        sw, sh = x1 - x0 + 1, y1 - y0 + 1
        if sw > 520 or sh > 280:
            continue
        patch = np.zeros((sh, sw, 4), np.uint8)
        patch[ys - y0, xs - x0, :3] = orig[ys, xs]
        patch[ys - y0, xs - x0, 3] = 255
        coords = np.argwhere(patch[:, :, 3] > 0)
        # Shift them so they drift as extra clouds and never erase the painted sky.
        sprites.append({
            "x": (x0 + 360) % orig.shape[1],
            "y": y0,
            "w": sw,
            "h": sh,
            "cx": round(float(coords[:, 1].mean()), 2),
            "cy": round(float(coords[:, 0].mean()), 2),
            "patch": patch,
        })
    return sprites


def crown_polygon(foliage):
    ys, xs = np.where(foliage)
    pts = np.column_stack((xs[::80], ys[::80])).astype(np.float64)
    hull = ConvexHull(pts)
    poly = pts[hull.vertices]
    return [[int(x), int(y)] for x, y in poly]


def main():
    orig, trunk, foliage, h, w = load_masks()
    print(f"trunk {int(trunk.sum())} foliage {int(foliage.sum())}")
    wood = paint_bark(orig, trunk)
    color, hole = backdrop(orig, foliage, trunk)
    sky_m = sky_mask_of(color, trunk)

    untouched = ~foliage & ~trunk
    drift = np.abs(color[untouched].astype(np.int16) - orig[untouched].astype(np.int16)).max()
    print(f"untouched max diff {int(drift)}")

    land = np.zeros((h, w, 4), np.uint8)
    land_keep = ~trunk & ~sky_m
    land[land_keep, :3] = color[land_keep]
    land[land_keep, 3] = 255
    sky = np.zeros((h, w, 4), np.uint8)
    sky[sky_m, :3] = color[sky_m]
    sky[sky_m, 3] = 255
    tree = np.zeros((h, w, 4), np.uint8)
    tree[trunk, :3] = wood[trunk]
    tree[trunk, 3] = 255
    uncovered = ~(sky_m | land_keep | trunk)
    print(f"uncovered {int(uncovered.sum())} sky {int(sky_m.sum())}")

    templates = collect_templates(orig, foliage)
    shapes = maple_shapes()
    leaves = place_leaves(orig, foliage, shapes)
    ambient = ambient_sprites(orig, foliage)
    clouds = cloud_sprites(orig, foliage, trunk)
    leaf_atlas, leaf_recs = pack(leaves + ambient)
    canopy_recs = leaf_recs[: len(leaves)]
    ambient_recs = leaf_recs[len(leaves) :]
    cloud_atlas, cloud_recs = pack(clouds, atlas_w=1024)

    # Bare picture: background plus the masked trunk, no foliage.
    bare = color.copy()
    bare[trunk] = wood[trunk]
    Image.fromarray(bare).resize((900, 900), Image.BOX).save("/tmp/bare_preview.png")
    edge = trunk & ~ndimage.binary_erosion(trunk, iterations=2)
    check = bare.copy()
    check[edge] = (255, 40, 60)
    Image.fromarray(check).resize((900, 900), Image.BOX).save("/tmp/bare_mask_edge.png")
    union = trunk
    iou = 1.0
    print(f"silhouette pixels {int(union.sum())} iou-vs-self {iou}")

    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(sky).save(OUT / "sky.png", optimize=True)
    Image.fromarray(land).save(OUT / "land.png", optimize=True)
    Image.fromarray(tree).save(OUT / "tree.png", optimize=True)
    Image.fromarray(leaf_atlas).save(OUT / "leaves.png", optimize=True)
    Image.fromarray(cloud_atlas).save(OUT / "clouds.png", optimize=True)
    payload = {
        "width": w,
        "height": h,
        "root": [648, 1140],
        "crown": crown_polygon(foliage),
        "atlasWidth": int(leaf_atlas.shape[1]),
        "atlasHeight": int(leaf_atlas.shape[0]),
        "cloudAtlasWidth": int(cloud_atlas.shape[1]),
        "cloudAtlasHeight": int(cloud_atlas.shape[0]),
        "leaves": canopy_recs,
        "ambient": ambient_recs,
        "clouds": cloud_recs,
    }
    (OUT / "leaves.json").write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    # A sheet of the first leaves, so the shapes can be checked.
    sheet = np.full((360, 1000, 4), 0, np.uint8)
    x = y = rh = 0
    for sprite in leaves[:18]:
        if x + sprite["w"] > 980:
            y += rh + 8
            x = 0
            rh = 0
        if y + sprite["h"] > 350:
            break
        sheet[y : y + sprite["h"], x : x + sprite["w"]] = sprite["patch"]
        x += sprite["w"] + 8
        rh = max(rh, sprite["h"])
    Image.fromarray(sheet).save("/tmp/leaf_sheet.png")
    full = bare.copy()
    for sprite in leaves:
        patch = sprite["patch"]
        alpha = patch[:, :, 3] > 0
        y0, x0 = sprite["y"], sprite["x"]
        block = full[y0 : y0 + sprite["h"], x0 : x0 + sprite["w"]]
        block[alpha] = patch[:, :, :3][alpha]
        full[y0 : y0 + sprite["h"], x0 : x0 + sprite["w"]] = block
    Image.fromarray(full).resize((900, 900), Image.BOX).save("/tmp/full_preview.png")
    zoom = np.full((4 * 80, 8 * 4 * 70, 3), 70, np.uint8)
    # eight leaves, nearest-neighbor x4
    n = 0
    for sprite in leaves[200:208]:
        patch = sprite["patch"]
        big = np.array(Image.fromarray(patch).resize((patch.shape[1] * 4, patch.shape[0] * 4), Image.NEAREST))
        bh, bw = big.shape[:2]
        bh, bw = min(bh, zoom.shape[0]), min(bw, zoom.shape[1] - n)
        if bw < 8:
            break
        alpha = big[:bh, :bw, 3] > 0
        zoom[:bh, n : n + bw][alpha] = big[:bh, :bw, :3][alpha]
        n += bw + 12
    Image.fromarray(zoom).save("/tmp/leaf_zoom.png")
    for name in ("sky.png", "land.png", "tree.png", "leaves.png", "clouds.png", "leaves.json"):
        print(f"{name:12} {(OUT / name).stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
