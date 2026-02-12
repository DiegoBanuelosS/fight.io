(function(){
    'use strict';

    // Particle and FloatingText utility classes exposed globally
    class Particle {
        constructor(x, y, color) {
            this.x = x; this.y = y;
            this.color = color || `rgba(${160 + Math.random()*60}, ${160 + Math.random()*60}, ${160 + Math.random()*60}, 0.9)`;
            this.vx = (Math.random()*4 - 2); this.vy = (Math.random()*4 - 2);
            this.life = 1; this.decay = Math.random()*0.03 + 0.02;
            this.r = Math.random()*3 + 2;
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

    // expose globally for legacy code compatibility
    window.Particle = Particle;
    window.FloatingText = FloatingText;
})();
