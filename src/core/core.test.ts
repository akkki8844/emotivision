import { describe, expect, it } from 'vitest';
import { computeAlignment, LM } from './alignment';
import { affectRegion, MODEL_CLASSES, normalisedEntropy, softmax } from './emotions';
import { PlayDetector, scoreFeatures } from './play';
import { computeMetrics, labelFromPath, restrictedArgmax } from './evaluation';
import { DEFAULT_TEMPORAL, TemporalSmoother } from './temporal';
import { confidenceStats } from './analytics';
import type { Point } from './types';

const onehot = (i: number, p = 0.9): number[] => {
  const rest = (1 - p) / (MODEL_CLASSES.length - 1);
  return MODEL_CLASSES.map((_, j) => (j === i ? p : rest));
};
const obs = (probs: number[]) => ({ probs, valence: 0.3, arousal: 0.1 });
const HAPPY = MODEL_CLASSES.indexOf('happiness');
const SAD = MODEL_CLASSES.indexOf('sadness');

describe('softmax / entropy', () => {
  it('sums to 1 and is stable for large logits', () => {
    const p = softmax([1000, 1001, 999]);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(p[1]).toBeGreaterThan(p[0]);
  });
  it('entropy is 0 for certain and 1 for uniform', () => {
    expect(normalisedEntropy([1, 0, 0, 0])).toBeCloseTo(0, 10);
    expect(normalisedEntropy([0.25, 0.25, 0.25, 0.25])).toBeCloseTo(1, 10);
  });
});

describe('TemporalSmoother', () => {
  it('warms up, then reports a confident label', () => {
    const s = new TemporalSmoother({ ...DEFAULT_TEMPORAL });
    let d = s.update(0, obs(onehot(HAPPY)));
    expect(d.status).toBe('warming');
    for (let i = 1; i < 10; i++) d = s.update(i * 33, obs(onehot(HAPPY)));
    expect(d.status).toBe('confident');
    expect(d.label).toBe('happiness');
    expect(d.stability).toBe(1);
  });

  it('does not flip on a single outlier frame', () => {
    const s = new TemporalSmoother({ ...DEFAULT_TEMPORAL });
    let t = 0;
    for (let i = 0; i < 15; i++) s.update((t += 33), obs(onehot(HAPPY)));
    const d = s.update((t += 33), obs(onehot(SAD)));
    expect(d.leading).toBe('happiness');
    expect(d.stability).toBeLessThan(1);
  });

  it('switches label after sustained change', () => {
    const s = new TemporalSmoother({ ...DEFAULT_TEMPORAL });
    let t = 0;
    for (let i = 0; i < 15; i++) s.update((t += 33), obs(onehot(HAPPY)));
    let d = s.update((t += 33), obs(onehot(SAD)));
    for (let i = 0; i < 30; i++) d = s.update((t += 33), obs(onehot(SAD)));
    expect(d.label).toBe('sadness');
  });

  it('reports uncertain for a flat distribution instead of forcing a label', () => {
    const s = new TemporalSmoother({ ...DEFAULT_TEMPORAL });
    const flat = new Array(MODEL_CLASSES.length).fill(1 / MODEL_CLASSES.length);
    let d = s.update(0, obs(flat));
    for (let i = 1; i < 10; i++) d = s.update(i * 33, obs(flat));
    expect(d.status).toBe('uncertain');
    expect(d.label).toBeNull();
    expect(d.reasons.length).toBeGreaterThan(0);
  });

  it('hard gates force uncertain even when the model is confident', () => {
    const s = new TemporalSmoother({ ...DEFAULT_TEMPORAL });
    let d = s.update(0, obs(onehot(HAPPY)), ['Too dark']);
    for (let i = 1; i < 10; i++) d = s.update(i * 33, obs(onehot(HAPPY)), ['Too dark']);
    expect(d.status).toBe('uncertain');
    expect(d.reasons).toContain('Too dark');
  });

  it('holds through a brief face loss and resets after the grace period', () => {
    const s = new TemporalSmoother({ ...DEFAULT_TEMPORAL });
    let t = 0;
    for (let i = 0; i < 10; i++) s.update((t += 33), obs(onehot(HAPPY)));
    expect(s.update((t += 100), null).status).toBe('confident');
    expect(s.update((t += 900), null).status).toBe('no-face');
    // state is cleared: warming again
    expect(s.update((t += 33), obs(onehot(HAPPY))).status).toBe('warming');
  });
});

describe('alignment', () => {
  const synthetic = (rollRad: number, scale = 100, cx = 500, cy = 400): Point[] => {
    // A fake 468-point "face": eyes at +-0.3 scale, everything else in a ring.
    const pts: Point[] = Array.from({ length: 468 }, (_, i) => {
      const a = (i / 468) * Math.PI * 2;
      return { x: Math.cos(a) * scale * 0.8, y: Math.sin(a) * scale * 1.0 };
    });
    pts[LM.rightEyeOuter] = { x: -0.4 * scale, y: -0.2 * scale };
    pts[LM.rightEyeInner] = { x: -0.2 * scale, y: -0.2 * scale };
    pts[LM.leftEyeInner] = { x: 0.2 * scale, y: -0.2 * scale };
    pts[LM.leftEyeOuter] = { x: 0.4 * scale, y: -0.2 * scale };
    pts[LM.noseTip] = { x: 0, y: 0 };
    pts[LM.cheekImageLeft] = { x: -0.8 * scale, y: 0 };
    pts[LM.cheekImageRight] = { x: 0.8 * scale, y: 0 };
    const c = Math.cos(rollRad);
    const s = Math.sin(rollRad);
    return pts.map((p) => ({ x: cx + p.x * c - p.y * s, y: cy + p.x * s + p.y * c }));
  };

  it('recovers head roll from the eye line', () => {
    for (const deg of [-25, -5, 0, 10, 30]) {
      const a = computeAlignment(synthetic((deg * Math.PI) / 180), 1.1);
      expect(a.rollDeg).toBeCloseTo(deg, 4);
    }
  });

  it('crop side scales with the face and margin', () => {
    const small = computeAlignment(synthetic(0, 50), 1.0);
    const big = computeAlignment(synthetic(0, 100), 1.0);
    expect(big.side / small.side).toBeCloseTo(2, 5);
    expect(computeAlignment(synthetic(0, 100), 1.2).side / big.side).toBeCloseTo(1.2, 5);
  });

  it('yaw proxy is ~0 for a frontal face', () => {
    expect(Math.abs(computeAlignment(synthetic(0.2), 1.1).yaw)).toBeLessThan(1e-9);
  });

  it('can disable alignment', () => {
    expect(computeAlignment(synthetic(0.5), 1.1, false).theta).toBe(0);
  });
});

describe('metrics', () => {
  it('matches a hand-computed confusion matrix', () => {
    // truth: A A A A B B C ; pred: A A B A B A C
    const classes = ['anger', 'happiness', 'sadness'] as const;
    const A = 'anger';
    const B = 'happiness';
    const C = 'sadness';
    const m = computeMetrics(
      [...classes],
      [
        { truth: A, pred: A },
        { truth: A, pred: A },
        { truth: A, pred: B },
        { truth: A, pred: A },
        { truth: B, pred: B },
        { truth: B, pred: A },
        { truth: C, pred: C },
      ],
    );
    expect(m.n).toBe(7);
    expect(m.accuracy).toBeCloseTo(5 / 7, 10);
    expect(m.confusion).toEqual([
      [3, 1, 0],
      [1, 1, 0],
      [0, 0, 1],
    ]);
    const a = m.perClass[0];
    expect(a.precision).toBeCloseTo(3 / 4, 10);
    expect(a.recall).toBeCloseTo(3 / 4, 10);
    expect(a.fp).toBe(1);
    expect(a.fn).toBe(1);
    expect(m.perClass[1].f1).toBeCloseTo(0.5, 10);
    expect(m.macroF1).toBeCloseTo((0.75 + 0.5 + 1) / 3, 10);
  });

  it('uses null, not 0, for undefined precision', () => {
    const m = computeMetrics(['anger', 'neutral'], [{ truth: 'anger', pred: 'anger' }]);
    expect(m.perClass[1].precision).toBeNull();
    expect(m.perClass[1].recall).toBeNull();
  });
});

describe('dataset labels', () => {
  it('maps common folder names', () => {
    expect(labelFromPath('test/happy/img1.png')).toBe('happiness');
    expect(labelFromPath('FER/Angry/a.jpg')).toBe('anger');
    expect(labelFromPath('x/surprise/y/z.png')).toBe('surprise');
    expect(labelFromPath('x/7/z.png')).toBeNull();
  });
  it('restricts argmax to allowed classes', () => {
    const p = onehot(MODEL_CLASSES.indexOf('contempt'));
    expect(restrictedArgmax(p, ['anger', 'neutral'])).not.toBe('contempt');
  });
});

describe('confidenceStats', () => {
  it('computes summary statistics', () => {
    const s = confidenceStats([0.2, 0.4, 0.6, 0.8, 1.0])!;
    expect(s.mean).toBeCloseTo(0.6, 10);
    expect(s.median).toBeCloseTo(0.6, 10);
    expect(s.min).toBe(0.2);
    expect(s.max).toBe(1.0);
  });
  it('returns null for empty input', () => {
    expect(confidenceStats([])).toBeNull();
  });
});

describe('extras (rule-based) scoring', () => {
  const base = {
    tongueArea: 0, earLeft: 0.3, earRight: 0.3, mouthOpen: 0.15,
    mouthWidth: 0.38, mouthShift: 0.01, mouthTilt: 0, browAsym: 0.05,
  };
  it('scores nothing on a neutral face', () => {
    const s = scoreFeatures(base);
    expect(s.geeked).toBe(0);
    expect(s.wink).toBe(0);
    expect(s.kiss).toBe(0);
  });
  it('a tongue triggers geeked', () => {
    expect(scoreFeatures({ ...base, tongueArea: 1 }).geeked).toBe(1);
  });
  it('one lopsided feature alone is normal, several together are geeked', () => {
    expect(scoreFeatures({ ...base, mouthShift: 0.12 }).geeked).toBe(0);
    expect(scoreFeatures({ ...base, mouthShift: 0.12, mouthTilt: 0.32, browAsym: 0.7 }).geeked).toBe(1);
  });
  it('wink needs one closed eye and one open eye, not two closed', () => {
    expect(scoreFeatures({ ...base, earLeft: 0.1, earRight: 0.3 }).wink).toBe(1);
    expect(scoreFeatures({ ...base, earLeft: 0.3, earRight: 0.1 }).wink).toBe(1);
    expect(scoreFeatures({ ...base, earLeft: 0.08, earRight: 0.09 }).wink).toBe(0);
    expect(scoreFeatures({ ...base, earLeft: 0.27, earRight: 0.3 }).wink).toBe(0);
  });
  it('kiss needs narrow, not wide-open, mouth', () => {
    expect(scoreFeatures({ ...base, mouthWidth: 0.23, mouthOpen: 0.1 }).kiss).toBe(1);
    expect(scoreFeatures({ ...base, mouthWidth: 0.23, mouthOpen: 0.7 }).kiss).toBe(0);
  });
});

describe('PlayDetector', () => {
  const neutral = {
    tongueArea: 0, earLeft: 0.3, earRight: 0.3, mouthOpen: 0.15,
    mouthWidth: 0.38, mouthShift: 0.01, mouthTilt: 0, browAsym: 0.05,
  };
  it('needs a sustained signal, then releases with hysteresis', () => {
    const d = new PlayDetector();
    let t = 0;
    let st = d.update((t += 33), neutral);
    expect(st.active).toBeNull();
    for (let i = 0; i < 12; i++) st = d.update((t += 33), { ...neutral, tongueArea: 1 });
    expect(st.active).toBe('geeked');
    for (let i = 0; i < 3; i++) st = d.update((t += 33), neutral);
    expect(st.active).toBe('geeked'); // still held briefly
    for (let i = 0; i < 20; i++) st = d.update((t += 33), neutral);
    expect(st.active).toBeNull();
  });
  it('ignores a one-frame blink-like asymmetry', () => {
    const d = new PlayDetector();
    let t = 0;
    for (let i = 0; i < 5; i++) d.update((t += 33), neutral);
    let st = d.update((t += 33), { ...neutral, earLeft: 0.08 });
    for (let i = 0; i < 5; i++) st = d.update((t += 33), neutral);
    expect(st.active).toBeNull();
  });
  it('sensitivity 0 switches extras off', () => {
    const d = new PlayDetector();
    d.sensitivity = 0;
    let t = 0;
    let st = d.update(t, neutral);
    for (let i = 0; i < 20; i++) st = d.update((t += 33), { ...neutral, tongueArea: 1 });
    expect(st.active).toBeNull();
  });
});

describe('affect regions', () => {
  it('names regions of the valence/arousal plane', () => {
    expect(affectRegion(0, 0)).toBe('Neutral zone');
    expect(affectRegion(0.8, 0.8)).toBe('Excited');
    expect(affectRegion(-0.8, 0.8)).toBe('Tense');
    expect(affectRegion(-0.8, -0.8)).toBe('Gloomy');
    expect(affectRegion(0.8, -0.8)).toBe('Relaxed');
  });
});
