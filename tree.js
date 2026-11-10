// One autumn pixel tree. Click the canopy to drop leaves; grow them back after.
(() => {
  const W = 192;
  const H = 144;
  const GRAVITY = 0.072;
  const MAX_FALL = 1.65;
  const WIND = 0.2;
  const GROW_FRAMES = 108;

  const PALETTE = [
    { c: "#F4DE8A", h: "#FFF3C4", s: "#D4B45A" },
    { c: "#F0B43A", h: "#F6D56A", s: "#C48A28" },
    { c: "#E07A2F", h: "#F0A24A", s: "#B85A1C" },
    { c: "#D14E2A", h: "#E07A3C", s: "#A33820" },
    { c: "#B1382C", h: "#D14E2A", s: "#7E2420" },
    { c: "#7E9A3E", h: "#B4C864", s: "#567028" },
  ];

  const WOOD = {
    1: "#3A2416",
    2: "#6B4228",
    3: "#8F5C38",
    4: "#4A2E1C",
  };

  const SHAPES = [
    [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
    ],
    [
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
      [1, 2],
      [2, 2],
    ],
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
      [2, 2],
      [1, 2],
    ],
    [
      [0, 1],
      [1, 0],
      [1, 1],
      [2, 1],
      [3, 1],
      [2, 2],
    ],
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [0, 2],
    ],
  ];

  const CLUMPS = [
    { x: 96, y: 28, rx: 11, ry: 10 },
    { x: 96, y: 40, rx: 26, ry: 15 },
    { x: 70, y: 46, rx: 20, ry: 15 },
    { x: 122, y: 44, rx: 20, ry: 15 },
    { x: 52, y: 58, rx: 14, ry: 12 },
    { x: 140, y: 56, rx: 14, ry: 12 },
    { x: 76, y: 68, rx: 18, ry: 12 },
    { x: 116, y: 66, rx: 18, ry: 12 },
    { x: 96, y: 58, rx: 16, ry: 13 },
  ];

  // x0, y0, cx, cy, x1, y1, width
  const LIMBS = [
    [96, 98, 74, 86, 62, 64, 2.5],
    [62, 64, 46, 60, 48, 54, 1.45],
    [74, 78, 64, 62, 70, 50, 1.65],
    [96, 96, 92, 70, 96, 34, 2.4],
    [96, 46, 82, 34, 86, 28, 1.25],
    [96, 44, 112, 32, 112, 28, 1.25],
    [98, 98, 120, 84, 132, 62, 2.5],
    [132, 62, 148, 56, 146, 50, 1.45],
    [116, 80, 128, 64, 122, 48, 1.65],
  ];

  const MOSS = [
    [90, 112],
    [91, 112],
    [91, 113],
    [89, 115],
    [103, 116],
    [104, 116],
    [104, 117],
  ];

  const canvas = document.getElementById("scene");
  const statusEl = document.getElementById("status");
  const dropBtn = document.getElementById("drop");
  const growBtn = document.getElementById("grow");
  const ctx = canvas.getContext("2d");
  canvas.width = W;
  canvas.height = H;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rand = mulberry32(20261110);
  const leaves = [];
  let branchList = [];
  let perch = { x: 40, y: 56 };
  let time = 0;
  let shake = 0;
  let birdHop = 0;
  let shownStatus = "";

  const FRAMES = SHAPES.map((shape) => {
    const frames = [];
    let cur = shape;
    for (let i = 0; i < 4; i += 1) {
      frames.push(cur);
      cur = normalize(cur.map(([x, y]) => [y, -x]));
    }
    return frames;
  });

  buildBranches();
  buildLeaves();

  dropBtn.addEventListener("click", () => dropLeaves(96, 46));
  growBtn.addEventListener("click", () => growLeaves());
  canvas.addEventListener("pointerdown", (event) => {
    const point = pointFromEvent(event);
    if (point && hitsTree(point.x, point.y)) onTreeActivate(point.x, point.y);
  });
  canvas.addEventListener("pointermove", (event) => {
    const point = pointFromEvent(event);
    canvas.style.cursor = point && hitsTree(point.x, point.y) ? "pointer" : "default";
  });
  canvas.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onTreeActivate(96, 46);
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  let last = performance.now();
  let acc = 0;
  requestAnimationFrame(loop);

  function loop(now) {
    acc += Math.min(100, now - last);
    last = now;
    while (acc >= 1000 / 60) {
      update();
      acc -= 1000 / 60;
    }
    draw();
    requestAnimationFrame(loop);
  }

  function update() {
    time += 1;
    if (shake > 0) shake -= 1;
    if (birdHop > 0) birdHop -= 1;

    for (const leaf of leaves) {
      if (leaf.state === "fall") updateFall(leaf);
      else if (leaf.state === "grow") updateGrow(leaf);
    }
    renderStatus();
  }

  function updateFall(leaf) {
    if (leaf.delay > 0) {
      leaf.delay -= 1;
      leaf.x = leaf.homeX;
      leaf.y = leaf.homeY;
      return;
    }
    leaf.vy = Math.min(leaf.vy + GRAVITY, MAX_FALL);
    leaf.vx += (WIND - leaf.vx) * 0.012;
    leaf.vx += Math.sin(time * 0.06 + leaf.phase) * 0.028;
    leaf.vx = clamp(leaf.vx, -1.15, 1.35);
    leaf.x += leaf.vx;
    leaf.y += leaf.vy;
    leaf.angle += leaf.vr + Math.sin(time * 0.13 + leaf.phase) * 0.02;

    if (leaf.x < 3) {
      leaf.x = 3;
      leaf.vx = Math.abs(leaf.vx) * 0.45;
    } else if (leaf.x > W - 6) {
      leaf.x = W - 6;
      leaf.vx = -Math.abs(leaf.vx) * 0.45;
    }

    if (leaf.y < leaf.restY) return;
    leaf.y = leaf.restY;
    leaf.vy *= -0.28;
    leaf.vx *= 0.62;
    leaf.vr *= 0.5;
    leaf.bounces += 1;
    if (leaf.bounces >= 2 || Math.abs(leaf.vy) < 0.32) {
      leaf.state = "ground";
      leaf.y = leaf.restY;
      leaf.vy = 0;
      leaf.vx *= 0.15;
      leaf.vr = 0;
    }
  }

  function updateGrow(leaf) {
    if (leaf.delay > 0) {
      leaf.delay -= 1;
      return;
    }
    leaf.t += 1 / GROW_FRAMES;
    if (leaf.t >= 1) {
      leaf.state = "on";
      leaf.x = leaf.homeX;
      leaf.y = leaf.homeY;
      leaf.vx = 0;
      leaf.vy = 0;
      leaf.angle = 0;
      return;
    }
    const eased = 1 - (1 - leaf.t) ** 3;
    const arc = Math.sin(leaf.t * Math.PI) * 14;
    leaf.x = leaf.fromX + (leaf.homeX - leaf.fromX) * eased;
    leaf.y = leaf.fromY + (leaf.homeY - leaf.fromY) * eased - arc;
    leaf.angle *= 0.92;
  }

  function dropLeaves(originX, originY) {
    const attached = leaves.filter((leaf) => leaf.state === "on");
    shake = attached.length ? 9 : 5;
    birdHop = attached.length ? 14 : 4;
    if (!attached.length) return;

    for (const leaf of attached) {
      const dist = Math.hypot(leaf.homeX - originX, leaf.homeY - originY);
      leaf.state = "fall";
      leaf.delay = reduceMotion ? 0 : Math.floor(dist * 0.5 + Math.random() * 10);
      leaf.x = leaf.homeX;
      leaf.y = leaf.homeY;
      leaf.vx = 0.18 + Math.sign(leaf.homeX - originX || 1) * 0.12 + (Math.random() - 0.25) * 0.55;
      leaf.vy = -0.28 - Math.random() * 0.45;
      leaf.vr = (Math.random() < 0.5 ? -1 : 1) * (0.045 + Math.random() * 0.05);
      leaf.angle = 0;
      leaf.bounces = 0;
      const dx = (leaf.homeX - 96) / 62;
      const mound = Math.max(0, 1 - dx * dx);
      leaf.restY = 116 - Math.floor(mound * 6) - Math.floor(Math.random() * 3);
      if (reduceMotion) {
        leaf.state = "ground";
        leaf.x = clamp(leaf.homeX + leaf.vx * 18, 3, W - 6);
        leaf.y = leaf.restY;
        leaf.vx = 0;
        leaf.vy = 0;
      }
    }
  }

  function growLeaves() {
    const loose = leaves.filter((leaf) => leaf.state !== "on" && leaf.state !== "grow");
    if (!loose.length) {
      if (leaves.every((leaf) => leaf.state === "on")) shake = 5;
      return;
    }
    shake = 6;
    birdHop = 10;
    for (const leaf of loose) {
      const dist = Math.hypot(leaf.homeX - 96, leaf.homeY - 42);
      leaf.fromX = leaf.x;
      leaf.fromY = leaf.y;
      leaf.t = 0;
      leaf.delay = reduceMotion ? 0 : Math.floor(dist * 0.42 + Math.random() * 8);
      leaf.vx = 0;
      leaf.vy = 0;
      leaf.state = "grow";
      if (reduceMotion) {
        leaf.state = "on";
        leaf.x = leaf.homeX;
        leaf.y = leaf.homeY;
        leaf.angle = 0;
      }
    }
  }

  function onTreeActivate(x, y) {
    if (leaves.some((leaf) => leaf.state === "on")) {
      dropLeaves(x, y);
      return;
    }
    const busy = leaves.some((leaf) => leaf.state === "fall" || leaf.state === "grow");
    if (!busy) growLeaves();
  }

  function draw() {
    const smoothing = false;
    ctx.imageSmoothingEnabled = smoothing;
    ctx.webkitImageSmoothingEnabled = smoothing;

    const shift = treeShift();
    drawSky();
    drawSun();
    drawCloud(64, 16, 0.9);
    drawCloud(168, 18, 0.75);
    drawHills();
    drawGround();
    drawBranches(shift);
    drawMoss(shift);
    drawTufts();
    drawLeaves(shift);
    drawBird(shift);
    drawButterfly();
  }

  function drawSky() {
    const bands = [
      [0, 62, "#6AA6C8"],
      [62, 96, "#8FC4DE"],
      [96, 112, "#E7D3B0"],
      [112, H, "#F4E6CC"],
    ];
    for (const [y0, y1, color] of bands) {
      ctx.fillStyle = color;
      ctx.fillRect(0, y0, W, y1 - y0);
    }
  }

  function drawSun() {
    ctx.fillStyle = "#FFE59A";
    fillEllipse(28, 22, 8, 8);
    ctx.fillStyle = "#FFF6D2";
    fillEllipse(27, 21, 4, 4);
  }

  function drawCloud(cx, cy, scale) {
    ctx.fillStyle = "#FFF8EE";
    fillEllipse(cx, cy, 14 * scale, 6 * scale);
    fillEllipse(cx - 8 * scale, cy + 2, 8 * scale, 5 * scale);
    fillEllipse(cx + 9 * scale, cy + 1, 9 * scale, 5 * scale);
    ctx.fillStyle = "#F0E0CC";
    fillEllipse(cx + 1, cy + 3, 10 * scale, 3 * scale);
  }

  function drawHills() {
    ctx.fillStyle = "#8AA56A";
    for (let x = 0; x < W; x += 1) {
      const top = 98 + Math.round(Math.sin(x * 0.045) * 3 + Math.sin(x * 0.012) * 5);
      ctx.fillRect(x, top, 1, 120 - top);
    }
    ctx.fillStyle = "#A3BC7A";
    for (let x = 0; x < W; x += 1) {
      const top = 98 + Math.round(Math.sin(x * 0.045) * 3 + Math.sin(x * 0.012) * 5);
      ctx.fillRect(x, top, 1, 1);
    }
    ctx.fillStyle = "#6E8B52";
    for (let x = 0; x < W; x += 1) {
      const top = 108 + Math.round(Math.sin(x * 0.05 + 1.2) * 3);
      ctx.fillRect(x, top, 1, 120 - top);
    }
    farBush(22, 112, 7, "#7E9A58");
    farBush(46, 114, 4, "#6E8B52");
    farBush(168, 113, 6, "#7E9A58");
  }

  function farBush(cx, cy, rx, color) {
    ctx.fillStyle = color;
    fillEllipse(cx, cy, rx, Math.max(2, Math.round(rx * 0.55)));
  }

  function drawGround() {
    ctx.fillStyle = "#6E9A4C";
    ctx.fillRect(0, 118, W, 12);
    ctx.fillStyle = "#5C8740";
    ctx.fillRect(0, 130, W, H - 130);

    for (let y = 118; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const n = hash(x, y);
        if (n < 0.94) continue;
        ctx.fillStyle = n > 0.97 ? "#8FBF5E" : "#4C7434";
        ctx.fillRect(x, y, 1, 1);
      }
    }

    ctx.fillStyle = "#C4A06A";
    fillEllipse(98, 124, 30, 6);
    ctx.fillStyle = "#A68452";
    fillEllipse(100, 126, 18, 3);

    flower(22, 114, "#F2B6C8");
    flower(36, 115, "#FFF6EA");
    flower(166, 114, "#E07A9A");
    flower(178, 116, "#FFF6EA");
    mushroom(30, 112);
    stone(160, 115);

    for (let x = 0; x < W; x += 2) {
      const h = hash(x, 3) > 0.78 ? 4 : hash(x, 3) > 0.42 ? 2 : 1;
      ctx.fillStyle = hash(x, 9) > 0.55 ? "#8FBF5E" : "#3F6B34";
      ctx.fillRect(x, 118 - h, 1, h);
    }
  }

  function drawBranches(shift) {
    for (const pixel of branchList) {
      ctx.fillStyle = WOOD[pixel.tone];
      ctx.fillRect(pixel.x + shift, pixel.y, 1, 1);
    }
  }

  function drawMoss(shift) {
    for (const [x, y] of MOSS) {
      ctx.fillStyle = y % 2 ? "#6E8B3A" : "#8AAA50";
      ctx.fillRect(x + shift, y, 1, 1);
    }
  }

  function drawTufts() {
    const tufts = [16, 40, 72, 88, 108, 124, 150, 174];
    for (const x of tufts) {
      const h = 4 + (x % 3);
      ctx.fillStyle = x % 2 ? "#8FBF5E" : "#3E6A32";
      for (let i = 0; i < h; i += 1) ctx.fillRect(x, 117 - i, 1, 1);
      ctx.fillRect(x + 1, 116 - Math.floor(h / 2), 1, 2);
    }
  }

  function drawLeaves(shift) {
    const ordered = leaves.slice().sort((a, b) => visualY(a) - visualY(b) || a.id - b.id);
    for (const leaf of ordered) {
      const attached = leaf.state === "on" || (leaf.state === "fall" && leaf.delay > 0);
      const jiggle = attached && shake > 0 && ((leaf.id + time) & 1) ? 1 : 0;
      const x = attached ? leaf.homeX + shift : leaf.x;
      const y = (attached ? leaf.homeY : leaf.y) + jiggle;
      drawLeafSprite(x, y, leaf, poseOf(leaf));
    }
  }

  function drawLeafSprite(x, y, leaf, pose) {
    const pts = FRAMES[leaf.shape][pose];
    const ox = Math.round(x);
    const oy = Math.round(y);
    for (let i = 0; i < pts.length; i += 1) {
      ctx.fillStyle = i === 0 ? leaf.highlight : i === pts.length - 1 ? leaf.shade : leaf.color;
      ctx.fillRect(ox + pts[i][0], oy + pts[i][1], 1, 1);
    }
  }

  function drawBird(shift) {
    const hop = birdHop > 0 ? 2 : 0;
    const flap = birdHop > 0 && Math.floor(time / 4) % 2 === 0;
    const x = perch.x + shift;
    const y = perch.y - hop;
    ctx.fillStyle = "#2A211C";
    if (flap) {
      ctx.fillRect(x - 2, y - 2, 1, 1);
      ctx.fillRect(x + 3, y - 2, 1, 1);
    }
    ctx.fillRect(x, y, 3, 2);
    ctx.fillRect(x + 1, y + 2, 2, 1);
    ctx.fillStyle = "#F0D7B0";
    ctx.fillRect(x + 1, y + 1, 1, 1);
    ctx.fillStyle = "#F0A04A";
    ctx.fillRect(x + 3, y, 2, 1);
    ctx.fillStyle = "#FFF6EA";
    ctx.fillRect(x + 2, y, 1, 1);
    if (!flap) {
      ctx.fillStyle = "#2A211C";
      ctx.fillRect(x, y + 2, 1, 1);
      ctx.fillRect(x + 2, y + 2, 1, 1);
    }
  }

  function drawButterfly() {
    const x = 16 + Math.round((Math.sin(time * 0.02) + 1) * 7);
    const y = 70 + Math.round(Math.cos(time * 0.017) * 3);
    const up = Math.floor(time / 8) % 2 === 0;
    ctx.fillStyle = "#3C2416";
    ctx.fillRect(x, y, 1, 2);
    ctx.fillStyle = up ? "#D14E2A" : "#F0B43A";
    ctx.fillRect(x - 2, up ? y - 1 : y + 1, 2, 1);
    ctx.fillRect(x + 1, up ? y - 1 : y + 1, 2, 1);
    ctx.fillStyle = up ? "#F0B43A" : "#D14E2A";
    ctx.fillRect(x - 1, y, 1, 1);
    ctx.fillRect(x + 1, y + 1, 1, 1);
  }

  function flower(x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
    ctx.fillRect(x - 1, y + 1, 1, 1);
    ctx.fillRect(x + 1, y + 1, 1, 1);
    ctx.fillRect(x, y + 2, 1, 1);
    ctx.fillStyle = "#F6E39A";
    ctx.fillRect(x, y + 1, 1, 1);
    ctx.fillStyle = "#3F6B34";
    ctx.fillRect(x, y + 3, 1, 1);
  }

  function mushroom(x, y) {
    ctx.fillStyle = "#F4E6D0";
    ctx.fillRect(x, y, 2, 3);
    ctx.fillStyle = "#C4472E";
    ctx.fillRect(x - 2, y - 2, 6, 2);
    ctx.fillRect(x - 1, y - 3, 4, 1);
    ctx.fillStyle = "#FFF6EA";
    ctx.fillRect(x - 1, y - 2, 1, 1);
    ctx.fillRect(x + 2, y - 1, 1, 1);
  }

  function stone(x, y) {
    ctx.fillStyle = "#8A8178";
    ctx.fillRect(x, y, 6, 2);
    ctx.fillRect(x + 1, y - 1, 4, 1);
    ctx.fillStyle = "#D9D0C6";
    ctx.fillRect(x + 1, y, 2, 1);
    ctx.fillStyle = "#5E574F";
    ctx.fillRect(x, y + 1, 6, 1);
  }

  function buildBranches() {
    const pixels = new Map();
    const rank = { 1: 1, 2: 2, 4: 3, 3: 4 };

    for (let y = 96; y <= 126; y += 1) {
      const t = (y - 96) / 30;
      const width = 3.05 + t * 2.15;
      const x = 96 + Math.sin((y - 96) * 0.13) * 1.05;
      stamp(pixels, rank, x, y, width);
    }
    curve(pixels, rank, 90, 120, 78, 126, 68, 128, 1.7);
    curve(pixels, rank, 102, 120, 116, 126, 126, 128, 1.7);
    for (const limb of LIMBS) curve(pixels, rank, ...limb);

    pixels.set(93 + 108 * W, 1);
    pixels.set(94 + 108 * W, 1);
    pixels.set(94 + 109 * W, 1);

    branchList = [];
    for (const [key, tone] of pixels) {
      branchList.push({ x: key % W, y: (key / W) | 0, tone });
    }
    choosePerch();
  }

  function choosePerch() {
    let best = null;
    for (const pixel of branchList) {
      if (pixel.y < 48 || pixel.y > 70 || pixel.x > 78) continue;
      if (!best || pixel.x < best.x) best = pixel;
    }
    if (best) perch = { x: best.x - 3, y: best.y - 4 };
  }

  function buildLeaves() {
    const occupied = new Set();
    let id = 0;
    for (let y = 16; y <= 84; y += 3) {
      const row = Math.round((y - 16) / 3);
      for (let x = 34 + (row % 2); x <= 158; x += 3) {
        const depth = canopyDepth(x + 1, y + 1);
        if (depth > 1) continue;
        if (depth > 0.74 && rand() > 0.42) continue;
        if (depth < 0.74 && rand() > 0.94) continue;
        if (y > 78 && Math.abs(x - 96) < 8) continue;
        const lx = x + (rand() > 0.72 ? 1 : 0);
        const ly = y + (rand() > 0.72 ? 1 : 0);
        if (lx < 6 || lx > W - 10 || ly < 8) continue;
        const key = `${lx},${ly}`;
        if (occupied.has(key)) continue;
        occupied.add(key);
        const edge = depth > 0.68;
        leaves.push({
          id,
          homeX: lx,
          homeY: ly,
          x: lx,
          y: ly,
          vx: 0,
          vy: 0,
          vr: 0,
          angle: 0,
          phase: rand() * Math.PI * 2,
          shape: edge ? 2 + Math.floor(rand() * 3) : Math.floor(rand() * 3),
          state: "on",
          delay: 0,
          fromX: lx,
          fromY: ly,
          t: 0,
          restY: 114,
          bounces: 0,
          depth,
          color: "#E07A2F",
          highlight: "#F0A24A",
          shade: "#B85A1C",
        });
        id += 1;
      }
    }
    paintLeaves();
  }

  function paintLeaves() {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const leaf of leaves) {
      minX = Math.min(minX, leaf.homeX);
      maxX = Math.max(maxX, leaf.homeX);
      minY = Math.min(minY, leaf.homeY);
      maxY = Math.max(maxY, leaf.homeY);
    }
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    for (const leaf of leaves) {
      const nx = (leaf.homeX - minX) / spanX;
      const ny = (leaf.homeY - minY) / spanY;
      const patch = ((Math.floor(leaf.homeX / 8) * 13 + Math.floor(leaf.homeY / 8) * 7) % 5) / 5;
      let shade = ny * 0.66 + nx * 0.16 + patch * 0.22 + (rand() - 0.5) * 0.12;
      shade = clamp(shade, 0, 1);
      let index = Math.round(shade * 4);
      if (rand() < 0.045) index = 5;
      const swatch = PALETTE[index];
      leaf.color = swatch.c;
      leaf.highlight = swatch.h;
      leaf.shade = swatch.s;
    }
  }

  function stamp(pixels, rank, x, y, radius) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    const rad = Math.max(1, radius);
    const reach = Math.ceil(rad + 1);
    for (let py = -reach; py <= reach; py += 1) {
      for (let px = -reach; px <= reach; px += 1) {
        const dist = Math.hypot(px, py);
        if (dist > rad + 0.85) continue;
        const sx = ix + px;
        const sy = iy + py;
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
        const outline = dist > Math.max(0.55, rad - 0.8);
        let tone = 2;
        if (outline) tone = 1;
        else if (px < -0.25) tone = 3;
        else if (px > 0.7) tone = 4;
        const key = sx + sy * W;
        const prev = pixels.get(key);
        if (!prev || rank[tone] > rank[prev]) pixels.set(key, tone);
      }
    }
  }

  function curve(pixels, rank, x0, y0, cx, cy, x1, y1, width) {
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(x1 - x0, y1 - y0) + Math.hypot(cx - x0, cy - y0))
    );
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const it = 1 - t;
      const x = it * it * x0 + 2 * it * t * cx + t * t * x1;
      const y = it * it * y0 + 2 * it * t * cy + t * t * y1;
      stamp(pixels, rank, x, y, width * (1 - t * 0.28));
    }
  }

  function fillEllipse(cx, cy, rx, ry) {
    if (rx <= 0 || ry <= 0) return;
    const y0 = Math.round(cy - ry);
    const y1 = Math.round(cy + ry);
    for (let y = y0; y <= y1; y += 1) {
      const dy = (y - cy) / ry;
      if (dy * dy > 1) continue;
      const nx = Math.sqrt(1 - dy * dy) * rx;
      const x0 = Math.round(cx - nx);
      const x1 = Math.round(cx + nx);
      ctx.fillRect(x0, y, Math.max(1, x1 - x0), 1);
    }
  }

  function canopyDepth(x, y) {
    let best = Infinity;
    for (const clump of CLUMPS) {
      const dx = (x - clump.x) / clump.rx;
      const dy = (y - clump.y) / clump.ry;
      best = Math.min(best, dx * dx + dy * dy);
    }
    return best;
  }

  function hitsTree(x, y) {
    if (canopyDepth(x, y) <= 1.18) return true;
    if (y < 90 || y > 128) return false;
    const t = (y - 90) / 38;
    return Math.abs(x - 96) <= 6 + t * 6;
  }

  function poseOf(leaf) {
    if (leaf.state === "on" || (leaf.state === "fall" && leaf.delay > 0)) return 0;
    if (leaf.state === "ground") return leaf.id % 4;
    const turns = Math.floor(leaf.angle / (Math.PI / 2));
    return ((turns % 4) + 4) % 4;
  }

  function visualY(leaf) {
    if (leaf.state === "on" || (leaf.state === "fall" && leaf.delay > 0)) return leaf.homeY;
    return leaf.y;
  }

  function treeShift() {
    if (shake > 0) return time % 2 === 0 ? 1 : -1;
    const sway = Math.sin(time * 0.018);
    if (sway > 0.72) return 1;
    if (sway < -0.72) return -1;
    return 0;
  }

  function pointFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * W,
      y: ((event.clientY - rect.top) / rect.height) * H,
    };
  }

  function renderStatus() {
    let on = 0;
    let fall = 0;
    let ground = 0;
    let grow = 0;
    for (const leaf of leaves) {
      if (leaf.state === "on") on += 1;
      else if (leaf.state === "fall") fall += 1;
      else if (leaf.state === "ground") ground += 1;
      else grow += 1;
    }
    let text = "葉子還在樹上。";
    if (grow) text = "葉子正在長回來。";
    else if (fall) text = "沙沙……葉子正落下來。";
    else if (on && ground) text = "有些葉子還掛在樹上。";
    else if (ground) text = "地上鋪滿了葉子。";
    if (text !== shownStatus) {
      statusEl.textContent = text;
      shownStatus = text;
    }
    const idleOnTree = on > 0 && fall === 0 && grow === 0;
    const readyToGrow = ground > 0 && on === 0 && fall === 0 && grow === 0;
    dropBtn.classList.toggle("is-next", idleOnTree);
    growBtn.classList.toggle("is-next", readyToGrow);
  }

  function normalize(points) {
    const minX = Math.min(...points.map((point) => point[0]));
    const minY = Math.min(...points.map((point) => point[1]));
    return points.map(([x, y]) => [x - minX, y - minY]);
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash(x, y) {
    let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
})();
