// The animated arena for one side of the race. Silo: four agents walled off from each other.
// Shared: the same four agents around a Meko core that every signal flows through.
import { useEffect, useRef } from 'react';
import { AGENTS, ORDER } from './agents.js';

const POS = { 'login-sentry': [0.17, 0.25], 'support-listener': [0.83, 0.25], 'identity-warden': [0.17, 0.75], 'payments-hawk': [0.83, 0.75] };

export default function Arena({ side, shared, running }) {
  const ref = useRef(null);
  const sideRef = useRef(side);
  sideRef.current = side;
  const runRef = useRef(running);
  runRef.current = running;

  useEffect(() => {
    const cv = ref.current;
    const g = cv.getContext('2d');
    let raf;
    let W = 0, H = 0;
    const parts = [];
    const rings = [];
    const labels = [];
    const glow = {};
    let shock = 0;
    let coreKick = 0;
    const resize = () => {
      const r = cv.getBoundingClientRect();
      const d = Math.min(window.devicePixelRatio || 1, 2);
      W = r.width; H = r.height;
      cv.width = W * d; cv.height = H * d;
      g.setTransform(d, 0, 0, d, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    const P = (a) => [POS[a][0] * W, POS[a][1] * H];
    const C = () => [W / 2, H / 2];
    const edge = (a) => { const [x, y] = P(a); return [x < W / 2 ? -10 : W + 10, y + (Math.random() - 0.5) * 60]; };
    const shoot = (from, to, color, speed = 0.03, size = 2.2, delay = 0) => parts.push({ from, to, color, p: -delay, speed, size });

    const draw = (now) => {
      const s = sideRef.current;
      // Consume the effects queued by the race state.
      for (const fx of s.fx.splice(0, 60)) {
        if (!AGENTS[fx.agent] && fx.k !== 'takeover' && fx.k !== 'pattern') continue;
        if (fx.k === 'routine') shoot(edge(fx.agent), P(fx.agent), 'rgba(140,160,190,0.35)', 0.05, 1.3);
        if (fx.k === 'signal') {
          const col = AGENTS[fx.agent].color;
          shoot(edge(fx.agent), P(fx.agent), col, 0.05, 2.4);
          glow[fx.agent] = 1;
          if (shared) {
            shoot(C(), P(fx.agent), '#9fe8ff', 0.045, 2.2, 0.25);
            shoot(P(fx.agent), C(), col, 0.04, 2.6, 0.6);
            for (const o of fx.from) if (o !== fx.agent && POS[o]) shoot(P(o), C(), AGENTS[o].color, 0.05, 1.8, 0.1);
            coreKick = Math.min(1, coreKick + 0.25);
          }
        }
        if (fx.k === 'hold') {
          const [x, y] = P(fx.agent);
          rings.push({ x, y, r: 10, a: 1, color: fx.fp ? '#ffd166' : '#58f0a7' });
          if (shared) rings.push({ x: W / 2, y: H / 2, r: 30, a: 0.8, color: '#58f0a7' });
          labels.push({ x, y: y - 34, text: `HOLD ${fx.label}`, a: 1, color: fx.fp ? '#ffd166' : '#58f0a7' });
          glow[fx.agent] = 1.6;
        }
        if (fx.k === 'takeover') {
          shock = 1;
          labels.push({ x: W / 2, y: H / 2 - (shared ? 70 : 10), text: `TAKEOVER ${fx.label}`, a: 1.4, color: '#ff4d4d', big: true });
        }
        if (fx.k === 'pattern') { rings.push({ x: W / 2, y: H / 2, r: 24, a: 1, color: '#ffb86b' }); coreKick = 1; }
      }

      g.clearRect(0, 0, W, H);
      // Grid.
      g.strokeStyle = 'rgba(120,150,200,0.06)'; g.lineWidth = 1;
      for (let x = (now / 60) % 32; x < W; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
      for (let y = 0; y < H; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }

      const [cx, cy] = C();
      if (shared) {
        // Links from every agent to the core.
        for (const a of ORDER) {
          const [x, y] = P(a);
          const gr = g.createLinearGradient(x, y, cx, cy);
          gr.addColorStop(0, `${AGENTS[a].color}55`); gr.addColorStop(1, 'rgba(90,209,255,0.08)');
          g.strokeStyle = gr; g.lineWidth = 1.2; g.setLineDash([3, 6]); g.lineDashOffset = -now / 40;
          g.beginPath(); g.moveTo(x, y); g.lineTo(cx, cy); g.stroke();
        }
        g.setLineDash([]);
        const pulse = 1 + Math.sin(now / 420) * 0.04 + coreKick * 0.12;
        const R = Math.min(W, H) * 0.17 * pulse;
        const rg = g.createRadialGradient(cx, cy, 2, cx, cy, R * 1.9);
        rg.addColorStop(0, 'rgba(90,209,255,0.42)'); rg.addColorStop(0.5, 'rgba(90,209,255,0.10)'); rg.addColorStop(1, 'rgba(90,209,255,0)');
        g.fillStyle = rg; g.beginPath(); g.arc(cx, cy, R * 1.9, 0, 7); g.fill();
        for (let i = 0; i < 3; i++) {
          g.strokeStyle = `rgba(140,225,255,${0.55 - i * 0.15})`; g.lineWidth = 1.4;
          g.beginPath(); g.arc(cx, cy, R * (0.62 + i * 0.2), now / (900 + i * 300) + i, now / (900 + i * 300) + i + 4.4); g.stroke();
        }
        g.fillStyle = '#0a1322'; g.beginPath(); g.arc(cx, cy, R * 0.5, 0, 7); g.fill();
        g.fillStyle = '#d9f6ff'; g.font = '700 15px "Space Grotesk"'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('meko', cx, cy - 4);
        g.fillStyle = 'rgba(160,220,255,0.7)'; g.font = '600 8px "JetBrains Mono"'; g.fillText('SHARED MEMORY', cx, cy + 11);
        coreKick *= 0.94;
      } else {
        // Walls: nothing crosses between agents.
        g.strokeStyle = 'rgba(255,90,60,0.32)'; g.lineWidth = 2; g.setLineDash([10, 7]);
        g.beginPath(); g.moveTo(cx, 14); g.lineTo(cx, H - 14); g.moveTo(14, cy); g.lineTo(W - 14, cy); g.stroke();
        g.setLineDash([]);
        g.fillStyle = '#0b1220'; g.strokeStyle = 'rgba(255,90,60,0.5)'; g.lineWidth = 1.2;
        g.beginPath(); g.roundRect(cx - 44, cy - 13, 88, 26, 13); g.fill(); g.stroke();
        g.fillStyle = '#ff8a73'; g.font = '600 9px "JetBrains Mono"'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('NO SHARING', cx, cy + 1);
      }

      // Particles.
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.p += p.speed;
        if (p.p < 0) continue;
        if (p.p >= 1) { parts.splice(i, 1); continue; }
        const e = 1 - (1 - p.p) ** 2;
        const x = p.from[0] + (p.to[0] - p.from[0]) * e;
        const y = p.from[1] + (p.to[1] - p.from[1]) * e;
        g.fillStyle = p.color; g.shadowColor = p.color; g.shadowBlur = 8;
        g.beginPath(); g.arc(x, y, p.size, 0, 7); g.fill();
      }
      g.shadowBlur = 0;

      // Agents.
      for (const a of ORDER) {
        const [x, y] = P(a);
        const A = AGENTS[a];
        const gl = glow[a] || 0;
        const r = 24 + gl * 4;
        const rg = g.createRadialGradient(x, y, 4, x, y, r * 2.2);
        rg.addColorStop(0, `${A.color}${gl > 0.3 ? '66' : '2a'}`); rg.addColorStop(1, `${A.color}00`);
        g.fillStyle = rg; g.beginPath(); g.arc(x, y, r * 2.2, 0, 7); g.fill();
        g.fillStyle = '#0b1322'; g.strokeStyle = A.color; g.lineWidth = 1.8;
        g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.stroke();
        g.fillStyle = A.color; g.font = '600 18px "Space Grotesk"'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(A.glyph, x, y + 1);
        g.fillStyle = 'rgba(220,232,255,0.85)'; g.font = '600 9px "JetBrains Mono"';
        g.fillText(A.short, x, y + r + 13);
        glow[a] = gl * 0.93;
      }

      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.r += 2.6; r.a -= 0.022;
        if (r.a <= 0) { rings.splice(i, 1); continue; }
        g.strokeStyle = r.color; g.globalAlpha = Math.max(0, r.a); g.lineWidth = 2.5;
        g.beginPath(); g.arc(r.x, r.y, r.r, 0, 7); g.stroke(); g.globalAlpha = 1;
      }
      for (let i = labels.length - 1; i >= 0; i--) {
        const l = labels[i];
        l.y -= 0.35; l.a -= 0.012;
        if (l.a <= 0) { labels.splice(i, 1); continue; }
        g.globalAlpha = Math.min(1, l.a); g.fillStyle = l.color;
        g.font = l.big ? '700 17px "Space Grotesk"' : '600 10px "JetBrains Mono"'; g.textAlign = 'center';
        g.fillText(l.text, Math.max(70, Math.min(W - 70, l.x)), l.y); g.globalAlpha = 1;
      }
      if (shock > 0.01) {
        g.fillStyle = `rgba(255,50,50,${shock * 0.22})`; g.fillRect(0, 0, W, H);
        g.strokeStyle = `rgba(255,70,70,${shock})`; g.lineWidth = 3;
        g.beginPath(); g.arc(cx, cy, (1 - shock) * Math.max(W, H) * 0.7, 0, 7); g.stroke();
        shock *= 0.95;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [shared]);

  return <canvas ref={ref} className="arena-canvas" />;
}
