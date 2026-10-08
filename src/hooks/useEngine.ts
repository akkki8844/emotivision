import { useEffect, useMemo, useState } from 'react';
import { Engine, type CameraStatus, type ModelStatus } from '../core/engine';
import type { FrameSnapshot } from '../core/types';

let shared: Engine | null = null;
/** One engine per page; created lazily so SSR/tests never touch the DOM. */
export function getEngine(): Engine {
  if (!shared) {
    shared = new Engine();
    // Developer hook for benchmarking from the console: open the app with ?debug
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __emotivision: Engine }).__emotivision = shared;
  }
  return shared;
}

export function useEngine() {
  const engine = useMemo(getEngine, []);
  const [model, setModel] = useState<ModelStatus>(engine.modelState);
  const [camera, setCamera] = useState<CameraStatus>(engine.cameraState);

  useEffect(() => {
    const a = engine.modelStatus.on(setModel);
    const b = engine.cameraStatus.on(setCamera);
    return () => {
      a();
      b();
    };
  }, [engine]);

  return { engine, model, camera };
}

/** Throttled view of the latest frame for React (the overlay reads engine.last directly at full rate). */
export function useSnapshot(engine: Engine, hz = 8): FrameSnapshot {
  const [snap, setSnap] = useState<FrameSnapshot>(engine.last);
  useEffect(() => {
    const id = setInterval(() => setSnap(engine.last), 1000 / hz);
    return () => clearInterval(id);
  }, [engine, hz]);
  return snap;
}

/** Polls a cheap getter at a fixed rate. */
export function usePoll<T>(get: () => T, ms = 250): T {
  const [v, setV] = useState<T>(get);
  useEffect(() => {
    const id = setInterval(() => setV(get()), ms);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms]);
  return v;
}
