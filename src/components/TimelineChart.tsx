import { useEffect, useRef, useState } from 'react';
import type { TimelinePoint } from '../core/analytics';
import { colorOf, EMOTIONS, labelOf, MODEL_CLASSES, PLAY_IDS, StateKey } from '../core/emotions';

interface Props {
  /** Returns the points to draw (called at ~5 Hz for live charts). */
  getPoints: () => TimelinePoint[];
  live?: boolean;
  /** Fixed visible window in seconds (live) or 0 to fit everything. */
  windowSec?: number;
  height?: number;
  title?: string;
}

const WINDOWS = [
  { label: '30 s', sec: 30 },
  { label: '2 min', sec: 120 },
  { label: 'Session', sec: 0 },
];

const css = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/**
 * Two stacked views of the same time axis:
 *  1. stacked area of smoothed class probabilities
 *  2. a strip showing the reported state (a class, "uncertain", or no face)
 */
export function TimelineChart({ getPoints, live = true, windowSec = 30, height = 230, title = 'Expression timeline' }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [win, setWin] = useState(windowSec);
  const winRef = useRef(win);
  winRef.current = win;
  const get = useRef(getPoints);
  get.current = getPoints;

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let stop = false;

    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const W = Math.round(rect.width * dpr);
      const H = Math.round(rect.height * dpr);
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      const pad = { l: 38, r: 10, t: 8, b: 20 };
      const stripH = 14;
      const gap = 8;
      const plotH = h - pad.t - pad.b - stripH - gap;
      const x0 = pad.l;
      const x1 = w - pad.r;
      const grid = css('--grid', 'rgba(255,255,255,0.07)');
      const text = css('--muted', '#8b9bb4');

      const pts = get.current();
      const last = pts.length ? pts[pts.length - 1].t : 0;
      const span = winRef.current > 0 ? winRef.current * 1000 : Math.max(10000, last);
      const tEnd = winRef.current > 0 ? Math.max(last, span) : span;
      const tStart = tEnd - span;
      const X = (t: number) => x0 + ((t - tStart) / span) * (x1 - x0);
      const Y = (p: number) => pad.t + (1 - p) * plotH;

      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = grid;
      ctx.fillStyle = text;
      ctx.lineWidth = 1;
      for (const p of [0, 0.25, 0.5, 0.75, 1]) {
        ctx.beginPath();
        ctx.moveTo(x0, Y(p));
        ctx.lineTo(x1, Y(p));
        ctx.stroke();
        ctx.textAlign = 'right';
        ctx.fillText(`${p * 100}%`, x0 - 6, Y(p));
      }
      // time ticks
      ctx.textAlign = 'center';
      const step = span <= 40000 ? 5000 : span <= 150000 ? 20000 : span <= 700000 ? 60000 : 300000;
      for (let t = Math.ceil(tStart / step) * step; t <= tEnd; t += step) {
        ctx.fillText(`${Math.round(t / 1000)}s`, X(t), h - pad.b / 2 + 2);
        ctx.beginPath();
        ctx.moveTo(X(t), pad.t);
        ctx.lineTo(X(t), pad.t + plotH);
        ctx.stroke();
      }

      const vis = pts.filter((p) => p.t >= tStart - 500);
      // Break the area where there is a gap > 400 ms or no face.
      if (vis.length > 1) {
        const segs: TimelinePoint[][] = [];
        let cur: TimelinePoint[] = [];
        for (let i = 0; i < vis.length; i++) {
          const p = vis[i];
          const broke = p.state === 'no-face' || (cur.length && p.t - cur[cur.length - 1].t > 400);
          if (broke && cur.length) {
            segs.push(cur);
            cur = [];
          }
          if (p.state !== 'no-face') cur.push(p);
        }
        if (cur.length) segs.push(cur);

        for (const seg of segs) {
          if (seg.length < 2) continue;
          const base = seg.map(() => 0);
          for (let c = 0; c < MODEL_CLASSES.length; c++) {
            ctx.beginPath();
            for (let i = 0; i < seg.length; i++) ctx.lineTo(X(seg[i].t), Y(base[i] + seg[i].probs[c]));
            for (let i = seg.length - 1; i >= 0; i--) ctx.lineTo(X(seg[i].t), Y(base[i]));
            ctx.closePath();
            ctx.fillStyle = EMOTIONS[MODEL_CLASSES[c]].color + 'cc';
            ctx.fill();
            for (let i = 0; i < seg.length; i++) base[i] += seg[i].probs[c];
          }
        }
      }

      // state strip
      const sy = pad.t + plotH + gap;
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(x0, sy, x1 - x0, stripH);
      for (let i = 0; i < vis.length; i++) {
        const p = vis[i];
        if (p.state === 'no-face') continue;
        const nextT = i + 1 < vis.length ? Math.min(vis[i + 1].t, p.t + 400) : p.t + 100;
        const xa = Math.max(x0, X(p.t));
        const xb = Math.min(x1, X(nextT));
        if (xb <= xa) continue;
        ctx.fillStyle = colorOf(p.state as StateKey);
        ctx.globalAlpha = p.state === 'uncertain' ? 0.55 : 1;
        ctx.fillRect(xa, sy, xb - xa + 0.5, stripH);
        ctx.globalAlpha = 1;
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = text;

      if (!vis.length) {
        ctx.textAlign = 'center';
        ctx.fillText(live ? 'Waiting for data. Start the camera.' : 'No data', (x0 + x1) / 2, pad.t + plotH / 2);
      }

      if (!stop) raf = window.setTimeout(render, live ? 200 : 1000) as unknown as number;
    };
    render();
    return () => {
      stop = true;
      clearTimeout(raf);
    };
  }, [live]);

  return (
    <section className="panel timeline" aria-label={title}>
      <div className="panel-head">
        <h3 className="panel-title">{title}</h3>
        {live && (
          <div className="seg" role="group" aria-label="Time window">
            {WINDOWS.map((w) => (
              <button key={w.label} className={win === w.sec ? 'on' : ''} onClick={() => setWin(w.sec)}>{w.label}</button>
            ))}
          </div>
        )}
      </div>
      <canvas ref={ref} style={{ width: '100%', height }} role="img" aria-label="Stacked area chart of smoothed class probabilities over time with a strip of reported states" />
      <ul className="legend">
        {MODEL_CLASSES.map((c) => (
          <li key={c}><i style={{ background: EMOTIONS[c].color }} />{EMOTIONS[c].label}</li>
        ))}
        {PLAY_IDS.map((k) => (
          <li key={k} title="Shown in the state strip only (rule-based extras)"><i className="strip" style={{ background: colorOf(k) }} />{labelOf(k)}</li>
        ))}
        <li><i style={{ background: colorOf('uncertain'), opacity: 0.6 }} />{labelOf('uncertain')}</li>
      </ul>
    </section>
  );
}
