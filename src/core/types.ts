export interface Point {
  x: number;
  y: number;
}

/** Box in video-frame coordinates normalised to 0..1. */
export interface NormBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Timings {
  detectMs: number;
  preprocessMs: number;
  inferMs: number;
  totalMs: number;
}

export interface QualityReport {
  /** Side of the face crop in source pixels. */
  facePx: number;
  /** Head roll in degrees (removed by alignment). */
  rollDeg: number;
  /** Signed yaw proxy in -1..1 from nose position between the cheeks. */
  yaw: number;
  /** Mean luma of the aligned crop, 0..255. */
  brightness: number;
  /** Laplacian variance of the aligned crop (higher = sharper). */
  sharpness: number;
  /** Human-readable reasons the frame is likely to be unreliable. */
  warnings: string[];
  /** Hard-gate reasons that force the result to be reported as uncertain. */
  blockers: string[];
}

export type DecisionStatus = 'no-face' | 'warming' | 'uncertain' | 'confident';

export interface Decision {
  status: DecisionStatus;
  /** Label shown to the user. Null unless status is 'confident'. */
  label: import('./emotions').EmotionId | null;
  /** Current best class of the smoothed distribution (even when uncertain). */
  leading: import('./emotions').EmotionId | null;
  /** Smoothed probability of the leading class, 0..1. */
  confidence: number;
  /** Gap between best and second best smoothed probability. */
  margin: number;
  /** Share of the recent window whose raw argmax equals the leading class, 0..1. */
  stability: number;
  /** Normalised entropy of the smoothed distribution, 0..1. */
  entropy: number;
  /** Smoothed probability vector in MODEL_CLASSES order. */
  probs: number[];
  /** Smoothed valence regression, -1 (unpleasant) .. +1 (pleasant). */
  valence: number;
  /** Smoothed arousal regression, -1 (calm) .. +1 (activated). */
  arousal: number;
  /** Why the result is uncertain, if it is. */
  reasons: string[];
}

export interface PlayFeatures {
  /** Tongue-coloured share of the area below the lower lip, 0..1. */
  tongueArea: number;
  /** Eye aspect ratios (vertical opening / width). */
  earLeft: number;
  earRight: number;
  /** Inner mouth opening / mouth width. */
  mouthOpen: number;
  /** Mouth width / face width. */
  mouthWidth: number;
  /** Sideways mouth shift relative to the nose, fraction of face width. */
  mouthShift: number;
  /** Mouth-corner height difference / mouth width. */
  mouthTilt: number;
  /** Relative left/right eyebrow height difference. */
  browAsym: number;
}

export interface PlayState {
  /** Extra state currently held, if any. */
  active: import('./emotions').PlayId | null;
  /** Raw (sensitivity-adjusted, smoothed) score of each extra, 0..1. */
  scores: Record<import('./emotions').PlayId, number>;
  features: PlayFeatures;
}

export interface FrameSnapshot {
  /** performance.now() timestamp of the frame. */
  t: number;
  faceFound: boolean;
  box: NormBox | null;
  landmarks: Point[] | null;
  quality: QualityReport | null;
  decision: Decision;
  /** Rule-based extras (geeked / wink / kiss). Null when no face. */
  play: PlayState | null;
  /** Raw single-frame softmax output (null when no face). */
  rawProbs: number[] | null;
  timings: Timings | null;
  fps: number;
}

export interface FaceObservation {
  /** Landmarks in source pixel coordinates. */
  landmarks: Point[];
  frameW: number;
  frameH: number;
}
