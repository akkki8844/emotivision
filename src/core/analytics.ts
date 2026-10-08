import { MODEL_CLASSES, NUM_CLASSES, PLAY_IDS, PlayId, EmotionId, StateKey } from './emotions';
import type { FrameSnapshot } from './types';

export type TimelineState = StateKey | 'no-face';

export interface TimelinePoint {
  /** ms since the session started. */
  t: number;
  state: TimelineState;
  /** Smoothed confidence of the leading class (0 when no face). */
  conf: number;
  /** Smoothed probabilities rounded to 3 decimals (MODEL_CLASSES order). */
  probs: number[];
  /** Valence / arousal regression (smoothed), 2 decimals. */
  v: number;
  a: number;
  /** Expression the participant was asked to make (guided experiments only). */
  instructed?: EmotionId | PlayId;
}

export interface Transition {
  t: number;
  from: TimelineState;
  to: TimelineState;
  confidence: number;
}

export interface ConfidenceStats {
  n: number;
  mean: number;
  median: number;
  p10: number;
  p90: number;
  min: number;
  max: number;
  std: number;
}

export interface SessionSummary {
  startedAtIso: string;
  durationMs: number;
  framesProcessed: number;
  framesWithFace: number;
  /** Mean smoothed confidence over frames that produced a verdict (confident or uncertain). */
  avgConfidence: number;
  /** Mean raw (unsmoothed) top-class probability over frames with a face. */
  avgRawConfidence: number;
  avgInferenceMs: number;
  avgPipelineMs: number;
  avgFps: number;
  /** Seconds spent in each state, over frames that produced a verdict. */
  seconds: Record<StateKey, number>;
  /** Percentage of verdict time in each state. */
  percent: Record<StateKey, number>;
  noFaceSeconds: number;
  mostFrequent: Exclude<StateKey, 'uncertain'> | null;
  /** Time-averaged valence/arousal over frames with a verdict. */
  avgValence: number;
  avgArousal: number;
  confidenceStats: ConfidenceStats | null;
  transitions: Transition[];
  /** Agreement matrix for guided protocols: instructed class (rows) x model state (cols incl. uncertain). */
  agreement: AgreementCell[] | null;
}

export interface AgreementCell {
  instructed: EmotionId | PlayId;
  seconds: Record<StateKey, number>;
  totalSeconds: number;
}

export const STATE_KEYS: StateKey[] = [...MODEL_CLASSES, ...PLAY_IDS, 'uncertain'];
const zeroRecord = (): Record<StateKey, number> =>
  Object.fromEntries(STATE_KEYS.map((k) => [k, 0])) as Record<StateKey, number>;

const MAX_POINTS = 12000;
const POINT_INTERVAL_MS = 100;
const MIN_DWELL_MS = 300;

export function confidenceStats(values: number[]): ConfidenceStats | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const variance = s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length;
  return { n: s.length, mean, median: q(0.5), p10: q(0.1), p90: q(0.9), min: s[0], max: s[s.length - 1], std: Math.sqrt(variance) };
}

/**
 * Accumulates statistics for one session. Only numbers are stored:
 * no frames, no images, no landmarks.
 */
export class SessionRecorder {
  readonly startedAt = performance.now();
  readonly startedAtIso = new Date().toISOString();
  timeline: TimelinePoint[] = [];
  transitions: Transition[] = [];

  private frames = 0;
  private faceFrames = 0;
  private verdictFrames = 0;
  private cnnFrames = 0;
  private sumConf = 0;
  private sumV = 0;
  private sumA = 0;
  private sumRawConf = 0;
  private sumInfer = 0;
  private sumPipe = 0;
  private sumFps = 0;
  private fpsSamples = 0;
  private seconds = zeroRecord();
  private noFaceMs = 0;
  private lastT: number | null = null;
  private lastPointT = -Infinity;
  private stride = 1;
  private strideCount = 0;
  private stableState: TimelineState = 'no-face';
  private candidate: TimelineState = 'no-face';
  private candidateSince = 0;
  private agreement = new Map<EmotionId | PlayId, { seconds: Record<StateKey, number>; total: number }>();
  private hasProtocol = false;
  private lastDurationMs = 0;

  get frameCount(): number {
    return this.frames;
  }

  get durationMs(): number {
    return this.lastDurationMs;
  }

  push(s: FrameSnapshot, instructed?: EmotionId | PlayId | null): void {
    const t = s.t - this.startedAt;
    const dt = this.lastT === null ? 0 : Math.min(Math.max(s.t - this.lastT, 0), 250);
    this.lastT = s.t;
    this.lastDurationMs = t;
    this.frames++;

    let state: TimelineState = 'no-face';
    const d = s.decision;
    if (s.faceFound) this.faceFrames++;
    if (s.faceFound && s.timings) {
      this.sumInfer += s.timings.inferMs;
      this.sumPipe += s.timings.totalMs;
      if (s.rawProbs) {
        let top = 0;
        for (let i = 0; i < NUM_CLASSES; i++) if (s.rawProbs[i] > top) top = s.rawProbs[i];
        this.sumRawConf += top;
      }
    }
    if (s.fps > 0) {
      this.sumFps += s.fps;
      this.fpsSamples++;
    }

    const playId = s.play?.active ?? null;
    const cnnVerdict = d.status === 'confident' || d.status === 'uncertain';
    if (playId) state = playId; // the extras detector overrides the network while it is active
    else if (d.status === 'confident' && d.label) state = d.label;
    else if (d.status === 'uncertain') state = 'uncertain';
    else if (d.status === 'warming') state = 'no-face'; // not yet a verdict; excluded from distribution

    const isVerdict = cnnVerdict || playId !== null;
    if (cnnVerdict) {
      this.cnnFrames++;
      this.sumConf += d.confidence;
      this.sumV += d.valence;
      this.sumA += d.arousal;
    }
    if (isVerdict) {
      this.verdictFrames++;
      this.seconds[state as StateKey] += dt / 1000;
      if (instructed) {
        this.hasProtocol = true;
        let row = this.agreement.get(instructed);
        if (!row) {
          row = { seconds: zeroRecord(), total: 0 };
          this.agreement.set(instructed, row);
        }
        row.seconds[state as StateKey] += dt / 1000;
        row.total += dt / 1000;
      }
    } else if (d.status === 'no-face') {
      this.noFaceMs += dt;
    }

    // State transitions with a minimum dwell time so one-frame glitches are not logged.
    if (state !== this.candidate) {
      this.candidate = state;
      this.candidateSince = s.t;
    } else if (state !== this.stableState && s.t - this.candidateSince >= MIN_DWELL_MS) {
      this.transitions.push({ t, from: this.stableState, to: state, confidence: d.confidence });
      this.stableState = state;
    }

    // Decimated timeline, thinned further if the session is very long.
    if (s.t - this.lastPointT >= POINT_INTERVAL_MS) {
      this.lastPointT = s.t;
      if (this.strideCount++ % this.stride === 0) {
        const point: TimelinePoint = {
          t,
          state,
          conf: playId && s.play ? s.play.scores[playId] : cnnVerdict ? d.confidence : 0,
          v: cnnVerdict ? Math.round(d.valence * 100) / 100 : 0,
          a: cnnVerdict ? Math.round(d.arousal * 100) / 100 : 0,
          probs: isVerdict || d.status === 'warming' ? d.probs.map((p) => Math.round(p * 1000) / 1000) : new Array(NUM_CLASSES).fill(0),
        };
        if (instructed) point.instructed = instructed;
        this.timeline.push(point);
        if (this.timeline.length > MAX_POINTS) {
          this.timeline = this.timeline.filter((_, i) => i % 2 === 0);
          this.stride *= 2;
        }
      }
    }
  }

  /** Current distribution in percent (cheap; used by the live dashboard). */
  distribution(): { seconds: Record<StateKey, number>; percent: Record<StateKey, number>; total: number } {
    const total = STATE_KEYS.reduce((a, k) => a + this.seconds[k], 0);
    const percent = zeroRecord();
    for (const k of STATE_KEYS) percent[k] = total > 0 ? (this.seconds[k] / total) * 100 : 0;
    return { seconds: { ...this.seconds }, percent, total };
  }

  liveStats() {
    const dist = this.distribution();
    let most: Exclude<StateKey, 'uncertain'> | null = null;
    let best = 0;
    for (const k of [...MODEL_CLASSES, ...PLAY_IDS]) {
      if (dist.seconds[k] > best) {
        best = dist.seconds[k];
        most = k;
      }
    }
    return {
      framesProcessed: this.frames,
      framesWithFace: this.faceFrames,
      avgConfidence: this.cnnFrames ? this.sumConf / this.cnnFrames : null,
      avgValence: this.cnnFrames ? this.sumV / this.cnnFrames : 0,
      avgArousal: this.cnnFrames ? this.sumA / this.cnnFrames : 0,
      avgInferenceMs: this.faceFrames ? this.sumInfer / this.faceFrames : null,
      mostFrequent: most,
      durationMs: this.lastDurationMs,
    };
  }

  summary(): SessionSummary {
    const dist = this.distribution();
    const live = this.liveStats();
    const confs = this.timeline.filter((p) => p.state !== 'no-face' && p.conf > 0).map((p) => p.conf);
    const agreement: AgreementCell[] | null = this.hasProtocol
      ? [...this.agreement.entries()].map(([instructed, row]) => ({
          instructed,
          seconds: row.seconds,
          totalSeconds: row.total,
        }))
      : null;
    return {
      startedAtIso: this.startedAtIso,
      durationMs: this.lastDurationMs,
      framesProcessed: this.frames,
      framesWithFace: this.faceFrames,
      avgConfidence: live.avgConfidence ?? 0,
      avgRawConfidence: this.faceFrames ? this.sumRawConf / this.faceFrames : 0,
      avgInferenceMs: live.avgInferenceMs ?? 0,
      avgPipelineMs: this.faceFrames ? this.sumPipe / this.faceFrames : 0,
      avgFps: this.fpsSamples ? this.sumFps / this.fpsSamples : 0,
      seconds: dist.seconds,
      percent: dist.percent,
      noFaceSeconds: this.noFaceMs / 1000,
      mostFrequent: live.mostFrequent,
      avgValence: live.avgValence,
      avgArousal: live.avgArousal,
      confidenceStats: confidenceStats(confs),
      transitions: this.transitions.slice(),
      agreement,
    };
  }
}
