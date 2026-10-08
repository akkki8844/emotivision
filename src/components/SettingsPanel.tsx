import type { Engine } from '../core/engine';

export interface UiSettings {
  showLandmarks: boolean;
  confidenceThreshold: number;
  smoothingMs: number;
  cropMargin: number;
  align: boolean;
  /** 0 disables the extras; 1 is the default sensitivity. */
  extrasSensitivity: number;
}

export const DEFAULT_UI: UiSettings = {
  showLandmarks: false,
  confidenceThreshold: 0.5,
  smoothingMs: 350,
  cropMargin: 1.15,
  align: true,
  extrasSensitivity: 1,
};

export function applySettings(engine: Engine, s: UiSettings): void {
  const p = engine.pipeline;
  if (!p) return;
  p.smoother.config.confidenceThreshold = s.confidenceThreshold;
  p.smoother.config.emaTauMs = s.smoothingMs;
  p.settings.cropMargin = s.cropMargin;
  p.settings.align = s.align;
  p.play.sensitivity = s.extrasSensitivity;
}

interface Props {
  value: UiSettings;
  onChange: (s: UiSettings) => void;
}

export function SettingsPanel({ value, onChange }: Props) {
  const set = <K extends keyof UiSettings>(k: K, v: UiSettings[K]) => onChange({ ...value, [k]: v });
  return (
    <section className="panel" aria-label="Pipeline settings">
      <div className="panel-head">
        <h3 className="panel-title">Pipeline settings</h3>
        <button className="btn tiny" onClick={() => onChange(DEFAULT_UI)}>Defaults</button>
      </div>

      <label className="field">
        <span>Uncertainty threshold <b className="mono">{(value.confidenceThreshold * 100).toFixed(0)}%</b></span>
        <input type="range" min={0.3} max={0.9} step={0.01} value={value.confidenceThreshold} onChange={(e) => set('confidenceThreshold', +e.target.value)} />
        <small>Below this smoothed confidence the app reports &quot;Expression uncertain&quot; instead of a label.</small>
      </label>

      <label className="field">
        <span>Temporal smoothing <b className="mono">{value.smoothingMs} ms</b></span>
        <input type="range" min={50} max={1200} step={10} value={value.smoothingMs} onChange={(e) => set('smoothingMs', +e.target.value)} />
        <small>Time constant of the moving average. Higher is steadier but reacts slower.</small>
      </label>

      <label className="field">
        <span>Face-crop margin <b className="mono">&times;{value.cropMargin.toFixed(2)}</b></span>
        <input type="range" min={0.9} max={1.5} step={0.01} value={value.cropMargin} onChange={(e) => set('cropMargin', +e.target.value)} />
        <small>How much context around the landmarks is fed to the model. Not tuned: compare values in the Evaluation Lab.</small>
      </label>

      <label className="field">
        <span>Extras sensitivity (geeked / wink / kissy) <b className="mono">{value.extrasSensitivity === 0 ? 'off' : `x${value.extrasSensitivity.toFixed(2)}`}</b></span>
        <input type="range" min={0} max={1.6} step={0.05} value={value.extrasSensitivity} onChange={(e) => set('extrasSensitivity', +e.target.value)} />
        <small>Higher triggers more easily. Set to 0 to switch the extras off.</small>
      </label>

      <label className="check">
        <input type="checkbox" checked={value.align} onChange={(e) => set('align', e.target.checked)} />
        <span>Align face (level the eyes before cropping)</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={value.showLandmarks} onChange={(e) => set('showLandmarks', e.target.checked)} />
        <span>Show face landmarks</span>
      </label>
    </section>
  );
}
