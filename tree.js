// Autumn lakeside tree. Leaves thin a little at a time, and the
// painting keeps moving: clouds drift, the crown sways, a few leaves fall.
(() => {
  const canvas = document.getElementById("scene");
  const statusEl = document.getElementById("status");
  const dropBtn = document.getElementById("drop");
  const growBtn = document.getElementById("grow");
  const ctx = canvas.getContext("2d");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DROP_SHARE = 0.22;

  const leaves = [];
  const ambient = [];
  const clouds = [];
  let skyImg = null;
  let landImg = null;
  let treeImg = null;
  let atlasImg = null;
  let cloudImg = null;
  let crown = [];
  let width = 1254;
  let height = 1254;
  let rootX = 648;
  let rootY = 1140;
  let ready = false;
  let time = 0;
  let cloudShift = 0;
  let shownStatus = "";

  dropBtn.disabled = true;
  growBtn.disabled = true;

  dropBtn.addEventListener("click", () => {
    const spot = randomAttached();
    dropLeaves(spot ? spot.homeCx : width * 0.5, spot ? spot.homeCy : height * 0.32);
  });
  growBtn.addEventListener("click", () => growLeaves());
  canvas.addEventListener("pointerdown", (event) => {
    if (!ready || event.button !== 0) return;
    const point = pointFromEvent(event);
    if (!point) return;
    const local = toTree(point.x, point.y);
    if (hitsTree(local.x, local.y)) onTreeActivate(local.x, local.y);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!ready) return;
    const point = pointFromEvent(event);
    if (!point) return;
    const local = toTree(point.x, point.y);
    canvas.style.cursor = hitsTree(local.x, local.y) ? "pointer" : "default";
  });
  canvas.addEventListener("keydown", (event) => {
    if (!ready || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onTreeActivate(width * 0.5, height * 0.32);
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  boot().catch(() => {
    statusEl.textContent = "畫面沒有載入。請重新整理。";
  });

  async function boot() {
    const [meta, sky, land, tree, atlas, cloudAtlas] = await Promise.all([
      fetch("assets/leaves.json").then((response) => {
        if (!response.ok) throw new Error("json");
        return response.json();
      }),
      loadImage("assets/sky.png"),
      loadImage("assets/land.png"),
      loadImage("assets/tree.png"),
      loadImage("assets/leaves.png"),
      loadImage("assets/clouds.png"),
    ]);
    skyImg = sky;
    landImg = land;
    treeImg = tree;
    atlasImg = atlas;
    cloudImg = cloudAtlas;
    crown = meta.crown;
    width = meta.width;
    height = meta.height;
    rootX = meta.root[0];
    rootY = meta.root[1];
    canvas.width = width;
    canvas.height = height;
    meta.leaves.forEach((spec, index) => leaves.push(makeLeaf(spec, index, false)));
    meta.ambient.forEach((spec, index) => ambient.push(makeDrifter(spec, index)));
    meta.clouds.forEach((spec) => {
      const [x, y, w, h, ax, ay] = spec;
      clouds.push({ x, y, w, h, ax, ay });
    });
    ready = true;
    dropBtn.disabled = false;
    growBtn.disabled = false;
    renderStatus();
    let last = performance.now();
    let acc = 0;
    requestAnimationFrame(function loop(now) {
      acc += Math.min(100, now - last);
      last = now;
      while (acc >= 1000 / 60) {
        update();
        acc -= 1000 / 60;
      }
      draw();
      requestAnimationFrame(loop);
    });
  }

  function makeLeaf(spec, index, drifting) {
    const [homeX, homeY, w, h, ax, ay, cx, cy] = spec;
    return {
      index,
      homeX,
      homeY,
      homeCx: homeX + cx,
      homeCy: homeY + cy,
      x: homeX + cx,
      y: homeY + cy,
      w,
      h,
      ax,
      ay,
      cx,
      cy,
      vx: 0,
      vy: 0,
      angle: 0,
      vr: 0,
      gravity: 0.16,
      wind: 0.4,
      maxFall: 6.2,
      phase: hash(index + (drifting ? 90 : 0)) * Math.PI * 2,
      state: "on",
      delay: 0,
      fromX: homeX + cx,
      fromY: homeY + cy,
      t: 0,
      restY: homeY + cy,
      bounces: 0,
    };
  }

  function makeDrifter(spec, index) {
    const leaf = makeLeaf(spec, index + 8000, true);
    leaf.alive = true;
    leaf.x = leaf.homeCx;
    leaf.y = leaf.homeCy;
    primeDrifter(leaf, false);
    return leaf;
  }

  function primeDrifter(leaf, fromTop) {
    const sway = hash(leaf.index + Math.floor(time) + 4);
    leaf.x = fromTop ? 180 + sway * (width - 360) : leaf.homeCx;
    leaf.y = fromTop ? -20 - sway * 80 : leaf.homeCy;
    leaf.vx = 0.15 + (sway - 0.4) * 0.7;
    leaf.vy = 0.35 + sway * 0.7;
    leaf.vr = (sway < 0.5 ? -1 : 1) * (0.008 + sway * 0.02);
    leaf.angle = sway * Math.PI;
    leaf.alive = true;
  }

  function update() {
    time += 1;
    if (!reduceMotion) cloudShift += 0.32;
    const gust = Math.sin(time * 0.013) * 0.62 + Math.sin(time * 0.005) * 0.28;
    for (const leaf of leaves) {
      if (leaf.state === "fall") updateFall(leaf, gust);
      else if (leaf.state === "grow") updateGrow(leaf);
    }
    if (!reduceMotion) updateAmbient();
    renderStatus();
  }

  function updateFall(leaf, gust) {
    if (leaf.delay > 0) {
      leaf.delay -= 1;
      if (leaf.delay === 0) {
        const world = toWorld(leaf.homeCx, leaf.homeCy);
        leaf.x = world.x;
        leaf.y = world.y;
      }
      return;
    }
    leaf.vy = Math.min(leaf.vy + leaf.gravity, leaf.maxFall);
    leaf.vx += (leaf.wind + gust - leaf.vx) * 0.018;
    leaf.vx += Math.sin(time * 0.07 + leaf.phase) * 0.055;
    leaf.vx = clamp(leaf.vx, -2.6, 3.2);
    leaf.x += leaf.vx;
    leaf.y += leaf.vy;
    leaf.angle += leaf.vr + Math.sin(time * 0.11 + leaf.phase) * 0.012;

    const margin = 18;
    if (leaf.x < margin) {
      leaf.x = margin;
      leaf.vx = Math.abs(leaf.vx) * 0.4;
    } else if (leaf.x > width - margin) {
      leaf.x = width - margin;
      leaf.vx = -Math.abs(leaf.vx) * 0.4;
    }

    if (leaf.y < leaf.restY) return;
    leaf.y = leaf.restY;
    leaf.vy *= -0.22;
    leaf.vx *= 0.5;
    leaf.vr *= 0.4;
    leaf.bounces += 1;
    if (leaf.bounces >= 2 || Math.abs(leaf.vy) < 0.45) {
      leaf.state = "ground";
      leaf.y = leaf.restY;
      leaf.vy = 0;
      leaf.vx = 0;
      leaf.vr = 0;
    }
  }

  function updateGrow(leaf) {
    if (leaf.delay > 0) {
      leaf.delay -= 1;
      return;
    }
    leaf.t += 1 / 96;
    if (leaf.t >= 1) {
      leaf.state = "on";
      leaf.x = leaf.homeCx;
      leaf.y = leaf.homeCy;
      leaf.vx = 0;
      leaf.vy = 0;
      leaf.angle = 0;
      return;
    }
    const eased = 1 - (1 - leaf.t) ** 3;
    const arc = Math.sin(leaf.t * Math.PI) * 86;
    leaf.x = leaf.fromX + (leaf.homeCx - leaf.fromX) * eased;
    leaf.y = leaf.fromY + (leaf.homeCy - leaf.fromY) * eased - arc;
    leaf.angle *= 0.9;
  }

  function updateAmbient() {
    const cover = canopyCover();
    for (const leaf of ambient) {
      if (!leaf.alive) continue;
      leaf.x += leaf.vx + Math.sin(time * 0.02 + leaf.phase) * 0.18;
      leaf.y += leaf.vy;
      leaf.angle += leaf.vr;
      const gone = leaf.y > height - 30 || leaf.x < -40 || leaf.x > width + 40;
      if (!gone) continue;
      if (cover > 0.06) primeDrifter(leaf, true);
      else leaf.alive = false;
    }
  }

  function canopyCover() {
    if (!leaves.length) return 0;
    let on = 0;
    for (const leaf of leaves) if (leaf.state === "on") on += 1;
    return on / leaves.length;
  }

  function dropLeaves(originX, originY) {
    const attached = leaves.filter((leaf) => leaf.state === "on");
    if (!attached.length) return;
    const count = attached.length < 70
      ? attached.length
      : Math.max(1, Math.round(attached.length * DROP_SHARE));
    const ranked = attached
      .map((leaf) => ({
        leaf,
        score: Math.hypot(leaf.homeCx - originX, leaf.homeCy - originY) + hash(leaf.index + 13) * 220,
      }))
      .sort((a, b) => a.score - b.score)
      .slice(0, count);
    for (const { leaf } of ranked) release(leaf, originX, originY);
  }

  function release(leaf, originX, originY) {
    const sway = hash(leaf.index + 17);
    const dist = Math.hypot(leaf.homeCx - originX, leaf.homeCy - originY);
    const world = toWorld(leaf.homeCx, leaf.homeCy);
    leaf.state = "fall";
    leaf.delay = reduceMotion ? 0 : Math.floor(sway * 72 + Math.min(dist, 280) * 0.05);
    leaf.x = world.x;
    leaf.y = world.y;
    leaf.gravity = 0.15 + sway * 0.12;
    leaf.maxFall = 5.2 + sway * 2.4;
    leaf.wind = 0.25 + (sway - 0.35) * 1.1;
    leaf.vx = 0.2 + Math.sign(leaf.homeCx - originX || 1) * 0.25 + (sway - 0.4) * 1.3;
    leaf.vy = -0.6 - sway * 1.8;
    leaf.vr = (sway < 0.5 ? -1 : 1) * (0.03 + sway * 0.08);
    leaf.angle = (sway - 0.5) * 0.4;
    leaf.bounces = 0;
    const ground = 1096 + Math.sin(leaf.homeCx * 0.021) * 14 + Math.sin(leaf.homeCx * 0.005) * 22;
    leaf.restY = clamp(ground + hash(leaf.index + 3) * 110, 1092, 1232);
    if (reduceMotion) {
      leaf.state = "ground";
      leaf.delay = 0;
      leaf.x = clamp(leaf.homeCx + leaf.vx * 28, 18, width - 18);
      leaf.y = leaf.restY;
      leaf.vx = 0;
      leaf.vy = 0;
      leaf.vr = 0;
    }
  }

  function growLeaves() {
    const loose = leaves.filter((leaf) => leaf.state !== "on" && leaf.state !== "grow");
    if (!loose.length) return;
    for (const leaf of loose) {
      const dist = Math.hypot(leaf.homeCx - width * 0.5, leaf.homeCy - height * 0.32);
      const sway = hash(leaf.index + 29);
      leaf.fromX = leaf.x;
      leaf.fromY = leaf.y;
      leaf.t = 0;
      leaf.delay = reduceMotion ? 0 : Math.floor(dist * 0.02 + sway * 16);
      leaf.vx = 0;
      leaf.vy = 0;
      leaf.state = "grow";
      if (reduceMotion) {
        leaf.state = "on";
        leaf.delay = 0;
        leaf.x = leaf.homeCx;
        leaf.y = leaf.homeCy;
        leaf.angle = 0;
      }
    }
    if (!reduceMotion) {
      for (const leaf of ambient) {
        if (!leaf.alive) primeDrifter(leaf, true);
      }
    }
  }

  function randomAttached() {
    const attached = leaves.filter((leaf) => leaf.state === "on");
    if (!attached.length) return null;
    return attached[Math.floor(hash(Math.floor(time) + 5) * attached.length)];
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
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (!skyImg) return;
    ctx.drawImage(skyImg, 0, 0);
    drawClouds();
    if (landImg) ctx.drawImage(landImg, 0, 0);

    ctx.save();
    applySway();
    if (treeImg) ctx.drawImage(treeImg, 0, 0);
    for (const leaf of leaves) {
      if (leaf.state === "on" || (leaf.state === "fall" && leaf.delay > 0)) drawSprite(leaf, leaf.homeX, leaf.homeY);
    }
    ctx.restore();

    const moving = [];
    for (const leaf of leaves) {
      if (leaf.state === "on" || (leaf.state === "fall" && leaf.delay > 0)) continue;
      moving.push(leaf);
    }
    for (const leaf of ambient) if (leaf.alive) moving.push(leaf);
    moving.sort((a, b) => a.y - b.y);
    for (const leaf of moving) drawLoose(leaf);
  }

  function drawClouds() {
    if (!cloudImg) return;
    const span = width + 160;
    for (const cloud of clouds) {
      let x = cloud.x + (reduceMotion ? 0 : cloudShift);
      x = ((x % span) + span) % span - 80;
      ctx.drawImage(cloudImg, cloud.ax, cloud.ay, cloud.w, cloud.h, Math.round(x), cloud.y, cloud.w, cloud.h);
      if (x + cloud.w > width - 40) {
        ctx.drawImage(cloudImg, cloud.ax, cloud.ay, cloud.w, cloud.h, Math.round(x - span), cloud.y, cloud.w, cloud.h);
      }
    }
  }

  function applySway() {
    const k = swayK();
    ctx.transform(1, 0, -k, 1, k * rootY, 0);
  }

  function swayK() {
    if (reduceMotion) return 0;
    return Math.sin(time * 0.018) * 0.01 + Math.sin(time * 0.007 + 1.2) * 0.004;
  }

  function toWorld(x, y) {
    const k = swayK();
    return { x: x - k * y + k * rootY, y };
  }

  function toTree(x, y) {
    const k = swayK();
    return { x: x + k * y - k * rootY, y };
  }

  function drawSprite(leaf, x, y) {
    ctx.drawImage(atlasImg, leaf.ax, leaf.ay, leaf.w, leaf.h, Math.round(x), Math.round(y), leaf.w, leaf.h);
  }

  function drawLoose(leaf) {
    if (leaf.angle === 0) {
      drawSprite(leaf, leaf.x - leaf.cx, leaf.y - leaf.cy);
      return;
    }
    ctx.save();
    ctx.translate(leaf.x, leaf.y);
    ctx.rotate(leaf.angle);
    ctx.drawImage(atlasImg, leaf.ax, leaf.ay, leaf.w, leaf.h, -leaf.cx, -leaf.cy, leaf.w, leaf.h);
    ctx.restore();
  }

  function hitsTree(x, y) {
    if (pointInPoly(x, y, crown)) return true;
    if (hitsTrunk(x, y)) return true;
    for (const leaf of leaves) {
      if (leaf.state !== "on") continue;
      if (x >= leaf.homeX && x < leaf.homeX + leaf.w && y >= leaf.homeY && y < leaf.homeY + leaf.h) return true;
    }
    return false;
  }

  function hitsTrunk(x, y) {
    if (y < 820 || y > 1165) return false;
    const t = (y - 820) / 345;
    const mid = 640 + Math.sin(t * 2.2) * 24;
    return Math.abs(x - mid) < 70 + t * 190;
  }

  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0];
      const yi = poly[i][1];
      const xj = poly[j][0];
      const yj = poly[j][1];
      const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.00001) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function renderStatus() {
    if (!ready) return;
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
    const total = leaves.length || 1;
    let text = "葉子還在樹上。";
    if (grow) text = "葉子正長回來。";
    else if (fall) text = "又有一些葉子落下來。";
    else if (on === 0 && ground) text = "枝頭已經空了。";
    else if (on > 0 && on / total < 0.18) text = "樹上的葉子不多了。";
    else if (on > 0 && ground) text = "樹冠薄了一些。";
    if (text !== shownStatus) {
      statusEl.textContent = text;
      shownStatus = text;
    }
    dropBtn.classList.toggle("is-ready", on > 0 && grow === 0);
    growBtn.classList.toggle("is-ready", ground + fall > 0 && grow === 0);
  }

  function pointFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * width,
      y: ((event.clientY - rect.top) / rect.height) * height,
    };
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(src));
      image.src = src;
    });
  }

  function hash(n) {
    let x = Math.imul((n + 1) | 0, 374761393);
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
})();
