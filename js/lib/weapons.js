(function(){
    'use strict';

    const registry = {};

    function register(key, handlers) {
        registry[key] = handlers || {};
    }

    function safeCall(fn) {
        try { fn && fn(); } catch (e) { console.warn('[Weapons] handler error', e); }
    }

    function onAttack(key, attacker, game) {
        const h = registry[key]; if (!h || !h.onAttack) return;
        try { h.onAttack(attacker, game); } catch (e) { console.warn('[Weapons] onAttack', key, e); }
    }
    function onHit(key, attacker, target, game, dmg) {
        const h = registry[key]; if (!h || !h.onHit) return;
        try { h.onHit(attacker, target, game, dmg); } catch (e) { console.warn('[Weapons] onHit', key, e); }
    }
    function onAbility(key, actor, game) {
        const h = registry[key]; if (!h || !h.onAbility) return;
        try { h.onAbility(actor, game); } catch (e) { console.warn('[Weapons] onAbility', key, e); }
    }
    function onKill(key, killer, target, game) {
        const h = registry[key]; if (!h || !h.onKill) return;
        try { h.onKill(killer, target, game); } catch (e) { console.warn('[Weapons] onKill', key, e); }
    }

    // Utility helpers
    function spawnParticles(game, x, y, color, n) {
        if (!game || !game.particles) return;
        const space = Math.max(0, (window.MAX_PARTICLES||200) - game.particles.length);
        const toSpawn = Math.min(n, space);
        for (let i = 0; i < toSpawn; i++) {
            const p = new Particle(x + (Math.random()-0.5)*8, y + (Math.random()-0.5)*8, color);
            p.vx *= 2; p.vy *= 2;
            game.particles.push(p);
        }
    }

    // Register abilities
    register('weapon_sword', {
        onHit(attacker, target, game, dmg) {
            // small knockback + extra spark particles
            const a = Math.atan2(target.y - attacker.y, target.x - attacker.x);
            target.x += Math.cos(a) * 6; target.y += Math.sin(a) * 6;
            spawnParticles(game, target.x, target.y, '#ffdddd', 6);
        }
        ,
        onAbility(attacker, game) {
            // Sword ability: brief damage buff and faster attack speed
            attacker.buffs = attacker.buffs || {};
            attacker.buffs._swordBuff = Date.now() + 1500; // 1.5s
            if (game && game.texts) game.texts.push(new FloatingText(attacker.x, attacker.y - 30, 'Furia', '#fff0b0'));
        }
    });

    register('weapon_axe', {
        onHit(attacker, target, game, dmg) {
            // heavier stagger
            target.staggerTimer = Math.max(target.staggerTimer || 0, 16);
            const a = Math.atan2(target.y - attacker.y, target.x - attacker.x);
            target.x += Math.cos(a) * 10; target.y += Math.sin(a) * 10;
            spawnParticles(game, target.x, target.y, '#ffcc88', 8);
        }
        ,
        onAbility(attacker, game) {
            // Axe ability: throw cleave in front
            const rad = 80;
            const ax = attacker.x + Math.cos(attacker.angle) * 30;
            const ay = attacker.y + Math.sin(attacker.angle) * 30;
            if (game && game.enemies) {
                for (const e of game.enemies) {
                    if (!e.alive) continue;
                    if (Math.hypot(e.x - ax, e.y - ay) <= rad) e.takeDamage(attacker.dmg * 0.8, attacker);
                }
            }
            spawnParticles(game, ax, ay, '#ffbb88', 12);
        }
    });

    register('weapon_hammer', {
        onHit(attacker, target, game, dmg) {
            // AoE shock: damage nearby enemies a fraction
            if (!game || !game.enemies) return;
            spawnParticles(game, target.x, target.y, '#ffd1a8', 10);
            const rad = 60;
            for (const e of game.enemies) {
                if (!e.alive) continue;
                if (e === target) continue;
                if (Math.hypot(e.x - target.x, e.y - target.y) <= rad) {
                    e.takeDamage((dmg || attacker.dmg) * 0.5, attacker);
                }
            }
        }
        ,
        onAbility(attacker, game) {
            // Hammer ability: ground slam stun nearby
            const rad = 90;
            for (const e of game.enemies) {
                if (!e.alive) continue;
                if (Math.hypot(e.x - attacker.x, e.y - attacker.y) <= rad) {
                    e.stunTimer = Math.max(e.stunTimer || 0, 400);
                    e.takeDamage(attacker.dmg * 0.6, attacker);
                }
            }
            spawnParticles(game, attacker.x, attacker.y, '#ffd1a8', 16);
        }
    });

    register('weapon_longsword', {
        onAttack(attacker, game) {
            // quick lunge forward
            const dash = 10;
            attacker.x += Math.cos(attacker.angle) * dash;
            attacker.y += Math.sin(attacker.angle) * dash;
            if (game && game.spawnHitFx) spawnParticles(game, attacker.x, attacker.y, '#dfefff', 6);
        }
        ,
        onAbility(attacker, game) {
            // Longsword ability: short spin that pushes enemies
            const rad = 60;
            for (const e of (game.enemies || [])) {
                if (!e.alive) continue;
                const d = Math.hypot(e.x - attacker.x, e.y - attacker.y);
                if (d <= rad) {
                    const a = Math.atan2(e.y - attacker.y, e.x - attacker.x);
                    e.x += Math.cos(a) * 12; e.y += Math.sin(a) * 12;
                    e.takeDamage(attacker.dmg * 0.4, attacker);
                }
            }
            spawnParticles(game, attacker.x, attacker.y, '#e0f0ff', 10);
        }
    });

    register('weapon_spear', {
        onHit(attacker, target, game, dmg) {
            // pierce: hit another enemy behind target
            if (!game || !game.enemies) return;
            const lineDir = Math.atan2(target.y - attacker.y, target.x - attacker.x);
            let best = null; let bd = Infinity;
            for (const e of game.enemies) {
                if (!e.alive || e === target) continue;
                const ang = Math.atan2(e.y - target.y, e.x - target.x);
                const diff = Math.abs(((ang - lineDir + Math.PI) % (2*Math.PI)) - Math.PI);
                if (diff < 0.5) {
                    const d = Math.hypot(e.x - target.x, e.y - target.y);
                    if (d < bd && d < 120) { bd = d; best = e; }
                }
            }
            if (best) {
                best.takeDamage((dmg || attacker.dmg) * 0.6, attacker);
                spawnParticles(game, best.x, best.y, '#ffeedd', 6);
            }
        }
        ,
        onAbility(attacker, game) {
            // Spear ability: charge forward and pierce
            const distCharge = 80;
            attacker.x += Math.cos(attacker.angle) * distCharge;
            attacker.y += Math.sin(attacker.angle) * distCharge;
            // damage enemies along the line
            for (const e of (game.enemies || [])) {
                if (!e.alive) continue;
                const d = Math.hypot(e.x - attacker.x, e.y - attacker.y);
                if (d < 40) e.takeDamage(attacker.dmg * 0.9, attacker);
            }
            spawnParticles(game, attacker.x, attacker.y, '#fff0dd', 8);
        }
    });

    register('weapon_dagger', {
        onHit(attacker, target, game, dmg) {
            // chance to crit and cause short bleed
            if (Math.random() < 0.3) {
                const crit = (dmg || attacker.dmg) * 1.2;
                target.takeDamage(crit, attacker);
                spawnParticles(game, target.x, target.y, '#ffaaaa', 6);
            }
            // bleed effect
            const now = Date.now();
            target._effects = target._effects || {};
            target._effects.bleed = { dps: 0.6, until: now + 2000 };
        }
        ,
        onAbility(attacker, game) {
            // Dagger ability: teleport behind nearest enemy and deal crit
            let best = null; let bd = Infinity;
            for (const e of (game.enemies || [])) {
                if (!e.alive) continue;
                const d = Math.hypot(e.x - attacker.x, e.y - attacker.y);
                if (d < bd) { bd = d; best = e; }
            }
            if (best && bd < 300) {
                attacker.x = best.x - Math.cos(attacker.angle) * 20;
                attacker.y = best.y - Math.sin(attacker.angle) * 20;
                best.takeDamage(attacker.dmg * 1.5, attacker);
                spawnParticles(game, best.x, best.y, '#ff9999', 8);
            }
        }
    });

    register('weapon_axe_double', {
        onAttack(attacker, game) {
            // whirlwind: deal small damage to enemies around attacker
            if (!game || !game.enemies) return;
            const rad = 50;
            for (const e of game.enemies) {
                if (!e.alive) continue;
                if (Math.hypot(e.x - attacker.x, e.y - attacker.y) <= rad) {
                    e.takeDamage(attacker.dmg * 0.6, attacker);
                }
            }
            spawnParticles(game, attacker.x, attacker.y, '#ffd6ff', 10);
        }
    });

    register('weapon_staff', {
        onHit(attacker, target, game, dmg) {
            // apply short slow
            target._effects = target._effects || {};
            target._effects.slow = { mult: 0.6, until: Date.now() + 1500 };
            spawnParticles(game, target.x, target.y, '#a8dfff', 6);
        }
        ,
        onAbility(attacker, game) {
            // Staff ability: small heal to self and nearby allies
            const rad = 80;
            if (attacker.isPlayer) attacker.hp = Math.min(attacker.maxHp, attacker.hp + 30);
            for (const p of (game.players || [])) {
                if (!p.alive) continue;
                if (Math.hypot(p.x - attacker.x, p.y - attacker.y) <= rad) p.hp = Math.min(p.maxHp, p.hp + 20);
            }
            spawnParticles(game, attacker.x, attacker.y, '#a8efff', 10);
        }
    });

    // expose
    window.Weapons = {
        register, onAttack, onHit, onAbility, onKill, _registry: registry
    };

})();
