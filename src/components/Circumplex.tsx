import { affectRegion } from '../core/emotions';

export interface VAPoint {
  v: number;
  a: number;
  color?: string;
}

interface Props {
  /** Older points, drawn as a fading trail (live) or a scatter (report). */
  trail: VAPoint[];
  current?: VAPoint | null;
  mean?: VAPoint | null;
  size?: number;
  title?: string;
}

const REGIONS: [string, number][] = [
  ['Pleased', 0], ['Excited', 45], ['Alert', 90], ['Tense', 135],
  ['Upset', 180], ['Gloomy', 225], ['Calm', 270], ['Relaxed', 315],
];

/** Valence (x) / arousal (y) plane after Russell's circumplex model of affect. */
export function Circumplex({ trail, current, mean, size = 260, title }: Props) {
  const R = size / 2 - 34;
  const c = size / 2;
  const X = (v: number) => c + v * R;
  const Y = (a: number) => c - a * R;
  const label = current ? affectRegion(current.v, current.a) : null;
  return (
    <figure className="circ">
      <svg viewBox={`0 0 ${size} ${size}`} width="100%" role="img" aria-label={title ?? 'Valence and arousal plot'} style={{ maxWidth: size }}>
        <circle cx={c} cy={c} r={R} fill="rgba(255,255,255,0.02)" stroke="var(--line-2)" />
        <circle cx={c} cy={c} r={R * 0.22} fill="none" stroke="var(--line)" strokeDasharray="3 3" />
        <line x1={c - R} y1={c} x2={c + R} y2={c} stroke="var(--line)" />
        <line x1={c} y1={c - R} x2={c} y2={c + R} stroke="var(--line)" />
        <text x={c} y={11} className="ax" textAnchor="middle">activated</text>
        <text x={c} y={size - 4} className="ax" textAnchor="middle">calm</text>
        <text x={10} y={c} className="ax" textAnchor="middle" transform={`rotate(-90 10 ${c})`}>unpleasant</text>
        <text x={size - 10} y={c} className="ax" textAnchor="middle" transform={`rotate(90 ${size - 10} ${c})`}>pleasant</text>
        {REGIONS.map(([name, deg]) => {
          const rad = (deg * Math.PI) / 180;
          const rr = R * 0.78;
          return (
            <text key={name} x={c + Math.cos(rad) * rr} y={c - Math.sin(rad) * rr + 3} className="reg" textAnchor="middle">{name}</text>
          );
        })}
        {trail.map((p, i) => (
          <circle key={i} cx={X(p.v)} cy={Y(p.a)} r={2.2} fill={p.color ?? '#22d3ee'} opacity={0.12 + 0.5 * ((i + 1) / trail.length)} />
        ))}
        {mean && <circle cx={X(mean.v)} cy={Y(mean.a)} r={6} fill="none" stroke="#fff" strokeWidth={1.5} />}
        {current && (
          <circle cx={X(current.v)} cy={Y(current.a)} r={6.5} fill={current.color ?? '#22d3ee'} stroke="#04121a" strokeWidth={1.5} style={{ transition: 'cx 0.2s, cy 0.2s' }} />
        )}
      </svg>
      {label && <figcaption className="small"><b>{label}</b></figcaption>}
    </figure>
  );
}
