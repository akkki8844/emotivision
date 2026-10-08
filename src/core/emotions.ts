/**
 * Class definitions for the expression model.
 * The order of MODEL_CLASSES MUST match the model's output index order
 * (verified against EmotiEffLib `idx_to_emotion_class` for 8-class models).
 */
export const MODEL_CLASSES = [
  'anger',
  'contempt',
  'disgust',
  'fear',
  'happiness',
  'neutral',
  'sadness',
  'surprise',
] as const;

export type EmotionId = (typeof MODEL_CLASSES)[number];
/**
 * Extra states produced by the rule-based "extras" detector (landmark geometry + tongue colour),
 * NOT by the neural network.
 */
export const PLAY_IDS = ['geeked', 'wink', 'kiss'] as const;
export type PlayId = (typeof PLAY_IDS)[number];
export type StateKey = EmotionId | PlayId | 'uncertain';

export const PLAYS: Record<PlayId, { label: string; color: string; blurb: string }> = {
  geeked: { label: 'Geeked', color: '#2dd4bf', blurb: 'Tongue out or a very lopsided, goofy face' },
  wink: { label: 'Wink', color: '#e879f9', blurb: 'One eye closed, the other open' },
  kiss: { label: 'Kissy face', color: '#fb7185', blurb: 'Pursed, puckered lips' },
};

export const isPlay = (k: string): k is PlayId => (PLAY_IDS as readonly string[]).includes(k);

export interface EmotionMeta {
  label: string;
  color: string;
  /** Contempt is produced by the model but is not in the seven categories of the brief. */
  extra?: boolean;
}

export const EMOTIONS: Record<EmotionId, EmotionMeta> = {
  anger: { label: 'Angry', color: '#f87171' },
  contempt: { label: 'Contempt', color: '#c084fc', extra: true },
  disgust: { label: 'Disgusted', color: '#a3e635' },
  fear: { label: 'Fearful', color: '#fb923c' },
  happiness: { label: 'Happy', color: '#facc15' },
  neutral: { label: 'Neutral', color: '#94a3b8' },
  sadness: { label: 'Sad', color: '#60a5fa' },
  surprise: { label: 'Surprised', color: '#f472b6' },
};

export const UNCERTAIN_COLOR = '#64748b';

export const NUM_CLASSES = MODEL_CLASSES.length;

export const labelOf = (k: StateKey): string =>
  k === 'uncertain' ? 'Uncertain' : isPlay(k) ? PLAYS[k].label : EMOTIONS[k].label;
export const colorOf = (k: StateKey): string =>
  k === 'uncertain' ? UNCERTAIN_COLOR : isPlay(k) ? PLAYS[k].color : EMOTIONS[k].color;

/**
 * Descriptive word for a point on the valence (x) / arousal (y) plane, after Russell's circumplex model.
 * These words name a region of a two-number summary; they are not extra classifier outputs.
 */
export function affectRegion(valence: number, arousal: number): string {
  if (Math.hypot(valence, arousal) < 0.22) return 'Neutral zone';
  const deg = ((Math.atan2(arousal, valence) * 180) / Math.PI + 360) % 360;
  const names = ['Pleased', 'Excited', 'Alert', 'Tense', 'Upset', 'Gloomy', 'Calm', 'Relaxed'];
  return names[Math.round(deg / 45) % 8];
}

export function argmax(values: ArrayLike<number>): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

/** Numerically stable softmax. */
export function softmax(logits: ArrayLike<number>): number[] {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
  const out = new Array<number>(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    out[i] = Math.exp(logits[i] - max);
    sum += out[i];
  }
  for (let i = 0; i < out.length; i++) out[i] /= sum;
  return out;
}

/** Shannon entropy normalised to 0..1 (0 = one class certain, 1 = uniform). */
export function normalisedEntropy(p: ArrayLike<number>): number {
  let h = 0;
  for (let i = 0; i < p.length; i++) if (p[i] > 1e-12) h -= p[i] * Math.log(p[i]);
  return h / Math.log(p.length);
}
