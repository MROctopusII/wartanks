(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const titleScreen = document.getElementById('titleScreen');
  const gameShell = document.getElementById('gameShell');
  const startBtn = document.getElementById('startBtn');
  const nameInput = document.getElementById('nameInput');
  const rInput = document.getElementById('rInput');
  const gInput = document.getElementById('gInput');
  const bInput = document.getElementById('bInput');
  const rValue = document.getElementById('rValue');
  const gValue = document.getElementById('gValue');
  const bValue = document.getElementById('bValue');
  const colorPreview = document.getElementById('colorPreview');
  const colorHex = document.getElementById('colorHex');
  const movementButtons = Array.from(document.querySelectorAll('.movementButton'));
  const SERVER_URL = 'https://wartanks-tbt6.onrender.com';

  const bodyImg = new Image();
  const turretImg = new Image();
  const grassImg = new Image();
  const bodyLightImg = new Image();
  const bodyShadowImg = new Image();
  const turretLightImg = new Image();
  const turretShadowImg = new Image();
  const explosionImg = new Image();
  const smokeImg = new Image();
  bodyImg.dataset.assetId = 'body';
  turretImg.dataset.assetId = 'turret';
  grassImg.dataset.assetId = 'grass';
  bodyLightImg.dataset.assetId = 'bodyLightMap';
  bodyShadowImg.dataset.assetId = 'bodyShadowMap';
  turretLightImg.dataset.assetId = 'turretLightMap';
  turretShadowImg.dataset.assetId = 'turretShadowMap';
  explosionImg.dataset.assetId = 'explosionParticle';
  smokeImg.dataset.assetId = 'smokeParticle';
  bodyImg.src = 'images/tank_body.png';
  turretImg.src = 'images/tank_turret.png';
  grassImg.src = 'images/terrain_grass.png';
  bodyLightImg.src = 'images/tank_body_lightmap.png';
  bodyShadowImg.src = 'images/tank_body_shadowmap.png';
  turretLightImg.src = 'images/tank_turret_lightmap.png';
  turretShadowImg.src = 'images/tank_turret_shadowmap.png';
  explosionImg.src = 'images/explosion_particle.png';
  smokeImg.src = 'images/smoke_particle.png';

  const view = { w: 960, h: 540, dpr: 1 };
  const world = { w: 20000, h: 14000 };
  const camera = { x: 0, y: 0 };
  const mouse = { x: 480, y: 270, worldX: 0, worldY: 0, down: false };
  const keys = Object.create(null);
  const players = [];
  const bullets = [];
  const blasts = [];
  const tintCache = new Map();

  const BODY_PIVOT = { x: 193, y: 137 };
  const TURRET_PIVOT = { x: 225, y: 66 };
  const SCALE = 0.28;
  const TANK_RADIUS = 42;
  const BULLET_RADIUS = 5;
  const MINIMAP_W = 220;
  const MINIMAP_H = 150;

  let running = false;
  let lastTime = performance.now();
  let grassPattern = null;
  let playerColor = '#e31b13';
  let movementStyle = 'tank';
  let ws = null;
  let myId = null;
  let connected = false;
  let connectionStatus = 'offline';
  let deathReturnTimer = null;
  const seenEvents = new Set();

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function rand(min, max) { return min + Math.random() * (max - min); }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => clamp(v, 0, 255).toString(16).padStart(2, '0')).join('');
  }
  function getCurrentPlayerColor() {
    return rgbToHex(parseInt(rInput.value, 10), parseInt(gInput.value, 10), parseInt(bInput.value, 10));
  }
  function updateColorPreview() {
    rValue.textContent = rInput.value;
    gValue.textContent = gInput.value;
    bValue.textContent = bInput.value;
    playerColor = getCurrentPlayerColor();
    colorPreview.style.background = playerColor;
    colorHex.textContent = playerColor.toUpperCase();
  }
  function loadImage(img) {
    return new Promise(resolve => {
      if (img.complete && img.naturalWidth > 0) resolve(true);
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
    });
  }
  function tintedSprite(maskImg, color, lightMap, shadowMap) {
    if (!maskImg || !maskImg.complete || maskImg.naturalWidth <= 0) return null;
    color = (color && /^#[0-9a-fA-F]{6}$/.test(color)) ? color : '#e31b13';
    const key = (maskImg.dataset.assetId || maskImg.src) + '|online3dlit|' + color.toLowerCase();
    if (tintCache.has(key)) return tintCache.get(key);

    const c = document.createElement('canvas');
    c.width = maskImg.naturalWidth;
    c.height = maskImg.naturalHeight;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(maskImg, 0, 0);
    g.globalCompositeOperation = 'source-over';
    if (shadowMap && shadowMap.complete && shadowMap.naturalWidth > 0) g.drawImage(shadowMap, 0, 0);
    if (lightMap && lightMap.complete && lightMap.naturalWidth > 0) g.drawImage(lightMap, 0, 0);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(maskImg, 0, 0);
    g.globalCompositeOperation = 'source-over';
    tintCache.set(key, c);
    return c;
  }

  function resize() {
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.w = Math.max(320, window.innerWidth || 960);
    view.h = Math.max(240, window.innerHeight || 540);
    canvas.width = Math.floor(view.w * view.dpr);
    canvas.height = Math.floor(view.h * view.dpr);
    canvas.style.width = view.w + 'px';
    canvas.style.height = view.h + 'px';
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    makeGrassPattern();
    updateCamera();
    updateMouseWorld();
    if (running) render();
  }
  function makeGrassPattern() {
    if (!grassPattern && grassImg.complete && grassImg.naturalWidth > 0) grassPattern = ctx.createPattern(grassImg, 'repeat');
  }
  function myPlayer() { return players.find(p => p.id === myId) || null; }
  function updateCamera() {
    const p = myPlayer();
    const follow = p || players[0];
    if (!follow) {
      camera.x = clamp(world.w / 2 - view.w / 2, 0, world.w - view.w);
      camera.y = clamp(world.h / 2 - view.h / 2, 0, world.h - view.h);
      return;
    }
    camera.x = clamp(follow.x - view.w / 2, 0, world.w - view.w);
    camera.y = clamp(follow.y - view.h / 2, 0, world.h - view.h);
  }
  function updateMouseWorld() {
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width ? (mouse.x - rect.left) * (view.w / rect.width) : mouse.x;
    const sy = rect.height ? (mouse.y - rect.top) * (view.h / rect.height) : mouse.y;
    mouse.worldX = sx + camera.x;
    mouse.worldY = sy + camera.y;
  }
  function key(code, char) { return !!keys[code] || !!keys[char]; }

  function spawnExplosion(x, y, size = 90, life = .28, vx = 0, vy = 0) {
    blasts.push({ kind: 'explosion', x, y, vx, vy, age: 0, life, size, grow: size * 0.55, angle: rand(0, Math.PI * 2), spin: rand(-1.8, 1.8), alphaStart: 1 });
  }
  function spawnSmoke(x, y, size = 52, life = .75, vx = null, vy = null) {
    blasts.push({ kind: 'smoke', x, y, vx: vx ?? rand(-22, 22), vy: vy ?? rand(-28, -6), age: 0, life, size, grow: size * rand(0.45, 0.95), angle: rand(0, Math.PI * 2), spin: rand(-.65, .65), alphaStart: rand(.38, .72) });
  }
  function spawnHitEffect(x, y, bulletVx = 0, bulletVy = 0) {
    spawnExplosion(x, y, rand(40, 52), .16, bulletVx * 0.015, bulletVy * 0.015);
    spawnSmoke(x + rand(-4, 4), y + rand(-4, 4), rand(20, 28), .42, bulletVx * 0.01 + rand(-10, 10), bulletVy * 0.01 + rand(-12, 4));
    spawnSmoke(x + rand(-6, 6), y + rand(-6, 6), rand(26, 34), .56, rand(-14, 14), rand(-20, -4));
  }
  function spawnDeathEffect(x, y) {
    spawnExplosion(x, y, 125, .28);
    spawnExplosion(x + rand(-18, 18), y + rand(-18, 18), 96, .22, rand(-18, 18), rand(-18, 18));
    for (let i = 0; i < 6; i++) {
      const a = rand(0, Math.PI * 2);
      const speed = rand(10, 42);
      const d = rand(6, 28);
      spawnSmoke(x + Math.cos(a) * d, y + Math.sin(a) * d, rand(42, 68), rand(.75, 1.2), Math.cos(a) * speed, Math.sin(a) * speed - rand(6, 18));
    }
  }
  function updateBlasts(dt) {
    for (let i = blasts.length - 1; i >= 0; i--) {
      const e = blasts[i];
      e.age += dt;
      if (e.vx) e.x += e.vx * dt;
      if (e.vy) e.y += e.vy * dt;
      if (e.spin) e.angle += e.spin * dt;
      if (e.age >= e.life) blasts.splice(i, 1);
    }
  }
  function handleServerEvents(events) {
    for (const e of events || []) {
      if (seenEvents.has(e.id)) continue;
      seenEvents.add(e.id);
      if (seenEvents.size > 500) seenEvents.clear();
      if (e.kind === 'hit') spawnHitEffect(e.x, e.y, e.vx || 0, e.vy || 0);
      if (e.kind === 'death') spawnDeathEffect(e.x, e.y);
    }
  }

  function websocketURL() {
    // Server hardcoded for the GitHub Pages frontend.
    // Browser WebSocket needs wss://, so the Render https:// URL is converted here.
    return SERVER_URL.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://').replace(/\/+$/, '');
  }

  function connectOnline() {
    disconnectOnline(false);
    connectionStatus = 'connecting';
    const url = websocketURL();
    if (!url) {
      connectionStatus = 'Render server missing';
      return;
    }
    const socket = new WebSocket(url);
    ws = socket;

    socket.addEventListener('open', () => {
      connected = true;
      connectionStatus = 'online';
      const playerName = (nameInput.value || 'Pilot').trim().slice(0, 16) || 'Pilot';
      socket.send(JSON.stringify({ type: 'join', name: playerName, color: getCurrentPlayerColor(), movementStyle }));
    });
    socket.addEventListener('message', ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.type === 'joined') {
        myId = msg.id;
        if (msg.world) { world.w = msg.world.w; world.h = msg.world.h; }
      } else if (msg.type === 'state') {
        if (msg.you) myId = msg.you;
        if (msg.world) { world.w = msg.world.w; world.h = msg.world.h; }
        players.length = 0;
        for (const p of msg.players || []) players.push(p);
        bullets.length = 0;
        for (const b of msg.bullets || []) bullets.push(b);
        handleServerEvents(msg.events || []);
        const me = myPlayer();
        if (me && !me.alive && deathReturnTimer === null) deathReturnTimer = 1.0;
      } else if (msg.type === 'dead') {
        if (deathReturnTimer === null) deathReturnTimer = 1.0;
      }
    });
    socket.addEventListener('close', () => {
      connected = false;
      if (running && deathReturnTimer === null) connectionStatus = 'disconnected - Render server unreachable';
    });
    socket.addEventListener('error', () => {
      connected = false;
      connectionStatus = 'connection error - WebSocket failed';
    });
  }
  function disconnectOnline(closeSocket = true) {
    connected = false;
    if (ws && closeSocket) {
      try { ws.close(); } catch (_) {}
    }
    ws = null;
  }
  function sendInput() {
    if (!running || !connected || !ws || ws.readyState !== WebSocket.OPEN) return;
    const me = myPlayer();
    if (!me || !me.alive) return;
    updateCamera();
    updateMouseWorld();
    const aimAngle = Math.atan2(mouse.worldY - me.y, mouse.worldX - me.x);
    const input = {
      up: key('KeyW', 'w') || key('ArrowUp', 'arrowup'),
      down: key('KeyS', 's') || key('ArrowDown', 'arrowdown'),
      left: key('KeyA', 'a') || key('ArrowLeft', 'arrowleft'),
      right: key('KeyD', 'd') || key('ArrowRight', 'arrowright'),
      mouseDown: mouse.down,
      aimAngle
    };
    ws.send(JSON.stringify({ type: 'input', input, movementStyle }));
  }

  function drawGround() {
    ctx.fillStyle = '#29451f';
    ctx.fillRect(0, 0, view.w, view.h);
    makeGrassPattern();
    if (grassPattern) {
      ctx.save();
      ctx.translate(-((camera.x % 250) + 250), -((camera.y % 250) + 250));
      ctx.fillStyle = grassPattern;
      ctx.fillRect(0, 0, view.w + 500, view.h + 500);
      ctx.restore();
    }
  }
  function drawFallbackTank(t, sx, sy) {
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(t.bodyAngle);
    ctx.fillStyle = t.color;
    ctx.fillRect(-38, -24, 76, 48);
    ctx.restore();
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(t.turretAngle);
    ctx.fillStyle = t.color;
    ctx.fillRect(-14, -13, 46, 26);
    ctx.fillRect(-62, -5, 65, 10);
    ctx.restore();
  }
  function drawHealthAndName(t, sx, sy) {
    const nameY = sy - 68;
    const barY = sy - 52;
    const barW = 62;
    const barH = 8;
    const hpRatio = clamp(t.hp / t.maxHp, 0, 1);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 13px Verdana, Arial, sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.fillStyle = '#ffffff';
    ctx.strokeText(t.name, sx, nameY);
    ctx.fillText(t.name, sx, nameY);
    if (t.regenerating) {
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#4cff77';
    }
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(sx - barW / 2 - 1, barY - 1, barW + 2, barH + 2);
    ctx.fillStyle = 'rgba(70,70,70,0.9)';
    ctx.fillRect(sx - barW / 2, barY, barW, barH);
    ctx.fillStyle = hpRatio > 0.55 ? '#35d04d' : (hpRatio > 0.25 ? '#f0c230' : '#e34635');
    ctx.fillRect(sx - barW / 2, barY, barW * hpRatio, barH);
    ctx.shadowBlur = 0;
    if (t.regenerating) {
      ctx.font = 'bold 12px Verdana, Arial, sans-serif';
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.fillStyle = '#78ff91';
      ctx.strokeText('+', sx + barW / 2 + 8, barY + 3);
      ctx.fillText('+', sx + barW / 2 + 8, barY + 3);
    }
    ctx.restore();
  }
  function drawTank(t) {
    if (!t.alive) return;
    const sx = t.x - camera.x;
    const sy = t.y - camera.y;
    if (sx < -140 || sy < -140 || sx > view.w + 140 || sy > view.h + 140) return;
    const bodySprite = tintedSprite(bodyImg, t.color, bodyLightImg, bodyShadowImg);
    const turretSprite = tintedSprite(turretImg, t.color, turretLightImg, turretShadowImg);
    if (!bodySprite || !turretSprite) {
      drawFallbackTank(t, sx, sy);
      drawHealthAndName(t, sx, sy);
      return;
    }
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(t.bodyAngle - Math.PI);
    ctx.drawImage(bodySprite, -BODY_PIVOT.x * SCALE, -BODY_PIVOT.y * SCALE, bodySprite.width * SCALE, bodySprite.height * SCALE);
    ctx.restore();
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(t.turretAngle - Math.PI);
    ctx.drawImage(turretSprite, -TURRET_PIVOT.x * SCALE, -TURRET_PIVOT.y * SCALE, turretSprite.width * SCALE, turretSprite.height * SCALE);
    ctx.restore();
    drawHealthAndName(t, sx, sy);
  }
  function drawBullets() {
    for (const b of bullets) {
      const sx = b.x - camera.x;
      const sy = b.y - camera.y;
      if (sx < -20 || sy < -20 || sx > view.w + 20 || sy > view.h + 20) continue;
      ctx.fillStyle = '#ffe36b';
      ctx.beginPath();
      ctx.arc(sx, sy, BULLET_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  function drawBlasts() {
    for (const e of blasts) {
      const sx = e.x - camera.x;
      const sy = e.y - camera.y;
      if (sx < -180 || sy < -180 || sx > view.w + 180 || sy > view.h + 180) continue;
      const p = clamp(e.age / e.life, 0, 1);
      const size = e.size + e.grow * p;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(e.angle || 0);
      if (e.kind === 'smoke' && smokeImg.complete && smokeImg.naturalWidth > 0) {
        ctx.globalAlpha = (e.alphaStart ?? .6) * Math.pow(1 - p, 1.12);
        ctx.drawImage(smokeImg, -size / 2, -size / 2, size, size);
      } else if (e.kind === 'explosion' && explosionImg.complete && explosionImg.naturalWidth > 0) {
        ctx.globalAlpha = (e.alphaStart ?? 1) * Math.pow(1 - p, .75);
        ctx.drawImage(explosionImg, -size / 2, -size / 2, size, size);
      }
      ctx.restore();
    }
  }
  function drawFogEdges() {
    const edgeX = Math.max(190, view.w * 0.19);
    const edgeY = Math.max(145, view.h * 0.22);
    ctx.save();
    let g = ctx.createLinearGradient(0, 0, edgeX, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.76)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, edgeX, view.h);
    g = ctx.createLinearGradient(view.w, 0, view.w - edgeX, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.76)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(view.w - edgeX, 0, edgeX, view.h);
    g = ctx.createLinearGradient(0, 0, 0, edgeY);
    g.addColorStop(0, 'rgba(0,0,0,0.65)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.w, edgeY);
    g = ctx.createLinearGradient(0, view.h, 0, view.h - edgeY);
    g.addColorStop(0, 'rgba(0,0,0,0.65)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, view.h - edgeY, view.w, edgeY);
    ctx.restore();
  }
  function drawMinimap() {
    const mmX = view.w - MINIMAP_W - 18;
    const mmY = view.h - MINIMAP_H - 18;
    const scaleX = MINIMAP_W / world.w;
    const scaleY = MINIMAP_H / world.h;
    ctx.save();
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = 'rgba(12,18,12,0.82)';
    ctx.fillRect(mmX, mmY, MINIMAP_W, MINIMAP_H);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(mmX, mmY, MINIMAP_W, MINIMAP_H);
    for (const t of players) {
      if (!t.alive) continue;
      const dotX = mmX + t.x * scaleX;
      const dotY = mmY + t.y * scaleY;
      ctx.fillStyle = t.color;
      ctx.beginPath();
      ctx.arc(dotX, dotY, t.id === myId ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
      if (t.id === myId) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(mmX + camera.x * scaleX, mmY + camera.y * scaleY, view.w * scaleX, view.h * scaleY);
    ctx.restore();
  }
  function drawLeaderboard() {
    const board = players.slice().sort((a, b) => b.score - a.score).slice(0, 7);
    const x = 16;
    const y = 18;
    const rowH = 18;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px Verdana, Arial, sans-serif';
    ctx.strokeText('ONLINE', x, y);
    ctx.fillText('ONLINE', x, y);
    for (let i = 0; i < board.length; i++) {
      const t = board[i];
      const yy = y + 20 + i * rowH;
      const displayName = t.name.length > 12 ? t.name.slice(0, 11) + '…' : t.name;
      const line = `${i + 1}. ${displayName}  ${t.score}`;
      ctx.font = t.id === myId ? 'bold 12px Verdana, Arial, sans-serif' : '12px Verdana, Arial, sans-serif';
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.strokeText(line, x, yy);
      ctx.fillStyle = t.color;
      ctx.fillText(line, x, yy);
    }
    ctx.restore();
  }
  function drawStatus() {
    if (connected && connectionStatus === 'online') return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#fff0a0';
    ctx.font = 'bold 20px Verdana, Arial, sans-serif';
    const txt = connectionStatus === 'connecting' ? 'Connecting...' : connectionStatus;
    ctx.strokeText(txt, view.w / 2, 42);
    ctx.fillText(txt, view.w / 2, 42);
    ctx.restore();
  }
  function drawDeath() {
    const p = myPlayer();
    if (!p || p.alive) return;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.38)';
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff0a0';
    ctx.font = 'bold 30px Verdana, Arial, sans-serif';
    ctx.fillText('Tank destroyed', view.w / 2, view.h / 2 - 18);
    ctx.font = '16px Verdana, Arial, sans-serif';
    ctx.fillText('Returning to title...', view.w / 2, view.h / 2 + 24);
    ctx.restore();
  }
  function render() {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    updateCamera();
    updateMouseWorld();
    drawGround();
    drawBullets();
    for (const t of players) drawTank(t);
    drawBlasts();
    drawFogEdges();
    drawLeaderboard();
    drawMinimap();
    drawStatus();
    drawDeath();
  }
  function update(dt) {
    updateBlasts(dt);
    if (deathReturnTimer !== null) {
      deathReturnTimer -= dt;
      if (deathReturnTimer <= 0) returnToTitle();
    }
    sendInput();
  }
  function loop(now) {
    if (!running) return;
    const dt = Math.min(.033, Math.max(.001, (now - lastTime) / 1000));
    lastTime = now;
    update(dt);
    if (running) render();
    if (running) requestAnimationFrame(loop);
  }
  function setMovementStyle(style) {
    if (!['tank', 'strafe', 'axial'].includes(style)) style = 'tank';
    movementStyle = style;
    for (const btn of movementButtons) {
      const selected = btn.dataset.style === movementStyle;
      btn.classList.toggle('selected', selected);
      btn.setAttribute('aria-checked', selected ? 'true' : 'false');
    }
  }
  function returnToTitle() {
    running = false;
    deathReturnTimer = null;
    mouse.down = false;
    for (const k of Object.keys(keys)) keys[k] = false;
    players.length = 0;
    bullets.length = 0;
    blasts.length = 0;
    myId = null;
    disconnectOnline(true);
    titleScreen.classList.remove('hidden');
    gameShell.classList.add('hidden');
    updateColorPreview();
  }
  function startGame() {
    if (running) return;
    titleScreen.classList.add('hidden');
    gameShell.classList.remove('hidden');
    running = true;
    connected = false;
    connectionStatus = 'connecting';
    deathReturnTimer = null;
    players.length = 0;
    bullets.length = 0;
    blasts.length = 0;
    resize();
    connectOnline();
    lastTime = performance.now();
    canvas.focus();
    requestAnimationFrame(loop);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; updateMouseWorld(); });
  window.addEventListener('mousedown', e => { if (e.button === 0) mouse.down = true; });
  window.addEventListener('mouseup', () => { mouse.down = false; });
  window.addEventListener('blur', () => { mouse.down = false; for (const k of Object.keys(keys)) keys[k] = false; });
  function isTypingInForm(target) {
    if (!target) return false;
    const tag = (target.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
  }

  window.addEventListener('keydown', e => {
    // Do not steal WASD/arrow keys while the player is typing a name
    // or editing sliders in the title screen. Those keys become controls
    // only when the game canvas is active.
    if (isTypingInForm(e.target)) {
      if (e.code === 'Enter' && e.target === nameInput && !titleScreen.classList.contains('hidden')) {
        e.preventDefault();
        startGame();
      }
      return;
    }

    keys[e.code] = true;
    keys[(e.key || '').toLowerCase()] = true;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (e.code === 'Enter' && !titleScreen.classList.contains('hidden')) startGame();
  }, { passive: false });
  window.addEventListener('keyup', e => {
    keys[e.code] = false;
    keys[(e.key || '').toLowerCase()] = false;
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  startBtn.addEventListener('click', startGame);
  movementButtons.forEach(btn => btn.addEventListener('click', () => setMovementStyle(btn.dataset.style)));
  [rInput, gInput, bInput].forEach(el => el.addEventListener('input', updateColorPreview));

  Promise.all([loadImage(bodyImg), loadImage(turretImg), loadImage(grassImg), loadImage(bodyLightImg), loadImage(bodyShadowImg), loadImage(turretLightImg), loadImage(turretShadowImg), loadImage(explosionImg), loadImage(smokeImg)]).then(() => {
    setMovementStyle(movementStyle);
    updateColorPreview();
    makeGrassPattern();
    resize();
  });
})();
