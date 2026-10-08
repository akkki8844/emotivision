import { SessionRecorder } from './analytics';
import { Camera, CameraError, CameraInfo } from './camera';
import { Experiment } from './experiment';
import { ExpressionModel, MODEL_FACTS, ModelRuntimeInfo } from './expressionModel';
import { FaceTracker } from './faceTracker';
import { ExpressionPipeline } from './pipeline';
import { emptyDecision } from './temporal';
import type { FrameSnapshot } from './types';

export type ModelStatus =
  | { state: 'idle' }
  | { state: 'loading'; step: string }
  | { state: 'ready'; runtime: ModelRuntimeInfo; loadMs: number }
  | { state: 'error'; message: string };

export type CameraStatus =
  | { state: 'off' }
  | { state: 'starting' }
  | { state: 'on'; info: CameraInfo }
  | { state: 'error'; message: string; code: CameraError['code'] };

type Listener<T> = (v: T) => void;

class Emitter<T> {
  private ls = new Set<Listener<T>>();
  on(l: Listener<T>): () => void {
    this.ls.add(l);
    return () => this.ls.delete(l);
  }
  emit(v: T): void {
    this.ls.forEach((l) => l(v));
  }
}

const NO_FACE: FrameSnapshot = {
  t: 0,
  faceFound: false,
  box: null,
  landmarks: null,
  quality: null,
  decision: emptyDecision('no-face'),
  play: null,
  rawProbs: null,
  timings: null,
  fps: 0,
};

/**
 * Owns the camera, the models and the processing loop, and publishes results.
 * UI code subscribes; it never touches pixels.
 */
export class Engine {
  readonly video = document.createElement('video');
  readonly camera = new Camera(this.video);
  readonly experiment = new Experiment();
  live = new SessionRecorder();

  readonly frames = new Emitter<FrameSnapshot>();
  readonly modelStatus = new Emitter<ModelStatus>();
  readonly cameraStatus = new Emitter<CameraStatus>();
  readonly experimentEvents = new Emitter<'finished'>();

  modelState: ModelStatus = { state: 'idle' };
  cameraState: CameraStatus = { state: 'off' };
  last: FrameSnapshot = NO_FACE;

  pipeline: ExpressionPipeline | null = null;
  private running = false;
  private paused = false;
  private busy = false;
  private pending = 0;
  private finishing: Promise<void> = Promise.resolve();
  private frameTimes: number[] = [];
  private loadPromise: Promise<void> | null = null;

  constructor() {
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
  }

  private setModel(s: ModelStatus): void {
    this.modelState = s;
    this.modelStatus.emit(s);
  }

  private setCamera(s: CameraStatus): void {
    this.cameraState = s;
    this.cameraStatus.emit(s);
  }

  /** Load detector + expression model (once). Safe to call repeatedly. */
  loadModels(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      const t0 = performance.now();
      try {
        this.setModel({ state: 'loading', step: 'Loading face detector' });
        const tracker = await FaceTracker.create();
        this.setModel({ state: 'loading', step: `Loading ${MODEL_FACTS.name}` });
        const model = await ExpressionModel.load();
        this.setModel({ state: 'loading', step: 'Warming up' });
        await model.warmUp();
        this.pipeline = new ExpressionPipeline(tracker, model);
        this.setModel({ state: 'ready', runtime: model.runtime, loadMs: performance.now() - t0 });
      } catch (e) {
        this.loadPromise = null;
        this.setModel({ state: 'error', message: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    })();
    this.loadPromise.catch(() => undefined);
    return this.loadPromise;
  }

  async startCamera(deviceId?: string): Promise<void> {
    this.setCamera({ state: 'starting' });
    try {
      const info = await this.camera.start(deviceId);
      this.setCamera({ state: 'on', info });
    } catch (e) {
      const err = e instanceof CameraError ? e : new CameraError(String(e), 'unknown');
      this.setCamera({ state: 'error', message: err.message, code: err.code });
      throw err;
    }
    await this.loadModels();
    this.resetLive();
    this.startLoop();
  }

  stopCamera(): void {
    this.running = false;
    if (this.experiment.state().phase === 'running') {
      this.experiment.stop();
      this.experimentEvents.emit('finished');
    }
    this.camera.stop();
    this.pipeline?.resetTemporal();
    this.last = NO_FACE;
    this.frames.emit(NO_FACE);
    this.setCamera({ state: 'off' });
  }

  setPaused(p: boolean): void {
    this.paused = p;
    if (!p && this.running) this.schedule();
  }

  resetLive(): void {
    this.live = new SessionRecorder();
    this.pipeline?.resetTemporal();
  }

  private startLoop(): void {
    if (this.running) return;
    this.running = true;
    this.frameTimes = [];
    this.schedule();
  }

  private schedule(): void {
    const v = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    const next = () => void this.tick();
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(next);
    else requestAnimationFrame(next);
  }

  private fps(now: number): number {
    this.frameTimes.push(now);
    while (this.frameTimes.length && now - this.frameTimes[0] > 1000) this.frameTimes.shift();
    if (this.frameTimes.length < 2) return 0;
    return ((this.frameTimes.length - 1) * 1000) / (now - this.frameTimes[0]);
  }

  private async tick(): Promise<void> {
    if (!this.running || this.paused) return;
    if (this.busy || this.pending >= 2 || !this.pipeline || this.video.readyState < 2 || !this.video.videoWidth) {
      this.schedule();
      return;
    }
    this.busy = true;
    const pipeline = this.pipeline;
    try {
      // Stage 1 (detection) of this frame overlaps stage 2 (model) of the previous one.
      const prepared = await pipeline.prepare(this.video);
      this.pending++;
      const previous = this.finishing;
      this.finishing = (async () => {
        await previous;
        try {
          const snap = await pipeline.finish(prepared, this.fps(performance.now()));
          this.last = snap;
          this.live.push(snap);
          if (this.experiment.push(snap)) this.experimentEvents.emit('finished');
          this.frames.emit(snap);
        } catch (e) {
          console.error('Frame processing failed', e);
        } finally {
          this.pending--;
        }
      })();
    } catch (e) {
      console.error('Frame detection failed', e);
    } finally {
      this.busy = false;
      if (this.running && !this.paused) this.schedule();
    }
  }
}
