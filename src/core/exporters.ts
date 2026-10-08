import { labelOf, MODEL_CLASSES } from './emotions';
import type { ExperimentReport } from './experiment';

function download(name: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

export function downloadJson(prefix: string, data: unknown): void {
  download(`${prefix}-${stamp()}.json`, 'application/json', JSON.stringify(data, null, 2));
}

/** Numbers only: one row per sampled timeline point. */
export function downloadTimelineCsv(report: ExperimentReport): void {
  const head = ['time_s', 'state', 'confidence', 'valence', 'arousal', 'instructed', ...MODEL_CLASSES.map((c) => `p_${c}`)];
  const rows = report.timeline.map((p) =>
    [
      (p.t / 1000).toFixed(2),
      p.state,
      p.conf.toFixed(3),
      p.v.toFixed(2),
      p.a.toFixed(2),
      p.instructed ?? '',
      ...p.probs.map((v) => v.toFixed(3)),
    ].join(','),
  );
  download(`emotivision-timeline-${stamp()}.csv`, 'text/csv', [head.join(','), ...rows].join('\n'));
}

export const fmtState = (s: string): string => (s === 'no-face' ? 'No face' : labelOf(s as never));
