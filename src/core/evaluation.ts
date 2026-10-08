import { EmotionId, MODEL_CLASSES } from './emotions';

/**
 * Standard classification metrics. All of these are computed from real predictions
 * on a labelled dataset supplied by the user: nothing here is pre-filled or estimated.
 */

export interface ClassMetrics {
  cls: EmotionId;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  support: number;
  /** null when undefined (no predictions of this class / no samples of this class). */
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export interface Metrics {
  classes: EmotionId[];
  n: number;
  accuracy: number | null;
  balancedAccuracy: number | null;
  macroF1: number | null;
  weightedF1: number | null;
  /** confusion[truthIndex][predictedIndex] over `classes`. */
  confusion: number[][];
  perClass: ClassMetrics[];
}

export interface LabelledPrediction {
  truth: EmotionId;
  pred: EmotionId;
}

const ratio = (a: number, b: number): number | null => (b === 0 ? null : a / b);

export function computeMetrics(classes: EmotionId[], samples: LabelledPrediction[]): Metrics {
  const idx = new Map(classes.map((c, i) => [c, i]));
  const k = classes.length;
  const confusion = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  let n = 0;
  for (const s of samples) {
    const t = idx.get(s.truth);
    const p = idx.get(s.pred);
    if (t === undefined || p === undefined) continue;
    confusion[t][p]++;
    n++;
  }

  const perClass: ClassMetrics[] = classes.map((cls, i) => {
    const tp = confusion[i][i];
    let fn = 0;
    let fp = 0;
    for (let j = 0; j < k; j++) {
      if (j !== i) {
        fn += confusion[i][j];
        fp += confusion[j][i];
      }
    }
    const support = tp + fn;
    const tn = n - tp - fn - fp;
    const precision = ratio(tp, tp + fp);
    const recall = ratio(tp, tp + fn);
    const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : precision === null || recall === null ? null : 0;
    return { cls, tp, fp, fn, tn, support, precision, recall, f1 };
  });

  const correct = perClass.reduce((a, c) => a + c.tp, 0);
  const withSupport = perClass.filter((c) => c.support > 0);
  const recalls = withSupport.map((c) => c.recall ?? 0);
  const f1s = withSupport.map((c) => c.f1 ?? 0);
  const totalSupport = withSupport.reduce((a, c) => a + c.support, 0);

  return {
    classes,
    n,
    accuracy: ratio(correct, n),
    balancedAccuracy: recalls.length ? recalls.reduce((a, b) => a + b, 0) / recalls.length : null,
    macroF1: f1s.length ? f1s.reduce((a, b) => a + b, 0) / f1s.length : null,
    weightedF1: totalSupport ? withSupport.reduce((a, c) => a + (c.f1 ?? 0) * c.support, 0) / totalSupport : null,
    confusion,
    perClass,
  };
}

/** Maps folder names found in common datasets (FER2013, FER+, RAF-DB, AffectNet, CK+, ...) to model classes. */
const ALIASES: Record<string, EmotionId> = {
  anger: 'anger',
  angry: 'anger',
  ang: 'anger',
  contempt: 'contempt',
  disgust: 'disgust',
  disgusted: 'disgust',
  fear: 'fear',
  fearful: 'fear',
  afraid: 'fear',
  happiness: 'happiness',
  happy: 'happiness',
  joy: 'happiness',
  neutral: 'neutral',
  sadness: 'sadness',
  sad: 'sadness',
  surprise: 'surprise',
  surprised: 'surprise',
};

export function labelFromFolder(name: string): EmotionId | null {
  const key = name.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (ALIASES[key]) return ALIASES[key];
  // AffectNet / RAF-DB style numeric folders are dataset specific; we refuse to guess.
  return null;
}

/** Truth label = nearest ancestor folder whose name is a known class, from a path like "test/happy/img1.png". */
export function labelFromPath(relativePath: string): EmotionId | null {
  const parts = relativePath.split(/[\\/]/).slice(0, -1).reverse();
  for (const p of parts) {
    const l = labelFromFolder(p);
    if (l) return l;
  }
  return null;
}

export const ALL_CLASSES: EmotionId[] = [...MODEL_CLASSES];

/** Argmax restricted to a subset of classes (used when the dataset has no "contempt" folder). */
export function restrictedArgmax(probs: number[], allowed: EmotionId[]): EmotionId {
  let best: EmotionId = allowed[0];
  let bestP = -1;
  for (const c of allowed) {
    const p = probs[MODEL_CLASSES.indexOf(c)];
    if (p > bestP) {
      bestP = p;
      best = c;
    }
  }
  return best;
}
