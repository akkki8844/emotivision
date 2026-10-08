import { useEffect, useRef, useState } from 'react';
import { colorOf, EMOTIONS, labelOf, PLAYS } from '../core/emotions';
import type { Engine, CameraStatus, ModelStatus } from '../core/engine';
import type { FrameSnapshot } from '../core/types';

interface Props {
  engine: Engine;
  snap: FrameSnapshot;
  camera: CameraStatus;
  model: ModelStatus;
  showLandmarks: boolean;
}

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Live video + canvas overlay (box, label, optional mesh). The overlay is drawn at display rate and eases toward the latest result. */
function Overlay({ engine, showLandmarks }: { engine: Engine; showLandmarks: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const flags = useRef({ showLandmarks });
  flags.current.showLandmarks = showLandmarks;

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let last = performance.now();
    // eased state
    const box = { x: 0, y: 0, w: 0, h: 0, a: 0 };
    let rgb: [number, number, number] = hexToRgb('#64748b');

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dt = Math.min(now - last, 100);
      last = now;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const W = Math.round(rect.width * dpr);
      const H = Math.round(rect.height * dpr);
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const w = rect.width;
      const h = rect.height;

      const s = engine.last;
      const d = s.decision;
      const live = s.faceFound || d.status !== 'no-face';
      const target = s.box;
      const k = 1 - Math.exp(-dt / 70);

      if (target && live) {
        // The <video> is mirrored by CSS, so mirror x here as well.
        const tx = (1 - (target.x + target.w)) * w;
        const ty = target.y * h;
        const tw = target.w * w;
        const th = target.h * h;
        if (box.a < 0.05) {
          box.x = tx;
          box.y = ty;
          box.w = tw;
          box.h = th;
        }
        box.x += (tx - box.x) * k;
        box.y += (ty - box.y) * k;
        box.w += (tw - box.w) * k;
        box.h += (th - box.h) * k;
        box.a += (1 - box.a) * k;
      } else {
        box.a += (0 - box.a) * (1 - Math.exp(-dt / 120));
      }

      const play = s.play?.active ?? null;
      const key = play ?? (d.status === 'confident' && d.label ? d.label : 'uncertain');
      const goal = hexToRgb(d.status === 'warming' && !play ? '#22d3ee' : colorOf(key));
      rgb = rgb.map((c, i) => c + (goal[i] - c) * (1 - Math.exp(-dt / 150))) as [number, number, number];
      const col = `rgb(${rgb.map(Math.round).join(',')})`;

      if (box.a > 0.02) {
        ctx.globalAlpha = box.a;

        if (flags.current.showLandmarks && s.landmarks) {
          ctx.fillStyle = 'rgba(34,211,238,0.55)';
          for (const p of s.landmarks) ctx.fillRect((1 - p.x) * w - 0.75, p.y * h - 0.75, 1.5, 1.5);
        }

        const L = Math.min(box.w, box.h) * 0.22;
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.shadowColor = col;
        ctx.shadowBlur = 12;
        const { x, y, w: bw, h: bh } = box;
        ctx.beginPath();
        ctx.moveTo(x, y + L); ctx.lineTo(x, y); ctx.lineTo(x + L, y);
        ctx.moveTo(x + bw - L, y); ctx.lineTo(x + bw, y); ctx.lineTo(x + bw, y + L);
        ctx.moveTo(x + bw, y + bh - L); ctx.lineTo(x + bw, y + bh); ctx.lineTo(x + bw - L, y + bh);
        ctx.moveTo(x + L, y + bh); ctx.lineTo(x, y + bh); ctx.lineTo(x, y + bh - L);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(${rgb.map(Math.round).join(',')},0.25)`;
        ctx.strokeRect(x, y, bw, bh);

        // label chip
        let text: string;
        if (play) text = `${PLAYS[play].label}!`;
        else if (d.status === 'confident' && d.label) text = `${EMOTIONS[d.label].label}  ${(d.confidence * 100).toFixed(0)}%`;
        else if (d.status === 'uncertain') text = 'Expression uncertain';
        else if (d.status === 'warming') text = 'Analysing...';
        else text = 'No face detected';
        ctx.font = '600 14px ui-sans-serif, system-ui, sans-serif';
        const tw = ctx.measureText(text).width + 22;
        const chipH = 28;
        let cy = y - chipH - 8;
        if (cy < 4) cy = y + 8;
        ctx.fillStyle = 'rgba(7,11,20,0.82)';
        ctx.beginPath();
        ctx.roundRect(x, cy, tw, chipH, 8);
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x + 11, cy + chipH / 2, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e6edf7';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + 21, cy + chipH / 2 + 0.5);
        ctx.globalAlpha = 1;
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  return <canvas ref={ref} className="overlay" aria-hidden="true" />;
}

function ModelSees({ engine }: { engine: Engine }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const id = setInterval(() => {
      const src = engine.pipeline?.cropCanvas;
      const c = ref.current;
      if (!src || !c || !engine.last.faceFound) return;
      c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
    }, 150);
    return () => clearInterval(id);
  }, [engine]);
  return <canvas ref={ref} width={112} height={112} className="model-sees" title="The aligned 224x224 crop the model receives" />;
}

export function CameraStage({ engine, snap, camera, model, showLandmarks }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');

  useEffect(() => {
    const el = host.current!;
    const v = engine.video;
    v.className = 'video';
    el.prepend(v);
    return () => {
      if (v.parentElement === el) el.removeChild(v);
    };
  }, [engine]);

  useEffect(() => {
    if (camera.state === 'on') engine.camera.listDevices().then(setDevices).catch(() => undefined);
  }, [camera.state, engine]);

  const on = camera.state === 'on';
  const aspect = on ? `${camera.info.width} / ${camera.info.height}` : '16 / 9';
  const d = snap.decision;
  const q = snap.quality;

  const faceStatus = !on
    ? { text: 'Camera off', cls: 'dim' }
    : snap.faceFound
      ? { text: 'Face detected', cls: 'ok' }
      : d.status === 'no-face'
        ? { text: 'No face detected', cls: 'warn' }
        : { text: 'Face detected', cls: 'ok' };
  const modelStatus =
    model.state === 'ready'
      ? { text: 'Model ready', cls: 'ok' }
      : model.state === 'loading'
        ? { text: model.step, cls: 'info' }
        : model.state === 'error'
          ? { text: 'Model error', cls: 'bad' }
          : { text: 'Model idle', cls: 'dim' };

  return (
    <section className="panel stage" aria-label="Live camera">
      <div className="stage-frame" style={{ aspectRatio: aspect }} ref={host}>
        <Overlay engine={engine} showLandmarks={showLandmarks} />
        {!on && (
          <div className="stage-empty">
            {camera.state === 'starting' ? (
              <p>Starting camera...</p>
            ) : (
              <>
                <div className="eye-icon" aria-hidden="true" />
                <h2>Camera is off</h2>
                <p>
                  Frames are analysed on this device only. Nothing is uploaded or recorded.
                </p>
                <button className="btn primary" onClick={() => engine.startCamera().catch(() => undefined)} disabled={model.state === 'error'}>
                  Start camera
                </button>
                {camera.state === 'error' && <p className="error" role="alert">{camera.message}</p>}
                {model.state === 'error' && <p className="error" role="alert">{model.message}</p>}
              </>
            )}
          </div>
        )}
        {on && snap.decision.status === 'no-face' && (
          <div className="stage-banner" role="status">No face detected</div>
        )}
        {on && q && q.warnings.length + q.blockers.length > 0 && d.status !== 'no-face' && (
          <div className="stage-warnings" role="status">
            {[...q.blockers, ...q.warnings].slice(0, 3).map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
        )}
        {on && <div className="stage-disclaimer">AI-estimated facial-expression category, not a measurement of how you feel</div>}
      </div>

      <div className="hud" role="group" aria-label="Pipeline status">
        <div className="chip"><span className="k">FPS</span><span className="v mono">{on && snap.fps ? snap.fps.toFixed(0) : '--'}</span></div>
        <div className="chip"><span className="k">Inference</span><span className="v mono">{snap.timings && snap.timings.inferMs ? `${snap.timings.inferMs.toFixed(0)} ms` : '--'}</span></div>
        <div className="chip"><span className="k">Pipeline</span><span className="v mono">{snap.timings && snap.faceFound ? `${snap.timings.totalMs.toFixed(0)} ms` : '--'}</span></div>
        <div className={`chip ${faceStatus.cls}`}><span className="dot" /><span className="v">{faceStatus.text}</span></div>
        <div className={`chip ${modelStatus.cls}`}><span className="dot" /><span className="v">{modelStatus.text}</span></div>
        <div className="chip local"><span className="dot" /><span className="v">Camera processing: Local</span></div>
        <div className="hud-spacer" />
        {on && devices.length > 1 && (
          <select
            aria-label="Camera device"
            value={deviceId}
            onChange={(e) => {
              setDeviceId(e.target.value);
              engine.startCamera(e.target.value).catch(() => undefined);
            }}
          >
            <option value="">Default camera</option>
            {devices.map((dv, i) => (
              <option key={dv.deviceId} value={dv.deviceId}>{dv.label || `Camera ${i + 1}`}</option>
            ))}
          </select>
        )}
        {on && <button className="btn" onClick={() => engine.stopCamera()}>Stop camera</button>}
        {on && (
          <div className="sees">
            <ModelSees engine={engine} />
            <span className="sees-cap">Model input<br />(aligned 224&times;224)</span>
          </div>
        )}
      </div>
      <span className="sr-only" aria-live="polite">
        {d.status === 'confident' && d.label ? `${labelOf(d.label)} ${Math.round(d.confidence * 100)} percent` : d.status === 'uncertain' ? 'Expression uncertain' : ''}
      </span>
    </section>
  );
}
