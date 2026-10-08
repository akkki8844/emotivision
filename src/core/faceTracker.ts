import type { FaceObservation } from './types';

/**
 * Face detection + 468-point landmarking using the official MediaPipe Face Mesh
 * solution (BlazeFace detector + face-landmark network, run locally in WebAssembly).
 * The runtime and its model files are served from /mediapipe/face_mesh (see scripts/fetch-assets.mjs),
 * so no request leaves the device.
 */

type ImageSource = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;

interface FaceMeshResults {
  multiFaceLandmarks?: { x: number; y: number; z: number }[][];
}

interface FaceMeshInstance {
  setOptions(o: Record<string, unknown>): void;
  onResults(cb: (r: FaceMeshResults) => void): void;
  initialize(): Promise<void>;
  send(input: { image: ImageSource }): Promise<void>;
  close(): Promise<void>;
}

declare global {
  interface Window {
    FaceMesh?: new (cfg: { locateFile: (file: string) => string }) => FaceMeshInstance;
  }
}

const BASE = '/mediapipe/face_mesh';

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.FaceMesh) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Could not load ${src}. Did you run "npm run setup"?`));
    document.head.appendChild(s);
  });
}

export class FaceTracker {
  private latest: FaceMeshResults | null = null;
  private staticMode = false;

  private constructor(private readonly mesh: FaceMeshInstance) {
    mesh.onResults((r) => {
      this.latest = r;
    });
  }

  static async create(): Promise<FaceTracker> {
    await loadScript(`${BASE}/face_mesh.js`);
    if (!window.FaceMesh) throw new Error('MediaPipe Face Mesh failed to initialise.');
    const mesh = new window.FaceMesh({ locateFile: (f) => `${BASE}/${f}` });
    mesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: false, // true adds iris points but made detection of some still photos fail in testing // 478 points: adds iris centres and sharper lips/eyes
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
      staticImageMode: false,
      selfieMode: false,
    });
    await mesh.initialize();
    return new FaceTracker(mesh);
  }

  /** Static mode re-runs detection on every image (used for unrelated images in the evaluation lab). */
  setStaticMode(on: boolean): void {
    if (on === this.staticMode) return;
    this.staticMode = on;
    this.mesh.setOptions({ staticImageMode: on });
  }

  /** Returns landmarks in source pixel coordinates, or null when no face is found. */
  async detect(source: ImageSource, width: number, height: number): Promise<FaceObservation | null> {
    this.latest = null;
    await this.mesh.send({ image: source });
    const results = this.latest as FaceMeshResults | null; // set by onResults during send()
    const lm = results?.multiFaceLandmarks?.[0];
    if (!lm || lm.length < 468) return null;
    return {
      landmarks: lm.map((p) => ({ x: p.x * width, y: p.y * height })),
      frameW: width,
      frameH: height,
    };
  }

  async dispose(): Promise<void> {
    await this.mesh.close();
  }
}
