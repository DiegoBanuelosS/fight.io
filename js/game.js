/* =========================================================
   FIGHT.IO — Complete Game Engine
   Solo | Co-op Local | Co-op Online | AI Training
   ========================================================= */
(function () {
    'use strict';

    // ===================== CONSTANTS =====================
    const TILE = 128, HALF = 64;
    const PLAYER_SPEED = 1.2, ENEMY_BASE_SPEED = 0.2;
    const DASH_SPEED = 4, DASH_DUR = 150, DASH_CD = 2000;
    const ATK_CD = 500, AUTO_ATK_MULT = 1.1, KNOCKBACK = 3, PICKUP_RANGE = 50;
    const BOSS_WAVE = 5, BOSS_HP_MULT = 5, BOSS_DMG_MULT = 1.5, BOSS_SPD_MULT = 0.7, BOSS_RAD = 38;
    const PLAYER_HP = 200;
    const PLAYER_DMG_MULT = 1.5;
    const ENEMY_DMG_TO_PLAYER = 0.25;
    const ENEMY_ATK_CD_MULT = 2.5;
    const MAX_ROOM_PLAYERS = 4;
    const PLAYER_COLORS_LABELS = { green: 'Verde', purple: 'Morado', red: 'Rojo', yellow: 'Amarillo' };
    const COLORS = ['green', 'purple', 'red', 'yellow'];
    const WEAPON_DATA = {
        weapon_sword:       { dmg: 15, range: 50, speed: 1.0, label: 'Espada' },
        weapon_axe:         { dmg: 20, range: 45, speed: 0.8, label: 'Hacha' },
        weapon_hammer:      { dmg: 28, range: 55, speed: 0.6, label: 'Martillo' },
        weapon_longsword:   { dmg: 18, range: 65, speed: 0.85, label: 'Mandoble' },
        weapon_spear:       { dmg: 14, range: 75, speed: 0.9, label: 'Lanza' },
        weapon_dagger:      { dmg: 10, range: 35, speed: 1.4, label: 'Daga' },
        weapon_axe_double:  { dmg: 24, range: 50, speed: 0.7, label: 'Hacha Doble' },
        weapon_staff:       { dmg: 12, range: 60, speed: 1.1, label: 'Bastón' }
    };
    const POWERUP_TYPES = [
        { key: 'heal',   color: '#4f4',  icon: '❤️', dur: 0,    label: '+50 HP' },
        { key: 'speed',  color: '#4ff',  icon: '⚡', dur: 8000, label: 'Velocidad' },
        { key: 'power',  color: '#f44',  icon: '🔥', dur: 8000, label: 'Poder' },
        { key: 'shield', color: '#44f',  icon: '🛡️', dur: 8000, label: 'Escudo' }
    ];
    const API_BASE = `http://${window.location.hostname || 'localhost'}:8080/api`;
    const WS_URL = `ws://${window.location.hostname || 'localhost'}:8081`;

    // ===================== ASSETS =====================
    const IMG = {};
    let assetsLoaded = 0, assetsTotal = 0;
    function loadImg(key, src) {
        assetsTotal++;
        const img = new Image();
        img.onload = () => assetsLoaded++;
        img.onerror = () => assetsLoaded++;
        img.src = src;
        IMG[key] = img;
    }
    COLORS.forEach(c => {
        loadImg(c + '_char', `PNG/Double (128px)/Characters/${c}_character.png`);
        loadImg(c + '_hand', `PNG/Double (128px)/Characters/${c}_hand.png`);
    });
    Object.keys(WEAPON_DATA).forEach(w => loadImg(w, `PNG/Double (128px)/Items/${w}.png`));
    loadImg('tilesheet', 'Tilesheet/Tilesheet@2.png');
    ['shield_blue', 'shield_red'].forEach(s => loadImg(s, `PNG/Double (128px)/Items/${s}.png`));

    function allLoaded() { return assetsLoaded >= assetsTotal; }

    // ===================== UTILITY =====================
    function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
    function angle(a, b) { return Math.atan2(b.y - a.y, b.x - a.x); }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function rand(lo, hi) { return Math.random() * (hi - lo) + lo; }
    function randInt(lo, hi) { return Math.floor(rand(lo, hi + 1)); }
    function lerp(a, b, t) { return a + (b - a) * t; }

    // ===================== Q-LEARNING =====================
    class QLearning {
        constructor() {
            this.q = {};
            this.lr = 0.1; this.gamma = 0.9; this.epsilon = 0.25;
            this.actions = ['chase', 'strafe_left', 'strafe_right', 'retreat', 'attack', 'flank'];
            this.totalUpdates = 0;
            this.wins = 0; this.losses = 0;
            this.load(); // restore from localStorage
        }

        // Expanded state key: distance bucket, HP ratio bucket, attack ready,
        // HP advantage vs target, near-wall flag, hazard flag
        // Total states: 3 × 3 × 2 × 3 × 2 × 3 = 324 possible states
        stateKey(fighter, target, structures, hazards) {
            const d = dist(fighter, target);
            const dBucket = d < 80 ? 0 : d < 200 ? 1 : 2;  // close, mid, far
            const hpRatio = fighter.hp / fighter.maxHp;
            const hpBucket = hpRatio > 0.6 ? 0 : hpRatio > 0.3 ? 1 : 2; // healthy, hurt, critical
            const atk = fighter.attackReady ? 1 : 0;

            // HP advantage: compare fighter's HP% to target's HP%
            const targetRatio = target.hp / target.maxHp;
            const advDiff = hpRatio - targetRatio;
            const advBucket = advDiff > 0.2 ? 0 : advDiff > -0.2 ? 1 : 2; // winning, even, losing

            // Near wall/structure check (within 60px of any structure)
            let nearWall = 0;
            if (structures) {
                for (const s of structures) {
                    if (s.collides(fighter.x, fighter.y, fighter.radius + 50)) {
                        nearWall = 1; break;
                    }
                }
            }

            // Hazard zone awareness: 0=safe, 1=in damage zone, 2=in helpful zone
            let hazardState = 0;
            if (hazards) {
                for (const hz of hazards) {
                    if (hz.contains(fighter.x, fighter.y)) {
                        if (hz.type === 'lava' || hz.type === 'spikes') { hazardState = 1; break; }
                        if (hz.type === 'heal') { hazardState = 2; }
                        if (hz.type === 'water') { hazardState = 1; break; } // treat as disadvantage
                    }
                }
            }

            return `${dBucket}_${hpBucket}_${atk}_${advBucket}_${nearWall}_${hazardState}`;
        }

        // Backwards-compatible key for game AI (no structures/hazards context)
        stateKeySimple(fighter, target) {
            const d = dist(fighter, target);
            const dBucket = d < 80 ? 0 : d < 200 ? 1 : 2;
            const hpRatio = fighter.hp / fighter.maxHp;
            const hpBucket = hpRatio > 0.6 ? 0 : hpRatio > 0.3 ? 1 : 2;
            const atk = fighter.attackReady ? 1 : 0;
            const targetRatio = target.hp / target.maxHp;
            const advDiff = hpRatio - targetRatio;
            const advBucket = advDiff > 0.2 ? 0 : advDiff > -0.2 ? 1 : 2;
            return `${dBucket}_${hpBucket}_${atk}_${advBucket}_0_0`;
        }

        getQ(s, a) { return (this.q[s] && this.q[s][a]) || 0; }
        setQ(s, a, v) {
            if (!this.q[s]) this.q[s] = {};
            this.q[s][a] = v;
            this.totalUpdates++;
        }
        bestAction(s) {
            let best = this.actions[0], bestV = -Infinity;
            for (const a of this.actions) { const v = this.getQ(s, a); if (v > bestV) { bestV = v; best = a; } }
            return best;
        }
        choose(s) {
            return Math.random() < this.epsilon ? this.actions[randInt(0, this.actions.length - 1)] : this.bestAction(s);
        }
        update(s, a, r, s2) {
            let maxNext = -Infinity;
            for (const a2 of this.actions) maxNext = Math.max(maxNext, this.getQ(s2, a2));
            const old = this.getQ(s, a);
            this.setQ(s, a, old + this.lr * (r + this.gamma * maxNext - old));
        }
        decayEpsilon() { this.epsilon = Math.max(0.10, this.epsilon * 0.995); }
        statesCount() { return Object.keys(this.q).length; }
        maxStates() { return 324; } // 3×3×2×3×2×3

        // Persistence - local
        save() {
            try {
                localStorage.setItem('fightio_qtable', JSON.stringify(this.q));
                localStorage.setItem('fightio_epsilon', this.epsilon.toString());
                localStorage.setItem('fightio_stats', JSON.stringify({
                    updates: this.totalUpdates, wins: this.wins, losses: this.losses
                }));
            } catch (e) { /* quota exceeded — silently fail */ }
        }
        load() {
            try {
                const saved = localStorage.getItem('fightio_qtable');
                if (saved) {
                    this.q = JSON.parse(saved);
                    const eps = localStorage.getItem('fightio_epsilon');
                    if (eps) this.epsilon = parseFloat(eps);
                    const stats = localStorage.getItem('fightio_stats');
                    if (stats) {
                        const s = JSON.parse(stats);
                        this.totalUpdates = s.updates || 0;
                        this.wins = s.wins || 0;
                        this.losses = s.losses || 0;
                    }
                    console.log(`[QL] Loaded from localStorage: ${this.statesCount()} states, ε=${this.epsilon.toFixed(4)}, ${this.totalUpdates} updates`);
                }
            } catch (e) { /* corrupt data — start fresh */ }
        }
        reset() {
            this.q = {}; this.epsilon = 0.25;
            this.totalUpdates = 0; this.wins = 0; this.losses = 0;
            localStorage.removeItem('fightio_qtable');
            localStorage.removeItem('fightio_epsilon');
            localStorage.removeItem('fightio_stats');
        }

        // Persistence - server (shared across all clients)
        async syncToServer() {
            try {
                const payload = {
                    q: this.q,
                    stats: { epsilon: this.epsilon, updates: this.totalUpdates, wins: this.wins, losses: this.losses }
                };
                const r = await fetch(API_BASE + '/qtable', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await r.json();
                console.log(`[QL] Synced to server: ${data.serverStates} states on server`);
                return data;
            } catch (e) {
                console.warn('[QL] Server sync failed:', e.message);
                return null;
            }
        }
        async loadFromServer() {
            try {
                const r = await fetch(API_BASE + '/qtable');
                const data = await r.json();
                if (data && data.q) {
                    // Merge server Q-table into local — server values win for new states
                    const serverQ = data.q;
                    let merged = 0;
                    for (const state in serverQ) {
                        if (!this.q[state]) {
                            this.q[state] = serverQ[state];
                            merged++;
                        } else {
                            // For existing states, take higher absolute values
                            for (const action in serverQ[state]) {
                                const sv = serverQ[state][action] || 0;
                                const lv = this.getQ(state, action);
                                if (Math.abs(sv) > Math.abs(lv)) {
                                    this.q[state][action] = sv;
                                    merged++;
                                }
                            }
                        }
                    }
                    if (data.stats) {
                        // Take the best epsilon (more trained = lower)
                        if (data.stats.epsilon < this.epsilon) {
                            this.epsilon = data.stats.epsilon;
                        }
                        // Accumulate stats
                        this.totalUpdates = Math.max(this.totalUpdates, data.stats.updates || 0);
                        this.wins = Math.max(this.wins, data.stats.wins || 0);
                        this.losses = Math.max(this.losses, data.stats.losses || 0);
                    }
                    console.log(`[QL] Loaded from server: merged ${merged} values, ${this.statesCount()} total states`);
                    // Save merged result locally too
                    this.save();
                }
            } catch (e) {
                console.warn('[QL] Server load failed (offline mode):', e.message);
            }
        }
        // Report: which actions are preferred in which states
        getReport() {
            const report = {};
            for (const s in this.q) {
                const best = this.bestAction(s);
                const val = this.getQ(s, best);
                report[s] = { best, val: +val.toFixed(2) };
            }
            return report;
        }
    }
    const sharedQL = new QLearning();
    // Load from server on startup (merges with localStorage)
    sharedQL.loadFromServer();

    // ===================== PARTICLES =====================
    class Particle {
        constructor(x, y, color) {
            this.x = x; this.y = y; this.color = color;
            this.vx = rand(-2, 2); this.vy = rand(-2, 2);
            this.life = 1; this.decay = rand(0.02, 0.05);
            this.r = rand(2, 5);
        }
        update() { this.x += this.vx; this.y += this.vy; this.life -= this.decay; }
        draw(ctx, cam) {
            ctx.globalAlpha = this.life;
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(this.x - cam.x, this.y - cam.y, this.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    }

    // ===================== FLOATING TEXT =====================
    class FloatingText {
        constructor(x, y, txt, color) {
            this.x = x; this.y = y; this.txt = txt; this.color = color;
            this.life = 1; this.vy = -1;
        }
        update() { this.y += this.vy; this.life -= 0.02; }
        draw(ctx, cam) {
            ctx.globalAlpha = this.life;
            ctx.fillStyle = this.color;
            ctx.font = 'bold 14px "Press Start 2P"';
            ctx.textAlign = 'center';
            ctx.fillText(this.txt, this.x - cam.x, this.y - cam.y);
            ctx.globalAlpha = 1;
        }
    }

    // ===================== STRUCTURE =====================
    class Structure {
        constructor(x, y, w, h, type) {
            this.x = x; this.y = y; this.w = w; this.h = h; this.type = type;
        }
        draw(ctx, cam) {
            const sx = this.x - cam.x, sy = this.y - cam.y;
            if (this.type === 'wall') {
                ctx.fillStyle = '#5a4a3a'; ctx.fillRect(sx, sy, this.w, this.h);
                ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 2; ctx.strokeRect(sx, sy, this.w, this.h);
                const brickH = 16, brickW = 32;
                ctx.strokeStyle = '#4a3a2a'; ctx.lineWidth = 1;
                for (let row = 0; row < this.h / brickH; row++) {
                    const off = (row % 2) * (brickW / 2);
                    for (let col = -1; col < this.w / brickW + 1; col++) {
                        const bx = sx + col * brickW + off, by = sy + row * brickH;
                        ctx.strokeRect(bx, by, brickW, brickH);
                    }
                }
            } else {
                ctx.fillStyle = '#6a5a4a'; ctx.fillRect(sx, sy, this.w, this.h);
                ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 2; ctx.strokeRect(sx, sy, this.w, this.h);
                ctx.fillStyle = '#4a3a2a';
                for (let px = 4; px < this.w - 4; px += 12)
                    for (let py = 4; py < this.h - 4; py += 12)
                        ctx.fillRect(sx + px, sy + py, 6, 6);
            }
        }
        collides(x, y, r) {
            const cx = clamp(x, this.x, this.x + this.w);
            const cy = clamp(y, this.y, this.y + this.h);
            return dist({ x, y }, { x: cx, y: cy }) < r;
        }
        pushOut(f) {
            const cx = clamp(f.x, this.x, this.x + this.w);
            const cy = clamp(f.y, this.y, this.y + this.h);
            const d = dist(f, { x: cx, y: cy });
            if (d < f.radius && d > 0) {
                const a = Math.atan2(f.y - cy, f.x - cx);
                f.x = cx + Math.cos(a) * (f.radius + 1);
                f.y = cy + Math.sin(a) * (f.radius + 1);
                f._collided = true; // flag: hit a structure
            }
        }
    }

    // ===================== HAZARD ZONES =====================
    class HazardZone {
        constructor(x, y, w, h, type) {
            this.x = x; this.y = y; this.w = w; this.h = h; this.type = type;
            this.timer = 0;
        }
        contains(fx, fy) {
            return fx >= this.x && fx <= this.x + this.w && fy >= this.y && fy <= this.y + this.h;
        }
        applyEffect(f, dt) {
            if (!f.alive || !this.contains(f.x, f.y)) return;
            switch (this.type) {
                case 'lava':
                    f.hp -= 0.15 * (dt / 16);
                    if (f.hp <= 0) { f.hp = 0; f.alive = false; }
                    break;
                case 'spikes':
                    f.hp -= 0.08 * (dt / 16);
                    if (f.hp <= 0) { f.hp = 0; f.alive = false; }
                    break;
                case 'water':
                    f._waterSlow = true;
                    break;
                case 'heal':
                    f.hp = Math.min(f.maxHp, f.hp + 0.05 * (dt / 16));
                    break;
            }
        }
        draw(ctx, cam) {
            const sx = this.x - cam.x, sy = this.y - cam.y;
            this.timer += 0.03;
            switch (this.type) {
                case 'lava':
                    ctx.fillStyle = 'rgba(255,60,0,0.35)';
                    ctx.fillRect(sx, sy, this.w, this.h);
                    ctx.strokeStyle = '#f80'; ctx.lineWidth = 2; ctx.strokeRect(sx, sy, this.w, this.h);
                    // bubbles
                    ctx.fillStyle = '#ff4400';
                    for (let i = 0; i < 5; i++) {
                        const bx = sx + ((i * 73 + this.timer * 20) % this.w);
                        const by = sy + ((i * 47 + Math.sin(this.timer + i) * 8) % this.h);
                        ctx.beginPath(); ctx.arc(bx, by, 3 + Math.sin(this.timer * 2 + i) * 1.5, 0, Math.PI * 2); ctx.fill();
                    }
                    break;
                case 'spikes':
                    ctx.fillStyle = 'rgba(120,120,120,0.3)';
                    ctx.fillRect(sx, sy, this.w, this.h);
                    ctx.strokeStyle = '#888'; ctx.lineWidth = 1; ctx.strokeRect(sx, sy, this.w, this.h);
                    // spike triangles
                    ctx.fillStyle = '#999';
                    for (let px = 0; px < this.w; px += 16) {
                        for (let py = 0; py < this.h; py += 16) {
                            ctx.beginPath();
                            ctx.moveTo(sx + px + 4, sy + py + 14);
                            ctx.lineTo(sx + px + 8, sy + py + 2);
                            ctx.lineTo(sx + px + 12, sy + py + 14);
                            ctx.closePath(); ctx.fill();
                        }
                    }
                    break;
                case 'water':
                    ctx.fillStyle = 'rgba(30,100,220,0.3)';
                    ctx.fillRect(sx, sy, this.w, this.h);
                    ctx.strokeStyle = '#2266cc'; ctx.lineWidth = 1; ctx.strokeRect(sx, sy, this.w, this.h);
                    // wave lines
                    ctx.strokeStyle = 'rgba(100,180,255,0.4)'; ctx.lineWidth = 1;
                    for (let row = 0; row < this.h; row += 20) {
                        ctx.beginPath();
                        for (let px = 0; px <= this.w; px += 4) {
                            const wy = sy + row + Math.sin(this.timer * 2 + px * 0.1) * 3;
                            px === 0 ? ctx.moveTo(sx + px, wy) : ctx.lineTo(sx + px, wy);
                        }
                        ctx.stroke();
                    }
                    break;
                case 'heal':
                    ctx.fillStyle = 'rgba(50,220,80,0.2)';
                    ctx.fillRect(sx, sy, this.w, this.h);
                    ctx.strokeStyle = '#3a3'; ctx.lineWidth = 1; ctx.strokeRect(sx, sy, this.w, this.h);
                    // sparkle effect
                    ctx.fillStyle = '#5f5';
                    for (let i = 0; i < 4; i++) {
                        const px = sx + ((i * 61 + this.timer * 15) % this.w);
                        const py = sy + ((i * 43 + Math.cos(this.timer + i * 2) * 6) % this.h);
                        ctx.globalAlpha = 0.5 + Math.sin(this.timer * 3 + i) * 0.3;
                        ctx.fillText('+', px, py + 4);
                    }
                    ctx.globalAlpha = 1;
                    break;
            }
        }
    }

    // ===================== TRAINING MAPS =====================
    const TRAINING_MAPS = [
        {
            id: 'open', name: '🏟️ Arena Abierta', desc: 'Sin obstáculos, combate puro',
            build(w, h) {
                return { structures: [], hazards: [] };
            }
        },
        {
            id: 'classic', name: '🏛️ Clásica', desc: 'Pilares y muros básicos',
            build(w, h) {
                const cx = w / 2, cy = h / 2;
                return {
                    structures: [
                        new Structure(cx - 20, cy - 20, 40, 40, 'pillar'),
                        new Structure(100, 100, 80, 20, 'wall'),
                        new Structure(w - 180, h - 120, 80, 20, 'wall'),
                    ],
                    hazards: []
                };
            }
        },
        {
            id: 'maze', name: '🌀 Laberinto', desc: 'Corredores estrechos, combate cerrado',
            build(w, h) {
                const s = [];
                // horizontal corridors
                s.push(new Structure(120, 120, 200, 20, 'wall'));
                s.push(new Structure(w - 320, 120, 200, 20, 'wall'));
                s.push(new Structure(200, 240, 180, 20, 'wall'));
                s.push(new Structure(w - 380, 240, 180, 20, 'wall'));
                s.push(new Structure(100, h - 140, 200, 20, 'wall'));
                s.push(new Structure(w - 300, h - 140, 200, 20, 'wall'));
                // vertical walls
                s.push(new Structure(320, 60, 20, 160, 'wall'));
                s.push(new Structure(w - 340, 60, 20, 160, 'wall'));
                s.push(new Structure(200, h - 280, 20, 140, 'wall'));
                s.push(new Structure(w - 220, h - 280, 20, 140, 'wall'));
                // center cross
                s.push(new Structure(w / 2 - 10, h / 2 - 80, 20, 160, 'wall'));
                s.push(new Structure(w / 2 - 80, h / 2 - 10, 160, 20, 'wall'));
                return { structures: s, hazards: [] };
            }
        },
        {
            id: 'fortress', name: '🏰 Fortaleza', desc: 'Fuerte central con aberturas',
            build(w, h) {
                const cx = w / 2, cy = h / 2;
                const s = [];
                const fw = 160, fh = 120;
                // fort walls with gaps
                s.push(new Structure(cx - fw / 2, cy - fh / 2, fw / 3, 20, 'wall')); // top-left
                s.push(new Structure(cx + fw / 6 + 20, cy - fh / 2, fw / 3, 20, 'wall')); // top-right
                s.push(new Structure(cx - fw / 2, cy + fh / 2 - 20, fw / 3, 20, 'wall')); // bottom-left
                s.push(new Structure(cx + fw / 6 + 20, cy + fh / 2 - 20, fw / 3, 20, 'wall')); // bottom-right
                s.push(new Structure(cx - fw / 2, cy - fh / 2, 20, fh / 3, 'wall')); // left-top
                s.push(new Structure(cx - fw / 2, cy + fh / 6, 20, fh / 3, 'wall')); // left-bottom
                s.push(new Structure(cx + fw / 2 - 20, cy - fh / 2, 20, fh / 3, 'wall')); // right-top
                s.push(new Structure(cx + fw / 2 - 20, cy + fh / 6, 20, fh / 3, 'wall')); // right-bottom
                // corner towers
                s.push(new Structure(80, 60, 40, 40, 'pillar'));
                s.push(new Structure(w - 120, 60, 40, 40, 'pillar'));
                s.push(new Structure(80, h - 100, 40, 40, 'pillar'));
                s.push(new Structure(w - 120, h - 100, 40, 40, 'pillar'));
                return { structures: s, hazards: [] };
            }
        },
        {
            id: 'pillars', name: '🗿 Pilares', desc: 'Muchos pilares, combate con cobertura',
            build(w, h) {
                const s = [];
                for (let row = 0; row < 4; row++) {
                    for (let col = 0; col < 5; col++) {
                        const px = 100 + col * (w - 200) / 4;
                        const py = 80 + row * (h - 160) / 3;
                        // stagger alternate rows
                        const off = (row % 2) * ((w - 200) / 8);
                        s.push(new Structure(px + off - 18, py - 18, 36, 36, 'pillar'));
                    }
                }
                return { structures: s, hazards: [] };
            }
        },
        {
            id: 'lava', name: '🌋 Volcán', desc: 'Zonas de lava que queman',
            build(w, h) {
                const cx = w / 2, cy = h / 2;
                const s = [
                    new Structure(cx - 20, cy - 20, 40, 40, 'pillar'),
                ];
                const hz = [
                    new HazardZone(0, 0, w, 50, 'lava'),           // top
                    new HazardZone(0, h - 50, w, 50, 'lava'),      // bottom
                    new HazardZone(0, 0, 50, h, 'lava'),            // left
                    new HazardZone(w - 50, 0, 50, h, 'lava'),       // right
                    new HazardZone(cx - 50, cy - 50, 100, 100, 'lava'), // center pool
                ];
                return { structures: s, hazards: hz };
            }
        },
        {
            id: 'swamp', name: '🌿 Pantano', desc: 'Agua que ralentiza + zonas curativas',
            build(w, h) {
                const s = [
                    new Structure(200, 200, 30, 30, 'pillar'),
                    new Structure(w - 230, 200, 30, 30, 'pillar'),
                    new Structure(200, h - 230, 30, 30, 'pillar'),
                    new Structure(w - 230, h - 230, 30, 30, 'pillar'),
                ];
                const hz = [
                    new HazardZone(120, 80, 160, 120, 'water'),
                    new HazardZone(w - 280, 80, 160, 120, 'water'),
                    new HazardZone(120, h - 200, 160, 120, 'water'),
                    new HazardZone(w - 280, h - 200, 160, 120, 'water'),
                    new HazardZone(w / 2 - 40, h / 2 - 40, 80, 80, 'heal'), // center heal
                ];
                return { structures: s, hazards: hz };
            }
        },
        {
            id: 'gauntlet', name: '⚔️ Trampa Mortal', desc: 'Pinchos y lava por doquier',
            build(w, h) {
                const cx = w / 2, cy = h / 2;
                const s = [
                    new Structure(cx - 120, cy - 10, 80, 20, 'wall'),
                    new Structure(cx + 40, cy - 10, 80, 20, 'wall'),
                ];
                const hz = [
                    new HazardZone(60, 60, 100, 80, 'spikes'),
                    new HazardZone(w - 160, 60, 100, 80, 'spikes'),
                    new HazardZone(60, h - 140, 100, 80, 'spikes'),
                    new HazardZone(w - 160, h - 140, 100, 80, 'spikes'),
                    // lava strips
                    new HazardZone(cx - 160, 30, 320, 30, 'lava'),
                    new HazardZone(cx - 160, h - 60, 320, 30, 'lava'),
                    // heal in center
                    new HazardZone(cx - 30, cy - 30, 60, 60, 'heal'),
                ];
                return { structures: s, hazards: hz };
            }
        },
        {
            id: 'random', name: '🎲 Aleatorio', desc: 'Mapa generado proceduralmente',
            build(w, h) {
                const s = [], hz = [];
                // random structures
                const numStructures = randInt(4, 10);
                for (let i = 0; i < numStructures; i++) {
                    const type = Math.random() < 0.4 ? 'pillar' : 'wall';
                    if (type === 'pillar') {
                        const sz = randInt(24, 48);
                        s.push(new Structure(rand(60, w - 60 - sz), rand(60, h - 60 - sz), sz, sz, 'pillar'));
                    } else {
                        const horizontal = Math.random() < 0.5;
                        const ww = horizontal ? randInt(60, 160) : 20;
                        const hh = horizontal ? 20 : randInt(60, 160);
                        s.push(new Structure(rand(40, w - 40 - ww), rand(40, h - 40 - hh), ww, hh, 'wall'));
                    }
                }
                // random hazards
                const hazardTypes = ['lava', 'water', 'spikes', 'heal'];
                const numHazards = randInt(1, 5);
                for (let i = 0; i < numHazards; i++) {
                    const ht = hazardTypes[randInt(0, hazardTypes.length - 1)];
                    const zw = randInt(50, 120), zh = randInt(50, 100);
                    hz.push(new HazardZone(rand(30, w - 30 - zw), rand(30, h - 30 - zh), zw, zh, ht));
                }
                return { structures: s, hazards: hz };
            }
        }
    ];

    // ===================== TRAINING METHODS =====================
    const TRAINING_METHODS = [
        {
            id: 'team2v2', name: '⚔️ 2v2 Equipos', desc: '4 luchadores en equipos de 2',
            fighters: 4, teams: 2,
            spawn(w, h) {
                const weapons = Object.keys(WEAPON_DATA);
                const fs = [];
                for (let i = 0; i < 4; i++) {
                    const c = COLORS[i % COLORS.length];
                    const wp = weapons[randInt(0, weapons.length - 1)];
                    const x = i < 2 ? rand(60, w * 0.35) : rand(w * 0.65, w - 60);
                    const y = rand(60, h - 60);
                    const f = new Fighter(x, y, c, wp, false, false);
                    f.team = i < 2 ? 0 : 1;
                    fs.push(f);
                }
                return fs;
            },
            isDone(fighters) {
                const t0 = fighters.filter(f => f.team === 0 && f.alive).length;
                const t1 = fighters.filter(f => f.team === 1 && f.alive).length;
                return t0 === 0 || t1 === 0;
            }
        },
        {
            id: 'duel', name: '🤺 1v1 Duelo', desc: 'Combate uno contra uno',
            fighters: 2, teams: 2,
            spawn(w, h) {
                const weapons = Object.keys(WEAPON_DATA);
                const fs = [];
                for (let i = 0; i < 2; i++) {
                    const c = COLORS[i];
                    const wp = weapons[randInt(0, weapons.length - 1)];
                    const x = i === 0 ? rand(60, w * 0.3) : rand(w * 0.7, w - 60);
                    const y = h / 2 + rand(-80, 80);
                    const f = new Fighter(x, y, c, wp, false, false);
                    f.team = i;
                    fs.push(f);
                }
                return fs;
            },
            isDone(fighters) {
                return fighters.filter(f => f.alive).length <= 1;
            }
        },
        {
            id: 'ffa', name: '💀 Todos vs Todos', desc: 'Cada uno por su cuenta',
            fighters: 4, teams: 4,
            spawn(w, h) {
                const weapons = Object.keys(WEAPON_DATA);
                const fs = [];
                const positions = [
                    [w * 0.2, h * 0.2], [w * 0.8, h * 0.2],
                    [w * 0.2, h * 0.8], [w * 0.8, h * 0.8]
                ];
                for (let i = 0; i < 4; i++) {
                    const c = COLORS[i];
                    const wp = weapons[randInt(0, weapons.length - 1)];
                    const f = new Fighter(positions[i][0] + rand(-30, 30), positions[i][1] + rand(-30, 30), c, wp, false, false);
                    f.team = i; // each is own team
                    fs.push(f);
                }
                return fs;
            },
            isDone(fighters) {
                return fighters.filter(f => f.alive).length <= 1;
            }
        },
        {
            id: 'survival', name: '🛡️ Supervivencia', desc: '1 vs oleadas de 3 enemigos',
            fighters: 4, teams: 2,
            spawn(w, h) {
                const weapons = Object.keys(WEAPON_DATA);
                const fs = [];
                // The defender (team 0)
                const defWp = weapons[randInt(0, weapons.length - 1)];
                const def = new Fighter(w / 2, h / 2, 'green', defWp, false, false);
                def.hp = 150; def.maxHp = 150; // extra HP
                def.team = 0;
                fs.push(def);
                // 3 attackers (team 1)
                const angles = [0, Math.PI * 2 / 3, Math.PI * 4 / 3];
                for (let i = 0; i < 3; i++) {
                    const ax = w / 2 + Math.cos(angles[i]) * 250;
                    const ay = h / 2 + Math.sin(angles[i]) * 200;
                    const c = COLORS[(i + 1) % COLORS.length];
                    const wp = weapons[randInt(0, weapons.length - 1)];
                    const f = new Fighter(clamp(ax, 60, w - 60), clamp(ay, 60, h - 60), c, wp, false, false);
                    f.team = 1;
                    fs.push(f);
                }
                return fs;
            },
            isDone(fighters) {
                const t0 = fighters.filter(f => f.team === 0 && f.alive).length;
                const t1 = fighters.filter(f => f.team === 1 && f.alive).length;
                return t0 === 0 || t1 === 0;
            }
        },
        {
            id: 'boss', name: '👑 Boss Training', desc: 'Equipo vs un jefe poderoso',
            fighters: 4, teams: 2,
            spawn(w, h) {
                const weapons = Object.keys(WEAPON_DATA);
                const fs = [];
                // 3 fighters (team 0)
                for (let i = 0; i < 3; i++) {
                    const x = w * 0.2 + rand(-40, 40);
                    const y = h * 0.3 + i * (h * 0.2);
                    const c = COLORS[i];
                    const wp = weapons[randInt(0, weapons.length - 1)];
                    const f = new Fighter(x, y, c, wp, false, false);
                    f.team = 0;
                    fs.push(f);
                }
                // Boss (team 1)
                const boss = new Fighter(w * 0.75, h / 2, 'red', weapons[randInt(0, weapons.length - 1)], false, true);
                boss.team = 1;
                fs.push(boss);
                return fs;
            },
            isDone(fighters) {
                const t0 = fighters.filter(f => f.team === 0 && f.alive).length;
                const t1 = fighters.filter(f => f.team === 1 && f.alive).length;
                return t0 === 0 || t1 === 0;
            }
        },
        {
            id: 'melee6', name: '🔥 6 Jugadores', desc: 'Batalla masiva 3v3',
            fighters: 6, teams: 2,
            spawn(w, h) {
                const weapons = Object.keys(WEAPON_DATA);
                const allColors = ['green', 'purple', 'red', 'yellow', 'green', 'purple'];
                const fs = [];
                for (let i = 0; i < 6; i++) {
                    const x = i < 3 ? rand(50, w * 0.35) : rand(w * 0.65, w - 50);
                    const y = (h * 0.2) + (i % 3) * (h * 0.3) + rand(-20, 20);
                    const c = allColors[i];
                    const wp = weapons[randInt(0, weapons.length - 1)];
                    const f = new Fighter(x, y, c, wp, false, false);
                    f.team = i < 3 ? 0 : 1;
                    fs.push(f);
                }
                return fs;
            },
            isDone(fighters) {
                const t0 = fighters.filter(f => f.team === 0 && f.alive).length;
                const t1 = fighters.filter(f => f.team === 1 && f.alive).length;
                return t0 === 0 || t1 === 0;
            }
        }
    ];

    // ===================== POWERUP =====================
    class PowerUp {
        constructor(x, y, type) {
            this.x = x; this.y = y; this.type = type;
            this.radius = 14; this.bob = 0;
        }
        update() { this.bob += 0.05; }
        draw(ctx, cam) {
            const sx = this.x - cam.x, sy = this.y - cam.y + Math.sin(this.bob) * 4;
            ctx.fillStyle = this.type.color;
            ctx.globalAlpha = 0.4;
            ctx.beginPath(); ctx.arc(sx, sy, 18, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 1;
            ctx.font = '18px serif'; ctx.textAlign = 'center';
            ctx.fillText(this.type.icon, sx, sy + 6);
        }
    }

    // ===================== WEAPON DROP =====================
    class WeaponDrop {
        constructor(x, y, weapon) {
            this.x = x; this.y = y; this.weapon = weapon;
            this.radius = 16; this.bob = 0;
        }
        update() { this.bob += 0.04; }
        draw(ctx, cam) {
            const sx = this.x - cam.x, sy = this.y - cam.y + Math.sin(this.bob) * 3;
            ctx.save();
            ctx.shadowColor = '#ff0'; ctx.shadowBlur = 10;
            const img = IMG[this.weapon];
            if (img) ctx.drawImage(img, sx - 16, sy - 16, 32, 32);
            ctx.restore();
        }
    }

    // ===================== REWARD ORB =====================
    class RewardOrb {
        constructor(x, y) {
            this.x = x; this.y = y;
            this.radius = 10; this.bob = Math.random() * Math.PI * 2;
            this.collected = false;
            this.glow = 0;
        }
        update() { this.bob += 0.06; this.glow += 0.04; }
        draw(ctx, cam) {
            if (this.collected) return;
            const sx = this.x - cam.x, sy = this.y - cam.y + Math.sin(this.bob) * 3;
            // outer glow
            ctx.save();
            ctx.globalAlpha = 0.25 + Math.sin(this.glow) * 0.1;
            ctx.fillStyle = '#4ef';
            ctx.beginPath(); ctx.arc(sx, sy, 16, 0, Math.PI * 2); ctx.fill();
            // inner orb
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = '#0ff';
            ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2); ctx.fill();
            // star/sparkle
            ctx.fillStyle = '#fff';
            ctx.globalAlpha = 0.7 + Math.sin(this.glow * 2) * 0.3;
            ctx.font = '12px serif'; ctx.textAlign = 'center';
            ctx.fillText('✦', sx, sy + 4);
            ctx.restore();
        }
    }

    function spawnRewardOrbs(arenaW, arenaH, count, structures) {
        const orbs = [];
        for (let i = 0; i < count; i++) {
            let ox, oy, tries = 0, valid = false;
            while (!valid && tries < 30) {
                ox = rand(50, arenaW - 50);
                oy = rand(50, arenaH - 50);
                valid = true;
                // avoid spawning inside structures
                if (structures) {
                    for (const s of structures) {
                        if (s.collides(ox, oy, 15)) { valid = false; break; }
                    }
                }
                tries++;
            }
            if (valid) orbs.push(new RewardOrb(ox, oy));
        }
        return orbs;
    }

    // ===================== FIGHTER =====================
    class Fighter {
        constructor(x, y, color, weapon, isPlayer, isBoss) {
            this.x = x; this.y = y;
            this.spawnX = x; this.spawnY = y; // remember start position
            this.color = color; this.weapon = weapon;
            this.isPlayer = isPlayer; this.isBoss = !!isBoss;
            this.radius = isBoss ? BOSS_RAD : 20;
            this.maxHp = isPlayer ? PLAYER_HP : (isBoss ? 100 * BOSS_HP_MULT : 100);
            this.hp = this.maxHp;
            this.angle = 0; this.speed = PLAYER_SPEED;
            this.vx = 0; this.vy = 0;
            this.attacking = false; this.attackTimer = 0; this.attackReady = true;
            this.dashing = false; this.dashTimer = 0; this.dashCdTimer = 0;
            this.knockX = 0; this.knockY = 0;
            this.alive = true;
            this.kills = 0; this.score = 0;
            this.prevState = null; this.prevAction = null;
            // collision awareness
            this._collided = false;
            this._wasColliding = false;
            // action commitment (avoid jitter)
            this._actionTimer = 0;
            this._currentAction = null;
            // power-up buffs
            this.buffs = {};
        }
        get weaponData() { return WEAPON_DATA[this.weapon] || WEAPON_DATA.weapon_sword; }
        get atkRange() { return this.weaponData.range + this.radius; }
        get dmg() {
            let d = this.weaponData.dmg;
            if (this.isBoss) d *= BOSS_DMG_MULT;
            if (this.isPlayer) d *= PLAYER_DMG_MULT;
            if (this.buffs.power) d *= 2;
            return d;
        }
        get actualSpeed() {
            let s = this.isPlayer ? PLAYER_SPEED : (this.isBoss ? ENEMY_BASE_SPEED * BOSS_SPD_MULT : ENEMY_BASE_SPEED);
            if (this.buffs.speed) s *= 1.6;
            return s;
        }
        addBuff(key, dur) {
            if (key === 'heal') { this.hp = Math.min(this.maxHp, this.hp + 50); return; }
            this.buffs[key] = Date.now() + dur;
        }
        updateBuffs() {
            const now = Date.now();
            for (const k in this.buffs) if (this.buffs[k] < now) delete this.buffs[k];
        }
        takeDamage(dmg, from) {
            let d = dmg;
            // Reduce damage enemies deal to players
            if (this.isPlayer && from && !from.isPlayer) d *= ENEMY_DMG_TO_PLAYER;
            if (this.buffs.shield) d *= 0.5;
            this.hp -= d;
            if (from) {
                const a = angle(from, this);
                const kb = (this.isBoss) ? KNOCKBACK * 0.3 : KNOCKBACK;
                this.knockX = Math.cos(a) * kb;
                this.knockY = Math.sin(a) * kb;
            }
            if (this.hp <= 0) { this.hp = 0; this.alive = false; }
        }
        update(dt, structures) {
            this.updateBuffs();
            if (this.attackTimer > 0) {
                this.attackTimer -= dt;
                if (this.attackTimer <= 0) { this.attacking = false; this.attackReady = true; }
            }
            if (this.dashCdTimer > 0) this.dashCdTimer -= dt;
            if (this.dashing) {
                this.dashTimer -= dt;
                if (this.dashTimer <= 0) this.dashing = false;
            }
            // apply knockback
            this.x += this.knockX; this.y += this.knockY;
            this.knockX *= 0.85; this.knockY *= 0.85;
            // apply velocity
            const spd = this.dashing ? DASH_SPEED : this.actualSpeed;
            this._collided = false; // reset each frame
            this.x += this.vx * spd; this.y += this.vy * spd;
            // structure collision (push out but don't revert)
            if (structures) structures.forEach(s => s.pushOut(this));
        }
        attack() {
            if (!this.attackReady || this.attacking) return false;
            this.attacking = true;
            this.attackReady = false;
            const cdMult = this.isPlayer ? 1 : ENEMY_ATK_CD_MULT;
            this.attackTimer = (ATK_CD * cdMult) / (this.weaponData.speed || 1);
            return true;
        }
        dash() {
            if (this.dashing || this.dashCdTimer > 0) return;
            this.dashing = true;
            this.dashTimer = DASH_DUR;
            this.dashCdTimer = DASH_CD;
        }
        draw(ctx, cam) {
            if (!this.alive) return;
            const sx = this.x - cam.x, sy = this.y - cam.y;
            ctx.save();
            // shield buff glow
            if (this.buffs.shield) {
                ctx.strokeStyle = 'rgba(68,68,255,0.5)'; ctx.lineWidth = 3;
                ctx.beginPath(); ctx.arc(sx, sy, this.radius + 6, 0, Math.PI * 2); ctx.stroke();
            }
            if (this.buffs.speed) {
                ctx.strokeStyle = 'rgba(68,255,255,0.4)'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(sx, sy, this.radius + 4, 0, Math.PI * 2); ctx.stroke();
            }
            // body
            const charImg = IMG[this.color + '_char'];
            const sz = this.isBoss ? this.radius * 2.2 : this.radius * 2;
            if (charImg) ctx.drawImage(charImg, sx - sz / 2, sy - sz / 2, sz, sz);
            else {
                ctx.fillStyle = this.color; ctx.beginPath();
                ctx.arc(sx, sy, this.radius, 0, Math.PI * 2); ctx.fill();
            }
            // weapon
            const wImg = IMG[this.weapon];
            if (wImg) {
                ctx.save(); ctx.translate(sx, sy); ctx.rotate(this.angle);
                const wOff = this.radius + 10;
                const swing = this.attacking ? Math.sin(this.attackTimer / 50) * 0.8 : 0;
                ctx.rotate(swing);
                ctx.drawImage(wImg, wOff - 12, -12, 24, 24);
                ctx.restore();
            }
            // hp bar
            if (!this.isPlayer || this.isBoss) {
                const bw = this.radius * 2, bh = 5;
                const bx = sx - bw / 2, by = sy - this.radius - 12;
                ctx.fillStyle = '#333'; ctx.fillRect(bx, by, bw, bh);
                ctx.fillStyle = this.hp > 50 ? '#4f4' : this.hp > 25 ? '#ff4' : '#f44';
                ctx.fillRect(bx, by, bw * (this.hp / this.maxHp), bh);
            }
            // boss crown
            if (this.isBoss) {
                ctx.font = '16px serif'; ctx.textAlign = 'center';
                ctx.fillText('👑', sx, sy - this.radius - 16);
            }
            ctx.restore();
        }
    }

    // ===================== BUILD ARENA STRUCTURES =====================
    function buildStructures(aw, ah) {
        const s = [];
        const cx = aw / 2, cy = ah / 2;
        // center pillar
        s.push(new Structure(cx - 40, cy - 40, 80, 80, 'pillar'));
        // corner walls
        s.push(new Structure(100, 100, 160, 24, 'wall'));
        s.push(new Structure(100, 100, 24, 160, 'wall'));
        s.push(new Structure(aw - 260, 100, 160, 24, 'wall'));
        s.push(new Structure(aw - 124, 100, 24, 160, 'wall'));
        s.push(new Structure(100, ah - 124, 160, 24, 'wall'));
        s.push(new Structure(100, ah - 260, 24, 160, 'wall'));
        s.push(new Structure(aw - 260, ah - 124, 160, 24, 'wall'));
        s.push(new Structure(aw - 124, ah - 260, 24, 160, 'wall'));
        // mid barriers
        s.push(new Structure(cx - 200, cy - 150, 24, 100, 'wall'));
        s.push(new Structure(cx + 176, cy + 50, 24, 100, 'wall'));
        s.push(new Structure(cx - 100, cy - 200, 100, 24, 'wall'));
        s.push(new Structure(cx, cy + 176, 100, 24, 'wall'));
        // small cover pillars
        s.push(new Structure(cx - 280, cy, 40, 40, 'pillar'));
        s.push(new Structure(cx + 240, cy, 40, 40, 'pillar'));
        s.push(new Structure(cx, cy - 280, 40, 40, 'pillar'));
        s.push(new Structure(cx, cy + 240, 40, 40, 'pillar'));
        return s;
    }

    // ===================== NETWORK MANAGER =====================
    class NetworkManager {
        constructor() {
            this.ws = null; this.isHost = false; this.roomCode = null;
            this.myId = null; this.connected = false; this.onMessage = null;
            this.players = []; // server player list
        }
        connect(cb) {
            try {
                this.ws = new WebSocket(WS_URL);
                this.ws.onopen = () => {
                    this.connected = true;
                    // Keepalive ping every 15 seconds to prevent timeout
                    this._pingInterval = setInterval(() => {
                        if (this.connected) this.send({ type: 'ping' });
                        else if (this._pingInterval) { clearInterval(this._pingInterval); this._pingInterval = null; }
                    }, 15000);
                    if (cb) cb(true);
                };
                this.ws.onerror = () => { if (cb) cb(false); };
                this.ws.onclose = () => { this.connected = false; };
                this.ws.onmessage = (e) => {
                    try { const d = JSON.parse(e.data); if (this.onMessage) this.onMessage(d); } catch (ex) {}
                };
            } catch (ex) { if (cb) cb(false); }
        }
        send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
        createRoom(color, weapon) { this.isHost = true; this.send({ type: 'create_room', color, weapon }); }
        joinRoom(code, color, weapon) { this.isHost = false; this.send({ type: 'join_room', code, color, weapon }); }
        startGame() { this.send({ type: 'start_game' }); }
        restartGame() { this.send({ type: 'restart_game' }); }
        readyRestart() { this.send({ type: 'ready_restart' }); }
        close() {
            if (this._pingInterval) { clearInterval(this._pingInterval); this._pingInterval = null; }
            if (this.ws) this.ws.close(); this.ws = null; this.connected = false; this.roomCode = null; this.myId = null; this.players = [];
        }
    }

    // ===================== MAIN GAME =====================
    class Game {
        constructor(mode, playersInfo, net, mySlot) {
            // mode: 'solo' | 'coop' | 'online_host' | 'online_guest'
            // playersInfo: array of {color, weapon, slot}
            this.mode = mode;
            this.canvas = document.getElementById('gameCanvas');
            this.ctx = this.canvas.getContext('2d');
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
            this.net = net || null;
            this.mySlot = mySlot || 0;
            this.arenaW = 1600; this.arenaH = 1200;
            this.structures = buildStructures(this.arenaW, this.arenaH);
            this.cam = { x: 0, y: 0 };
            this.particles = []; this.texts = []; this.drops = []; this.powerups = [];
            this.rewardOrbs = [];
            this.wave = 0; this.enemiesAlive = 0;
            this.enemies = [];
            this.running = false; this.lastTime = 0;

            // players — up to 4
            const offsets = [[-60,0],[-20,0],[20,0],[60,0]];
            this.players = [];
            for (let i = 0; i < playersInfo.length; i++) {
                const pi = playersInfo[i];
                const ox = offsets[i] ? offsets[i][0] : (i * 40 - 60);
                const oy = offsets[i] ? offsets[i][1] : 0;
                this.players.push(new Fighter(
                    this.arenaW / 2 + ox, this.arenaH / 2 + oy,
                    pi.color, pi.weapon, true, false
                ));
            }
            // backwards compat aliases
            this.p1 = this.players[0] || null;
            this.p2 = this.players[1] || null;

            // input
            this.keys = {}; this.mouse = { x: 0, y: 0, down: false };
            this._onKey = (e) => this.keys[e.key.toLowerCase()] = e.type === 'keydown';
            this._onMouse = (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; };
            this._onMouseD = (e) => { if (e.button === 0) this.mouse.down = true; };
            this._onMouseU = (e) => { if (e.button === 0) this.mouse.down = false; };
            this._onResize = () => { this.canvas.width = window.innerWidth; this.canvas.height = window.innerHeight; };

            // online state
            this.netSyncTimer = 0;
            this.remoteState = null;

            if (this.net) {
                this.net.onMessage = (msg) => this.onNetMessage(msg);
            }
        }

        start() {
            window.addEventListener('keydown', this._onKey);
            window.addEventListener('keyup', this._onKey);
            window.addEventListener('mousemove', this._onMouse);
            window.addEventListener('mousedown', this._onMouseD);
            window.addEventListener('mouseup', this._onMouseU);
            window.addEventListener('resize', this._onResize);
            this.running = true;
            this.lastTime = performance.now();
            this.nextWave();
            this.loop();
        }

        stop() {
            this.running = false;
            window.removeEventListener('keydown', this._onKey);
            window.removeEventListener('keyup', this._onKey);
            window.removeEventListener('mousemove', this._onMouse);
            window.removeEventListener('mousedown', this._onMouseD);
            window.removeEventListener('mouseup', this._onMouseU);
            window.removeEventListener('resize', this._onResize);
        }

        loop() {
            if (!this.running) return;
            const now = performance.now();
            const dt = Math.min(now - this.lastTime, 50);
            this.lastTime = now;
            this.update(dt);
            this.render();
            requestAnimationFrame(() => this.loop());
        }

        // ---- WAVE SYSTEM ----
        nextWave() {
            this.wave++;
            const isBossWave = this.wave % BOSS_WAVE === 0;
            const count = isBossWave ? 1 : Math.min(3 + this.wave, 15);
            const availColors = COLORS.filter(c => c !== this.p1.color && (!this.p2 || c !== this.p2.color));
            const weapons = Object.keys(WEAPON_DATA);
            for (let i = 0; i < count; i++) {
                const a = Math.random() * Math.PI * 2;
                const d = 400 + Math.random() * 200;
                const ex = this.arenaW / 2 + Math.cos(a) * d;
                const ey = this.arenaH / 2 + Math.sin(a) * d;
                const ec = availColors[randInt(0, availColors.length - 1)];
                const ew = weapons[randInt(0, weapons.length - 1)];
                this.enemies.push(new Fighter(
                    clamp(ex, 40, this.arenaW - 40),
                    clamp(ey, 40, this.arenaH - 40),
                    ec, ew, false, isBossWave
                ));
            }
            this.enemiesAlive = count;
            // show announcement
            const ann = document.getElementById('wave-announce');
            const annTxt = document.getElementById('wave-announce-text');
            if (ann && annTxt) {
                annTxt.textContent = isBossWave ? `👑 JEFE — Oleada ${this.wave}!` : `Oleada ${this.wave}!`;
                ann.classList.remove('hidden');
                setTimeout(() => ann.classList.add('hidden'), 2000);
            }
            document.getElementById('wave-num').textContent = this.wave;
            // spawn powerup
            if (this.wave > 1 && Math.random() < 0.6) {
                const pt = POWERUP_TYPES[randInt(0, POWERUP_TYPES.length - 1)];
                this.powerups.push(new PowerUp(
                    rand(100, this.arenaW - 100), rand(100, this.arenaH - 100), pt
                ));
            }
            // spawn reward orbs for AI learning
            const orbCount = 3 + Math.min(this.wave, 7); // 3-10 orbs
            this.rewardOrbs.push(...spawnRewardOrbs(this.arenaW, this.arenaH, orbCount, this.structures));
        }

        // ---- ENEMY AI ----
        updateEnemyAI(e, dt) {
            const target = this.closestPlayer(e);
            if (!target || !target.alive) return;
            const s = sharedQL.stateKey(e, target, this.structures, null);
            // Only pick a new action every ~15 frames (commitment)
            e._actionTimer = (e._actionTimer || 0) - 1;
            if (e._actionTimer <= 0 || !e._currentAction) {
                const action = sharedQL.choose(s);
                e._currentAction = action;
                e._actionTimer = 10 + randInt(0, 10); // 10-20 frames commitment
                e.prevState = s; e.prevAction = action;
            }
            const action = e._currentAction;
            const a = angle(e, target);
            const spd = e.actualSpeed;
            // Low HP enemies retreat more often
            const hpRatio = e.hp / e.maxHp;
            const shouldRetreat = hpRatio < 0.3 && Math.random() < 0.5;
            if (shouldRetreat) {
                e.vx = -Math.cos(a); e.vy = -Math.sin(a);
            } else {
                switch (action) {
                    case 'chase': e.vx = Math.cos(a); e.vy = Math.sin(a); break;
                    case 'retreat': e.vx = -Math.cos(a); e.vy = -Math.sin(a); break;
                    case 'strafe_left': e.vx = Math.cos(a - Math.PI / 2); e.vy = Math.sin(a - Math.PI / 2); break;
                    case 'strafe_right': e.vx = Math.cos(a + Math.PI / 2); e.vy = Math.sin(a + Math.PI / 2); break;
                    case 'flank': { const fa = a + (Math.random() > 0.5 ? 1 : -1) * Math.PI / 3; e.vx = Math.cos(fa); e.vy = Math.sin(fa); break; }
                    case 'attack': e.vx = Math.cos(a) * 0.3; e.vy = Math.sin(a) * 0.3; break;
                }
            }
            e.angle = a;
            const d = dist(e, target);
            // Hesitation: enemies only attack 40% of the time they're in range
            if (d < e.atkRange * AUTO_ATK_MULT && Math.random() < 0.4) {
                if (e.attack()) {
                    const dmg = e.dmg;
                    if (d < e.atkRange) {
                        target.takeDamage(dmg, e);
                        this.spawnHitFx(target);
                        const reward = 1 + dmg / 10;
                        if (e.prevState) {
                            const s2 = sharedQL.stateKey(e, target, this.structures, null);
                            sharedQL.update(e.prevState, e.prevAction, reward, s2);
                        }
                    }
                }
            }
        }

        closestPlayer(e) {
            let best = null, bd = Infinity;
            for (const p of this.players) {
                if (!p.alive) continue;
                const d = dist(e, p);
                if (d < bd) { bd = d; best = p; }
            }
            return best || this.p1;
        }

        // ---- INPUT ----
        handleP1Input() {
            const k = this.keys;
            let dx = 0, dy = 0;
            if (k['w'] || k['arrowup'] && this.mode === 'solo') dy--;
            if (k['s'] || k['arrowdown'] && this.mode === 'solo') dy++;
            if (k['a'] || k['arrowleft'] && this.mode === 'solo') dx--;
            if (k['d'] || k['arrowright'] && this.mode === 'solo') dx++;
            // for non-solo, only WASD for P1
            if (this.mode !== 'solo') {
                dx = 0; dy = 0;
                if (k['w']) dy--;  if (k['s']) dy++;
                if (k['a']) dx--;  if (k['d']) dx++;
            }
            if (dx || dy) { const m = Math.hypot(dx, dy); this.p1.vx = dx / m; this.p1.vy = dy / m; }
            else { this.p1.vx = 0; this.p1.vy = 0; }
            // angle to mouse
            this.p1.angle = Math.atan2(
                this.mouse.y - (this.p1.y - this.cam.y),
                this.mouse.x - (this.p1.x - this.cam.x)
            );
            // auto-attack nearest enemy
            const nearest = this.nearestEnemy(this.p1);
            if (nearest && dist(this.p1, nearest) < this.p1.atkRange * AUTO_ATK_MULT) {
                if (this.p1.attack()) {
                    if (dist(this.p1, nearest) < this.p1.atkRange) {
                        nearest.takeDamage(this.p1.dmg, this.p1);
                        this.spawnHitFx(nearest);
                        if (!nearest.alive) {
                            this.onEnemyKill(nearest, this.p1);
                        }
                    }
                }
            }
            // also attack on click  
            if (this.mouse.down) {
                const ne = this.nearestEnemy(this.p1);
                if (ne && dist(this.p1, ne) < this.p1.atkRange) {
                    if (this.p1.attack()) {
                        ne.takeDamage(this.p1.dmg, this.p1);
                        this.spawnHitFx(ne);
                        if (!ne.alive) this.onEnemyKill(ne, this.p1);
                    }
                }
            }
            // dash
            if (k[' ']) this.p1.dash();
            // pickup
            if (k['e']) this.tryPickup(this.p1);
        }

        handleP2Input() {
            if (!this.p2 || !this.p2.alive) return;
            const k = this.keys;
            let dx = 0, dy = 0;
            if (k['arrowup']) dy--;    if (k['arrowdown']) dy++;
            if (k['arrowleft']) dx--;  if (k['arrowright']) dx++;
            if (dx || dy) { const m = Math.hypot(dx, dy); this.p2.vx = dx / m; this.p2.vy = dy / m; }
            else { this.p2.vx = 0; this.p2.vy = 0; }
            // face nearest enemy
            const ne = this.nearestEnemy(this.p2);
            if (ne) this.p2.angle = angle(this.p2, ne);
            // auto-attack
            if (ne && dist(this.p2, ne) < this.p2.atkRange * AUTO_ATK_MULT) {
                if (this.p2.attack()) {
                    if (dist(this.p2, ne) < this.p2.atkRange) {
                        ne.takeDamage(this.p2.dmg, this.p2);
                        this.spawnHitFx(ne);
                        if (!ne.alive) this.onEnemyKill(ne, this.p2);
                    }
                }
            }
            // dash
            if (k['enter']) this.p2.dash();
            // pickup
            if (k['/']) this.tryPickup(this.p2);
        }

        nearestEnemy(player) {
            let best = null, bd = Infinity;
            for (const e of this.enemies) {
                if (!e.alive) continue;
                const d = dist(player, e);
                if (d < bd) { bd = d; best = e; }
            }
            return best;
        }

        onEnemyKill(enemy, killer) {
            killer.kills++;
            const pts = enemy.isBoss ? 500 : 100;
            killer.score += pts;
            this.texts.push(new FloatingText(enemy.x, enemy.y - 20, `+${pts}`, '#ff0'));
            sharedQL.decayEpsilon();
            // negative reward for dying
            if (enemy.prevState) {
                sharedQL.update(enemy.prevState, enemy.prevAction, -2, enemy.prevState);
            }
            // weapon drop
            if (Math.random() < 0.3) {
                this.drops.push(new WeaponDrop(enemy.x, enemy.y, enemy.weapon));
            }
            this.enemiesAlive--;
        }

        tryPickup(player) {
            // weapon drops
            for (let i = this.drops.length - 1; i >= 0; i--) {
                if (dist(player, this.drops[i]) < PICKUP_RANGE) {
                    player.weapon = this.drops[i].weapon;
                    this.texts.push(new FloatingText(player.x, player.y - 20, WEAPON_DATA[player.weapon].label, '#0ff'));
                    this.drops.splice(i, 1);
                    return;
                }
            }
            // powerups
            for (let i = this.powerups.length - 1; i >= 0; i--) {
                if (dist(player, this.powerups[i]) < PICKUP_RANGE) {
                    const pu = this.powerups[i];
                    player.addBuff(pu.type.key, pu.type.dur);
                    this.texts.push(new FloatingText(player.x, player.y - 20, pu.type.label, pu.type.color));
                    this.powerups.splice(i, 1);
                    return;
                }
            }
        }

        spawnHitFx(target) {
            const color = target.isPlayer ? '#f44' : '#ff0';
            for (let i = 0; i < 6; i++) this.particles.push(new Particle(target.x, target.y, color));
        }

        // ---- ONLINE SYNC ----
        onNetMessage(msg) {
            switch (msg.type) {
                case 'state':
                    this.remoteState = msg;
                    break;
                case 'input':
                    // Host receives guest input — identify by senderId/slot
                    if (msg.slot !== undefined && this.players[msg.slot]) {
                        const rp = this.players[msg.slot];
                        if (rp && rp.alive) {
                            const rk = msg.keys;
                            let dx = 0, dy = 0;
                            if (rk.up) dy--; if (rk.down) dy++; if (rk.left) dx--; if (rk.right) dx++;
                            if (dx || dy) { const m = Math.hypot(dx, dy); rp.vx = dx / m; rp.vy = dy / m; }
                            else { rp.vx = 0; rp.vy = 0; }
                            if (rk.dash) rp.dash();
                        }
                    }
                    break;
                case 'game_restart': {
                    // Server sent game_restart — create a new game for all clients
                    const plist = msg.players || (netManager ? netManager.players : []);
                    const mySlot = plist.findIndex(p => p.id === (netManager ? netManager.myId : null));
                    const playersInfo = plist.map(p => ({ color: p.color, weapon: p.weapon }));
                    const isHost = netManager && netManager.isHost;
                    showScreen('game-screen');
                    updateOnlinePlayerList(plist);
                    currentGame = new Game(isHost ? 'online_host' : 'online_guest', playersInfo, netManager, mySlot >= 0 ? mySlot : 0);
                    currentGame.start();
                    break;
                }
                case 'player_left':
                    this.texts.push(new FloatingText(this.arenaW / 2, this.arenaH / 2, 'Jugador desconectado', '#f44'));
                    updateOnlinePlayerList(msg.players || []);
                    break;
                case 'ready_count': {
                    const btn = document.getElementById('restart-btn');
                    if (btn) btn.textContent = 'LISTOS: ' + msg.ready + '/' + msg.needed;
                    break;
                }
            }
        }

        sendHostState() {
            if (!this.net || this.mode !== 'online_host') return;
            this.netSyncTimer++;
            if (this.netSyncTimer % 3 !== 0) return;
            const enemyData = this.enemies.filter(e => e.alive).map(e => ({
                x: Math.round(e.x), y: Math.round(e.y), hp: Math.round(e.hp),
                maxHp: e.maxHp, color: e.color, weapon: e.weapon, angle: +e.angle.toFixed(2),
                attacking: e.attacking, isBoss: e.isBoss
            }));
            const playersData = this.players.map(p => ({
                x: Math.round(p.x), y: Math.round(p.y), hp: p.hp, maxHp: p.maxHp,
                angle: +p.angle.toFixed(2), attacking: p.attacking,
                weapon: p.weapon, color: p.color, alive: p.alive
            }));
            let totalScore = 0, totalKills = 0;
            this.players.forEach(p => { totalScore += p.score; totalKills += p.kills; });
            this.net.send({
                type: 'state',
                players: playersData,
                enemies: enemyData,
                wave: this.wave,
                score: totalScore,
                kills: totalKills,
                gameOver: this.players.every(p => !p.alive)
            });
        }

        sendGuestInput() {
            if (!this.net || this.mode !== 'online_guest') return;
            this.netSyncTimer++;
            if (this.netSyncTimer % 2 !== 0) return;
            const k = this.keys;
            this.net.send({
                type: 'input',
                slot: this.mySlot,
                keys: { up: !!k['w'] || !!k['arrowup'], down: !!k['s'] || !!k['arrowdown'],
                        left: !!k['a'] || !!k['arrowleft'], right: !!k['d'] || !!k['arrowright'],
                        dash: !!k[' '] }
            });
        }

        applyRemoteState() {
            if (!this.remoteState) return;
            const rs = this.remoteState;
            // Update all players from host state
            if (rs.players) {
                for (let i = 0; i < rs.players.length; i++) {
                    if (this.players[i]) {
                        Object.assign(this.players[i], {
                            x: rs.players[i].x, y: rs.players[i].y,
                            hp: rs.players[i].hp, angle: rs.players[i].angle,
                            attacking: rs.players[i].attacking, alive: rs.players[i].alive
                        });
                    }
                }
            }
            // rebuild enemies from remote
            this.enemies = (rs.enemies || []).map(e => {
                const f = new Fighter(e.x, e.y, e.color, e.weapon, false, e.isBoss);
                f.hp = e.hp; f.maxHp = e.maxHp; f.angle = e.angle; f.attacking = e.attacking;
                return f;
            });
            this.wave = rs.wave || this.wave;
            document.getElementById('wave-num').textContent = this.wave;
            document.getElementById('score-num').textContent = rs.score || 0;
            document.getElementById('kills-num').textContent = rs.kills || 0;
            // Detect game over from host
            if (rs.gameOver) {
                this._remoteGameOver = true;
            }
            this.remoteState = null;
        }

        // ---- UPDATE ----
        update(dt) {
            if (this.mode === 'online_guest') {
                // Guest: send inputs, apply remote state, render + HUD
                this.sendGuestInput();
                this.applyRemoteState();
                this.particles.forEach(p => p.update());
                this.particles = this.particles.filter(p => p.life > 0);
                this.texts.forEach(t => t.update());
                this.texts = this.texts.filter(t => t.life > 0);

                // Guest HUD
                if (this.players[this.mySlot]) {
                    const me = this.players[this.mySlot];
                    const hpPct = me.hp / me.maxHp * 100;
                    document.getElementById('hp-bar').style.width = hpPct + '%';
                    document.getElementById('hp-text').textContent = Math.round(me.hp);
                    document.getElementById('hp-label').textContent = 'P' + (this.mySlot + 1) + ' HP';
                }
                // Other players HP bars
                const h2 = document.getElementById('hud-p2');
                const otherPlayers = this.players.filter((_, i) => i !== this.mySlot);
                if (otherPlayers.length > 0) {
                    h2.classList.remove('hidden');
                    let h2html = '';
                    for (let i = 0; i < this.players.length; i++) {
                        if (i === this.mySlot) continue;
                        const pp = this.players[i];
                        const pct = pp.alive ? (pp.hp / pp.maxHp * 100) : 0;
                        h2html += `<div class="hud-hp p2-hp"><span>P${i+1}</span><div class="hp-bar-bg"><div class="hp-bar p2" style="width:${pct}%"></div></div><span>${Math.round(pp.hp)}</span></div>`;
                    }
                    h2.innerHTML = h2html;
                }
                // Wave/score from remote
                document.getElementById('wave-num').textContent = this.wave;
                // Boss HUD
                const boss = this.enemies.find(e => e.isBoss && e.alive);
                const bHud = document.getElementById('boss-hud');
                if (boss) {
                    bHud.classList.remove('hidden');
                    document.getElementById('boss-hp-bar').style.width = (boss.hp / boss.maxHp * 100) + '%';
                } else {
                    bHud.classList.add('hidden');
                }
                // Guest game over check — from remote state
                if (this._remoteGameOver) {
                    this._remoteGameOver = false;
                    this.gameOver();
                }

                this.updateCamera();
                return;
            }

            this.handleP1Input();
            if (this.mode === 'coop') this.handleP2Input();
            // Host auto-attack for remote online players (slots > 0)
            if (this.mode === 'online_host') {
                for (let i = 1; i < this.players.length; i++) {
                    const rp = this.players[i];
                    if (!rp || !rp.alive) continue;
                    // Face nearest enemy
                    const ne = this.nearestEnemy(rp);
                    if (ne) {
                        rp.angle = angle(rp, ne);
                        // Auto-attack
                        if (dist(rp, ne) < rp.atkRange * AUTO_ATK_MULT) {
                            if (rp.attack()) {
                                if (dist(rp, ne) < rp.atkRange) {
                                    ne.takeDamage(rp.dmg, rp);
                                    this.spawnHitFx(ne);
                                    if (!ne.alive) this.onEnemyKill(ne, rp);
                                }
                            }
                        }
                    }
                }
            }

            // update all players
            for (const p of this.players) {
                if (!p.alive) continue;
                p.update(dt, this.structures);
                p.x = clamp(p.x, p.radius, this.arenaW - p.radius);
                p.y = clamp(p.y, p.radius, this.arenaH - p.radius);
            }

            // enemies
            for (const e of this.enemies) {
                if (!e.alive) continue;
                this.updateEnemyAI(e, dt);
                e.update(dt, this.structures);
                // arena edge — just clamp, flag collision
                const preX = e.x, preY = e.y;
                e.x = clamp(e.x, e.radius, this.arenaW - e.radius);
                e.y = clamp(e.y, e.radius, this.arenaH - e.radius);
                if (e.x !== preX || e.y !== preY) e._collided = true;
                // small penalty only on FIRST collision frame (not every tick)
                if (e._collided && !e._wasColliding && e.prevState) {
                    const s2 = sharedQL.stateKey(e, this.closestPlayer(e), this.structures, null);
                    sharedQL.update(e.prevState, e.prevAction, -0.1, s2);
                }
                e._wasColliding = e._collided;
                // reward orb collection
                for (let oi = this.rewardOrbs.length - 1; oi >= 0; oi--) {
                    const orb = this.rewardOrbs[oi];
                    if (!orb.collected && dist(e, orb) < e.radius + orb.radius) {
                        orb.collected = true;
                        this.rewardOrbs.splice(oi, 1);
                        // Q-learning reward: 0.5 (less than kill=1+)
                        if (e.prevState) {
                            const s2 = sharedQL.stateKey(e, this.closestPlayer(e), this.structures, null);
                            sharedQL.update(e.prevState, e.prevAction, 0.5, s2);
                        }
                    }
                }
                if (!e.alive && this.enemiesAlive > 0) {
                    this.onEnemyKill(e, this.closestPlayer(e));
                }
            }
            this.enemies = this.enemies.filter(e => e.alive);

            // check wave clear
            if (this.enemies.length === 0) this.nextWave();

            // pickup proximity hint
            const hint = document.getElementById('pickup-hint');
            const nearDrop = this.drops.some(d => dist(this.p1, d) < PICKUP_RANGE) ||
                             this.powerups.some(p => dist(this.p1, p) < PICKUP_RANGE);
            if (hint) hint.classList.toggle('hidden', !nearDrop);

            // auto-pickup powerups on contact
            for (let i = this.powerups.length - 1; i >= 0; i--) {
                const pu = this.powerups[i];
                let picked = false;
                for (const p of this.players) {
                    if (p.alive && dist(p, pu) < 30) {
                        p.addBuff(pu.type.key, pu.type.dur);
                        this.texts.push(new FloatingText(p.x, p.y - 20, pu.type.label, pu.type.color));
                        picked = true; break;
                    }
                }
                if (picked) this.powerups.splice(i, 1);
            }

            // update fx
            this.drops.forEach(d => d.update());
            this.powerups.forEach(p => p.update());
            this.rewardOrbs.forEach(o => o.update());
            this.particles.forEach(p => p.update());
            this.particles = this.particles.filter(p => p.life > 0);
            this.texts.forEach(t => t.update());
            this.texts = this.texts.filter(t => t.life > 0);

            // HUD
            const hpPct = this.p1.hp / this.p1.maxHp * 100;
            document.getElementById('hp-bar').style.width = hpPct + '%';
            document.getElementById('hp-text').textContent = Math.round(this.p1.hp);
            let totalScore = 0, totalKills = 0;
            this.players.forEach(p => { totalScore += p.score; totalKills += p.kills; });
            document.getElementById('score-num').textContent = totalScore;
            document.getElementById('kills-num').textContent = totalKills;

            // P2+ HUD bars
            const h2 = document.getElementById('hud-p2');
            if (this.players.length > 1) {
                h2.classList.remove('hidden');
                let h2html = '';
                for (let i = 1; i < this.players.length; i++) {
                    const pp = this.players[i];
                    const pct = pp.alive ? (pp.hp / pp.maxHp * 100) : 0;
                    h2html += `<div class="hud-hp p2-hp"><span>P${i+1}</span><div class="hp-bar-bg"><div class="hp-bar p2" style="width:${pct}%"></div></div><span>${Math.round(pp.hp)}</span></div>`;
                }
                h2.innerHTML = h2html;
            } else {
                h2.classList.add('hidden');
            }

            // boss HUD
            const boss = this.enemies.find(e => e.isBoss && e.alive);
            const bHud = document.getElementById('boss-hud');
            if (boss) {
                bHud.classList.remove('hidden');
                document.getElementById('boss-hp-bar').style.width = (boss.hp / boss.maxHp * 100) + '%';
            } else {
                bHud.classList.add('hidden');
            }

            // powerup indicators
            const indEl = document.getElementById('powerup-indicators');
            if (indEl) {
                let html = '';
                for (const k in this.p1.buffs) {
                    const rem = Math.max(0, (this.p1.buffs[k] - Date.now()) / 1000).toFixed(1);
                    const pt = POWERUP_TYPES.find(p => p.key === k);
                    if (pt) html += `<div class="pu-ind" style="background:${pt.color}33;border-color:${pt.color}">${pt.icon} ${rem}s</div>`;
                }
                indEl.innerHTML = html;
            }

            // online sync
            this.sendHostState();

            // game over check — all players dead
            const allDead = this.players.every(p => !p.alive);
            if (allDead) {
                this.gameOver();
            }

            this.updateCamera();
        }

        updateCamera() {
            // Camera follows average of alive players
            let fx = 0, fy = 0, cnt = 0;
            for (const p of this.players) {
                if (p.alive) { fx += p.x; fy += p.y; cnt++; }
            }
            if (cnt > 0) { fx /= cnt; fy /= cnt; }
            else if (this.p1) { fx = this.p1.x; fy = this.p1.y; }
            if (this.mode === 'online_guest' && this.players[this.mySlot]) {
                fx = this.players[this.mySlot].x;
                fy = this.players[this.mySlot].y;
            }
            this.cam.x = lerp(this.cam.x, fx - this.canvas.width / 2, 0.08);
            this.cam.y = lerp(this.cam.y, fy - this.canvas.height / 2, 0.08);
        }

        // ---- RENDER ----
        render() {
            const ctx = this.ctx, c = this.cam;
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            // draw floor tiles
            const tileImg = IMG.tilesheet;
            const tileSize = TILE;
            const srcX = 6 * 128, srcY = 0;
            const startCol = Math.floor(c.x / tileSize);
            const startRow = Math.floor(c.y / tileSize);
            const endCol = startCol + Math.ceil(this.canvas.width / tileSize) + 1;
            const endRow = startRow + Math.ceil(this.canvas.height / tileSize) + 1;
            for (let row = startRow; row <= endRow; row++) {
                for (let col = startCol; col <= endCol; col++) {
                    if (col < 0 || row < 0 || col * tileSize >= this.arenaW || row * tileSize >= this.arenaH) continue;
                    const dx = col * tileSize - c.x, dy = row * tileSize - c.y;
                    if (tileImg && tileImg.complete) ctx.drawImage(tileImg, srcX, srcY, 128, 128, dx, dy, tileSize, tileSize);
                    else { ctx.fillStyle = '#3a3'; ctx.fillRect(dx, dy, tileSize, tileSize); }
                }
            }
            // arena boundary
            ctx.strokeStyle = '#f44'; ctx.lineWidth = 3;
            ctx.strokeRect(-c.x, -c.y, this.arenaW, this.arenaH);
            // structures
            this.structures.forEach(s => s.draw(ctx, c));
            // drops, powerups, reward orbs
            this.drops.forEach(d => d.draw(ctx, c));
            this.powerups.forEach(p => p.draw(ctx, c));
            this.rewardOrbs.forEach(o => o.draw(ctx, c));
            // enemies
            this.enemies.forEach(e => e.draw(ctx, c));
            // players
            this.players.forEach(p => p.draw(ctx, c));
            // fx
            this.particles.forEach(p => p.draw(ctx, c));
            this.texts.forEach(t => t.draw(ctx, c));
        }

        // ---- GAME OVER ----
        gameOver() {
            this.stop();
            // Do NOT close the network — keep players in the room
            let totalScore = 0, totalKills = 0;
            this.players.forEach(p => { totalScore += p.score; totalKills += p.kills; });
            document.getElementById('final-wave').textContent = this.wave;
            document.getElementById('final-score').textContent = totalScore;
            document.getElementById('final-kills').textContent = totalKills;
            showScreen('gameover-screen');
            this._finalScore = totalScore;
            this._finalKills = totalKills;
            this._finalWave = this.wave;
            // Show restart button for online
            const restartBtn = document.getElementById('restart-btn');
            restartBtn.disabled = false;
            if (this.net) {
                restartBtn.textContent = 'LISTO PARA REINICIAR';
            } else {
                restartBtn.textContent = 'REINTENTAR';
            }
            loadLeaderboard();
            loadStats();
        }
    }

    // ===================== TRAINING MODE =====================
    class TrainingMode {
        constructor() {
            this.canvas = document.getElementById('trainingCanvas');
            this.ctx = this.canvas.getContext('2d');
            this.canvas.width = 800; this.canvas.height = 600;
            this.arenaW = 800; this.arenaH = 600;
            this.mapIndex = 1; // default: classic
            this.methodIndex = 0; // default: 2v2
            this.structures = [];
            this.hazards = [];
            this.fighters = [];
            this.particles = []; this.texts = [];
            this.episode = 0; this.round = 0; this.totalReward = 0;
            this.speed = 1; this.paused = false; this.running = false;
            this.cam = { x: 0, y: 0 };
            this.autoRotateMap = false;
            this.autoRotateMethod = false;
            this.buildMapUI();
            this.buildMethodUI();
        }

        buildMapUI() {
            const grid = document.getElementById('train-map-grid');
            grid.innerHTML = '';
            TRAINING_MAPS.forEach((m, i) => {
                const btn = document.createElement('button');
                btn.className = 'train-opt-btn' + (i === this.mapIndex ? ' active' : '');
                btn.title = m.desc;
                btn.textContent = m.name;
                btn.addEventListener('click', () => {
                    this.mapIndex = i;
                    this.autoRotateMap = false;
                    grid.querySelectorAll('.train-opt-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.applyMap();
                    this.startRound();
                });
                grid.appendChild(btn);
            });
            // Auto-rotate button
            const autoBtn = document.createElement('button');
            autoBtn.className = 'train-opt-btn auto-btn' + (this.autoRotateMap ? ' active' : '');
            autoBtn.textContent = '🔄 Auto';
            autoBtn.title = 'Rotar mapas automáticamente';
            autoBtn.addEventListener('click', () => {
                this.autoRotateMap = !this.autoRotateMap;
                autoBtn.classList.toggle('active', this.autoRotateMap);
                if (this.autoRotateMap) {
                    grid.querySelectorAll('.train-opt-btn:not(.auto-btn)').forEach(b => b.classList.remove('active'));
                }
            });
            grid.appendChild(autoBtn);
        }

        buildMethodUI() {
            const grid = document.getElementById('train-method-grid');
            grid.innerHTML = '';
            TRAINING_METHODS.forEach((m, i) => {
                const btn = document.createElement('button');
                btn.className = 'train-opt-btn' + (i === this.methodIndex ? ' active' : '');
                btn.title = m.desc;
                btn.textContent = m.name;
                btn.addEventListener('click', () => {
                    this.methodIndex = i;
                    this.autoRotateMethod = false;
                    grid.querySelectorAll('.train-opt-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.startRound();
                });
                grid.appendChild(btn);
            });
            // Auto-rotate button
            const autoBtn = document.createElement('button');
            autoBtn.className = 'train-opt-btn auto-btn' + (this.autoRotateMethod ? ' active' : '');
            autoBtn.textContent = '🔄 Auto';
            autoBtn.title = 'Rotar métodos automáticamente';
            autoBtn.addEventListener('click', () => {
                this.autoRotateMethod = !this.autoRotateMethod;
                autoBtn.classList.toggle('active', this.autoRotateMethod);
                if (this.autoRotateMethod) {
                    grid.querySelectorAll('.train-opt-btn:not(.auto-btn)').forEach(b => b.classList.remove('active'));
                }
            });
            grid.appendChild(autoBtn);
        }

        applyMap() {
            const map = TRAINING_MAPS[this.mapIndex];
            const built = map.build(this.arenaW, this.arenaH);
            this.structures = built.structures;
            this.hazards = built.hazards;
        }

        start() {
            this.running = true;
            this.episode = 0; this.round = 0; this.totalReward = 0;
            this.applyMap();
            this.startRound();
            this.loop();
        }

        stop() { this.running = false; sharedQL.save(); sharedQL.syncToServer(); }

        startRound() {
            this.round++;
            // auto-rotate if enabled
            if (this.autoRotateMap) {
                this.mapIndex = (this.round - 1) % TRAINING_MAPS.length;
                this.applyMap();
            }
            if (this.autoRotateMethod) {
                this.methodIndex = (this.round - 1) % TRAINING_METHODS.length;
            }

            const method = TRAINING_METHODS[this.methodIndex];
            this.fighters = method.spawn(this.arenaW, this.arenaH);
            // reset water slow flag
            this.fighters.forEach(f => { f._waterSlow = false; });
            this.particles = [];
            this.texts = [];
            // spawn reward orbs
            this.rewardOrbs = spawnRewardOrbs(this.arenaW, this.arenaH, 8, this.structures);
            this.updateHUD();
        }

        loop() {
            if (!this.running) return;
            if (!this.paused) {
                for (let s = 0; s < this.speed; s++) {
                    this.tick();
                }
            }
            this.render();
            requestAnimationFrame(() => this.loop());
        }

        tick() {
            const method = TRAINING_METHODS[this.methodIndex];
            const alive = this.fighters.filter(f => f.alive);

            if (method.isDone(this.fighters)) {
                this.episode++;
                sharedQL.decayEpsilon();
                // Auto-save every 10 episodes + sync to server every 50
                if (this.episode % 10 === 0) {
                    sharedQL.save();
                    if (this.episode % 50 === 0) sharedQL.syncToServer();
                }
                this.startRound();
                return;
            }

            // Reset water slow each tick before hazard effects
            alive.forEach(f => { f._waterSlow = false; });

            // Apply hazard zone effects
            for (const hz of this.hazards) {
                for (const f of alive) {
                    hz.applyEffect(f, 16);
                }
            }

            for (const f of alive) {
                // find nearest enemy from other team
                const enemies = alive.filter(e => e.team !== f.team && e.alive);
                if (enemies.length === 0) continue;
                let target = enemies[0], bd = dist(f, enemies[0]);
                for (let i = 1; i < enemies.length; i++) {
                    const d = dist(f, enemies[i]);
                    if (d < bd) { bd = d; target = enemies[i]; }
                }

                const s = sharedQL.stateKey(f, target, this.structures, this.hazards);
                // Only pick a new action every ~15 frames (commitment)
                f._actionTimer = (f._actionTimer || 0) - 1;
                if (f._actionTimer <= 0 || !f._currentAction) {
                    const action = sharedQL.choose(s);
                    f._currentAction = action;
                    f._actionTimer = 10 + randInt(0, 10); // 10-20 frames commitment
                    f.prevState = s; f.prevAction = action;
                }
                const action = f._currentAction;
                const a = angle(f, target);
                switch (action) {
                    case 'chase': f.vx = Math.cos(a); f.vy = Math.sin(a); break;
                    case 'retreat': f.vx = -Math.cos(a); f.vy = -Math.sin(a); break;
                    case 'strafe_left': f.vx = Math.cos(a - Math.PI / 2); f.vy = Math.sin(a - Math.PI / 2); break;
                    case 'strafe_right': f.vx = Math.cos(a + Math.PI / 2); f.vy = Math.sin(a + Math.PI / 2); break;
                    case 'flank': { const fa = a + (Math.random() > 0.5 ? 1 : -1) * Math.PI / 3; f.vx = Math.cos(fa); f.vy = Math.sin(fa); break; }
                    case 'attack': f.vx = Math.cos(a) * 0.3; f.vy = Math.sin(a) * 0.3; break;
                }
                f.angle = a;

                // water slow effect
                if (f._waterSlow) {
                    f.vx *= 0.4;
                    f.vy *= 0.4;
                }

                f.update(16, this.structures);
                // arena edge — just clamp, flag collision
                const preFFX = f.x, preFFY = f.y;
                f.x = clamp(f.x, f.radius, this.arenaW - f.radius);
                f.y = clamp(f.y, f.radius, this.arenaH - f.radius);
                if (f.x !== preFFX || f.y !== preFFY) f._collided = true;
                // small penalty only on FIRST collision frame
                if (f._collided && !f._wasColliding && f.prevState) {
                    const s2 = sharedQL.stateKey(f, target, this.structures, this.hazards);
                    sharedQL.update(f.prevState, f.prevAction, -0.1, s2);
                    this.totalReward -= 0.1;
                }
                f._wasColliding = f._collided;

                // reward orb collection
                for (let oi = this.rewardOrbs.length - 1; oi >= 0; oi--) {
                    const orb = this.rewardOrbs[oi];
                    if (!orb.collected && dist(f, orb) < f.radius + orb.radius) {
                        orb.collected = true;
                        this.rewardOrbs.splice(oi, 1);
                        // Q-learning reward: 0.5 (less than kill)
                        if (f.prevState) {
                            const s2 = sharedQL.stateKey(f, target, this.structures, this.hazards);
                            sharedQL.update(f.prevState, f.prevAction, 0.5, s2);
                            this.totalReward += 0.5;
                        }
                        if (this.speed <= 2) {
                            this.particles.push(new Particle(orb.x, orb.y, '#0ff'));
                            this.particles.push(new Particle(orb.x, orb.y, '#4ef'));
                        }
                    }
                }

                // combat
                if (bd < f.atkRange * AUTO_ATK_MULT && f.attack()) {
                    if (bd < f.atkRange) {
                        target.takeDamage(f.dmg, f);
                        const reward = target.alive ? 1 : 5;
                        this.totalReward += reward;
                        const s2 = sharedQL.stateKey(f, target, this.structures, this.hazards);
                        sharedQL.update(s, action, reward, s2);
                        if (this.speed <= 2) {
                            this.particles.push(new Particle(target.x, target.y, '#ff0'));
                            this.particles.push(new Particle(target.x, target.y, '#f80'));
                        }
                        if (!target.alive && target.prevState) {
                            sharedQL.update(target.prevState, target.prevAction, -3, s2);
                        }
                    }
                }

                // hazard avoidance reward: negative reward for standing in damage zones
                for (const hz of this.hazards) {
                    if ((hz.type === 'lava' || hz.type === 'spikes') && hz.contains(f.x, f.y)) {
                        if (f.prevState) {
                            sharedQL.update(f.prevState, f.prevAction, -0.5, s);
                        }
                    }
                    // positive reward for using heal zones
                    if (hz.type === 'heal' && hz.contains(f.x, f.y) && f.hp < f.maxHp * 0.7) {
                        if (f.prevState) {
                            sharedQL.update(f.prevState, f.prevAction, 0.3, s);
                        }
                    }
                }
            }

            // filter dead from alive check
            this.fighters = this.fighters.filter(f => f.alive || true); // keep all for render

            // update particles and orbs
            if (this.speed <= 2) {
                this.particles.forEach(p => p.update());
                this.particles = this.particles.filter(p => p.life > 0);
                this.rewardOrbs.forEach(o => o.update());
            } else {
                this.particles = [];
            }

            this.updateHUD();
        }

        updateHUD() {
            const el = (id) => document.getElementById(id);
            el('train-episodes').textContent = this.episode;
            el('train-states').textContent = sharedQL.statesCount() + '/' + sharedQL.maxStates();
            el('train-epsilon').textContent = sharedQL.epsilon.toFixed(4);
            el('train-reward').textContent = Math.round(this.totalReward);
            el('train-round').textContent = this.round;
            el('train-updates').textContent = sharedQL.totalUpdates;
            el('train-map-name').textContent = TRAINING_MAPS[this.mapIndex].name;
            el('train-method-name').textContent = TRAINING_METHODS[this.methodIndex].name;
            // Save indicator
            const saveStatus = el('train-save-status');
            if (saveStatus) {
                if (this.episode > 0 && this.episode % 10 === 0) {
                    saveStatus.textContent = '💾 Guardado! (' + sharedQL.statesCount() + ' estados)';
                    saveStatus.style.color = '#4f4';
                } else {
                    const pct = (sharedQL.statesCount() / sharedQL.maxStates() * 100).toFixed(0);
                    saveStatus.textContent = '💾 Auto-guardado · Cobertura: ' + pct + '%';
                    saveStatus.style.color = '#4ecdc4';
                }
            }
        }

        render() {
            const ctx = this.ctx, c = this.cam;
            ctx.fillStyle = '#2a2a2a'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            // floor grid
            ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 1;
            for (let x = 0; x < this.arenaW; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.arenaH); ctx.stroke(); }
            for (let y = 0; y < this.arenaH; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.arenaW, y); ctx.stroke(); }
            // boundary
            ctx.strokeStyle = '#888'; ctx.lineWidth = 2;
            ctx.strokeRect(0, 0, this.arenaW, this.arenaH);
            // hazard zones (below structures and fighters)
            this.hazards.forEach(hz => hz.draw(ctx, c));
            // reward orbs
            this.rewardOrbs.forEach(o => o.draw(ctx, c));
            // structures
            this.structures.forEach(s => s.draw(ctx, c));
            // fighters
            for (const f of this.fighters) {
                if (!f.alive) continue;
                f.draw(ctx, c);
                // team indicator
                const teamColors = [
                    'rgba(100,100,255,0.4)', 'rgba(255,100,100,0.4)',
                    'rgba(100,255,100,0.4)', 'rgba(255,255,100,0.4)'
                ];
                ctx.fillStyle = teamColors[f.team % teamColors.length];
                ctx.beginPath(); ctx.arc(f.x, f.y, f.radius + 3, 0, Math.PI * 2); ctx.fill();
                // HP bar above fighter
                if (f.hp < f.maxHp) {
                    const bw = 30, bh = 4;
                    const bx = f.x - bw / 2, by = f.y - f.radius - 12;
                    ctx.fillStyle = '#333'; ctx.fillRect(bx, by, bw, bh);
                    ctx.fillStyle = f.hp / f.maxHp > 0.3 ? '#4f4' : '#f44';
                    ctx.fillRect(bx, by, bw * (f.hp / f.maxHp), bh);
                }
            }
            // particles
            this.particles.forEach(p => p.draw(ctx, c));
            // info overlay
            ctx.fillStyle = '#fff'; ctx.font = '10px "Press Start 2P"'; ctx.textAlign = 'left';
            const mapName = TRAINING_MAPS[this.mapIndex].id;
            const methodName = TRAINING_METHODS[this.methodIndex].id;
            ctx.fillText(`ε=${sharedQL.epsilon.toFixed(3)}  EP=${this.episode}  SPD=${this.speed}x  MAP=${mapName}  MODE=${methodName}`, 8, 16);
            // show alive counts per team
            const teamCounts = {};
            this.fighters.forEach(f => {
                if (!teamCounts[f.team]) teamCounts[f.team] = { alive: 0, total: 0 };
                teamCounts[f.team].total++;
                if (f.alive) teamCounts[f.team].alive++;
            });
            let tcText = '';
            for (const t in teamCounts) tcText += `T${t}:${teamCounts[t].alive}/${teamCounts[t].total} `;
            ctx.fillText(tcText, 8, 32);
        }
    }

    // ===================== SCREEN / UI MANAGEMENT =====================
    function showScreen(id) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const el = document.getElementById(id);
        if (el) el.classList.add('active');
    }

    let currentGame = null;
    let trainingMode = null;
    let netManager = null;

    function getSelection(prefix) {
        const charEl = document.querySelector(prefix ? `.${prefix}.selected` : '.char-option.selected:not(.p2-char)');
        const weapEl = document.querySelector(prefix ? `.${prefix}.selected` : '.weapon-option.selected:not(.p2-weap)');
        return {
            color: charEl ? charEl.dataset.color : 'green',
            weapon: weapEl ? weapEl.dataset.weapon : 'weapon_sword'
        };
    }

    function getP1Selection() {
        const charEl = document.querySelector('.char-option.selected:not(.p2-char)');
        const weapEl = document.querySelector('.weapon-option.selected:not(.p2-weap)');
        return {
            color: charEl ? charEl.dataset.color : 'green',
            weapon: weapEl ? weapEl.dataset.weapon : 'weapon_sword'
        };
    }

    function getP2Selection() {
        const charEl = document.querySelector('.p2-char.selected');
        const weapEl = document.querySelector('.p2-weap.selected');
        return {
            color: charEl ? charEl.dataset.color : 'purple',
            weapon: weapEl ? weapEl.dataset.weapon : 'weapon_axe'
        };
    }

    function startSolo() {
        const { color, weapon } = getP1Selection();
        showScreen('game-screen');
        document.getElementById('hud-p2').classList.add('hidden');
        document.getElementById('net-status').classList.add('hidden');
        document.getElementById('online-players-list').classList.add('hidden');
        currentGame = new Game('solo', [{color, weapon}]);
        currentGame.start();
    }

    function startCoop() {
        const p1 = getP1Selection();
        const p2 = getP2Selection();
        showScreen('game-screen');
        document.getElementById('net-status').classList.add('hidden');
        document.getElementById('online-players-list').classList.add('hidden');
        currentGame = new Game('coop', [p1, p2]);
        currentGame.start();
    }

    function startOnline() {
        document.getElementById('online-dialog').classList.remove('hidden');
        document.getElementById('p2-selection').classList.add('hidden');
    }

    function cancelOnline() {
        document.getElementById('online-dialog').classList.add('hidden');
        document.getElementById('room-status').classList.add('hidden');
        document.getElementById('start-online-btn').classList.add('hidden');
        document.getElementById('room-code-display').classList.add('hidden');
        if (netManager) { netManager.close(); netManager = null; }
    }

    function createRoom() {
        const p1 = getP1Selection();
        netManager = new NetworkManager();
        const statusEl = document.getElementById('room-status');
        const statusText = document.getElementById('room-status-text');
        const codeDisplay = document.getElementById('room-code-display');
        const codeValue = document.getElementById('room-code-value');
        const startBtn = document.getElementById('start-online-btn');
        statusEl.classList.remove('hidden');
        statusText.textContent = 'Conectando al servidor...';

        // Set onMessage BEFORE connecting so we don't miss 'welcome'
        netManager.onMessage = (msg) => {
            switch (msg.type) {
                case 'welcome':
                    netManager.myId = msg.id;
                    // Now create room after we have our ID
                    netManager.createRoom(p1.color, p1.weapon);
                    break;
                case 'room_created':
                    netManager.roomCode = msg.code;
                    netManager.players = msg.players || [];
                    statusText.textContent = 'Esperando jugadores... (1/' + MAX_ROOM_PLAYERS + ')';
                    codeDisplay.classList.remove('hidden');
                    codeValue.textContent = msg.code;
                    updateRoomLobbyList(netManager.players);
                    break;
                case 'player_list':
                    netManager.players = msg.players || [];
                    statusText.textContent = 'Jugadores: ' + netManager.players.length + '/' + MAX_ROOM_PLAYERS;
                    if (netManager.players.length >= 2) startBtn.classList.remove('hidden');
                    updateRoomLobbyList(netManager.players);
                    break;
                case 'game_start':
                case 'game_restart': {
                    const plist = msg.players || netManager.players;
                    const mySlot = plist.findIndex(p => p.id === netManager.myId);
                    const playersInfo = plist.map(p => ({ color: p.color, weapon: p.weapon }));
                    showScreen('game-screen');
                    document.getElementById('online-dialog').classList.add('hidden');
                    document.getElementById('net-status').classList.remove('hidden');
                    updateOnlinePlayerList(plist);
                    currentGame = new Game('online_host', playersInfo, netManager, mySlot >= 0 ? mySlot : 0);
                    currentGame.start();
                    break;
                }
                case 'player_left':
                    netManager.players = msg.players || [];
                    updateOnlinePlayerList(netManager.players);
                    updateRoomLobbyList(netManager.players);
                    break;
                case 'error':
                    statusText.textContent = '❌ ' + msg.msg;
                    break;
            }
        };

        netManager.connect((ok) => {
            if (!ok) {
                statusText.textContent = '❌ No se pudo conectar al servidor';
                return;
            }
            // welcome message will arrive via onMessage and trigger createRoom
        });
    }

    function joinRoom() {
        const code = document.getElementById('room-code-input').value.trim().toUpperCase();
        if (code.length !== 4) return;
        const p1 = getP1Selection();
        netManager = new NetworkManager();
        const statusEl = document.getElementById('room-status');
        const statusText = document.getElementById('room-status-text');
        statusEl.classList.remove('hidden');
        statusText.textContent = 'Conectando...';

        // Set onMessage BEFORE connecting so we don't miss 'welcome'
        netManager.onMessage = (msg) => {
            switch (msg.type) {
                case 'welcome':
                    netManager.myId = msg.id;
                    netManager.joinRoom(code, p1.color, p1.weapon);
                    break;
                case 'player_list':
                    netManager.players = msg.players || [];
                    statusText.textContent = 'En sala. Jugadores: ' + netManager.players.length + '/' + MAX_ROOM_PLAYERS + '. Esperando inicio...';
                    updateRoomLobbyList(netManager.players);
                    break;
                case 'game_start':
                case 'game_restart': {
                    const plist = msg.players || netManager.players;
                    const mySlot = plist.findIndex(p => p.id === netManager.myId);
                    const playersInfo = plist.map(p => ({ color: p.color, weapon: p.weapon }));
                    showScreen('game-screen');
                    document.getElementById('online-dialog').classList.add('hidden');
                    document.getElementById('net-status').classList.remove('hidden');
                    updateOnlinePlayerList(plist);
                    currentGame = new Game('online_guest', playersInfo, netManager, mySlot >= 0 ? mySlot : 1);
                    currentGame.start();
                    break;
                }
                case 'player_left':
                    netManager.players = msg.players || [];
                    updateOnlinePlayerList(netManager.players);
                    break;
                case 'error':
                    statusText.textContent = '❌ ' + msg.msg;
                    break;
            }
        };

        netManager.connect((ok) => {
            if (!ok) {
                statusText.textContent = '❌ No se pudo conectar';
                return;
            }
            // welcome message will arrive via onMessage and trigger joinRoom
        });
    }

    function updateOnlinePlayerList(players) {
        const el = document.getElementById('online-players-list');
        if (!el) return;
        if (!players || players.length === 0) { el.classList.add('hidden'); return; }
        el.classList.remove('hidden');
        let html = '<h3>👥 Jugadores</h3>';
        players.forEach((p, i) => {
            const label = PLAYER_COLORS_LABELS[p.color] || p.color;
            const isHost = i === 0 ? ' ⭐' : '';
            html += `<div class="online-player-item"><span class="player-dot" style="background:${p.color}"></span>P${i+1} - ${label}${isHost}</div>`;
        });
        el.innerHTML = html;
    }

    function updateRoomLobbyList(players) {
        const el = document.getElementById('room-lobby-list');
        if (!el) return;
        if (!players || players.length === 0) { el.innerHTML = ''; return; }
        let html = '';
        players.forEach((p, i) => {
            const label = PLAYER_COLORS_LABELS[p.color] || p.color;
            const tag = i === 0 ? ' (Host)' : '';
            html += `<div class="lobby-player"><span class="player-dot" style="background:${p.color}"></span>${label}${tag}</div>`;
        });
        el.innerHTML = html;
    }

    function startTraining() {
        showScreen('training-screen');
        if (trainingMode) trainingMode.stop();
        trainingMode = new TrainingMode();
        trainingMode.start();
    }

    function backFromTraining() {
        if (trainingMode) trainingMode.stop();
        trainingMode = null;
        sharedQL.save();
        sharedQL.syncToServer();
        showScreen('menu-screen');
    }

    // ---- LEADERBOARD / API ----
    async function loadLeaderboard() {
        try {
            const r = await fetch(API_BASE + '/leaderboard');
            if (!r.ok) return;
            const data = await r.json();
            const tbody = document.getElementById('leaderboard-body');
            tbody.innerHTML = '';
            data.forEach((e, i) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td>${i + 1}</td><td>${e.name}</td><td>${e.score}</td><td>${e.wave}</td><td>${e.kills}</td>`;
                tbody.appendChild(tr);
            });
            document.getElementById('leaderboard-container').classList.remove('hidden');
        } catch (e) {}
    }

    async function loadStats() {
        try {
            const r = await fetch(API_BASE + '/stats');
            if (!r.ok) return;
            const d = await r.json();
            document.getElementById('stat-total-games').textContent = d.totalGames || 0;
            document.getElementById('stat-total-kills').textContent = d.totalKills || 0;
            document.getElementById('stat-max-score').textContent = d.maxScore || 0;
            document.getElementById('server-stats').classList.remove('hidden');
        } catch (e) {}
    }

    async function submitScore() {
        const name = document.getElementById('player-name').value.trim();
        if (!name || !currentGame) return;
        try {
            await fetch(API_BASE + '/leaderboard', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    score: currentGame._finalScore || 0,
                    wave: currentGame._finalWave || 0,
                    kills: currentGame._finalKills || 0
                })
            });
            document.getElementById('submit-score-btn').disabled = true;
            document.getElementById('submit-score-btn').textContent = '✓ GUARDADO';
            loadLeaderboard();
            loadStats();
        } catch (e) {}
    }

    // ===================== EVENT BINDINGS =====================
    function init() {
        // wait for assets
        if (!allLoaded()) { setTimeout(init, 100); return; }

        // char selection (P1)
        document.querySelectorAll('.char-option:not(.p2-char)').forEach(el => {
            el.addEventListener('click', () => {
                document.querySelectorAll('.char-option:not(.p2-char)').forEach(e => e.classList.remove('selected'));
                el.classList.add('selected');
            });
        });
        // weapon selection (P1)
        document.querySelectorAll('.weapon-option:not(.p2-weap)').forEach(el => {
            el.addEventListener('click', () => {
                document.querySelectorAll('.weapon-option:not(.p2-weap)').forEach(e => e.classList.remove('selected'));
                el.classList.add('selected');
            });
        });
        // P2 char
        document.querySelectorAll('.p2-char').forEach(el => {
            el.addEventListener('click', () => {
                document.querySelectorAll('.p2-char').forEach(e => e.classList.remove('selected'));
                el.classList.add('selected');
            });
        });
        // P2 weapon
        document.querySelectorAll('.p2-weap').forEach(el => {
            el.addEventListener('click', () => {
                document.querySelectorAll('.p2-weap').forEach(e => e.classList.remove('selected'));
                el.classList.add('selected');
            });
        });

        // mode buttons
        document.getElementById('start-btn').addEventListener('click', startSolo);
        document.getElementById('coop-btn').addEventListener('click', () => {
            const p2sel = document.getElementById('p2-selection');
            p2sel.classList.toggle('hidden');
            if (!p2sel.classList.contains('hidden')) {
                // on second click, start coop
                document.getElementById('coop-btn').textContent = 'INICIAR CO-OP';
                document.getElementById('coop-btn').onclick = startCoop;
            }
        });
        document.getElementById('online-btn').addEventListener('click', startOnline);
        document.getElementById('training-btn').addEventListener('click', startTraining);

        // online buttons
        document.getElementById('create-room-btn').addEventListener('click', createRoom);
        document.getElementById('join-room-btn').addEventListener('click', joinRoom);
        document.getElementById('start-online-btn').addEventListener('click', () => {
            if (netManager) netManager.startGame();
        });
        document.getElementById('cancel-online-btn').addEventListener('click', cancelOnline);

        // training buttons
        document.querySelectorAll('.speed-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if (trainingMode) trainingMode.speed = parseInt(btn.dataset.speed);
            });
        });
        document.getElementById('train-reset-btn').addEventListener('click', () => {
            sharedQL.reset();
            if (trainingMode) {
                trainingMode.episode = 0;
                trainingMode.totalReward = 0;
                trainingMode.round = 0;
                trainingMode.startRound();
            }
        });
        document.getElementById('train-back-btn').addEventListener('click', backFromTraining);

        // game over buttons
        document.getElementById('restart-btn').addEventListener('click', () => {
            document.getElementById('submit-score-btn').disabled = false;
            document.getElementById('submit-score-btn').textContent = 'GUARDAR PUNTUACIÓN';
            document.getElementById('leaderboard-container').classList.add('hidden');
            document.getElementById('server-stats').classList.add('hidden');
            // If we have an active network connection, vote for restart
            if (netManager && netManager.connected) {
                netManager.readyRestart();
                const restartBtn = document.getElementById('restart-btn');
                restartBtn.textContent = 'ESPERANDO OTROS...';
                restartBtn.disabled = true;
                // The game_restart message from the server (handled in onNetMessage / createRoom / joinRoom handlers) will start the new game
            } else {
                startSolo();
            }
        });
        document.getElementById('menu-btn').addEventListener('click', () => {
            document.getElementById('submit-score-btn').disabled = false;
            document.getElementById('submit-score-btn').textContent = 'GUARDAR PUNTUACIÓN';
            document.getElementById('leaderboard-container').classList.add('hidden');
            document.getElementById('server-stats').classList.add('hidden');
            // Disconnect from online if connected
            if (netManager) { netManager.close(); netManager = null; }
            document.getElementById('online-players-list').classList.add('hidden');
            showScreen('menu-screen');
        });
        document.getElementById('submit-score-btn').addEventListener('click', submitScore);
    }

    // kick off
    init();
})();
