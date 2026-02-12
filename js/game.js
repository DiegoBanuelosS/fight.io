/* =========================================================
   FIGHT.IO — Complete Game Engine
   Solo | Co-op Local | Co-op Online | AI Training
   ========================================================= */
(function () {
    'use strict';

    // ===================== CONSTANTS =====================
    const TILE = 128, HALF = 64;
    const PLAYER_SPEED = 0.8, ENEMY_BASE_SPEED = 0.65;
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
        weapon_sword:       { dmg: 15, range: 50, speed: 1.0, label: 'Espada', abilityCd: 2000, abilityDur: 1500, abilityColor: '#fff0b0', abilityDesc: 'Buff de daño breve' },
        weapon_axe:         { dmg: 20, range: 45, speed: 0.8, label: 'Hacha', abilityCd: 3000, abilityDur: 700, abilityColor: '#ffbb88', abilityDesc: 'Cleave frontal' },
        weapon_hammer:      { dmg: 28, range: 55, speed: 0.6, label: 'Martillo', abilityCd: 4500, abilityDur: 900, abilityColor: '#ffd1a8', abilityDesc: 'Stun AoE' },
        weapon_longsword:   { dmg: 18, range: 65, speed: 0.85, label: 'Mandoble', abilityCd: 2500, abilityDur: 700, abilityColor: '#e0f0ff', abilityDesc: 'Giro empujador' },
        weapon_spear:       { dmg: 14, range: 75, speed: 0.9, label: 'Lanza', abilityCd: 2800, abilityDur: 600, abilityColor: '#fff0dd', abilityDesc: 'Carga y perfora' },
        weapon_dagger:      { dmg: 10, range: 35, speed: 1.4, label: 'Daga', abilityCd: 2000, abilityDur: 500, abilityColor: '#ff9999', abilityDesc: 'Teletransporte crítico' },
        weapon_axe_double:  { dmg: 24, range: 50, speed: 0.7, label: 'Hacha Doble', abilityCd: 3500, abilityDur: 700, abilityColor: '#ffd6ff', abilityDesc: 'Torbellino cercano' },
        weapon_staff:       { dmg: 12, range: 60, speed: 1.1, label: 'Bastón', abilityCd: 5000, abilityDur: 1000, abilityColor: '#a8efff', abilityDesc: 'Curación área' }
    };
    const DEFAULT_ABILITY_CD = 3000; // ms
    const POWERUP_TYPES = [
        { key: 'heal',   color: '#4f4',  icon: '❤️', dur: 0,    label: '+50 HP' },
        { key: 'speed',  color: '#4ff',  icon: '⚡', dur: 8000, label: 'Velocidad' },
        { key: 'power',  color: '#f44',  icon: '🔥', dur: 8000, label: 'Poder' },
        { key: 'shield', color: '#44f',  icon: '🛡️', dur: 8000, label: 'Escudo' }
    ];
    const API_BASE = `http://${window.location.hostname || 'localhost'}:8080/api`;
    const WS_URL = `ws://${window.location.hostname || 'localhost'}:8081`;
    // FX constants are provided by js/lib/fx_constants.js and particle classes
    // (window.MAX_PARTICLES, window.MAX_TEXTS, window.PARTICLES_PER_HIT)
    const MAX_PARTICLES = window.MAX_PARTICLES || 200;
    const MAX_TEXTS = window.MAX_TEXTS || 40;
    const PARTICLES_PER_HIT = window.PARTICLES_PER_HIT || 12;

    // DEBUG
    window.DEBUG_MODE = false;
    window.toggleDebug = () => {
        window.DEBUG_MODE = !window.DEBUG_MODE;
        console.log(`[DEBUG] Mode: ${window.DEBUG_MODE ? 'ON' : 'OFF'}`);
    };
    console.log("Tip: Type window.toggleDebug() in console to view AI debug info.");

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
    loadImg('tilesheet', 'Tilesheet/tilesheet@2.png');
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
        // HP advantage vs target, wall flags (4 bits), hazard flag
        // Total states: 3 × 3 × 2 × 3 × 16 × 3 = 2592 possible states
        stateKey(fighter, target, structures, hazards, arenaW, arenaH) {
            const d = dist(fighter, target);
            const dBucket = d < 80 ? 0 : d < 200 ? 1 : 2;  // close, mid, far
            const hpRatio = fighter.hp / fighter.maxHp;
            const hpBucket = hpRatio > 0.6 ? 0 : hpRatio > 0.3 ? 1 : 2; // healthy, hurt, critical
            const atk = fighter.attackReady ? 1 : 0;

            // HP advantage: compare fighter's HP% to target's HP%
            const targetRatio = target.hp / target.maxHp;
            const advDiff = hpRatio - targetRatio;
            const advBucket = advDiff > 0.2 ? 0 : advDiff > -0.2 ? 1 : 2; // winning, even, losing

            // Wall/Obstacle Sensing (4 directions)
            // Bitmask: 1=Left, 2=Right, 4=Up, 8=Down
            let walls = 0;
            const range = 80;

            // Arena Borders
            if (fighter.x - range < 0) walls |= 1;
            if (arenaW && fighter.x + range > arenaW) walls |= 2;
            if (fighter.y - range < 0) walls |= 4;
            if (arenaH && fighter.y + range > arenaH) walls |= 8;

            // Structures
            if (structures) {
                const checks = [
                    {x: -range, y: 0, bit: 1}, // Left
                    {x: range, y: 0, bit: 2},  // Right
                    {x: 0, y: -range, bit: 4}, // Up
                    {x: 0, y: range, bit: 8}   // Down
                ];
                for (const c of checks) {
                    if (walls & c.bit) continue;
                    const px = fighter.x + c.x;
                    const py = fighter.y + c.y;
                    for (const s of structures) {
                        if (s.collides(px, py, fighter.radius)) {
                            walls |= c.bit;
                            break;
                        }
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

            return `${dBucket}_${hpBucket}_${atk}_${advBucket}_${walls}_${hazardState}`;
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
        maxStates() { return 2592; } // 3×3×2×3×16×3

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

    // Particle and FloatingText classes are provided by js/lib/particle.js
    // as global `Particle` and `FloatingText` for backward compatibility.

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
            
            // --- DEBUG MAP COLLISION ---
            if (window.DEBUG_MODE) {
                ctx.strokeStyle = '#f0f'; ctx.lineWidth = 2; // Magenta box for physics bounds
                ctx.strokeRect(sx, sy, this.w, this.h);
                
                // Cross pattern if it's a solid block
                ctx.beginPath();
                ctx.moveTo(sx, sy); ctx.lineTo(sx + this.w, sy + this.h);
                ctx.moveTo(sx + this.w, sy); ctx.lineTo(sx, sy + this.h);
                ctx.strokeStyle = 'rgba(255, 0, 255, 0.3)';
                ctx.stroke();

                // Coords text
                ctx.fillStyle = '#fff'; ctx.font = '10px monospace';
                ctx.fillText(`[${this.x},${this.y}]`, sx, sy - 5);
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
            function hexToRgba(hex, a) {
                try {
                    if (hex[0] === '#') hex = hex.slice(1);
                    const bigint = parseInt(hex, 16);
                    const r = (bigint >> 16) & 255;
                    const g = (bigint >> 8) & 255;
                    const b = bigint & 255;
                    return `rgba(${r},${g},${b},${a})`;
                } catch (e) { return `rgba(255,255,255,${a})`; }
            }
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
            // sistema combate PRO
            this.staggerTimer = 0;
            this.staggerForceX = 0;
            this.combo = 0;
            this.comboTimer = 0;
            this.lastHitTime = 0;
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
            this.stunTimer = 0;
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
            // ability cooldown tracking (ms)
            this.abilityCdTimer = 0; // remaining ms
            this.abilityCooldown = (WEAPON_DATA[this.weapon] && WEAPON_DATA[this.weapon].abilityCd) || DEFAULT_ABILITY_CD;
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
            // allow slow effects from weapons
            if (this._effects && this._effects.slow && Date.now() < this._effects.slow.until) {
                s *= this._effects.slow.mult;
            }
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
        // custom short-lived effects registry (bleed, slow, etc.)
        _applyEffects(dt) {
            if (!this._effects) return;
            const now = Date.now();
            // bleed damage (hp per frame scaled similar to hazards)
            if (this._effects.bleed && this._effects.bleed.until > now) {
                const dps = this._effects.bleed.dps || 0.5; // per "tick" base
                this.hp -= dps * (dt / 16);
                if (this.hp <= 0) { this.hp = 0; this.alive = false; }
            } else if (this._effects.bleed) {
                delete this._effects.bleed;
            }
            // slow expires handled by actualSpeed getter using _effects.slow.until
            if (this._effects.slow && this._effects.slow.until <= now) delete this._effects.slow;
        }
        // ability cooldown tick
        _tickAbility(dt) {
            if (this.abilityCdTimer > 0) {
                this.abilityCdTimer = Math.max(0, this.abilityCdTimer - dt);
            }
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
                
            // STAGGER PRO (micro reacción al golpe)
            if (Math.random() < 0.35) {   // probabilidad
                this.staggerTimer = 8;   // duración corta

                // empuje leve dependiendo dirección
                const push = 0.5;
                this.staggerForceX = from.x < this.x ? push : -push;
            }


            }
            if (this.hp <= 0) { this.hp = 0; this.alive = false; }
        }
        update(dt, structures) {
            this.updateBuffs();
            // apply custom weapon effects (bleed/slow)
            this._applyEffects(dt);
            // tick ability cooldown
            this._tickAbility(dt);
            // stun check
            if (this.stunTimer > 0) {
                this.stunTimer -= dt;
                return; // NO se mueve mientras está stun
            }

            if (this.attackTimer > 0) {
                this.attackTimer -= dt;
                if (this.attackTimer <= 0) { this.attacking = false; this.attackReady = true; }
            }
            if (this.dashCdTimer > 0) this.dashCdTimer -= dt;
            if (this.dashing) {
                this.dashTimer -= dt;
                if (this.dashTimer <= 0) this.dashing = false;
            }
            // knockback eliminado
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
            // ability aura if active (pulsing + rim + lighter blend)
            try {
                if (this._abilityActive && Date.now() < this._abilityActive.until) {
                    const col = this._abilityActive.color || '#fff0b0';
                    const t = performance.now() / 250;
                    const pulse = 0.6 + 0.35 * Math.sin(t);
                    // soft radial glow
                    ctx.save();
                    ctx.globalCompositeOperation = 'lighter';
                    const g = ctx.createRadialGradient(sx, sy, this.radius * 0.2, sx, sy, this.radius + 48);
                    g.addColorStop(0, hexToRgba(col, 0.45 * pulse));
                    g.addColorStop(0.5, hexToRgba(col, 0.18 * pulse));
                    g.addColorStop(1, 'rgba(0,0,0,0)');
                    ctx.fillStyle = g;
                    ctx.beginPath(); ctx.arc(sx, sy, this.radius + 48, 0, Math.PI * 2); ctx.fill();
                    // bright rim
                    ctx.lineWidth = 6; ctx.strokeStyle = hexToRgba(col, 0.9 * pulse);
                    ctx.beginPath(); ctx.arc(sx, sy, this.radius + 18, 0, Math.PI * 2); ctx.stroke();
                    // rotating arc
                    const start = (t % (Math.PI * 2));
                    ctx.lineWidth = 3; ctx.strokeStyle = hexToRgba('#ffffff', 0.08 * pulse);
                    ctx.beginPath(); ctx.arc(sx, sy, this.radius + 26, start, start + Math.PI * 0.9); ctx.stroke();
                    ctx.restore();
                }
            } catch (e) {}
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
            // Calc swing for debug use outside
            const swing = this.attacking ? Math.sin(this.attackTimer / 50) * 0.8 : 0;
            
            if (wImg) {
                ctx.save(); ctx.translate(sx, sy); ctx.rotate(this.angle);
                const wOff = this.radius + 10;
                ctx.rotate(swing);
                ctx.drawImage(wImg, wOff - 12, -12, 24, 24);

                // --- DEBUG WEAPON HITBOX ---
                if (window.DEBUG_MODE) {
                    // Approximate weapon physical box
                    ctx.strokeStyle = '#f00'; ctx.lineWidth = 1; 
                    ctx.strokeRect(wOff - 12, -12, 24, 24);
                }
                ctx.restore();
            }

            // --- DEBUG WEAPON ARC & DAMAGE ---
            if (window.DEBUG_MODE) {
                ctx.save(); ctx.translate(sx, sy); ctx.rotate(this.angle);
                
                // Attack Cone Area
                ctx.beginPath();
                ctx.moveTo(0,0);
                // 60 degree cone
                ctx.arc(0, 0, this.atkRange * 1.1, -Math.PI/6 + swing, Math.PI/6 + swing);
                ctx.closePath();
                ctx.fillStyle = this.attacking ? 'rgba(255, 0, 0, 0.2)' : 'rgba(255, 255, 0, 0.1)';
                ctx.fill();
                ctx.strokeStyle = this.attacking ? '#f00' : '#ff0';
                ctx.stroke();

                // Weapon Info Text
                ctx.rotate(-this.angle); // Un-rotate for text
                if (this.isPlayer) {
                    ctx.fillStyle = '#fff'; ctx.font = '10px monospace';
                    ctx.fillText(`DMG: ${Math.floor(this.dmg)}`, 0, this.radius + 15);
                    ctx.fillText(`RNG: ${this.atkRange}`, 0, this.radius + 25);
                }
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
            
            // --- DEBUG OVERLAY ---
            if (window.DEBUG_MODE) {
                ctx.save();
                
                // 1. Collision Indicator (Thick Cyan Box if collided)
                if (this._collided) {
                    ctx.strokeStyle = '#0ff'; ctx.lineWidth = 3;
                    ctx.beginPath(); ctx.arc(sx, sy, this.radius + 4, 0, Math.PI*2); ctx.stroke();
                }

                // 2. Exact Hitbox (Magenta)
                ctx.strokeStyle = '#f0f'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(sx, sy, this.radius, 0, Math.PI*2); ctx.stroke();
                
                // 3. Attack Range (Yellow Dashed)
                ctx.strokeStyle = '#ff0'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
                ctx.beginPath(); ctx.arc(sx, sy, this.atkRange || 0, 0, Math.PI*2); ctx.stroke();
                ctx.setLineDash([]); // Reset

                // 4. Movement Arrow (Bright Green + Head)
                const vMag = Math.hypot(this.vx, this.vy);
                if (vMag > 0.01) {
                    const arrowLen = 40;
                    const ex = sx + this.vx * arrowLen;
                    const ey = sy + this.vy * arrowLen;
                    const ang = Math.atan2(this.vy, this.vx);
                    
                    ctx.strokeStyle = '#0f0'; ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(sx, sy);
                    ctx.lineTo(ex, ey);
                    // Arrowhead
                    ctx.lineTo(ex - 8 * Math.cos(ang - Math.PI/6), ey - 8 * Math.sin(ang - Math.PI/6));
                    ctx.moveTo(ex, ey);
                    ctx.lineTo(ex - 8 * Math.cos(ang + Math.PI/6), ey - 8 * Math.sin(ang + Math.PI/6));
                    ctx.stroke();
                }

                // 5. Data Text Layer
                // Outline
                ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
                ctx.fillStyle = '#fff'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
                
                const lines = [
                    `HP: ${Math.ceil(this.hp)}/${this.maxHp}`,
                    `Pos: ${Math.round(this.x)},${Math.round(this.y)}`
                ];
                
                if (this.isPlayer) {
                    if (this._collided) lines.push('COLLIDING');
                } else { // AI specific
                     // Action Text Color
                     let actColor = '#fff';
                     if (this._currentAction === 'attack') actColor = '#f44';
                     else if (this._currentAction === 'chase') actColor = '#4f4';
                     else if (this._currentAction === 'retreat') actColor = '#ff4';
                     
                     lines.push(`ACT: ${this._currentAction || 'IDLE'}`);
                     lines.push(`Tmr: ${this._actionTimer || 0}`);
                     if (this.stuckFrames > 0) lines.push(`STUCK: ${this.stuckFrames}`);
                }

                let ty = sy - this.radius - 10 - (lines.length * 12);
                lines.forEach((l, i) => {
                     // Draw stroke then fill for visibility
                     ctx.strokeText(l, sx, ty + i*14);
                     if (l.startsWith('ACT:')) ctx.fillStyle = '#ff8'; // Highlight action
                     else ctx.fillStyle = '#fff';
                     ctx.fillText(l, sx, ty + i*14);
                });

                ctx.restore();
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

            // settings
            this.settings = {
                autoAttack: localStorage.getItem('fightio_autoAttack') !== 'false', // default true
                mute: localStorage.getItem('fightio_mute') === 'true', // default false
                volume: parseInt(localStorage.getItem('fightio_volume') || '50')
            };

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
            // controls mapping (can be remapped by player)
            this.controls = this._loadControls();
            this._onKey = (e) => {
                const k = (e.key || '').toLowerCase();
                const down = e.type === 'keydown';
                this.keys[k] = down;
                if (!down) return; // only trigger actions on keydown
                // Player 1 ability / pickup
                if (this.p1 && this.p1.alive && this.controls && this.controls.p1) {
                    if (k === (this.controls.p1.ability || 'q')) {
                        if (this.p1.abilityCdTimer <= 0) {
                            if (window.Weapons && window.Weapons.onAbility) window.Weapons.onAbility(this.p1.weapon, this.p1, this);
                            const wc = WEAPON_DATA[this.p1.weapon] || {};
                            const dur = wc.abilityDur || 800;
                            const color = wc.abilityColor || '#fff0b0';
                            const desc = wc.abilityDesc || '';
                            this.p1._abilityActive = { until: Date.now() + dur, color, desc };
                            this.p1.abilityCdTimer = this.p1.abilityCooldown || (wc.abilityCd || DEFAULT_ABILITY_CD);
                            this.texts.push(new FloatingText(this.p1.x, this.p1.y - 34, 'HABILIDAD', color));
                        } else {
                            this.texts.push(new FloatingText(this.p1.x, this.p1.y - 34, 'EN CD', '#ff7777'));
                        }
                    }
                    if (k === (this.controls.p1.pickup || 'e')) this.tryPickup(this.p1);
                }
                // Player 2 ability / pickup
                if (this.p2 && this.p2.alive && this.controls && this.controls.p2) {
                    if (k === (this.controls.p2.ability || '/')) {
                        if (this.p2.abilityCdTimer <= 0) {
                            if (window.Weapons && window.Weapons.onAbility) window.Weapons.onAbility(this.p2.weapon, this.p2, this);
                            const wc2 = WEAPON_DATA[this.p2.weapon] || {};
                            const dur2 = wc2.abilityDur || 800;
                            const color2 = wc2.abilityColor || '#fff0b0';
                            const desc2 = wc2.abilityDesc || '';
                            this.p2._abilityActive = { until: Date.now() + dur2, color: color2, desc: desc2 };
                            this.p2.abilityCdTimer = this.p2.abilityCooldown || (wc2.abilityCd || DEFAULT_ABILITY_CD);
                            this.texts.push(new FloatingText(this.p2.x, this.p2.y - 34, 'HABILIDAD', color2));
                        } else {
                            this.texts.push(new FloatingText(this.p2.x, this.p2.y - 34, 'EN CD', '#ff7777'));
                        }
                    }
                    if (k === (this.controls.p2.pickup || '/')) this.tryPickup(this.p2);
                }
            };
            this._onMouse = (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; };
            this._onMouseD = (e) => { if (e.button === 0) this.mouse.down = true; };
            this._onMouseU = (e) => { if (e.button === 0) this.mouse.down = false; };
            this._onResize = () => { this.canvas.width = window.innerWidth; this.canvas.height = window.innerHeight; };

            // online state
            this.netSyncTimer = 0;
            this.remoteState = null;

            // pause state
            this.paused = false;
            this.waveTimeout = null;

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
            // create controls UI for remapping
            try { this.renderControlsUI(); } catch (e) { console.warn('controls UI failed', e); }
            try { this.createAbilityUI(); } catch (e) { console.warn('ability UI failed', e); }
            try { this.createAbilityInfoUI(); } catch (e) { console.warn('ability info UI failed', e); }
            
            // Pause Toggle Listener
            this._onPauseToggle = (e) => {
                if (e.key === 'Escape') this.togglePause();
            };
            window.addEventListener('keydown', this._onPauseToggle);

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
            if (this._onPauseToggle) window.removeEventListener('keydown', this._onPauseToggle);
        }

        // Load/save controls mapping to localStorage
        _loadControls() {
            try {
                const saved = localStorage.getItem('fightio_controls');
                if (saved) return JSON.parse(saved);
            } catch (e) {}
            // defaults
            return {
                p1: { up: 'w', down: 's', left: 'a', right: 'd', dash: ' ', ability: 'q', pickup: 'e' },
                p2: { up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright', dash: 'enter', ability: '/', pickup: '/' }
            };
        }
        _saveControls() {
            try { localStorage.setItem('fightio_controls', JSON.stringify(this.controls)); } catch (e) {}
        }

        // Render a small controls panel to remap keys
        renderControlsUI() {
            // remove existing
            let panel = document.getElementById('controls-panel');
            if (panel) panel.parentNode.removeChild(panel);
            panel = document.createElement('div'); panel.id = 'controls-panel';
            panel.style.position = 'fixed'; panel.style.right = '10px'; panel.style.top = '10px';
            panel.style.background = 'rgba(0,0,0,0.35)'; panel.style.color = '#fff'; panel.style.padding = '6px';
            panel.style.borderRadius = '6px'; panel.style.fontFamily = 'sans-serif'; panel.style.fontSize = '12px';
            panel.style.zIndex = 9999; panel.style.minWidth = '120px'; panel.style.maxWidth = '140px';
            const makeBtn = (label, playerKey, action) => {
                const btn = document.createElement('button');
                btn.textContent = label; btn.style.background = '#222'; btn.style.color = '#fff';
                btn.style.border = '1px solid rgba(255,255,255,0.06)'; btn.style.padding = '4px 6px'; btn.style.borderRadius = '4px';
                btn.style.fontSize = '11px'; btn.onclick = () => this._startRemap(playerKey, action, btn);
                return btn;
            };
            const title = document.createElement('div'); title.textContent = 'Teclas (compacto)'; title.style.fontWeight = '700'; title.style.marginBottom = '6px'; title.style.fontSize = '12px';
            panel.appendChild(title);
            const row1 = document.createElement('div'); row1.style.display = 'flex'; row1.style.justifyContent = 'space-between'; row1.style.gap = '6px';
            row1.appendChild(makeBtn('P1 H', 'p1', 'ability'));
            row1.appendChild(makeBtn('P1 E', 'p1', 'pickup'));
            panel.appendChild(row1);
            const row2 = document.createElement('div'); row2.style.display = 'flex'; row2.style.justifyContent = 'space-between'; row2.style.gap = '6px'; row2.style.marginTop = '6px';
            row2.appendChild(makeBtn('P2 H', 'p2', 'ability'));
            row2.appendChild(makeBtn('P2 E', 'p2', 'pickup'));
            panel.appendChild(row2);
            document.body.appendChild(panel);
        }

        // Create ability HUD elements (icons + cooldown overlay)
        createAbilityUI() {
            const hudLeft = document.getElementById('hud-left') || document.getElementById('hud');
            if (!hudLeft) return;
            // remove if exists
            const existing = document.getElementById('ability-panel');
            if (existing) existing.parentNode.removeChild(existing);
            const panel = document.createElement('div'); panel.id = 'ability-panel';
            panel.style.display = 'flex'; panel.style.flexDirection = 'column'; panel.style.gap = '6px';
            panel.style.marginTop = '6px';
            const makeAbilitySlot = (id) => {
                const slot = document.createElement('div'); slot.className = 'ability-slot';
                slot.style.position = 'relative'; slot.style.width = '44px'; slot.style.height = '44px';
                slot.style.border = '1px solid rgba(255,255,255,0.08)'; slot.style.borderRadius = '6px';
                slot.style.background = 'rgba(0,0,0,0.35)';
                const img = document.createElement('img'); img.id = id + '-img'; img.style.width = '100%'; img.style.height = '100%'; img.style.objectFit = 'cover'; img.style.borderRadius = '6px';
                const overlay = document.createElement('div'); overlay.id = id + '-ov';
                overlay.style.position = 'absolute'; overlay.style.left = '0'; overlay.style.top = '0'; overlay.style.width = '100%'; overlay.style.height = '0%'; overlay.style.background = 'rgba(0,0,0,0.6)'; overlay.style.borderRadius = '6px';
                overlay.style.pointerEvents = 'none';
                slot.appendChild(img); slot.appendChild(overlay);
                return slot;
            };
            const p1slot = makeAbilitySlot('ability-p1');
            panel.appendChild(p1slot);
            hudLeft.appendChild(panel);
        }

        // Create side panel showing ability name/description and active state
        createAbilityInfoUI() {
            // single compact slot showing current player's ability info
            const existing = document.getElementById('ability-info');
            if (existing) existing.parentNode.removeChild(existing);
            const container = document.createElement('div'); container.id = 'ability-info';
            container.style.position = 'fixed'; container.style.left = '12px'; container.style.top = '12px';
            container.style.background = 'rgba(0,0,0,0.25)'; container.style.color = '#fff'; container.style.padding = '6px';
            container.style.borderRadius = '6px'; container.style.fontFamily = 'sans-serif'; container.style.fontSize = '12px';
            container.style.zIndex = 9999; container.style.minWidth = '160px';
            const title = document.createElement('div'); title.textContent = 'Habilidad'; title.style.fontWeight = '700'; title.style.marginBottom = '6px'; title.style.fontSize = '12px';
            container.appendChild(title);
            const row = document.createElement('div'); row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '8px';
            const icon = document.createElement('img'); icon.id = 'ability-info-icon'; icon.style.width = '36px'; icon.style.height = '36px'; icon.style.borderRadius = '6px'; icon.style.objectFit = 'cover';
            const info = document.createElement('div'); info.style.flex = '1';
            const name = document.createElement('div'); name.id = 'ability-info-name'; name.textContent = '-'; name.style.fontWeight = '600'; name.style.fontSize = '13px';
            const desc = document.createElement('div'); desc.id = 'ability-info-desc'; desc.textContent = ''; desc.style.fontSize = '11px'; desc.style.opacity = '0.95';
            const dmg = document.createElement('div'); dmg.id = 'ability-info-dmg'; dmg.textContent = ''; dmg.style.fontSize = '11px'; dmg.style.opacity = '0.9';
            info.appendChild(name); info.appendChild(desc); info.appendChild(dmg);
            const dot = document.createElement('div'); dot.id = 'ability-info-dot'; dot.style.width = '12px'; dot.style.height = '12px'; dot.style.borderRadius = '6px'; dot.style.background = 'rgba(255,255,255,0.06)';
            row.appendChild(icon); row.appendChild(info); row.appendChild(dot);
            container.appendChild(row);
            document.body.appendChild(container);
        }

        updateAbilityInfoUI() {
            try {
                const icon = document.getElementById('ability-info-icon');
                const name = document.getElementById('ability-info-name');
                const desc = document.getElementById('ability-info-desc');
                const dmg = document.getElementById('ability-info-dmg');
                const dot = document.getElementById('ability-info-dot');
                if (!icon || !name || !desc || !dmg || !dot) return;
                const p = this.p1 || this.players[0];
                if (!p) return;
                const wc = WEAPON_DATA[p.weapon] || {};
                const src = (IMG[p.weapon] && IMG[p.weapon].src) || '';
                if (icon.src !== src) icon.src = src;
                name.textContent = wc.label || p.weapon || '-';
                desc.textContent = wc.abilityDesc || '';
                const pow = (wc.abilityPower || 0) * p.dmg || 0;
                dmg.textContent = pow > 0 ? `Daño habilidad: ${Math.round(pow)}` : '';
                if (p._abilityActive && Date.now() < p._abilityActive.until) {
                    dot.style.background = p._abilityActive.color || '#fff0b0';
                    dot.style.boxShadow = `0 0 8px ${p._abilityActive.color || '#fff0b0'}`;
                } else {
                    dot.style.background = 'rgba(255,255,255,0.06)'; dot.style.boxShadow = 'none';
                }
            } catch (e) {}
        }

        // Update ability UI each frame
        updateAbilityUI() {
            try {
                // single P1 slot
                const p1img = document.getElementById('ability-p1-img');
                const p1ov = document.getElementById('ability-p1-ov');
                const p = this.p1 || this.players[0];
                if (p && p1img && p1ov) {
                    const src = (IMG[p.weapon] && IMG[p.weapon].src) || '';
                    if (p1img.src !== src) p1img.src = src;
                    const cd = p.abilityCooldown || DEFAULT_ABILITY_CD;
                    const rem = p.abilityCdTimer || 0;
                    const pct = Math.min(1, rem / cd);
                    p1ov.style.height = (pct * 100) + '%';
                }
            } catch (e) { /* fail silently */ }
        }

        _startRemap(playerKey, action, btn) {
            btn.textContent = '...';
            const handler = (e) => {
                const k = (e.key || '').toLowerCase();
                this.controls[playerKey][action] = k;
                this._saveControls();
                btn.textContent = k.toUpperCase();
                window.removeEventListener('keydown', handler);
            };
            window.addEventListener('keydown', handler);
        }

        loop() {
            if (!this.running) return;
            if (this.paused) {
                // Keep asking for frames to resume smoothly, but don't update
                requestAnimationFrame(() => this.loop());
                return;
            }
            const now = performance.now();
            const dt = Math.min(now - this.lastTime, 50);
            
            // FPS Calculation
            if (window.DEBUG_MODE) {
                if (!this._lastFpsTime) { this._lastFpsTime = now; this._frameCount = 0; }
                this._frameCount++;
                if (now - this._lastFpsTime >= 1000) {
                    this._fps = this._frameCount;
                    this._frameCount = 0;
                    this._lastFpsTime = now;
                }
            }

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
                if (this.waveTimeout) clearTimeout(this.waveTimeout);
                annTxt.textContent = isBossWave ? `👑 JEFE — Oleada ${this.wave}!` : `Oleada ${this.wave}!`;
                ann.classList.remove('hidden');
                this.waveTimeout = setTimeout(() => ann.classList.add('hidden'), 2000);
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
            // const orbCount = 3 + Math.min(this.wave, 7); // 3-10 orbs
            // this.rewardOrbs.push(...spawnRewardOrbs(this.arenaW, this.arenaH, orbCount, this.structures));
        }

        // ---- PAUSE & MENU ----
        togglePause() {
            if (this.paused) this.resume();
            else this.pause();
        }
        pause() {
            this.paused = true;
            const pm = document.getElementById('pause-menu');
            if(pm) pm.classList.add('active');
        }
        resume() {
            this.paused = false;
            this.lastTime = performance.now(); // Prevent large dt
            const pm = document.getElementById('pause-menu');
            const sm = document.getElementById('settings-screen');
            if(pm) pm.classList.remove('active');
            if(sm) sm.classList.remove('active');
        }
        openSettings() {
            document.getElementById('pause-menu').classList.remove('active');
            document.getElementById('settings-screen').classList.add('active');
            
            // Sync UI with current settings
            document.getElementById('setting-auto-attack').checked = this.settings.autoAttack;
            document.getElementById('setting-mute').checked = this.settings.mute;
            document.getElementById('setting-volume').value = this.settings.volume;
            document.getElementById('volume-value').textContent = this.settings.volume + '%';
        }
        closeSettings() {
            document.getElementById('settings-screen').classList.remove('active');
            document.getElementById('pause-menu').classList.add('active');
        }
        // Save settings when changed
        updateSetting(key, value) {
            this.settings[key] = value;
            localStorage.setItem('fightio_' + key, value);
            // If we had an audio system, we would update gain nodes here
        }
        quitGame() {
            this.resume(); 
            this.stop();
            showScreen('menu-screen');
            if (this.net) { this.net.close(); }
            // clean up ui specifically
            document.getElementById('pause-menu').classList.remove('active');
            document.getElementById('net-status').classList.add('hidden');
            document.getElementById('online-players-list').classList.add('hidden');
            // re-enable button
            document.getElementById('submit-score-btn').disabled = false;
            currentGame = null;
        }

        // ---- ENEMY AI ----
        updateEnemyAI(e, dt) {
            const target = this.closestPlayer(e);
            if (!target || !target.alive) return;
            
            // --- Stuck Detection & Unstuck Logic (Re-implemented Fix) ---
            if (e.prevX === undefined) { e.prevX = e.x; e.prevY = e.y; e.stuckFrames = 0; }
            const moveDist = Math.hypot(e.x - e.prevX, e.y - e.prevY);
            
            // Detect if intent is movement but result is stationary
            if ((e._currentAction === 'chase' || e._currentAction === 'retreat') && moveDist < 0.2) {
                e.stuckFrames++;
            } else {
                e.stuckFrames = Math.max(0, e.stuckFrames - 2);
            }
            e.prevX = e.x; e.prevY = e.y;

            // If stuck for 0.5s, force a random escape vector
            if (e.stuckFrames > 30) {
                 if (!e._unstuckDir) {
                     const ang = Math.random() * Math.PI * 2;
                     e._unstuckDir = { x: Math.cos(ang), y: Math.sin(ang) };
                 }
                 e.vx = e._unstuckDir.x;
                 e.vy = e._unstuckDir.y;
                 e.angle = Math.atan2(e.vy, e.vx);
                 return; // Override physics engine
            } else {
                 e._unstuckDir = null;
            }

            e._actionTimer = (e._actionTimer || 0) - 1;

            const s = sharedQL.stateKey(e, target, this.structures, null, this.arenaW, this.arenaH);
            
            // --- Logic Selection (Action Intent) ---
            if (e._actionTimer <= 0 || !e._currentAction) {
                let action;
                const qValues = sharedQL.q[s] || {}; // Keep Q-table read even if unused
                
                // FORCE HEURISTIC MOVEMENT ALWAYS (Temporarily Disable Learned Movement for reliability)
                const d = dist(e, target);
                const hpRatio = e.hp / e.maxHp;
                
                if (hpRatio < 0.25) {
                        action = 'retreat';
                } else if (d > e.atkRange * 0.8) {
                        action = 'chase';
                } else if (d < e.atkRange * 0.4) {
                        action = 'retreat';
                } else {
                        // In combat range: Circle or Attack
                        action = Math.random() < 0.6 ? 'attack' : (Math.random() < 0.5 ? 'strafe_left' : 'strafe_right');
                }
                
                e._currentAction = action;
                e._actionTimer = 8 + randInt(0, 5); 
                e.prevState = s; e.prevAction = action;
            }
            
            let action = e._currentAction;
            
            // --- Navigation / Steering (PHYSICS ENGINE) ---
            const a = angle(e, target);
            let goalVx = 0, goalVy = 0;
            
            switch (action) {
                case 'chase': goalVx = Math.cos(a); goalVy = Math.sin(a); break;
                case 'retreat': goalVx = -Math.cos(a); goalVy = -Math.sin(a); break;
                case 'strafe_left': goalVx = Math.cos(a - Math.PI / 2); goalVy = Math.sin(a - Math.PI / 2); break;
                case 'strafe_right': goalVx = Math.cos(a + Math.PI / 2); goalVy = Math.sin(a + Math.PI / 2); break;
                case 'attack': goalVx = Math.cos(a) * 0.1; goalVy = Math.sin(a) * 0.1; break; // Slow down to hit
            }
            
            // Apply Wall Sliding (Tangential Movement)
            let blockedX = false, blockedY = false;
            // Tighter feeler to avoid "air" stuck
            const feeler = e.radius + 2; 
            
            // Check Arena Bounds
            if ((e.x < feeler && goalVx < 0) || (e.x > this.arenaW - feeler && goalVx > 0)) blockedX = true;
            if ((e.y < feeler && goalVy < 0) || (e.y > this.arenaH - feeler && goalVy > 0)) blockedY = true;

            // Check Structures
            if (this.structures) {
                for (const str of this.structures) {
                    // Optimized collision check with simple AABB
                    if (e.x + feeler > str.x && e.x - feeler < str.x + str.w &&
                        e.y + feeler > str.y && e.y - feeler < str.y + str.h) {
                        
                        const dx = (e.x) - (str.x + str.w/2);
                        const dy = (e.y) - (str.y + str.h/2);
                        const w2 = str.w/2 + feeler;
                        const h2 = str.h/2 + feeler;
                        const ox = Math.abs(dx) / w2;
                        const oy = Math.abs(dy) / h2;

                        if (ox > oy) { 
                            if ((dx < 0 && goalVx > 0) || (dx > 0 && goalVx < 0)) blockedX = true;
                        } else { 
                            if ((dy < 0 && goalVy > 0) || (dy > 0 && goalVy < 0)) blockedY = true;
                        }
                    }
                }
            }

            // Apply Blocks (Slide)
            if (blockedX) goalVx = 0;
            if (blockedY) goalVy = 0;

            // Corner Escape: If both stopped, bounce randomly
            if (blockedX && blockedY && (action === 'chase' || action === 'retreat')) {
                 const escAngle = Math.random() * Math.PI * 2;
                 goalVx = Math.cos(escAngle); 
                 goalVy = Math.sin(escAngle);
            }

            // Normalization & Boost
            const m = Math.hypot(goalVx, goalVy);
            if (m > 0.01) {
                // Diagonal slide boost
                if (action === 'chase' && (blockedX || blockedY)) {
                     if (blockedX) goalVy = Math.sin(a) > 0 ? 1 : -1;
                     if (blockedY) goalVx = Math.cos(a) > 0 ? 1 : -1;
                }
                const m2 = Math.hypot(goalVx, goalVy);
                e.vx = (goalVx / m2);
                e.vy = (goalVy / m2);
            } else {
                e.vx = 0; e.vy = 0;
            }
            e.angle = a;
            
            const distToTarget = dist(e, target);
            // Increased attack frequency: 60%
            if (distToTarget < e.atkRange * AUTO_ATK_MULT && Math.random() < 0.6) {
                if (e.attack()) {
                    // weapon onAttack hook
                    if (window.Weapons && window.Weapons.onAttack) window.Weapons.onAttack(e.weapon, e, this);
                    const dmg = e.dmg;
                    // Slightly increase effective hit range to match visual overlap
                    if (distToTarget < e.atkRange * 1.1) {
                        target.takeDamage(dmg, e);
                        // weapon onHit hook
                        if (window.Weapons && window.Weapons.onHit) window.Weapons.onHit(e.weapon, e, target, this, dmg);
                        this.spawnHitFx(target);
                        const reward = 1 + dmg / 10;
                        if (e.prevState) {
                            const s2 = sharedQL.stateKey(e, target, this.structures, null, this.arenaW, this.arenaH);
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
            const map = (this.controls && this.controls.p1) ? this.controls.p1 : { up: 'w', down: 's', left: 'a', right: 'd', dash: ' ', ability: 'q', pickup: 'e' };
            let dx = 0, dy = 0;
            // movement mapping respects solo vs coop: allow arrow keys too in solo
            if (k[map.up] || (this.mode === 'solo' && k['arrowup'])) dy--;
            if (k[map.down] || (this.mode === 'solo' && k['arrowdown'])) dy++;
            if (k[map.left] || (this.mode === 'solo' && k['arrowleft'])) dx--;
            if (k[map.right] || (this.mode === 'solo' && k['arrowright'])) dx++;
            if (dx || dy) { const m = Math.hypot(dx, dy); this.p1.vx = dx / m; this.p1.vy = dy / m; }
            else { this.p1.vx = 0; this.p1.vy = 0; }
            // angle to mouse
            this.p1.angle = Math.atan2(
                this.mouse.y - (this.p1.y - this.cam.y),
                this.mouse.x - (this.p1.x - this.cam.x)
            );
            // auto-attack nearest enemy
            const nearest = this.nearestEnemy(this.p1);
            if (this.settings.autoAttack && nearest && dist(this.p1, nearest) < this.p1.atkRange * AUTO_ATK_MULT) {
                if (this.p1.attack()) {
                    // weapon onAttack hook
                    if (window.Weapons && window.Weapons.onAttack) window.Weapons.onAttack(this.p1.weapon, this.p1, this);
                    if (dist(this.p1, nearest) < this.p1.atkRange) {
                        nearest.takeDamage(this.p1.dmg, this.p1);
                        // weapon onHit hook
                        if (window.Weapons && window.Weapons.onHit) window.Weapons.onHit(this.p1.weapon, this.p1, nearest, this, this.p1.dmg);
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
                        // onAttack hook
                        if (window.Weapons && window.Weapons.onAttack) window.Weapons.onAttack(this.p1.weapon, this.p1, this);
                        ne.takeDamage(this.p1.dmg, this.p1);
                        if (window.Weapons && window.Weapons.onHit) window.Weapons.onHit(this.p1.weapon, this.p1, ne, this, this.p1.dmg);
                        const now = Date.now();

                    if (now - this.lastHitTime < 800) {
                        this.combo++;
                    } else {
                            this.combo = 1;
                    }

this.lastHitTime = now;

ne.takeDamage(this.p1.dmg * comboBonus, this.p1);
// bonus damage por combo
const comboBonus = 1 + (this.combo * 0.08);
ne.takeDamage(this.p1.dmg * comboBonus, this.p1);
if (window.Weapons && window.Weapons.onHit) window.Weapons.onHit(this.p1.weapon, this.p1, ne, this, this.p1.dmg * comboBonus);

// feedback visual
this.texts.push(
   new FloatingText(ne.x, ne.y - 30, "x"+this.combo, "#ff8800")
);


                        this.spawnHitFx(ne);
                        if (!ne.alive) this.onEnemyKill(ne, this.p1);
                    }
                }
            }
            // dash
            if (k[map.dash] || k[' ']) this.p1.dash();
            this.invulnerableUntil = Date.now() + 200;
            if (Date.now() < this.invulnerableUntil) return;
            // pickup (also handled on keydown in _onKey)
            if (k[map.pickup]) this.tryPickup(this.p1);
        }

        handleP2Input() {
            if (!this.p2 || !this.p2.alive) return;
            const k = this.keys;
            const map = (this.controls && this.controls.p2) ? this.controls.p2 : { up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright', dash: 'enter', ability: '/', pickup: '/' };
            let dx = 0, dy = 0;
            if (k[map.up]) dy--;    if (k[map.down]) dy++;
            if (k[map.left]) dx--;  if (k[map.right]) dx++;
            if (dx || dy) { const m = Math.hypot(dx, dy); this.p2.vx = dx / m; this.p2.vy = dy / m; }
            else { this.p2.vx = 0; this.p2.vy = 0; }
            // face nearest enemy
            const ne = this.nearestEnemy(this.p2);
            if (ne) this.p2.angle = angle(this.p2, ne);
            // auto-attack
            if (this.settings.autoAttack && ne && dist(this.p2, ne) < this.p2.atkRange * AUTO_ATK_MULT) {
                if (this.p2.attack()) {
                    // onAttack hook
                    if (window.Weapons && window.Weapons.onAttack) window.Weapons.onAttack(this.p2.weapon, this.p2, this);
                    if (dist(this.p2, ne) < this.p2.atkRange) {
                        ne.takeDamage(this.p2.dmg, this.p2);
                        // onHit
                        if (window.Weapons && window.Weapons.onHit) window.Weapons.onHit(this.p2.weapon, this.p2, ne, this, this.p2.dmg);
                        this.spawnHitFx(ne);
                        if (!ne.alive) this.onEnemyKill(ne, this.p2);
                    }
                }
            }
            // dash
            if (k[map.dash]) this.p2.dash();
            // pickup (also handled on keydown in _onKey)
            if (k[map.pickup]) this.tryPickup(this.p2);
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
            killer.momentum += 0.05;
            killer.momentum = Math.min(killer.momentum, 2);
            killer.kills++;
            const pts = enemy.isBoss ? 500 : 100;
            killer.score += pts;
            this.texts.push(new FloatingText(enemy.x, enemy.y - 20, `+${pts}`, '#ff0'));
            // weapon onKill hook
            if (window.Weapons && window.Weapons.onKill) window.Weapons.onKill(killer.weapon, killer, enemy, this);
            sharedQL.decayEpsilon();
            // negative reward for dying
            if (enemy.prevState) {
                sharedQL.update(enemy.prevState, enemy.prevAction, -2, enemy.prevState);
            }
            // weapon drop: ensure enemy's weapon is dropped so players can pick up
            if (enemy && enemy.weapon) {
                this.drops.push(new WeaponDrop(enemy.x, enemy.y, enemy.weapon));
            }
            this.enemiesAlive--;
        }

        tryPickup(player) {
            // weapon drops
            for (let i = this.drops.length - 1; i >= 0; i--) {
                if (dist(player, this.drops[i]) < PICKUP_RANGE) {
                    player.weapon = this.drops[i].weapon;
                    // update ability cooldown value for new weapon and reset timer
                    player.abilityCooldown = (WEAPON_DATA[player.weapon] && WEAPON_DATA[player.weapon].abilityCd) || DEFAULT_ABILITY_CD;
                    player.abilityCdTimer = 0;
                    player._abilityActive = null;
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

            const color = target.isPlayer ? '#ff2222' : '#ffff00';

                // Spawn particles but respect a global cap to avoid explosion
                const space = Math.max(0, MAX_PARTICLES - this.particles.length);
                const toSpawn = Math.min(PARTICLES_PER_HIT, space);
                for (let i = 0; i < toSpawn; i++) {
                    const p = new Particle(target.x, target.y, color);
                    p.vx *= 2; p.vy *= 2;
                    this.particles.push(p);
                }

            // mini shake
            this.cam.x += rand(-5,5);
            this.cam.y += rand(-5,5);
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
            // aplicar stagger
            if (this.staggerTimer > 0) {
                this.staggerTimer--;   // mucho más rápido


            // empuje ligero
            this.velocity.x += this.staggerForceX;

            // reducir control del jugador (feeling hit)
            this.velocity.x *= 0.85;
        } else {
            this.staggerForceX = 0;
        }

            if (this.mode === 'online_guest') {
                // Guest: send inputs, apply remote state, render + HUD
                this.sendGuestInput();
                this.applyRemoteState();
                this.particles.forEach(p => p.update());
                // compact particles in-place to avoid allocations
                let pj = 0;
                for (let pi = 0; pi < this.particles.length; pi++) {
                    const pp = this.particles[pi];
                    if (pp.life > 0) this.particles[pj++] = pp;
                }
                this.particles.length = pj;
                if (this.particles.length > MAX_PARTICLES) this.particles.length = MAX_PARTICLES;
                this.texts.forEach(t => t.update());
                // compact texts in-place and cap
                let tj = 0;
                for (let ti = 0; ti < this.texts.length; ti++) {
                    const tt = this.texts[ti];
                    if (tt.life > 0) this.texts[tj++] = tt;
                }
                this.texts.length = tj;
                if (this.texts.length > MAX_TEXTS) this.texts.splice(0, this.texts.length - MAX_TEXTS);

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
                                // weapon onAttack
                                if (window.Weapons && window.Weapons.onAttack) window.Weapons.onAttack(rp.weapon, rp, this);
                                if (dist(rp, ne) < rp.atkRange) {
                                    ne.takeDamage(rp.dmg, rp);
                                    // weapon onHit
                                    if (window.Weapons && window.Weapons.onHit) window.Weapons.onHit(rp.weapon, rp, ne, this, rp.dmg);
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

            // =====================
            // MODO COMBATE PRO (momentum speed)
            // =====================

            p.momentum = p.momentum || 1;

            if (p.attacking) {
                p.momentum = Math.min(2, p.momentum + 0.15);
            } else {
            p.momentum = Math.max(1, p.momentum - 0.05);
            }

            p.speed = PLAYER_SPEED * p.momentum;

            // =====================

            p.update(dt, this.structures);

            p.x = clamp(p.x, p.radius, this.arenaW - p.radius);
            p.y = clamp(p.y, p.radius, this.arenaH - p.radius);
}


            // enemies
            for (const e of this.enemies) {
                if (!e.alive) continue;
                this.updateEnemyAI(e, dt);
                const player = this.players.find(p => p.alive);

            if (player) {

                const distToPlayer = dist(e, player);

            if (distToPlayer < 120) {

                if (!e._rage) {
                    e._rage = true;
                    e.radius *= 1.1; // efecto visual simple
                }

            } else {

                if (e._rage) {
                        e._rage = false;
                        e.radius /= 1.1;
                    }
            }
        }


    e.update(dt, this.structures);

                e.update(dt, this.structures);
                // arena edge — just clamp, flag collision
                const preX = e.x, preY = e.y;
                e.x = clamp(e.x, e.radius, this.arenaW - e.radius);
                e.y = clamp(e.y, e.radius, this.arenaH - e.radius);
                if (e.x !== preX || e.y !== preY) e._collided = true;
                // small penalty only on FIRST collision frame (not every tick)
                if (e._collided && !e._wasColliding && e.prevState) {
                    const s2 = sharedQL.stateKey(e, this.closestPlayer(e), this.structures, null, this.arenaW, this.arenaH);
                    sharedQL.update(e.prevState, e.prevAction, -1.0, s2);
                }
                e._wasColliding = e._collided;
                
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
            // compact particles in-place
            let pj2 = 0;
            for (let pi2 = 0; pi2 < this.particles.length; pi2++) {
                const pp2 = this.particles[pi2];
                if (pp2.life > 0) this.particles[pj2++] = pp2;
            }
            this.particles.length = pj2;
            if (this.particles.length > MAX_PARTICLES) this.particles.length = MAX_PARTICLES;
            this.texts.forEach(t => t.update());
            // compact texts in-place and cap
            let tj2 = 0;
            for (let ti2 = 0; ti2 < this.texts.length; ti2++) {
                const tt2 = this.texts[ti2];
                if (tt2.life > 0) this.texts[tj2++] = tt2;
            }
            this.texts.length = tj2;
            if (this.texts.length > MAX_TEXTS) this.texts.splice(0, this.texts.length - MAX_TEXTS);

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

            // --- GLOBAL DEBUG HUD (Coordinates & FPS) ---
            if (window.DEBUG_MODE) {
                ctx.save();
                // Semi-transparent background box at Top-Left
                ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                ctx.fillRect(10, 10, 220, 60);
                
                // Black Text for visibility
                ctx.fillStyle = '#000'; 
                ctx.font = 'bold 16px monospace'; 
                ctx.textAlign = 'left';
                
                let px = 0, py = 0;
                if (this.p1) { px = Math.round(this.p1.x); py = Math.round(this.p1.y); }
                
                const fpsVal = this._fps || 60;
                const txt1 = `FPS: ${fpsVal}  (${Math.round(1000/fpsVal)}ms)`;
                const txt2 = `POS: X:${px} Y:${py}`;
                
                ctx.fillText(txt1, 20, 35);
                ctx.fillText(txt2, 20, 55);
                ctx.restore();
            }

            // enemies
            this.enemies.forEach(e => e.draw(ctx, c));
            // players
            this.players.forEach(p => p.draw(ctx, c));
            // fx
            this.particles.forEach(p => p.draw(ctx, c));
            this.texts.forEach(t => t.draw(ctx, c));
            // ability UI update (DOM)
            try { this.updateAbilityUI(); } catch (e) {}
            try { this.updateAbilityInfoUI(); } catch (e) {}
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

                const s = sharedQL.stateKey(f, target, this.structures, this.hazards, this.arenaW, this.arenaH);
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
                
                // Removed explicit wall penalty to avoid massive negative scores from jitter
                // The AI naturally learns to avoid walls by not reaching the target (opportunity cost)
                /* 
                if (f._collided && !f._wasColliding && f.prevState) {
                    const s2 = sharedQL.stateKey(f, target, this.structures, this.hazards, this.arenaW, this.arenaH);
                    sharedQL.update(f.prevState, f.prevAction, -0.1, s2);
                    // this.totalReward -= 0.1; 
                }
                */
                f._wasColliding = f._collided;

                // reward orb collection
                for (let oi = this.rewardOrbs.length - 1; oi >= 0; oi--) {
                    const orb = this.rewardOrbs[oi];
                    if (!orb.collected && dist(f, orb) < f.radius + orb.radius) {
                        orb.collected = true;
                        this.rewardOrbs.splice(oi, 1);
                        // Q-learning reward: 0.5 (less than kill)
                        if (f.prevState) {
                            const s2 = sharedQL.stateKey(f, target, this.structures, this.hazards, this.arenaW, this.arenaH);
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
                    // onAttack hook for training fighter
                    if (window.Weapons && window.Weapons.onAttack) window.Weapons.onAttack(f.weapon, f, this);
                    if (bd < f.atkRange) {
                        target.takeDamage(f.dmg, f);
                        // onHit
                        if (window.Weapons && window.Weapons.onHit) window.Weapons.onHit(f.weapon, f, target, this, f.dmg);
                        const reward = target.alive ? 1 : 5;
                        this.totalReward += reward;
                        const s2 = sharedQL.stateKey(f, target, this.structures, this.hazards, this.arenaW, this.arenaH);
                        sharedQL.update(s, action, reward, s2);
                        if (this.speed <= 2) {
                            this.particles.push(new Particle(target.x, target.y, `rgba(${150+Math.random()*70},
                            ${150+Math.random()*70},
                            ${150+Math.random()*70},
                            0.9)`));
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
                // compact particles in-place to avoid allocations
                let pj3 = 0;
                for (let pi3 = 0; pi3 < this.particles.length; pi3++) {
                    const pp3 = this.particles[pi3];
                    if (pp3.life > 0) this.particles[pj3++] = pp3;
                }
                this.particles.length = pj3;
                if (this.particles.length > MAX_PARTICLES) this.particles.length = MAX_PARTICLES;
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

        // pause menu buttons
        document.getElementById('resume-btn').addEventListener('click', () => { if(currentGame) currentGame.resume(); });
        document.getElementById('settings-btn').addEventListener('click', () => { if(currentGame) currentGame.openSettings(); });
        document.getElementById('quit-btn').addEventListener('click', () => { if(currentGame) currentGame.quitGame(); });
        document.getElementById('settings-back-btn').addEventListener('click', () => { if(currentGame) currentGame.closeSettings(); });

        // Settings Listeners
        document.getElementById('setting-auto-attack').addEventListener('change', (e) => {
            if(currentGame) currentGame.updateSetting('autoAttack', e.target.checked);
        });
        document.getElementById('setting-mute').addEventListener('change', (e) => {
            if(currentGame) currentGame.updateSetting('mute', e.target.checked);
        });
        document.getElementById('setting-volume').addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            document.getElementById('volume-value').textContent = val + '%';
            if(currentGame) currentGame.updateSetting('volume', val);
        });
    }

    // kick off
    init();
})();
