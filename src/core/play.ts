import { Alignment, CROP_SIZE } from './alignment';
import { PLAY_IDS, type PlayId } from './emotions';
import type { PlayFeatures, PlayState, Point } from './types';

/**
 * Rule-based "extras" detector: geeked (tongue out / very lopsided face), wink and kissy face.
 *
 * This is NOT part of the neural network. It measures geometry of the 468/478-point face mesh and, for the
 * tongue, a colour cue in the aligned face crop, then applies hand-set thresholds. It has not been evaluated
 * on labelled data, so treat it as an experimental, fun layer: the thresholds are exposed in the UI.
 */

/** MediaPipe Face Mesh indices (468-point model). */
const I = {
  // right eye = subject's right = image-left
  rEyeOuter: 33, rEyeInner: 133, rUpper: [160, 159, 158], rLower: [144, 145, 153],
  // left eye = subject's left = image-right
  lEyeInner: 362, lEyeOuter: 263, lUpper: [385, 386, 387], lLower: [380, 374, 373],
  rBrow: 105, lBrow: 334, rLid: 159, lLid: 386,
  mouthR: 61, mouthL: 291, innerR: 78, innerL: 308, innerUp: 13, innerLow: 14, lipBottom: 17,
  chin: 152, forehead: 10, nose: 1, cheekR: 234, cheekL: 454,
  skinR: 50, skinL: 280,
} as const;

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
/** 0 below `a`, 1 above `b`, linear between. */
const ramp = (v: number, a: number, b: number) => clamp((v - a) / (b - a));
const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);

export const PLAY_ON = 0.6;
export const PLAY_OFF = 0.4;

export const EMPTY_FEATURES: PlayFeatures = {
  tongueArea: 0, earLeft: 0.25, earRight: 0.25, mouthOpen: 0, mouthWidth: 0.4, mouthShift: 0, mouthTilt: 0, browAsym: 0,
};

/** Map a source-frame point into the 224x224 aligned crop. */
export function toCrop(p: Point, a: Alignment): Point {
  const k = CROP_SIZE / a.side;
  const dx = p.x - a.cx;
  const dy = p.y - a.cy;
  const c = Math.cos(a.theta);
  const s = Math.sin(a.theta);
  return { x: CROP_SIZE / 2 + k * (dx * c + dy * s), y: CROP_SIZE / 2 + k * (-dx * s + dy * c) };
}

function px(rgba: Uint8ClampedArray, x: number, y: number): [number, number, number] | null {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 1 || yi < 1 || xi >= CROP_SIZE - 1 || yi >= CROP_SIZE - 1) return null;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const i = ((yi + dy) * CROP_SIZE + xi + dx) * 4;
      r += rgba[i];
      g += rgba[i + 1];
      b += rgba[i + 2];
    }
  }
  return [r / 9, g / 9, b / 9];
}

/** Redness = r - g in normalised chromaticity; skin ~0.08-0.12, lips and tongue ~0.2-0.3. */
function redness(c: [number, number, number]): number {
  const s = c[0] + c[1] + c[2];
  return s < 90 ? -1 : (c[0] - c[1]) / s;
}

/** Length (in crop px) of the contiguous reddish run starting at (x,y) and moving by dy per step. */
function redRun(rgba: Uint8ClampedArray, x: number, y0: number, dir: 1 | -1, maxLen: number, skinRed: number): number {
  let run = 0;
  let miss = 0;
  for (let i = 0; i < maxLen; i++) {
    const c = px(rgba, x, y0 + dir * i);
    if (!c) break;
    if (redness(c) - skinRed > 0.07) {
      run = i + 1;
      miss = 0;
    } else if (++miss >= 3) break;
  }
  return run;
}

/** Measure all extras features for one frame. `rgba` is the aligned 224x224 crop. */
export function computePlayFeatures(lm: Point[], a: Alignment, rgba: Uint8ClampedArray): PlayFeatures {
  if (lm.length < 468) return { ...EMPTY_FEATURES };
  const ux = Math.cos(a.theta);
  const uy = Math.sin(a.theta);
  const U = (p: Point) => p.x * ux + p.y * uy; // along the eye line
  const V = (p: Point) => -p.x * uy + p.y * ux; // across (downward)
  const faceW = Math.abs(U(lm[I.cheekL]) - U(lm[I.cheekR])) || 1;

  const ear = (upper: readonly number[], lower: readonly number[], c0: number, c1: number) => {
    let s = 0;
    for (let i = 0; i < 3; i++) s += dist(lm[upper[i]], lm[lower[i]]);
    return s / 3 / (dist(lm[c0], lm[c1]) || 1);
  };
  const earRight = ear(I.rUpper, I.rLower, I.rEyeOuter, I.rEyeInner);
  const earLeft = ear(I.lUpper, I.lLower, I.lEyeInner, I.lEyeOuter);

  const mouthW = dist(lm[I.mouthR], lm[I.mouthL]) || 1;
  const mouthOpen = dist(lm[I.innerUp], lm[I.innerLow]) / (dist(lm[I.innerR], lm[I.innerL]) || 1);
  const mouthWidth = mouthW / faceW;
  const mouthCenterU = (U(lm[I.mouthR]) + U(lm[I.mouthL])) / 2;
  const mouthShift = (mouthCenterU - U(lm[I.nose])) / faceW;
  const mouthTilt = (V(lm[I.mouthL]) - V(lm[I.mouthR])) / mouthW;

  const browR = V(lm[I.rLid]) - V(lm[I.rBrow]);
  const browL = V(lm[I.lLid]) - V(lm[I.lBrow]);
  const browAsym = Math.abs(browR - browL) / (((browR + browL) / 2) || 1);

  // Tongue: how far the reddish run extends below the inner lower lip, compared with the mouth width and the upper lip.
  const cK = (i: number) => toCrop(lm[i], a);
  const skinP = [cK(I.skinR), cK(I.skinL)].map((p) => px(rgba, p.x, p.y)).filter(Boolean) as [number, number, number][];
  let tongueArea = 0;
  if (skinP.length) {
    const skinRed = skinP.reduce((s, c) => s + redness(c), 0) / skinP.length;
    const low = cK(I.innerLow);
    const up = cK(I.innerUp);
    const chin = cK(I.chin);
    const cr = cK(I.mouthR);
    const cl = cK(I.mouthL);
    const mw = Math.abs(cl.x - cr.x) || 1;
    const maxLen = Math.max(4, chin.y - low.y);
    const xs = [-0.2, -0.1, 0, 0.1, 0.2].map((f) => (cr.x + cl.x) / 2 + f * mw);
    const down = xs.map((x) => redRun(rgba, x, low.y + 1, 1, maxLen, skinRed)).sort((p, q) => p - q);
    const upRun = xs.map((x) => redRun(rgba, x, up.y - 1, -1, mw, skinRed)).sort((p, q) => p - q);
    const L = down[2] / mw; // median column
    const Lup = Math.max(upRun[2] / mw, 0.06);
    tongueArea = ramp(L, 0.26, 0.4) * ramp(L / Lup, 1.6, 2.4);
  }

  return { tongueArea, earLeft, earRight, mouthOpen, mouthWidth, mouthShift, mouthTilt, browAsym };
}

/** Per-frame raw scores (0..1) from features. */
export function scoreFeatures(f: PlayFeatures): Record<PlayId, number> {
  // Relative to the other eye, so it does not depend on face size, camera or the person's eye shape.
  // Open eyes of different people measure ~0.25-0.4 with this definition; a closed eyelid is far below its partner.
  const lo = Math.min(f.earLeft, f.earRight);
  const hi = Math.max(f.earLeft, f.earRight);
  const winkScore = ramp(0.7 - lo / (hi || 1), 0, 0.25) * ramp(hi, 0.2, 0.26);

  const sShift = ramp(Math.abs(f.mouthShift), 0.05, 0.12);
  const sTilt = ramp(Math.abs(f.mouthTilt), 0.12, 0.32);
  const sBrow = ramp(f.browAsym, 0.3, 0.7);
  // A single lopsided feature is normal; several at once is a "weird face".
  const weird = ramp(sShift + sTilt + sBrow + 0.7 * winkScore, 1.1, 1.9);

  const kiss = ramp(0.31 - f.mouthWidth, 0, 0.07) * (1 - ramp(f.mouthOpen, 0.25, 0.5));

  return {
    geeked: Math.max(f.tongueArea, weird),
    wink: winkScore,
    kiss,
  };
}

const ATTACK_MS = 60;
const RELEASE_MS = 160;
const HOLD_MS: Record<PlayId, number> = { geeked: 120, wink: 260, kiss: 200 };

/** Temporal logic for the extras: fast-attack/slow-release smoothing, minimum hold time and on/off hysteresis. */
export class PlayDetector {
  sensitivity = 1;
  private s: Record<PlayId, number> = { geeked: 0, wink: 0, kiss: 0 };
  private above: Record<PlayId, number> = { geeked: 0, wink: 0, kiss: 0 };
  private active: PlayId | null = null;
  private lastT: number | null = null;

  reset(): void {
    this.s = { geeked: 0, wink: 0, kiss: 0 };
    this.above = { geeked: 0, wink: 0, kiss: 0 };
    this.active = null;
    this.lastT = null;
  }

  update(t: number, f: PlayFeatures, extraBlock = false): PlayState {
    const dt = this.lastT === null ? 0 : Math.min(t - this.lastT, 250);
    this.lastT = t;
    const raw = scoreFeatures(f);
    for (const id of PLAY_IDS) {
      const target = extraBlock ? 0 : clamp(raw[id] * this.sensitivity);
      const tau = target > this.s[id] ? ATTACK_MS : RELEASE_MS;
      this.s[id] += (target - this.s[id]) * (1 - Math.exp(-dt / tau));
      this.above[id] = this.s[id] >= PLAY_ON ? this.above[id] + dt : 0;
    }

    if (this.active && this.s[this.active] < PLAY_OFF) this.active = null;
    if (!this.active || (this.active !== 'geeked' && this.above.geeked >= HOLD_MS.geeked)) {
      for (const id of PLAY_IDS) {
        if (this.above[id] >= HOLD_MS[id]) {
          this.active = id;
          break;
        }
      }
    }
    return { active: this.active, scores: { ...this.s }, features: f };
  }
}
