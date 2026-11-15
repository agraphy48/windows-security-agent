// -*- coding: utf-8 -*-
/**
 * CYBER DUEL: ARENA 2026
 * Game Duel 1v1 Real-Time Retro-Futuristik (PVP & Player vs AI)
 * Menggunakan HTML5 Canvas, Web Audio API Synthesizer, & Touch Controls
 */

function renderDuelGameHtml() {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>CYBER DUEL: ARENA 2026 - Uji Coba Game 1v1</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; -webkit-user-select: none; }
    body {
      background: radial-gradient(circle at 50% 50%, #0f172a 0%, #020617 100%);
      color: #f8fafc;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      touch-action: none;
    }

    #game-container {
      position: relative;
      width: 95vw;
      max-width: 1050px;
      aspect-ratio: 16 / 9;
      background: #020617;
      border: 2px solid #334155;
      border-radius: 16px;
      box-shadow: 0 0 35px rgba(56, 189, 248, 0.2), inset 0 0 30px rgba(0,0,0,0.8);
      overflow: hidden;
    }

    canvas {
      width: 100%;
      height: 100%;
      display: block;
    }

    /* Top HUD */
    .hud-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      padding: 14px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      pointer-events: none;
      z-index: 10;
    }

    .player-hud {
      display: flex;
      flex-direction: column;
      width: 38%;
      gap: 6px;
    }

    .player-hud.p2 {
      align-items: flex-end;
    }

    .player-name-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 800;
      font-size: 14px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    .p1-color { color: #38bdf8; text-shadow: 0 0 10px rgba(56, 189, 248, 0.6); }
    .p2-color { color: #f43f5e; text-shadow: 0 0 10px rgba(244, 63, 94, 0.6); }

    .bar-container {
      width: 100%;
      height: 16px;
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      overflow: hidden;
      position: relative;
    }

    .hp-bar {
      height: 100%;
      transition: width 0.15s ease-out;
    }
    .p1-hp { background: linear-gradient(90deg, #0284c7, #38bdf8); }
    .p2-hp { background: linear-gradient(90deg, #f43f5e, #fb7185); float: right; }

    .shield-bar-container {
      width: 75%;
      height: 8px;
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      overflow: hidden;
    }
    .shield-bar {
      height: 100%;
      background: #a855f7;
      transition: width 0.1s ease;
    }
    .p2 .shield-bar { float: right; }

    .match-score-badge {
      display: flex;
      flex-direction: column;
      align-items: center;
      background: rgba(15, 23, 42, 0.9);
      border: 1px solid #475569;
      padding: 6px 16px;
      border-radius: 12px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.5);
    }
    .score-text {
      font-size: 22px;
      font-weight: 900;
      letter-spacing: 2px;
      color: #f8fafc;
    }
    .round-info {
      font-size: 11px;
      color: #94a3b8;
      text-transform: uppercase;
      font-weight: 700;
    }

    /* Modal / Menu Overlay */
    .menu-modal {
      position: absolute;
      inset: 0;
      background: rgba(2, 6, 23, 0.88);
      backdrop-filter: blur(8px);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 20;
      padding: 24px;
      text-align: center;
    }

    .modal-title {
      font-size: 38px;
      font-weight: 900;
      letter-spacing: -0.5px;
      background: linear-gradient(135deg, #38bdf8 0%, #a855f7 50%, #f43f5e 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 8px;
      text-transform: uppercase;
    }
    .modal-subtitle {
      font-size: 15px;
      color: #94a3b8;
      max-width: 520px;
      line-height: 1.5;
      margin-bottom: 24px;
    }

    .btn-group {
      display: flex;
      flex-direction: column;
      gap: 12px;
      width: 100%;
      max-width: 320px;
    }

    .btn-menu {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #ffffff;
      padding: 12px 20px;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 4px 14px rgba(37, 99, 235, 0.3);
    }
    .btn-menu:hover {
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(37, 99, 235, 0.5);
    }
    .btn-secondary {
      background: rgba(30, 41, 59, 0.8);
      box-shadow: none;
      border-color: #475569;
      color: #cbd5e1;
    }
    .btn-secondary:hover {
      background: rgba(51, 65, 85, 0.9);
      color: #ffffff;
    }

    .controls-hint {
      margin-top: 24px;
      font-size: 12px;
      color: #64748b;
      display: flex;
      gap: 20px;
    }

    /* Mobile On-Screen Controls */
    .mobile-controls {
      display: none;
      position: absolute;
      bottom: 12px;
      left: 12px;
      right: 12px;
      justify-content: space-between;
      pointer-events: none;
      z-index: 15;
    }
    .touch-btn-cluster {
      display: flex;
      gap: 10px;
      pointer-events: auto;
    }
    .t-btn {
      width: 54px;
      height: 54px;
      border-radius: 50%;
      background: rgba(30, 41, 59, 0.7);
      border: 2px solid rgba(255,255,255,0.2);
      color: white;
      font-size: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(4px);
    }
    .t-btn:active {
      background: rgba(56, 189, 248, 0.5);
      transform: scale(0.95);
    }

    @media (max-width: 768px) {
      .mobile-controls { display: flex; }
      .controls-hint { display: none; }
      #game-container { width: 100vw; height: 100vh; max-width: none; border-radius: 0; border: none; }
    }

    .back-nav {
      margin-top: 14px;
      font-size: 13px;
      color: #64748b;
    }
    .back-nav a {
      color: #38bdf8;
      text-decoration: none;
      font-weight: 600;
    }
    .back-nav a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>

  <div id="game-container">
    <!-- Top HUD Overlay -->
    <div class="hud-overlay">
      <div class="player-hud p1">
        <div class="player-name-row p1-color">
          <span>🔵</span>
          <span id="p1-title">PLAYER 1 (CYBER)</span>
        </div>
        <div class="bar-container">
          <div id="p1-hp" class="hp-bar p1-hp" style="width: 100%;"></div>
        </div>
        <div class="shield-bar-container">
          <div id="p1-shield" class="shield-bar" style="width: 100%;"></div>
        </div>
      </div>

      <div class="match-score-badge">
        <div class="round-info" id="round-label">FIRST TO 3</div>
        <div class="score-text"><span id="p1-score">0</span> - <span id="p2-score">0</span></div>
      </div>

      <div class="player-hud p2">
        <div class="player-name-row p2-color">
          <span id="p2-title">CYBER BOT (AI)</span>
          <span>🔴</span>
        </div>
        <div class="bar-container">
          <div id="p2-hp" class="hp-bar p2-hp" style="width: 100%;"></div>
        </div>
        <div class="shield-bar-container">
          <div id="p2-shield" class="shield-bar" style="width: 100%;"></div>
        </div>
      </div>
    </div>

    <!-- Main Game Canvas -->
    <canvas id="arena"></canvas>

    <!-- Mobile Touch Controls -->
    <div class="mobile-controls">
      <div class="touch-btn-cluster">
        <button class="t-btn" id="btn-touch-up">▲</button>
        <div style="display:flex; flex-direction:column; gap:6px;">
          <button class="t-btn" id="btn-touch-left">◀</button>
          <button class="t-btn" id="btn-touch-right">▶</button>
        </div>
        <button class="t-btn" id="btn-touch-down">▼</button>
      </div>
      <div class="touch-btn-cluster">
        <button class="t-btn" id="btn-touch-shield" style="border-color:#a855f7; color:#c084fc;">🛡️</button>
        <button class="t-btn" id="btn-touch-fire" style="border-color:#38bdf8; color:#38bdf8; width:64px; height:64px;">⚡</button>
      </div>
    </div>

    <!-- Menu & Game Over Modal -->
    <div id="menu-modal" class="menu-modal">
      <div class="modal-title" id="modal-heading">CYBER DUEL: ARENA</div>
      <div class="modal-subtitle" id="modal-desc">
        Uji ketangkasan dan refleks dalam arena duel futuristik! Tembak plasma, tangkis dengan perisai energi, dan hancurkan lawan Anda.
      </div>

      <div class="btn-group">
        <button class="btn-menu" onclick="startGame('ai')">
          <span>🤖</span>
          <span>Duel Lawan Cyber AI (Bot)</span>
        </button>
        <button class="btn-menu btn-secondary" onclick="startGame('pvp')">
          <span>👥</span>
          <span>Duel 2 Pemain (1 Keyboard)</span>
        </button>
      </div>

      <div class="controls-hint">
        <div><strong>P1 (Biru):</strong> [W,A,S,D] Gerak | [Space / F] Tembak | [Shift / G] Perisai</div>
        <div><strong>P2 (Merah):</strong> [Panah] Gerak | [Enter / L] Tembak | [Ctrl / K] Perisai</div>
      </div>
    </div>
  </div>

  <div class="back-nav">
    Kembali ke <a href="/portal">🌐 Portal Navigasi Aplikasi Kedukan Aksara</a>
  </div>

  <script>
    // 1. Audio Synthesizer (Web Audio API)
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    let actx = null;

    function initAudio() {
      if (!actx) actx = new AudioCtx();
      if (actx.state === 'suspended') actx.resume();
    }

    function soundLaser(pitch = 600, duration = 0.12) {
      if (!actx) return;
      try {
        const osc = actx.createOscillator();
        const gain = actx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(pitch, actx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, actx.currentTime + duration);
        gain.gain.setValueAtTime(0.15, actx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, actx.currentTime + duration);
        osc.connect(gain);
        gain.connect(actx.destination);
        osc.start();
        osc.stop(actx.currentTime + duration);
      } catch(e) {}
    }

    function soundExplosion() {
      if (!actx) return;
      try {
        const osc = actx.createOscillator();
        const gain = actx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(140, actx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(20, actx.currentTime + 0.35);
        gain.gain.setValueAtTime(0.3, actx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, actx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(actx.destination);
        osc.start();
        osc.stop(actx.currentTime + 0.35);
      } catch(e) {}
    }

    function soundShield() {
      if (!actx) return;
      try {
        const osc = actx.createOscillator();
        const gain = actx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, actx.currentTime);
        osc.frequency.linearRampToValueAtTime(1200, actx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.18, actx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, actx.currentTime + 0.15);
        osc.connect(gain);
        gain.connect(actx.destination);
        osc.start();
        osc.stop(actx.currentTime + 0.15);
      } catch(e) {}
    }

    function soundPowerup() {
      if (!actx) return;
      try {
        [440, 554, 659, 880].forEach((freq, idx) => {
          const osc = actx.createOscillator();
          const gain = actx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, actx.currentTime + idx * 0.06);
          gain.gain.setValueAtTime(0.15, actx.currentTime + idx * 0.06);
          gain.gain.linearRampToValueAtTime(0.01, actx.currentTime + idx * 0.06 + 0.1);
          osc.connect(gain);
          gain.connect(actx.destination);
          osc.start(actx.currentTime + idx * 0.06);
          osc.stop(actx.currentTime + idx * 0.06 + 0.1);
        });
      } catch(e) {}
    }

    // 2. Game Core Engine
    const canvas = document.getElementById('arena');
    const ctx = canvas.getContext('2d');

    // Virtual Coordinate Resolution (16:9)
    const V_WIDTH = 1000;
    const V_HEIGHT = 562;

    function resizeCanvas() {
      canvas.width = V_WIDTH;
      canvas.height = V_HEIGHT;
    }
    resizeCanvas();

    let gameMode = 'ai'; // 'ai' or 'pvp'
    let isPlaying = false;
    let p1Score = 0;
    let p2Score = 0;
    const TARGET_WINS = 3;

    // Keys State
    const keys = {};
    window.addEventListener('keydown', e => {
      keys[e.code] = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', e => { keys[e.code] = false; });

    // Entities
    class Player {
      constructor(id, x, y, color, isAi = false) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.radius = 24;
        this.color = color;
        this.isAi = isAi;
        this.hp = 100;
        this.maxHp = 100;
        this.shield = 100;
        this.maxShield = 100;
        this.isShieldActive = false;
        this.speed = 5;
        this.angle = id === 1 ? 0 : Math.PI;
        this.shootCooldown = 0;
        this.chargeTime = 0;
        this.powerup = null;
        this.powerupTimer = 0;
      }

      reset(x, y) {
        this.x = x;
        this.y = y;
        this.hp = 100;
        this.shield = 100;
        this.isShieldActive = false;
        this.angle = this.id === 1 ? 0 : Math.PI;
        this.shootCooldown = 0;
        this.chargeTime = 0;
        this.powerup = null;
        this.powerupTimer = 0;
      }

      update(targetEnemy) {
        // Powerup countdown
        if (this.powerupTimer > 0) {
          this.powerupTimer--;
          if (this.powerupTimer <= 0) this.powerup = null;
        }

        // Shield recharge & drain
        if (this.isShieldActive) {
          this.shield -= 0.8;
          if (this.shield <= 0) {
            this.shield = 0;
            this.isShieldActive = false;
          }
        } else {
          if (this.shield < this.maxShield) this.shield += 0.35;
        }

        if (this.shootCooldown > 0) this.shootCooldown--;

        if (this.isAi) {
          this.updateAi(targetEnemy);
        } else {
          this.updateHuman();
        }

        // Constrain to arena
        const pad = this.radius + 15;
        this.x = Math.max(pad, Math.min(V_WIDTH - pad, this.x));
        this.y = Math.max(pad, Math.min(V_HEIGHT - pad, this.y));
      }

      updateHuman() {
        let vx = 0, vy = 0;

        if (this.id === 1) {
          // P1 Controls: WASD
          if (keys['KeyW']) vy -= 1;
          if (keys['KeyS']) vy += 1;
          if (keys['KeyA']) vx -= 1;
          if (keys['KeyD']) vx += 1;

          // Shield: Shift or G
          this.isShieldActive = (keys['ShiftLeft'] || keys['KeyG']) && this.shield > 5;

          // Aim towards opponent
          const dx = p2.x - this.x;
          const dy = p2.y - this.y;
          this.angle = Math.atan2(dy, dx);

          // Fire: Space or F
          if ((keys['Space'] || keys['KeyF']) && this.shootCooldown <= 0 && !this.isShieldActive) {
            this.fire();
          }
        } else {
          // P2 Controls: Arrow Keys
          if (keys['ArrowUp']) vy -= 1;
          if (keys['ArrowDown']) vy += 1;
          if (keys['ArrowLeft']) vx -= 1;
          if (keys['ArrowRight']) vx += 1;

          // Shield: ControlRight or K
          this.isShieldActive = (keys['ControlRight'] || keys['KeyK']) && this.shield > 5;

          // Aim towards P1
          const dx = p1.x - this.x;
          const dy = p1.y - this.y;
          this.angle = Math.atan2(dy, dx);

          // Fire: Enter or L
          if ((keys['Enter'] || keys['KeyL']) && this.shootCooldown <= 0 && !this.isShieldActive) {
            this.fire();
          }
        }

        // Apply Movement
        const currentSpeed = this.powerup === 'speed' ? this.speed * 1.4 : this.speed;
        if (vx !== 0 && vy !== 0) {
          vx *= 0.7071;
          vy *= 0.7071;
        }
        this.x += vx * currentSpeed;
        this.y += vy * currentSpeed;
      }

      updateAi(enemy) {
        const dx = enemy.x - this.x;
        const dy = enemy.y - this.y;
        const dist = Math.hypot(dx, dy);

        // Aim towards player with slight predictive offset
        this.angle = Math.atan2(dy, dx);

        // Check incoming bullets for dodging / shield
        let bulletThreat = false;
        for (const b of bullets) {
          if (b.owner !== this) {
            const bDist = Math.hypot(b.x - this.x, b.y - this.y);
            if (bDist < 140) {
              bulletThreat = true;
              break;
            }
          }
        }

        // AI Shield decision
        if (bulletThreat && this.shield > 25 && Math.random() < 0.6) {
          this.isShieldActive = true;
        } else {
          this.isShieldActive = false;
        }

        // Movement strategy: Keep optimal medium distance (280-450 px)
        let vx = 0, vy = 0;
        if (dist > 450) {
          vx = Math.cos(this.angle);
          vy = Math.sin(this.angle);
        } else if (dist < 260) {
          vx = -Math.cos(this.angle);
          vy = -Math.sin(this.angle);
        } else {
          // Strafe tangentially
          vx = -Math.sin(this.angle) * (Math.sin(Date.now() / 400) > 0 ? 1 : -1);
          vy = Math.cos(this.angle) * (Math.sin(Date.now() / 400) > 0 ? 1 : -1);
        }

        // Seek power-up if available
        if (activeCrate) {
          const cDx = activeCrate.x - this.x;
          const cDy = activeCrate.y - this.y;
          const cDist = Math.hypot(cDx, cDy);
          if (cDist < 300) {
            vx = cDx / cDist;
            vy = cDy / cDist;
          }
        }

        this.x += vx * (this.speed * 0.9);
        this.y += vy * (this.speed * 0.9);

        // AI Shooting logic
        if (this.shootCooldown <= 0 && !this.isShieldActive && Math.random() < 0.08) {
          this.fire();
        }
      }

      fire() {
        this.shootCooldown = this.powerup === 'speed' ? 12 : 22;
        soundLaser(this.id === 1 ? 750 : 600);

        const bx = this.x + Math.cos(this.angle) * (this.radius + 10);
        const by = this.y + Math.sin(this.angle) * (this.radius + 10);

        if (this.powerup === 'shotgun') {
          // Spread shot
          [-0.2, 0, 0.2].forEach(spread => {
            bullets.push(new Bullet(this, bx, by, this.angle + spread, this.color));
          });
        } else {
          // Regular blaster
          bullets.push(new Bullet(this, bx, by, this.angle, this.color));
        }

        // Recoil spark
        createParticles(bx, by, this.color, 4);
      }

      draw() {
        ctx.save();
        ctx.translate(this.x, this.y);

        // Draw Shield Bubble if active
        if (this.isShieldActive) {
          ctx.beginPath();
          ctx.arc(0, 0, this.radius + 12, 0, Math.PI * 2);
          ctx.strokeStyle = '#c084fc';
          ctx.lineWidth = 3;
          ctx.shadowColor = '#a855f7';
          ctx.shadowBlur = 15;
          ctx.stroke();

          ctx.fillStyle = 'rgba(168, 85, 247, 0.18)';
          ctx.fill();
        }

        // Draw Player Body Mech
        ctx.rotate(this.angle);

        // Blaster Cannon
        ctx.fillStyle = '#64748b';
        ctx.fillRect(8, -5, 24, 10);

        // Main Hull
        ctx.beginPath();
        ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#0f172a';
        ctx.fill();
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 4;
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 12;
        ctx.stroke();

        // Cockpit Eye
        ctx.beginPath();
        ctx.arc(6, 0, 8, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();

        ctx.restore();
      }
    }

    class Bullet {
      constructor(owner, x, y, angle, color) {
        this.owner = owner;
        this.x = x;
        this.y = y;
        this.speed = 13;
        this.vx = Math.cos(angle) * this.speed;
        this.vy = Math.sin(angle) * this.speed;
        this.radius = 5;
        this.color = color;
        this.damage = 14;
        this.life = 75;
      }

      update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life--;
      }

      draw() {
        ctx.save();
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 3;
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.restore();
      }
    }

    class Crate {
      constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.type = type; // 'health', 'shotgun', 'speed'
        this.radius = 18;
        this.bob = 0;
      }

      draw() {
        this.bob += 0.05;
        const yOffset = Math.sin(this.bob) * 4;

        ctx.save();
        ctx.translate(this.x, this.y + yOffset);

        ctx.beginPath();
        ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
        let color = '#22c55e';
        let icon = '💚';
        if (this.type === 'shotgun') { color = '#ec4899'; icon = '⚡'; }
        if (this.type === 'speed') { color = '#eab308'; icon = '🚀'; }

        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
        ctx.stroke();

        ctx.font = '15px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(icon, 0, 1);

        ctx.restore();
      }
    }

    class Particle {
      constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.color = color;
        const angle = Math.random() * Math.PI * 2;
        const spd = Math.random() * 5 + 1;
        this.vx = Math.cos(angle) * spd;
        this.vy = Math.sin(angle) * spd;
        this.alpha = 1;
        this.decay = Math.random() * 0.04 + 0.02;
        this.radius = Math.random() * 3 + 2;
      }
      update() {
        this.x += this.vx;
        this.y += this.vy;
        this.alpha -= this.decay;
      }
      draw() {
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.alpha);
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.restore();
      }
    }

    const p1 = new Player(1, 150, V_HEIGHT / 2, '#38bdf8');
    const p2 = new Player(2, V_WIDTH - 150, V_HEIGHT / 2, '#f43f5e', true);
    let bullets = [];
    let particles = [];
    let activeCrate = null;
    let crateTimer = 0;

    function createParticles(x, y, color, count = 8) {
      for (let i = 0; i < count; i++) {
        particles.push(new Particle(x, y, color));
      }
    }

    function spawnCrate() {
      const types = ['health', 'shotgun', 'speed'];
      const chosen = types[Math.floor(Math.random() * types.length)];
      const cx = V_WIDTH / 2 + (Math.random() * 300 - 150);
      const cy = V_HEIGHT / 2 + (Math.random() * 200 - 100);
      activeCrate = new Crate(cx, cy, chosen);
    }

    function updateGame() {
      if (!isPlaying) return;

      // Update Players
      p1.update(p2);
      p2.update(p1);

      // Spawn Crates
      crateTimer++;
      if (crateTimer > 600 && !activeCrate) {
        spawnCrate();
        crateTimer = 0;
      }

      // Check Crate Pickups
      if (activeCrate) {
        [p1, p2].forEach(p => {
          if (Math.hypot(p.x - activeCrate.x, p.y - activeCrate.y) < p.radius + activeCrate.radius) {
            soundPowerup();
            createParticles(activeCrate.x, activeCrate.y, '#ffffff', 12);

            if (activeCrate.type === 'health') {
              p.hp = Math.min(p.maxHp, p.hp + 35);
            } else {
              p.powerup = activeCrate.type;
              p.powerupTimer = 400;
            }
            activeCrate = null;
          }
        });
      }

      // Update Bullets
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.update();

        // Check arena bounds
        if (b.x < 0 || b.x > V_WIDTH || b.y < 0 || b.y > V_HEIGHT || b.life <= 0) {
          bullets.splice(i, 1);
          continue;
        }

        // Check collision against players
        const target = b.owner === p1 ? p2 : p1;
        const dist = Math.hypot(b.x - target.x, b.y - target.y);

        if (dist < target.radius + b.radius) {
          // If target shield is active, deflect!
          if (target.isShieldActive) {
            soundShield();
            b.owner = target;
            b.vx = -b.vx * 1.1;
            b.vy = -b.vy * 1.1;
            b.color = target.color;
            createParticles(b.x, b.y, '#a855f7', 10);
            continue;
          }

          // Direct Hit!
          soundExplosion();
          createParticles(b.x, b.y, target.color, 14);
          target.hp -= b.damage;
          bullets.splice(i, 1);

          // Check Knockout
          if (target.hp <= 0) {
            target.hp = 0;
            handleRoundOver(b.owner);
            break;
          }
        }
      }

      // Update Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update();
        if (particles[i].alpha <= 0) particles.splice(i, 1);
      }

      // Update HUD
      document.getElementById('p1-hp').style.width = p1.hp + '%';
      document.getElementById('p2-hp').style.width = p2.hp + '%';
      document.getElementById('p1-shield').style.width = p1.shield + '%';
      document.getElementById('p2-shield').style.width = p2.shield + '%';
    }

    function handleRoundOver(winner) {
      isPlaying = false;
      if (winner === p1) p1Score++;
      else p2Score++;

      document.getElementById('p1-score').textContent = p1Score;
      document.getElementById('p2-score').textContent = p2Score;

      createParticles(winner.x, winner.y, '#f59e0b', 40);

      setTimeout(() => {
        if (p1Score >= TARGET_WINS || p2Score >= TARGET_WINS) {
          // Match Finished
          const isP1Win = p1Score >= TARGET_WINS;
          document.getElementById('modal-heading').textContent = isP1Win ? '🎉 PLAYER 1 MENANG!' : (gameMode === 'ai' ? '🤖 CYBER BOT MENANG!' : '🎉 PLAYER 2 MENANG!');
          document.getElementById('modal-desc').textContent = \`Skor Akhir: \${p1Score} - \${p2Score}. Pertarungan duel cyber yang sangat sengit!\`;
          document.getElementById('menu-modal').style.display = 'flex';
          p1Score = 0;
          p2Score = 0;
        } else {
          // Next Round
          startRound();
        }
      }, 1200);
    }

    function startRound() {
      bullets = [];
      particles = [];
      activeCrate = null;
      crateTimer = 0;
      p1.reset(150, V_HEIGHT / 2);
      p2.reset(V_WIDTH - 150, V_HEIGHT / 2);
      isPlaying = true;
    }

    function startGame(mode) {
      initAudio();
      gameMode = mode;
      p2.isAi = (mode === 'ai');

      document.getElementById('p2-title').textContent = (mode === 'ai') ? 'CYBER BOT (AI)' : 'PLAYER 2 (ROSE)';
      document.getElementById('menu-modal').style.display = 'none';

      p1Score = 0;
      p2Score = 0;
      document.getElementById('p1-score').textContent = '0';
      document.getElementById('p2-score').textContent = '0';

      startRound();
    }

    function drawArenaBackground() {
      // Clear
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, V_WIDTH, V_HEIGHT);

      // Grid lines
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.25)';
      ctx.lineWidth = 1;
      const step = 50;
      for (let x = 0; x < V_WIDTH; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, V_HEIGHT);
        ctx.stroke();
      }
      for (let y = 0; y < V_HEIGHT; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(V_WIDTH, y);
        ctx.stroke();
      }

      // Center Divider Circle
      ctx.beginPath();
      ctx.arc(V_WIDTH / 2, V_HEIGHT / 2, 75, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.2)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Center Line
      ctx.beginPath();
      ctx.moveTo(V_WIDTH / 2, 0);
      ctx.lineTo(V_WIDTH / 2, V_HEIGHT);
      ctx.setLineDash([8, 8]);
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.2)';
      ctx.stroke();
      ctx.setLineDash([]);
    }

    function gameLoop() {
      updateGame();
      drawArenaBackground();

      if (activeCrate) activeCrate.draw();
      bullets.forEach(b => b.draw());
      p1.draw();
      p2.draw();
      particles.forEach(p => p.draw());

      requestAnimationFrame(gameLoop);
    }
    requestAnimationFrame(gameLoop);

    // Mobile Touch Bindings
    function bindTouch(btnId, keyCode) {
      const el = document.getElementById(btnId);
      if (!el) return;
      el.addEventListener('touchstart', e => { e.preventDefault(); keys[keyCode] = true; });
      el.addEventListener('touchend', e => { e.preventDefault(); keys[keyCode] = false; });
    }
    bindTouch('btn-touch-up', 'KeyW');
    bindTouch('btn-touch-down', 'KeyS');
    bindTouch('btn-touch-left', 'KeyA');
    bindTouch('btn-touch-right', 'KeyD');
    bindTouch('btn-touch-fire', 'Space');
    bindTouch('btn-touch-shield', 'ShiftLeft');
  </script>
</body>
</html>`;
}

module.exports = {
  render(res) {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, private'
    });
    res.end(renderDuelGameHtml());
  }
};
