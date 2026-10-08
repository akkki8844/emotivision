import { useState } from 'react';
import { colorOf, PLAY_IDS, PLAYS, type StateKey } from '../core/emotions';
import type { Engine } from '../core/engine';
import { PLAY_ON } from '../core/play';
import type { FrameSnapshot } from '../core/types';
import { Circumplex, VAPoint } from './Circumplex';
import { usePoll } from '../hooks/useEngine';

/** Valence/arousal map of the last few seconds (from the network's regression outputs). */
export function AffectMap({ engine, snap }: { engine: Engine; snap: FrameSnapshot }) {
  const trail = usePoll<VAPoint[]>(
    () =>
      engine.live.timeline
        .slice(-50)
        .filter((p) => p.state !== 'no-face' && (p.v !== 0 || p.a !== 0))
        .map((p) => ({ v: p.v, a: p.a, color: colorOf(p.state as StateKey) })),
    250,
  );
  const d = snap.decision;
  const live = d.status === 'confident' || d.status === 'uncertain';
  const cur: VAPoint | null = live
    ? { v: d.valence, a: d.arousal, color: d.leading ? colorOf(d.leading) : '#22d3ee' }
    : null;
  return (
    <section className="panel" aria-label="Valence and arousal">
      <h3 className="panel-title">Affect map (valence / arousal)</h3>
      <p className="muted small">
        Two extra numbers from the same network: how pleasant (x) and how activated (y) the visible expression looks. The words name regions of the plane, not extra classifier outputs.
      </p>
      <Circumplex trail={trail} current={cur} />
    </section>
  );
}

const FEATURE_ROWS: [keyof NonNullable<FrameSnapshot['play']>['features'], string, number][] = [
  ['tongueArea', 'Tongue cue', 2],
  ['earLeft', 'Eye opening L', 2],
  ['earRight', 'Eye opening R', 2],
  ['mouthOpen', 'Mouth open', 2],
  ['mouthWidth', 'Mouth width', 2],
  ['mouthShift', 'Mouth shift', 3],
  ['mouthTilt', 'Mouth tilt', 2],
  ['browAsym', 'Brow asymmetry', 2],
];

export function ExtrasPanel({ snap }: { snap: FrameSnapshot }) {
  const [open, setOpen] = useState(false);
  const p = snap.play;
  return (
    <section className="panel" aria-label="Playful extras">
      <h3 className="panel-title">Extras: geeked, wink, kissy</h3>
      <p className="muted small">
        Rule-based detectors on face geometry and tongue colour, separate from the neural network. Experimental, tuned by hand and not evaluated.
      </p>
      <ul className="bars extras">
        {PLAY_IDS.map((id) => {
          const sc = p?.scores[id] ?? 0;
          return (
            <li key={id} className={p?.active === id ? 'lead' : ''}>
              <span className="bar-label">{PLAYS[id].label}</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ transform: `scaleX(${sc})`, background: PLAYS[id].color }} />
                <span className="bar-mark" style={{ left: `${PLAY_ON * 100}%` }} />
              </span>
              <span className="bar-val mono">{p?.active === id ? 'ON' : `${(sc * 100).toFixed(0)}%`}</span>
            </li>
          );
        })}
      </ul>
      <button className="btn tiny" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide' : 'Show'} measured features</button>
      {open && (
        <dl className="kv feat">
          {FEATURE_ROWS.map(([k, name, digits]) => (
            <div key={k}><dt>{name}</dt><dd className="mono">{p ? p.features[k].toFixed(digits) : '--'}</dd></div>
          ))}
        </dl>
      )}
    </section>
  );
}
