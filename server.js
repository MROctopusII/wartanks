const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

const WORLD = { w: 20000, h: 14000 };
const TANK_RADIUS = 42;
const BULLET_RADIUS = 5;
const BULLET_DAMAGE = 20;       // 5 clean hits to kill.
const BULLET_SPEED = 820;
const BULLET_RANGE = 1050;      // Online-safe version of "destroy near screen edge".
const REGEN_DELAY = 2.6;
const REGEN_RATE = 8.0;         // Slow, but visible.
const FIRE_COOLDOWN = 0.62;
const SEND_RATE = 30;
const TICK_RATE = 60;

const players = new Map();
const bullets = [];
let nextId = 1;
let nextBulletId = 1;
let nextEventId = 1;
let pendingEvents = [];
let lastTick = Date.now();
let lastBroadcast = 0;

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function rand(min, max) { return min + Math.random() * (max - min); }
function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function turnToward(current, target, step) {
  return current + clamp(normAngle(target - current), -step, step);
}
function cleanName(name) {
  name = String(name || 'Pilot').replace(/[<>]/g, '').trim().slice(0, 16);
  return name || 'Pilot';
}
function cleanColor(color) {
  color = String(color || '#e31b13');
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#e31b13';
}
function cleanStyle(style) {
  return ['tank', 'strafe', 'axial'].includes(style) ? style : 'tank';
}
function randomPoint(pad = 480) {
  return { x: rand(pad, WORLD.w - pad), y: rand(pad, WORLD.h - pad) };
}
function farPointFrom(points, minDist = 1600, pad = 480) {
  let best = null;
  let bestScore = -1;
  for (let tries = 0; tries < 160; tries++) {
    const p = randomPoint(pad);
    let nearest = Infinity;
    for (const q of points) nearest = Math.min(nearest, Math.hypot(p.x - q.x, p.y - q.y));
    if (!points.length || nearest >= minDist) return p;
    if (nearest > bestScore) { best = p; bestScore = nearest; }
  }
  return best || randomPoint(pad);
}
function spawnPoint() {
  const live = [...players.values()].filter(p => p.alive).map(p => ({ x: p.x, y: p.y }));
  return farPointFrom(live, 1800);
}
function makePlayer(ws, join) {
  const p = spawnPoint();
  const a = rand(-Math.PI, Math.PI);
  return {
    id: 'p' + nextId++,
    ws,
    name: cleanName(join.name),
    color: cleanColor(join.color),
    movementStyle: cleanStyle(join.movementStyle),
    x: p.x,
    y: p.y,
    bodyAngle: a,
    turretAngle: a,
    hp: 100,
    maxHp: 100,
    alive: true,
    score: 0,
    reload: rand(0, .25),
    lastDamageAge: 999,
    regenerating: false,
    input: { up: false, down: false, left: false, right: false, mouseDown: false, aimAngle: a }
  };
}
function moveVector(p, vx, vy, speed, dt) {
  const len = Math.hypot(vx, vy);
  if (len <= 0) return false;
  p.x = clamp(p.x + (vx / len) * speed * dt, TANK_RADIUS, WORLD.w - TANK_RADIUS);
  p.y = clamp(p.y + (vy / len) * speed * dt, TANK_RADIUS, WORLD.h - TANK_RADIUS);
  return true;
}
function moveForward(p, amount) {
  p.x = clamp(p.x + Math.cos(p.bodyAngle) * amount, TANK_RADIUS, WORLD.w - TANK_RADIUS);
  p.y = clamp(p.y + Math.sin(p.bodyAngle) * amount, TANK_RADIUS, WORLD.h - TANK_RADIUS);
}
function shoot(p) {
  if (!p.alive || p.reload > 0) return;
  const a = p.turretAngle;
  bullets.push({
    id: nextBulletId++,
    x: p.x + Math.cos(a) * 70,
    y: p.y + Math.sin(a) * 70,
    startX: p.x,
    startY: p.y,
    vx: Math.cos(a) * BULLET_SPEED,
    vy: Math.sin(a) * BULLET_SPEED,
    age: 0,
    owner: p.id,
    color: p.color
  });
  p.reload = FIRE_COOLDOWN;
}
function damage(target, amount, shooter) {
  if (!target.alive) return;
  target.hp -= amount;
  target.lastDamageAge = 0;
  target.regenerating = false;
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.input.mouseDown = false;
    if (shooter && shooter !== target) shooter.score += 1;
    pendingEvents.push({ id: nextEventId++, kind: 'death', x: target.x, y: target.y, victim: target.id, killer: shooter ? shooter.id : null });
    try { target.ws.send(JSON.stringify({ type: 'dead' })); } catch (_) {}
  }
}
function updatePlayer(p, dt) {
  if (p.reload > 0) p.reload -= dt;
  if (p.lastDamageAge < 999) p.lastDamageAge += dt;

  if (!p.alive) return;

  if (p.hp < p.maxHp && p.lastDamageAge >= REGEN_DELAY) {
    p.hp = Math.min(p.maxHp, p.hp + REGEN_RATE * dt);
    p.regenerating = p.hp < p.maxHp;
  } else {
    p.regenerating = false;
  }

  const input = p.input || {};
  const aimAngle = Number.isFinite(input.aimAngle) ? input.aimAngle : p.turretAngle;
  const up = !!input.up;
  const down = !!input.down;
  const left = !!input.left;
  const right = !!input.right;

  p.turretAngle = aimAngle;
  p.movementStyle = cleanStyle(p.movementStyle);

  const speed = 300;
  const reverseSpeed = 185;
  const turnSpeed = 3.35;

  if (p.movementStyle === 'strafe') {
    p.bodyAngle = aimAngle;
    let forward = 0;
    let side = 0;
    if (up) forward += 1;
    if (down) forward -= 1;
    if (right) side += 1;
    if (left) side -= 1;
    const vx = Math.cos(p.bodyAngle) * forward + Math.cos(p.bodyAngle + Math.PI / 2) * side;
    const vy = Math.sin(p.bodyAngle) * forward + Math.sin(p.bodyAngle + Math.PI / 2) * side;
    const moveSpeed = forward < 0 && side === 0 ? reverseSpeed : speed;
    moveVector(p, vx, vy, moveSpeed, dt);
  } else if (p.movementStyle === 'axial') {
    let vx = 0;
    let vy = 0;
    if (left) vx -= 1;
    if (right) vx += 1;
    if (up) vy -= 1;
    if (down) vy += 1;
    if (moveVector(p, vx, vy, speed, dt)) {
      p.bodyAngle = turnToward(p.bodyAngle, Math.atan2(vy, vx), 7.5 * dt);
    }
  } else {
    let turn = 0;
    if (left) turn -= 1;
    if (right) turn += 1;
    p.bodyAngle += turn * turnSpeed * dt;
    let throttle = 0;
    if (up) throttle += 1;
    if (down) throttle -= 1;
    if (throttle !== 0) moveForward(p, (throttle > 0 ? speed : reverseSpeed) * throttle * dt);
  }

  if (input.mouseDown) shoot(p);
}
function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.age += dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const traveled = Math.hypot(b.x - b.startX, b.y - b.startY);
    let remove = b.age > 1.8 || traveled > BULLET_RANGE || b.x < 0 || b.y < 0 || b.x > WORLD.w || b.y > WORLD.h;
    if (!remove) {
      for (const p of players.values()) {
        if (!p.alive || p.id === b.owner) continue;
        if (Math.hypot(p.x - b.x, p.y - b.y) < TANK_RADIUS + BULLET_RADIUS) {
          const shooter = players.get(b.owner) || null;
          damage(p, BULLET_DAMAGE, shooter);
          pendingEvents.push({ id: nextEventId++, kind: 'hit', x: b.x, y: b.y, vx: b.vx, vy: b.vy, owner: b.owner });
          remove = true;
          break;
        }
      }
    }
    if (remove) bullets.splice(i, 1);
  }
}
function update(dt) {
  for (const p of players.values()) updatePlayer(p, dt);
  updateBullets(dt);
}
function publicState(events) {
  return {
    type: 'state',
    world: WORLD,
    players: [...players.values()].map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      movementStyle: p.movementStyle,
      x: p.x,
      y: p.y,
      bodyAngle: p.bodyAngle,
      turretAngle: p.turretAngle,
      hp: Math.round(p.hp),
      maxHp: p.maxHp,
      alive: p.alive,
      score: p.score,
      regenerating: p.regenerating
    })),
    bullets: bullets.map(b => ({ id: b.id, x: b.x, y: b.y, color: b.color })),
    events
  };
}
function broadcast() {
  const events = pendingEvents;
  pendingEvents = [];
  const stateBase = publicState(events);
  const textBase = JSON.stringify(stateBase);
  for (const p of players.values()) {
    if (p.ws.readyState !== 1) continue;
    // Keep it simple: every client receives the same state plus its own id.
    const msg = textBase.slice(0, -1) + `,"you":"${p.id}"}`;
    try { p.ws.send(msg); } catch (_) {}
  }
}

wss.on('connection', ws => {
  let playerId = null;
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return; }

    if (msg.type === 'join') {
      if (playerId && players.has(playerId)) players.delete(playerId);
      const p = makePlayer(ws, msg);
      playerId = p.id;
      players.set(playerId, p);
      ws.send(JSON.stringify({ type: 'joined', id: playerId, world: WORLD }));
      return;
    }

    const p = playerId ? players.get(playerId) : null;
    if (!p) return;

    if (msg.type === 'input') {
      if (typeof msg.movementStyle === 'string') p.movementStyle = cleanStyle(msg.movementStyle);
      const input = msg.input || msg;
      p.input = {
        up: !!input.up,
        down: !!input.down,
        left: !!input.left,
        right: !!input.right,
        mouseDown: !!input.mouseDown,
        aimAngle: Number.isFinite(input.aimAngle) ? input.aimAngle : p.turretAngle
      };
    }
  });

  ws.on('close', () => {
    if (playerId) players.delete(playerId);
  });
  ws.on('error', () => {
    if (playerId) players.delete(playerId);
  });
});

setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.05, Math.max(0.001, (now - lastTick) / 1000));
  lastTick = now;
  update(dt);
  if (now - lastBroadcast >= 1000 / SEND_RATE) {
    lastBroadcast = now;
    broadcast();
  }
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`Wartanks online server running on port ${PORT}`);
});
