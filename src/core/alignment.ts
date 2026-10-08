import type { Point, QualityReport } from './types';

/** MediaPipe Face Mesh landmark indices used for alignment and pose proxies. */
export const LM = {
  rightEyeOuter: 33, // image-left eye (subject's right)
  rightEyeInner: 133,
  leftEyeInner: 362, // image-right eye (subject's left)
  leftEyeOuter: 263,
  noseTip: 1,
  cheekImageLeft: 234,
  cheekImageRight: 454,
} as const;

export const CROP_SIZE = 224;

export interface Alignment {
  /** Crop centre in source pixels. */
  cx: number;
  cy: number;
  /** Side length of the (rotated) square crop in source pixels. */
  side: number;
  /** Rotation of the eye line in radians. */
  theta: number;
  rollDeg: number;
  /** -1..1, 0 is frontal. */
  yaw: number;
}

const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Face alignment/normalisation: rotate so the eyes are horizontal, then take a square
 * that covers all landmarks (scaled by `margin`).
 * Pure function of the landmarks, so it can be unit tested.
 */
export function computeAlignment(landmarks: Point[], margin: number, align = true): Alignment {
  const eyeA = mid(landmarks[LM.rightEyeOuter], landmarks[LM.rightEyeInner]);
  const eyeB = mid(landmarks[LM.leftEyeInner], landmarks[LM.leftEyeOuter]);
  const theta = align ? Math.atan2(eyeB.y - eyeA.y, eyeB.x - eyeA.x) : 0;
  const pivot = mid(eyeA, eyeB);
  const ux = Math.cos(theta);
  const uy = Math.sin(theta);

  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of landmarks) {
    const dx = p.x - pivot.x;
    const dy = p.y - pivot.y;
    const u = dx * ux + dy * uy;
    const v = -dx * uy + dy * ux;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  const uc = (minU + maxU) / 2;
  const vc = (minV + maxV) / 2;
  const side = Math.max(maxU - minU, maxV - minV) * margin;

  // Yaw proxy: where the nose tip sits between the two cheek edges along the eye axis.
  const proj = (p: Point) => (p.x - pivot.x) * ux + (p.y - pivot.y) * uy;
  const l = proj(landmarks[LM.cheekImageLeft]);
  const r = proj(landmarks[LM.cheekImageRight]);
  const n = proj(landmarks[LM.noseTip]);
  const span = r - l || 1;
  const yaw = ((n - l) / span - 0.5) * 2;

  return {
    cx: pivot.x + uc * ux - vc * uy,
    cy: pivot.y + uc * uy + vc * ux,
    side,
    theta,
    rollDeg: (theta * 180) / Math.PI,
    yaw,
  };
}

/** Axis-aligned bounding box (source pixels) of all landmarks, for the on-screen overlay. */
export function landmarkBox(landmarks: Point[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of landmarks) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Warp the source image so the aligned face square fills the destination canvas. */
export function drawAlignedCrop(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  a: Alignment,
  size = CROP_SIZE,
): void {
  const k = size / a.side;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);
  ctx.scale(k, k);
  ctx.rotate(-a.theta);
  ctx.translate(-a.cx, -a.cy);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export const QUALITY_LIMITS = {
  minFacePxHard: 64,
  minFacePxSoft: 120,
  darkHard: 25,
  darkSoft: 60,
  brightSoft: 225,
  yawSoft: 0.3,
  yawHard: 0.6,
  blurSoft: 20,
} as const;

/** Luma mean and Laplacian variance of an RGBA crop (cheap image-quality probes). */
export function imageStats(rgba: Uint8ClampedArray, size: number): { brightness: number; sharpness: number } {
  const step = 2;
  const n = Math.floor(size / step);
  const g = new Float32Array(n * n);
  let sum = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = ((y * step) * size + x * step) * 4;
      const l = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      g[y * n + x] = l;
      sum += l;
    }
  }
  let m = 0;
  let m2 = 0;
  let c = 0;
  for (let y = 1; y < n - 1; y++) {
    for (let x = 1; x < n - 1; x++) {
      const i = y * n + x;
      const lap = g[i - 1] + g[i + 1] + g[i - n] + g[i + n] - 4 * g[i];
      m += lap;
      m2 += lap * lap;
      c++;
    }
  }
  const mean = m / c;
  return { brightness: sum / (n * n), sharpness: m2 / c - mean * mean };
}

export function assessQuality(a: Alignment, stats: { brightness: number; sharpness: number }): QualityReport {
  const L = QUALITY_LIMITS;
  const warnings: string[] = [];
  const blockers: string[] = [];

  if (a.side < L.minFacePxHard) blockers.push('Face too small - move closer');
  else if (a.side < L.minFacePxSoft) warnings.push('Face is small - move closer for a better reading');

  if (stats.brightness < L.darkHard) blockers.push('Too dark');
  else if (stats.brightness < L.darkSoft) warnings.push('Low light');
  else if (stats.brightness > L.brightSoft) warnings.push('Overexposed');

  if (Math.abs(a.yaw) > L.yawHard) blockers.push('Head turned too far');
  else if (Math.abs(a.yaw) > L.yawSoft) warnings.push('Head turned - face the camera');

  if (stats.sharpness < L.blurSoft) warnings.push('Image looks blurry');

  return {
    facePx: a.side,
    rollDeg: a.rollDeg,
    yaw: a.yaw,
    brightness: stats.brightness,
    sharpness: stats.sharpness,
    warnings,
    blockers,
  };
}
