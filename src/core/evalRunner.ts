import { EmotionId, MODEL_CLASSES } from './emotions';
import { computeMetrics, labelFromPath, Metrics, restrictedArgmax } from './evaluation';
import type { ExpressionPipeline } from './pipeline';

export interface EvalOptions {
  datasetName: string;
  /** "detect": run the full pipeline (face detection + alignment). "cropped": images are already face crops. */
  mode: 'detect' | 'cropped';
  /** Only allow predictions among classes that exist in the dataset (e.g. ignore "contempt" for 7-class sets). */
  restrictToDatasetClasses: boolean;
  /** Cap per class (0 = no cap). Selection is a seeded shuffle so a run is reproducible. */
  maxPerClass: number;
  seed: number;
}

export interface EvalError {
  path: string;
  truth: EmotionId;
  pred: EmotionId;
  confidence: number;
}

export interface EvalRun {
  options: EvalOptions;
  startedAtIso: string;
  seconds: number;
  filesSeen: number;
  skippedUnlabelled: number;
  unknownFolders: string[];
  /** Images where the face detector found nothing (only in "detect" mode). */
  noFace: Record<string, number>;
  unreadable: number;
  evaluated: number;
  metrics: Metrics;
  meanConfidenceCorrect: number | null;
  meanConfidenceWrong: number | null;
  /** Most confident wrong predictions (paths only; no pixels are kept). */
  topErrors: EvalError[];
}

export interface EvalFile {
  file: File;
  path: string;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function loadImage(file: File): Promise<HTMLImageElement | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function runEvaluation(
  pipeline: ExpressionPipeline,
  files: EvalFile[],
  opts: EvalOptions,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<EvalRun> {
  const t0 = performance.now();
  const imageExt = /\.(png|jpe?g|webp|bmp)$/i;

  const labelled: { f: EvalFile; truth: EmotionId }[] = [];
  const unknown = new Set<string>();
  let skipped = 0;
  let seen = 0;
  for (const f of files) {
    if (!imageExt.test(f.path)) continue;
    seen++;
    const truth = labelFromPath(f.path);
    if (!truth) {
      skipped++;
      const parts = f.path.split(/[\\/]/);
      unknown.add(parts.length > 1 ? parts[parts.length - 2] : '(root)');
    } else labelled.push({ f, truth });
  }

  // Seeded, reproducible cap per class.
  const rnd = mulberry32(opts.seed);
  const byClass = new Map<EmotionId, typeof labelled>();
  for (const l of labelled) byClass.set(l.truth, [...(byClass.get(l.truth) ?? []), l]);
  const chosen: typeof labelled = [];
  for (const cls of MODEL_CLASSES) {
    const arr = (byClass.get(cls) ?? []).sort((a, b) => a.f.path.localeCompare(b.f.path));
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    chosen.push(...(opts.maxPerClass > 0 ? arr.slice(0, opts.maxPerClass) : arr));
  }

  const datasetClasses = MODEL_CLASSES.filter((c) => byClass.has(c));
  const allowed: EmotionId[] = opts.restrictToDatasetClasses ? [...datasetClasses] : [...MODEL_CLASSES];
  const matrixClasses = opts.restrictToDatasetClasses ? datasetClasses : [...MODEL_CLASSES];

  const noFace: Record<string, number> = {};
  const preds: { truth: EmotionId; pred: EmotionId }[] = [];
  const errors: EvalError[] = [];
  let unreadable = 0;
  let sumOk = 0;
  let nOk = 0;
  let sumBad = 0;
  let nBad = 0;

  pipeline.setStatic(true);
  try {
    for (let i = 0; i < chosen.length; i++) {
      if (signal.aborted) break;
      const { f, truth } = chosen[i];
      const img = await loadImage(f.file);
      if (!img) {
        unreadable++;
      } else {
        const res = await pipeline.classifyImage(img, opts.mode);
        if (!res) {
          noFace[truth] = (noFace[truth] ?? 0) + 1;
        } else {
          const pred = restrictedArgmax(res.probs, allowed);
          const conf = res.probs[MODEL_CLASSES.indexOf(pred)];
          preds.push({ truth, pred });
          if (pred === truth) {
            sumOk += conf;
            nOk++;
          } else {
            sumBad += conf;
            nBad++;
            errors.push({ path: f.path, truth, pred, confidence: conf });
          }
        }
      }
      onProgress(i + 1, chosen.length);
      if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
    }
  } finally {
    pipeline.setStatic(false);
  }

  errors.sort((a, b) => b.confidence - a.confidence);
  return {
    options: opts,
    startedAtIso: new Date().toISOString(),
    seconds: (performance.now() - t0) / 1000,
    filesSeen: seen,
    skippedUnlabelled: skipped,
    unknownFolders: [...unknown].sort(),
    noFace,
    unreadable,
    evaluated: preds.length,
    metrics: computeMetrics(matrixClasses, preds),
    meanConfidenceCorrect: nOk ? sumOk / nOk : null,
    meanConfidenceWrong: nBad ? sumBad / nBad : null,
    topErrors: errors.slice(0, 20),
  };
}
