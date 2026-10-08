import * as ort from 'onnxruntime-web/webgpu';
import { NUM_CLASSES, softmax } from './emotions';
import { CROP_SIZE } from './alignment';

export const MODEL_URL = '/models/enet_b0_8_va_mtl.onnx';

/** Static facts about the model. Sourced from the EmotiEffLib repository and README. */
export const MODEL_FACTS = {
  name: 'HSEmotion enet_b0_8_va_mtl',
  architecture: 'EfficientNet-B0 (ImageNet-initialised, pre-trained for face identification on VGGFace2, fine-tuned for expressions)',
  dataset: 'AffectNet (8 expression classes plus continuous valence/arousal labels)',
  classes: 8,
  /** Multi-task head: 8 expression logits followed by valence and arousal (each about -1..1). */
  outputs: '8 expression logits + valence + arousal',
  inputSize: `${CROP_SIZE} x ${CROP_SIZE} RGB`,
  preprocessing: 'Aligned face crop, resize to 224 x 224, scale to 0..1, normalise with ImageNet mean/std, NCHW float32',
  framework: 'ONNX Runtime Web (WebAssembly)',
  location: 'On this device, inside the browser tab',
  fileSizeMB: 16.0,
  source: 'github.com/sb-ai-lab/EmotiEffLib',
  /** Accuracy reported by the model authors for their own AffectNet validation split. NOT measured by this app. */
  reportedAffectNetAcc8: 61.93,
} as const;

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

export interface ModelOutput {
  /** Softmax over the 8 expression classes. */
  probs: number[];
  /** Regressed valence (unpleasant -1 .. pleasant +1). */
  valence: number;
  /** Regressed arousal (calm -1 .. activated +1). */
  arousal: number;
  inferMs: number;
  preprocessMs: number;
}

export interface ModelRuntimeInfo {
  provider: string;
  threads: number;
  simd: boolean;
  crossOriginIsolated: boolean;
  ortVersion: string;
}

export class ExpressionModel {
  private readonly input = new Float32Array(3 * CROP_SIZE * CROP_SIZE);

  private constructor(
    private readonly session: ort.InferenceSession,
    readonly runtime: ModelRuntimeInfo,
  ) {}

  /**
   * WASM (multi-threaded, SIMD) is the default: in testing on an integrated GPU, WebGPU was slower because the
   * face landmarker already uses the same GPU. Opt in with ?backend=webgpu (falls back to WASM if unavailable).
   */
  static async load(): Promise<ExpressionModel> {
    ort.env.wasm.wasmPaths = '/ort/';
    const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
    const threads = isolated ? Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2))) : 1;
    ort.env.wasm.numThreads = threads;

    const res = await fetch(MODEL_URL);
    if (!res.ok) {
      throw new Error(`Model file not found (HTTP ${res.status}). Run "npm run setup" to download it.`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const want = new URLSearchParams(location.search).get('backend');

    const make = async (provider: 'webgpu' | 'wasm') => {
      const session = await ort.InferenceSession.create(bytes, { executionProviders: [provider], graphOptimizationLevel: 'all' });
      const info: ModelRuntimeInfo = {
        provider,
        threads: provider === 'wasm' ? threads : 1,
        simd: true,
        crossOriginIsolated: isolated,
        ortVersion: ort.env.versions.web ?? 'unknown',
      };
      return new ExpressionModel(session, info);
    };

    if (want === 'webgpu' && 'gpu' in navigator) {
      try {
        const adapter = await (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter();
        if (adapter) {
          const m = await make('webgpu');
          await m.warmUp(); // surfaces unsupported-operator errors now rather than mid-session
          return m;
        }
      } catch (e) {
        console.warn('WebGPU backend unavailable, falling back to WASM:', e);
      }
    }
    return make('wasm');
  }

  /** RGBA pixels (CROP_SIZE x CROP_SIZE) to a normalised NCHW float tensor, in place. */
  private fill(rgba: Uint8ClampedArray): void {
    const plane = CROP_SIZE * CROP_SIZE;
    const out = this.input;
    for (let i = 0; i < plane; i++) {
      const j = i * 4;
      out[i] = (rgba[j] / 255 - MEAN[0]) / STD[0];
      out[plane + i] = (rgba[j + 1] / 255 - MEAN[1]) / STD[1];
      out[2 * plane + i] = (rgba[j + 2] / 255 - MEAN[2]) / STD[2];
    }
  }

  /** Classify an aligned RGBA crop. Returns class probabilities in MODEL_CLASSES order. */
  async classify(rgba: Uint8ClampedArray): Promise<ModelOutput> {
    const t0 = performance.now();
    this.fill(rgba);
    const t1 = performance.now();
    const tensor = new ort.Tensor('float32', this.input, [1, 3, CROP_SIZE, CROP_SIZE]);
    const out = await this.session.run({ [this.session.inputNames[0]]: tensor });
    const data = out[this.session.outputNames[0]].data as Float32Array;
    if (data.length !== NUM_CLASSES + 2) {
      throw new Error(`Unexpected model output size ${data.length}, expected ${NUM_CLASSES + 2}`);
    }
    const t2 = performance.now();
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    return {
      probs: softmax(data.subarray(0, NUM_CLASSES)),
      valence: clamp(data[NUM_CLASSES]),
      arousal: clamp(data[NUM_CLASSES + 1]),
      inferMs: t2 - t1,
      preprocessMs: t1 - t0,
    };
  }

  /**
   * Compile kernels / allocate memory with a throw-away zero tensor so the first live frame is not slow.
   * The output is discarded and never shown or recorded.
   */
  async warmUp(): Promise<void> {
    await this.classify(new Uint8ClampedArray(CROP_SIZE * CROP_SIZE * 4));
  }
}
