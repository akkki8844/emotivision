import { argmax, EmotionId, MODEL_CLASSES, normalisedEntropy, NUM_CLASSES } from './emotions';
import type { Decision } from './types';

export interface TemporalConfig {
  /** Time constant of the exponential moving average over probabilities. */
  emaTauMs: number;
  /** Length of the window used for the stability metric. */
  windowMs: number;
  /** Below this smoothed top probability the result is "uncertain". */
  confidenceThreshold: number;
  /** Below this gap between best and second best the result is "uncertain". */
  marginThreshold: number;
  /** A new class must beat the held class by this much before the label switches. */
  hysteresis: number;
  /** Face may disappear this long before the smoother resets. */
  faceLossGraceMs: number;
  /** Number of frames before a verdict is issued after (re)acquiring a face. */
  warmupFrames: number;
}

export const DEFAULT_TEMPORAL: TemporalConfig = {
  emaTauMs: 350,
  windowMs: 1500,
  confidenceThreshold: 0.5,
  marginThreshold: 0.12,
  hysteresis: 0.08,
  faceLossGraceMs: 500,
  warmupFrames: 4,
};

const EMPTY_PROBS = Object.freeze(new Array<number>(NUM_CLASSES).fill(0)) as number[];

export function emptyDecision(status: Decision['status'] = 'no-face'): Decision {
  return {
    status,
    label: null,
    leading: null,
    confidence: 0,
    margin: 0,
    stability: 0,
    entropy: 0,
    probs: EMPTY_PROBS,
    valence: 0,
    arousal: 0,
    reasons: [],
  };
}

interface WindowEntry {
  t: number;
  top: number;
}

/**
 * Temporal analysis stage.
 *
 *  - time-constant EMA over class probabilities (independent of frame rate)
 *  - hysteresis on the displayed label so near-ties do not flicker
 *  - rolling-window stability metric
 *  - explicit "uncertain" decision when confidence or margin is too low
 */
export class TemporalSmoother {
  private ema: number[] | null = null;
  private va: [number, number] = [0, 0];
  private window: WindowEntry[] = [];
  private lastT = 0;
  private lastFaceT = -Infinity;
  private frames = 0;
  private held: number | null = null;
  private last: Decision = emptyDecision();

  constructor(public config: TemporalConfig = DEFAULT_TEMPORAL) {}

  reset(): void {
    this.ema = null;
    this.window = [];
    this.frames = 0;
    this.held = null;
    this.lastFaceT = -Infinity;
    this.last = emptyDecision();
  }

  /**
   * @param t     frame timestamp in ms
   * @param obs   raw model output for this frame, or null if no face was found
   * @param block optional hard-gate reasons (e.g. face far too small) that force "uncertain"
   */
  update(t: number, obs: { probs: number[]; valence: number; arousal: number } | null, block: string[] = []): Decision {
    const cfg = this.config;

    if (!obs) {
      if (t - this.lastFaceT > cfg.faceLossGraceMs) {
        this.reset();
        this.last = emptyDecision('no-face');
      }
      return this.last;
    }

    const probs = obs.probs;
    const dt = this.frames === 0 ? 0 : Math.min(Math.max(t - this.lastT, 1), 500);
    this.lastT = t;
    this.lastFaceT = t;
    this.frames++;

    if (!this.ema) {
      this.ema = probs.slice();
      this.va = [obs.valence, obs.arousal];
    } else {
      const a = 1 - Math.exp(-dt / cfg.emaTauMs);
      this.va[0] += a * (obs.valence - this.va[0]);
      this.va[1] += a * (obs.arousal - this.va[1]);
      let sum = 0;
      for (let i = 0; i < NUM_CLASSES; i++) {
        this.ema[i] += a * (probs[i] - this.ema[i]);
        sum += this.ema[i];
      }
      for (let i = 0; i < NUM_CLASSES; i++) this.ema[i] /= sum;
    }
    const ema = this.ema;

    this.window.push({ t, top: argmax(probs) });
    while (this.window.length && t - this.window[0].t > cfg.windowMs) this.window.shift();

    // Leading class with hysteresis against the currently held label.
    let leading = argmax(ema);
    if (this.held !== null && leading !== this.held && ema[leading] - ema[this.held] < cfg.hysteresis) {
      leading = this.held;
    }

    let second = 0;
    for (let i = 0; i < NUM_CLASSES; i++) if (i !== leading && ema[i] > second) second = ema[i];
    const confidence = ema[leading];
    const margin = confidence - second;

    let agree = 0;
    for (const w of this.window) if (w.top === leading) agree++;
    const stability = this.window.length >= 3 ? agree / this.window.length : 0;

    const reasons: string[] = [...block];
    if (confidence < cfg.confidenceThreshold) reasons.push('Low confidence');
    if (margin < cfg.marginThreshold) reasons.push('Two expressions are nearly tied');

    let status: Decision['status'];
    if (this.frames < cfg.warmupFrames) status = 'warming';
    else if (reasons.length) status = 'uncertain';
    else status = 'confident';

    this.held = status === 'confident' ? leading : null;

    this.last = {
      status,
      label: status === 'confident' ? (MODEL_CLASSES[leading] as EmotionId) : null,
      leading: MODEL_CLASSES[leading] as EmotionId,
      confidence,
      margin,
      stability,
      entropy: normalisedEntropy(ema),
      probs: ema.slice(),
      valence: this.va[0],
      arousal: this.va[1],
      reasons: status === 'uncertain' ? reasons : [],
    };
    return this.last;
  }
}
