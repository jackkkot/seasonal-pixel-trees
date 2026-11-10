// Autumn lakeside tree. The painting is the scene; clicking the crown
// releases its leaves, and they can grow back.
(() => {
  const GRAVITY = 0.2;
  const MAX_FALL = 7.4;
  const WIND = 0.72;

  const canvas = document.getElementById("scene");
  const statusEl = document.getElementById("status");
  const dropBtn = document.getElementById("drop");
  const growBtn = document.getElementById("grow");
  const ctx = canvas.getContext("2d");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const leaves = [];
  let sceneImg = null;
  let bareImg = null;
  let atlasImg = null;
  let crown = [];
  let width = 1254;
  let height = 1254;
  let ready = false;
  let time = 0;
  let shownStatus = "";

  dropBtn.disabled = true;
  growBtn.disabled = true;

  dropBtn.addEventListener("click", () => dropLeaves(width * 0.5, height * 0.34));
  growBtn.addEventListener("click", () => growLeaves());
  canvas.addEventListener("pointerdown", (event) => {
    if (!ready || event.button !== 0) return;
    const point = pointFromEvent(event);
    if (point && hitsTree(point.x, point.y)) onTreeActivate(point.x, point.y);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!ready) return;
    const point = pointFromEvent(event);
    canvas.style.cursor = point && hitsTree(point.x, point.y) ? "pointer" : "default";
  });
  canvas.addEventListener("keydown", (event) => {
    if (!ready || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onTreeActivate(width * 0.5, height * 0.34);
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  boot().catch(() => {
    statusEl.textContent = "畫面沒有載入。請重新整理。";
  });

  async function boot() {
    const [meta, scene, bare, atlas] = await Promise.all([
      fetch("assets/leaves.json").then((response) => {
        if (!response.ok) throw new Error("json");
        return response.json();
      }),
      loadImage("assets/scene.png"),
      loadImage("assets/bare.png"),
      loadImage("assets/leaves.png"),
    ]);
    sceneImg = scene;
    bareImg = bare;
    atlasImg = atlas;
    crown = meta.crown;
    width = meta.width;
    height = meta.height;
    canvas.width = width;
    canvas.height = height;
    meta.leaves.forEach((spec, index) => {
      const [homeX, homeY, w, h, ax, ay, cx, cy] = spec;
      leaves.push({
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
        phase: hash(index) * Math.PI * 2,
        state: "on",
        delay: 0,
        fromX: homeX + cx,
        fromY: homeY + cy,
        t: 0,
        restY: homeY + cy,
        bounces: 0,
      });
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

  function update() {
    time += 1;
    for (const leaf of leaves) {
      if (leaf.state === "fall") updateFall(leaf);
      else if (leaf.state === "grow") updateGrow(leaf);
    }
    renderStatus();
  }

  function updateFall(leaf) {
    if (leaf.delay > 0) {
      leaf.delay -= 1;
      leaf.x = leaf.homeCx;
      leaf.y = leaf.homeCy;
      return;
    }
    leaf.vy = Math.min(leaf.vy + GRAVITY, MAX_FALL);
    leaf.vx += (WIND - leaf.vx) * 0.012;
    leaf.vx += Math.sin(time * 0.05 + leaf.phase) * 0.045;
    leaf.vx = clamp(leaf.vx, -2.4, 3.1);
    leaf.x += leaf.vx;
    leaf.y += leaf.vy;
    leaf.angle += leaf.vr + Math.sin(time * 0.09 + leaf.phase) * 0.01;

    const margin = 16;
    if (leaf.x < margin) {
      leaf.x = margin;
      leaf.vx = Math.abs(leaf.vx) * 0.45;
    } else if (leaf.x > width - margin) {
      leaf.x = width - margin;
      leaf.vx = -Math.abs(leaf.vx) * 0.45;
    }

    if (leaf.y < leaf.restY) return;
    leaf.y = leaf.restY;
    leaf.vy *= -0.28;
    leaf.vx *= 0.55;
    leaf.vr *= 0.45;
    leaf.bounces += 1;
    if (leaf.bounces >= 2 || Math.abs(leaf.vy) < 0.55) {
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
    leaf.t += 1 / 92;
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
    const arc = Math.sin(leaf.t * Math.PI) * 90;
    leaf.x = leaf.fromX + (leaf.homeCx - leaf.fromX) * eased;
    leaf.y = leaf.fromY + (leaf.homeCy - leaf.fromY) * eased - arc;
    leaf.angle *= 0.9;
  }

  function dropLeaves(originX, originY) {
    const attached = leaves.filter((leaf) => leaf.state === "on");
    if (!attached.length) return;
    for (const leaf of attached) {
      const dist = Math.hypot(leaf.homeCx - originX, leaf.homeCy - originY);
      const sway = hash(leaf.index + 17);
      leaf.state = "fall";
      leaf.delay = reduceMotion ? 0 : Math.floor(dist * 0.04 + sway * 14);
      leaf.x = leaf.homeCx;
      leaf.y = leaf.homeCy;
      leaf.vx = 0.35 + Math.sign(leaf.homeCx - originX || 1) * 0.2 + (sway - 0.35) * 1.4;
      leaf.vy = -1.1 - sway * 1.6;
      leaf.vr = (sway < 0.5 ? -1 : 1) * (0.045 + sway * 0.07);
      leaf.angle = 0;
      leaf.bounces = 0;
      const ground = 1008 + Math.sin(leaf.homeCx * 0.017) * 22 + Math.sin(leaf.homeCx * 0.004) * 36;
      leaf.restY = clamp(ground + hash(leaf.index + 3) * 170, 1004, 1210);
      if (reduceMotion) {
        leaf.state = "ground";
        leaf.delay = 0;
        leaf.x = clamp(leaf.homeCx + leaf.vx * 28, 16, width - 16);
        leaf.y = leaf.restY;
        leaf.vx = 0;
        leaf.vy = 0;
        leaf.vr = 0;
      }
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
      leaf.delay = reduceMotion ? 0 : Math.floor(dist * 0.028 + sway * 12);
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
    ctx.imageSmoothingEnabled = false;
    if (!sceneImg) return;
    const allOn = ready && leaves.every((leaf) => leaf.state === "on");
    if (!ready || allOn) {
      ctx.drawImage(sceneImg, 0, 0);
      return;
    }
    ctx.drawImage(bareImg, 0, 0);
    const ordered = leaves.slice().sort((a, b) => a.y - b.y || a.index - b.index);
    for (const leaf of ordered) drawLeaf(leaf);
  }

  function drawLeaf(leaf) {
    const parked = leaf.state === "on" || (leaf.state === "fall" && leaf.delay > 0);
    if (parked || leaf.angle === 0) {
      const x = parked ? leaf.homeX : Math.round(leaf.x - leaf.cx);
      const y = parked ? leaf.homeY : Math.round(leaf.y - leaf.cy);
      ctx.drawImage(atlasImg, leaf.ax, leaf.ay, leaf.w, leaf.h, x, y, leaf.w, leaf.h);
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
      const parked = leaf.state === "on" || (leaf.state === "fall" && leaf.delay > 0);
      if (!parked) continue;
      if (x >= leaf.homeX && x < leaf.homeX + leaf.w && y >= leaf.homeY && y < leaf.homeY + leaf.h) {
        return true;
      }
    }
    return false;
  }

  function hitsTrunk(x, y) {
    if (y < 830 || y > 1165) return false;
    const t = (y - 830) / 335;
    const mid = 640 + Math.sin(t * 2.4) * 28;
    return Math.abs(x - mid) < 54 + t * 210;
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
    let text = "葉子還在樹上。";
    if (grow) text = "葉子正長回來。";
    else if (fall) text = "風來了，葉子正落下。";
    else if (on && ground) text = "有些葉子還掛在樹上。";
    else if (ground) text = "湖畔鋪滿了落葉。";
    if (text !== shownStatus) {
      statusEl.textContent = text;
      shownStatus = text;
    }
    const idleOnTree = on > 0 && fall === 0 && grow === 0;
    const readyToGrow = ground > 0 && on === 0 && fall === 0 && grow === 0;
    dropBtn.classList.toggle("is-ready", idleOnTree);
    growBtn.classList.toggle("is-ready", readyToGrow);
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
