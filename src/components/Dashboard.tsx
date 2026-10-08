import { affectRegion, colorOf, EMOTIONS, labelOf, MODEL_CLASSES, PLAY_IDS, PLAYS, StateKey } from '../core/emotions';
import type { Engine, ModelStatus } from '../core/engine';
import { MODEL_FACTS } from '../core/expressionModel';
import type { FrameSnapshot } from '../core/types';
import { usePoll } from '../hooks/useEngine';

const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;

function stabilityWord(s: number): string {
  if (s >= 0.8) return 'High';
  if (s >= 0.55) return 'Moderate';
  return 'Low';
}

export function LiveAnalysis({ snap, active }: { snap: FrameSnapshot; active: boolean }) {
  const d = snap.decision;
  let headline = '--';
  let sub = 'Start the camera to begin';
  let color = '#64748b';
  const play = snap.play?.active ?? null;
  if (active) {
    if (play) {
      headline = PLAYS[play].label;
      color = PLAYS[play].color;
      sub = `${PLAYS[play].blurb}. Rule-based detector, not the neural network.`;
    } else if (d.status === 'confident' && d.label) {
      headline = EMOTIONS[d.label].label;
      color = EMOTIONS[d.label].color;
      sub = 'Most likely visible expression category';
    } else if (d.status === 'uncertain') {
      headline = 'Expression uncertain';
      sub = d.reasons.join(' / ') || 'Confidence too low to report a category';
    } else if (d.status === 'warming') {
      headline = 'Analysing...';
      color = '#22d3ee';
      sub = 'Collecting a few frames';
    } else {
      headline = 'No face detected';
      sub = 'Face the camera in good light';
    }
  }
  const showMetrics = active && (d.status === 'confident' || d.status === 'uncertain');
  const nn = d.status === 'confident' && d.label ? `${EMOTIONS[d.label].label} ${pct(d.confidence)}` : d.status === 'uncertain' ? 'uncertain' : '--';
  return (
    <section className="panel" aria-label="Live analysis">
      <h3 className="panel-title">Live analysis</h3>
      <div className="headline" style={{ color }}>{headline}</div>
      <p className="muted small">{sub}</p>

      <div className="meter" role="img" aria-label={`Confidence ${showMetrics ? pct(d.confidence) : 'not available'}`}>
        <div className="meter-fill" style={{ transform: `scaleX(${showMetrics ? d.confidence : 0})`, background: color }} />
        {showMetrics && <div className="meter-mark" style={{ left: '50%' }} title="Default uncertainty threshold" />}
      </div>
      {play && <p className="small muted">Neural network says: <b>{nn}</b></p>}
      <dl className="kv">
        <div><dt>Confidence</dt><dd className="mono">{showMetrics ? pct(d.confidence, 1) : '--'}</dd></div>
        <div><dt>Stability</dt><dd className="mono">{showMetrics ? `${pct(d.stability)} ${stabilityWord(d.stability)}` : '--'}</dd></div>
        <div><dt>Margin to 2nd</dt><dd className="mono">{showMetrics ? pct(d.margin, 1) : '--'}</dd></div>
        <div><dt>Entropy</dt><dd className="mono">{showMetrics ? d.entropy.toFixed(2) : '--'}</dd></div>
        <div className="wide"><dt>Affect region (valence / arousal)</dt><dd>{showMetrics ? `${affectRegion(d.valence, d.arousal)} (${d.valence >= 0 ? '+' : ''}${d.valence.toFixed(2)} / ${d.arousal >= 0 ? '+' : ''}${d.arousal.toFixed(2)})` : '--'}</dd></div>
      </dl>
      <p className="note">The model estimates the most likely <em>visible</em> facial-expression category. It does not know how you feel.</p>
    </section>
  );
}

export function ProbabilityBars({ snap }: { snap: FrameSnapshot }) {
  const probs = snap.decision.probs;
  const lead = snap.decision.leading;
  return (
    <section className="panel" aria-label="Class probabilities">
      <h3 className="panel-title">Smoothed class probabilities</h3>
      <ul className="bars">
        {MODEL_CLASSES.map((c, i) => (
          <li key={c} className={lead === c ? 'lead' : ''}>
            <span className="bar-label">{EMOTIONS[c].label}{EMOTIONS[c].extra && <sup title="Extra class not in the brief's seven">+</sup>}</span>
            <span className="bar-track"><span className="bar-fill" style={{ transform: `scaleX(${probs[i] || 0})`, background: EMOTIONS[c].color }} /></span>
            <span className="bar-val mono">{(probs[i] * 100 || 0).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const DIST_KEYS: StateKey[] = [...MODEL_CLASSES, ...PLAY_IDS, 'uncertain'];

export function DistributionChart({ engine, title = 'Expression distribution', source }: { engine: Engine; title?: string; source?: () => ReturnType<Engine['live']['distribution']> }) {
  const dist = usePoll(source ?? (() => engine.live.distribution()), 500);
  const max = Math.max(1, ...DIST_KEYS.map((k) => dist.percent[k]));
  return (
    <section className="panel" aria-label="Expression distribution">
      <h3 className="panel-title">{title}</h3>
      <p className="muted small">Share of analysed time spent in each category{dist.total > 0 ? ` (${dist.total.toFixed(0)} s)` : ''}</p>
      <ul className="dist">
        {DIST_KEYS.map((k) => (
          <li key={k}>
            <span className="bar-label">{labelOf(k)}</span>
            <span className="bar-track">
              <span className="bar-fill" style={{ transform: `scaleX(${dist.percent[k] / max})`, background: colorOf(k), opacity: k === 'uncertain' ? 0.6 : 1 }} />
            </span>
            <span className="bar-val mono">{dist.percent[k].toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ModelInfo({ model, snap }: { model: ModelStatus; snap: FrameSnapshot }) {
  const rt = model.state === 'ready' ? model.runtime : null;
  return (
    <section className="panel" aria-label="Model information">
      <h3 className="panel-title">Model information</h3>
      <dl className="kv stacked">
        <div><dt>Model</dt><dd>{MODEL_FACTS.name}</dd></div>
        <div><dt>Architecture</dt><dd>EfficientNet-B0, {MODEL_FACTS.classes} classes + valence/arousal</dd></div>
        <div><dt>Input size</dt><dd className="mono">{MODEL_FACTS.inputSize}</dd></div>
        <div><dt>Inference framework</dt><dd>{rt ? `ONNX Runtime Web ${rt.ortVersion}` : MODEL_FACTS.framework} ({rt ? `${rt.provider}, ${rt.threads} thread${rt.threads > 1 ? 's' : ''}` : 'wasm'})</dd></div>
        <div><dt>Face detector</dt><dd>MediaPipe Face Mesh (BlazeFace + 468 landmarks)</dd></div>
        <div><dt>Processing location</dt><dd>{MODEL_FACTS.location}</dd></div>
        <div><dt>Current FPS</dt><dd className="mono">{snap.fps ? snap.fps.toFixed(1) : '--'}</dd></div>
        {model.state === 'ready' && <div><dt>Load time</dt><dd className="mono">{(model.loadMs / 1000).toFixed(1)} s</dd></div>}
      </dl>
    </section>
  );
}

export function SessionStats({ engine }: { engine: Engine }) {
  const s = usePoll(() => engine.live.liveStats(), 500);
  const dur = Math.round(s.durationMs / 1000);
  return (
    <section className="panel" aria-label="Session statistics">
      <div className="panel-head">
        <h3 className="panel-title">Session statistics</h3>
        <button className="btn tiny" onClick={() => engine.resetLive()}>Reset</button>
      </div>
      <dl className="kv">
        <div><dt>Frames processed</dt><dd className="mono">{s.framesProcessed.toLocaleString()}</dd></div>
        <div><dt>Frames with a face</dt><dd className="mono">{s.framesWithFace.toLocaleString()}</dd></div>
        <div><dt>Average confidence</dt><dd className="mono">{s.avgConfidence === null ? '--' : pct(s.avgConfidence, 1)}</dd></div>
        <div><dt>Avg inference latency</dt><dd className="mono">{s.avgInferenceMs === null ? '--' : `${s.avgInferenceMs.toFixed(1)} ms`}</dd></div>
        <div><dt>Most frequent</dt><dd>{s.mostFrequent ? labelOf(s.mostFrequent) : '--'}</dd></div>
        <div><dt>Duration</dt><dd className="mono">{Math.floor(dur / 60)}:{String(dur % 60).padStart(2, '0')}</dd></div>
      </dl>
      <p className="muted small">Only counters and probabilities are kept. No images are stored.</p>
    </section>
  );
}
