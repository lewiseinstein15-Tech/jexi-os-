import { useEffect, useRef } from 'react';

/**
 * B192 — ORB CORE (the JEXI "presence"): a canvas 3D particle sphere
 * (point-cloud on latitudinal/longitudinal grid lines — the ZOEY_OS look),
 * slowly rotating and breathing. Color reacts to her state:
 *   idle = pale cyan · thinking = violet · speaking = amber pulse
 * Zero dependencies, 60fps, mobile-safe (paused when hidden).
 */
export default function OrbCore({ size = 320, state = 'idle', label = 'JEXI' }) {
  const ref = useRef(null);
  const raf = useRef(0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(2, typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1);
    const W = size; const H = size;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    // point cloud on a sphere: rings + meridians (grid topology, not noise)
    const pts = [];
    const R = W * 0.335;
    const RINGS = 14; const MERIDIANS = 22;
    for (let i = 1; i < RINGS; i++) {
      const phi = (Math.PI * i) / RINGS;
      for (let j = 0; j < MERIDIANS; j++) {
        const theta = (2 * Math.PI * j) / MERIDIANS + (i % 2) * (Math.PI / MERIDIANS);
        pts.push({
          x: R * Math.sin(phi) * Math.cos(theta),
          y: R * Math.cos(phi),
          z: R * Math.sin(phi) * Math.sin(theta),
        });
      }
    }
    // a few meridian great-circles for the "topology mesh" feel
    for (let m = 0; m < 6; m++) {
      const theta0 = (Math.PI * m) / 6;
      for (let i = 0; i <= 40; i++) {
        const phi = (Math.PI * i) / 40;
        pts.push({
          x: R * Math.sin(phi) * Math.cos(theta0),
          y: R * Math.cos(phi),
          z: R * Math.sin(phi) * Math.sin(theta0),
        });
      }
    }

    const COLORS = {
      idle: { r: 200, g: 240, b: 255 },
      thinking: { r: 190, g: 140, b: 255 },
      speaking: { r: 255, g: 190, b: 110 },
      writing: { r: 160, g: 220, b: 255 },
    };
    let t = 0;
    let last = 0;

    const draw = (ts) => {
      raf.current = requestAnimationFrame(draw);
      if (ts - last < 28) return; // ~35fps cap: smooth + battery-kind
      last = ts;
      t += 0.011;
      const col = COLORS[state] || COLORS.idle;
      const breathe = 1 + 0.035 * Math.sin(t * 2.2);
      const rotY = t * 0.35;
      const rotX = 0.35 + 0.1 * Math.sin(t * 0.6);
      const cy = H / 2 + Math.sin(t * 0.8) * 4;
      const cx = W / 2;
      const speaking = state === 'speaking';
      const pulse = speaking ? (0.5 + 0.5 * Math.sin(t * 9)) : 0;

      ctx.clearRect(0, 0, W, H);

      // ambient glow behind the cloud
      const g = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.75);
      g.addColorStop(0, `rgba(${col.r},${col.g},${col.b},${0.10 + pulse * 0.10})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      const cosY = Math.cos(rotY); const sinY = Math.sin(rotY);
      const cosX = Math.cos(rotX); const sinX = Math.sin(rotX);

      // project + depth sort-lite (painters approximation via alpha by z)
      for (const p of pts) {
        // rotate Y then X
        let x = p.x * cosY + p.z * sinY;
        let z = -p.x * sinY + p.z * cosY;
        const y = p.y * cosX - z * sinX;
        z = p.y * sinX + z * cosX;
        const scale = breathe * (1 + z / (R * 3.2));
        const px = cx + x * scale;
        const py = cy + y * scale;
        const depth = (z + R) / (2 * R); // 0 back → 1 front
        const alpha = 0.14 + depth * 0.7;
        const rad = 0.7 + depth * 1.1;
        ctx.fillStyle = `rgba(${col.r},${col.g},${col.b},${alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, rad, 0, 6.283);
        ctx.fill();
      }
    };
    raf.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf.current);
  }, [size, state]);

  return (
    <div className="jx-orb" role="img" aria-label={`JEXI ${state}`}>
      <canvas ref={ref} style={{ width: size, height: size }} />
      {label && <span className="jx-orb-label">{label}</span>}
    </div>
  );
}
