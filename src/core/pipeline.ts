import { Alignment, assessQuality, computeAlignment, CROP_SIZE, drawAlignedCrop, imageStats, landmarkBox } from './alignment';
import type { ExpressionModel } from './expressionModel';
import type { FaceTracker } from './faceTracker';
import { DEFAULT_TEMPORAL, TemporalSmoother } from './temporal';
import type { FrameSnapshot, NormBox, Point, QualityReport } from './types';
import { argmax } from './emotions';
import { computePlayFeatures, PlayDetector, scoreFeatures } from './play';

export interface PipelineSettings {
  /** Face-crop margin multiplier around the landmark bounding square. */
  cropMargin: number;
  /** Rotate the crop so the eyes are level. */
  align: boolean;
}

export interface PreparedFrame {
  t0: number;
  t1: number;
  W: number;
  H: number;
  face: { landmarks: Point[]; align: Alignment; pixels: Uint8ClampedArray; quality: QualityReport } | null;
}

export const DEFAULT_SETTINGS: PipelineSettings = { cropMargin: 1.15, align: true };

/**
 * One full pass of the vision pipeline for a single frame:
 *   frame -> face detection/landmarks -> alignment crop -> expression model -> temporal smoothing
 */
export class ExpressionPipeline {
  readonly smoother = new TemporalSmoother({ ...DEFAULT_TEMPORAL });
  readonly play = new PlayDetector();
  settings: PipelineSettings = { ...DEFAULT_SETTINGS };
  /** The aligned 224x224 crop that was last fed to the model (shown in the UI as "what the model sees"). */
  readonly cropCanvas: HTMLCanvasElement;
  private readonly cropCtx: CanvasRenderingContext2D;

  constructor(
    private readonly tracker: FaceTracker,
    private readonly model: ExpressionModel,
  ) {
    this.cropCanvas = document.createElement('canvas');
    this.cropCanvas.width = CROP_SIZE;
    this.cropCanvas.height = CROP_SIZE;
    const ctx = this.cropCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas is not available.');
    this.cropCtx = ctx;
  }

  /**
   * Stage 1 (detection, alignment, quality probes). Safe to start for frame N+1 while stage 2 of frame N
   * is still waiting on the model, because it only reads the video and copies the crop pixels out.
   */
  async prepare(video: HTMLVideoElement): Promise<PreparedFrame> {
    const t0 = performance.now();
    const W = video.videoWidth;
    const H = video.videoHeight;
    const face = await this.tracker.detect(video, W, H);
    const t1 = performance.now();
    if (!face) return { t0, t1, W, H, face: null };

    const align = computeAlignment(face.landmarks, this.settings.cropMargin, this.settings.align);
    drawAlignedCrop(this.cropCtx, video, align);
    const pixels = this.cropCtx.getImageData(0, 0, CROP_SIZE, CROP_SIZE).data;
    const quality = assessQuality(align, imageStats(pixels, CROP_SIZE));
    return { t0, t1, W, H, face: { landmarks: face.landmarks, align, pixels, quality } };
  }

  /** Stage 2 (model, temporal smoothing, extras). Must be called in frame order. */
  async finish(p: PreparedFrame, fps: number): Promise<FrameSnapshot> {
    const { t0, t1, W, H } = p;
    if (!p.face) {
      const decision = this.smoother.update(t0, null);
      if (decision.status === 'no-face') this.play.reset();
      return {
        t: t0,
        faceFound: false,
        box: null,
        landmarks: null,
        quality: null,
        decision,
        play: null,
        rawProbs: null,
        timings: { detectMs: t1 - t0, preprocessMs: 0, inferMs: 0, totalMs: t1 - t0 },
        fps,
      };
    }
    const { landmarks: lm, align, pixels, quality } = p.face;
    const out = await this.model.classify(pixels);
    const blocked = quality.blockers.length > 0;
    const decision = this.smoother.update(t0, out, quality.blockers);
    const play = this.play.update(t0, computePlayFeatures(lm, align, pixels), blocked);
    const t2 = performance.now();

    const b = landmarkBox(lm);
    const box: NormBox = { x: b.x / W, y: b.y / H, w: b.w / W, h: b.h / H };
    const landmarks: Point[] = lm.map((q) => ({ x: q.x / W, y: q.y / H }));
    return {
      t: t0,
      faceFound: true,
      box,
      landmarks,
      quality,
      decision,
      play,
      rawProbs: out.probs,
      timings: { detectMs: t1 - t0, preprocessMs: out.preprocessMs, inferMs: out.inferMs, totalMs: t2 - t0 },
      fps,
    };
  }

  /**
   * Stateless single-image classification used by the evaluation lab: no temporal smoothing,
   * no quality gating (the lab reports detector misses separately).
   */
  async classifyImage(
    source: HTMLImageElement | HTMLCanvasElement,
    mode: 'detect' | 'cropped',
  ): Promise<{ probs: number[]; top: number } | null> {
    const w = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const h = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    if (mode === 'cropped') {
      this.cropCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.cropCtx.imageSmoothingQuality = 'high';
      this.cropCtx.drawImage(source, 0, 0, w, h, 0, 0, CROP_SIZE, CROP_SIZE);
    } else {
      const face = await this.tracker.detect(source, w, h);
      if (!face) return null;
      drawAlignedCrop(this.cropCtx, source, computeAlignment(face.landmarks, this.settings.cropMargin, this.settings.align));
    }
    const pixels = this.cropCtx.getImageData(0, 0, CROP_SIZE, CROP_SIZE).data;
    const { probs } = await this.model.classify(pixels);
    return { probs, top: argmax(probs) };
  }

  /** Developer probe: full single-image analysis incl. valence/arousal and extras features (no temporal state). */
  async probeImage(source: HTMLImageElement | HTMLCanvasElement) {
    const w = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const h = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    this.tracker.setStaticMode(true);
    try {
      const face = await this.tracker.detect(source, w, h);
      if (!face) return null;
      const align = computeAlignment(face.landmarks, this.settings.cropMargin, this.settings.align);
      drawAlignedCrop(this.cropCtx, source, align);
      const pixels = this.cropCtx.getImageData(0, 0, CROP_SIZE, CROP_SIZE).data;
      const out = await this.model.classify(pixels);
      const features = computePlayFeatures(face.landmarks, align, pixels);
      return { ...out, landmarks: face.landmarks, features, scores: scoreFeatures(features), quality: assessQuality(align, imageStats(pixels, CROP_SIZE)) };
    } finally {
      this.tracker.setStaticMode(false);
    }
  }

  setStatic(on: boolean): void {
    this.tracker.setStaticMode(on);
  }

  resetTemporal(): void {
    this.smoother.reset();
    this.play.reset();
  }
}
