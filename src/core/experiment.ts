import type { EmotionId, PlayId } from './emotions';
import { SessionRecorder, SessionSummary } from './analytics';
import type { FrameSnapshot } from './types';

export interface ProtocolStep {
  /** Expression the participant is asked to make. */
  target: EmotionId | PlayId;
  holdSeconds: number;
}

/** Seconds at the start of each step that are excluded so the participant can move into the pose. */
export const SETTLE_SECONDS = 2;

export const DEFAULT_PROTOCOL: ProtocolStep[] = (
  ['neutral', 'happiness', 'surprise', 'sadness', 'anger', 'fear', 'disgust', 'geeked', 'wink'] as (EmotionId | PlayId)[]
).map((target) => ({ target, holdSeconds: 8 }));

export type ExperimentMode = 'free' | 'guided';

export interface ExperimentReport {
  title: string;
  mode: ExperimentMode;
  protocol: ProtocolStep[] | null;
  settleSeconds: number;
  summary: SessionSummary;
  /** Compact timeline kept for charts and CSV export. */
  timeline: SessionRecorder['timeline'];
  generatedAtIso: string;
  model: string;
  settings: Record<string, number | boolean | string>;
}

export interface ExperimentState {
  phase: 'idle' | 'running' | 'finished';
  mode: ExperimentMode;
  elapsedMs: number;
  stepIndex: number;
  stepElapsedMs: number;
  /** True while the participant is still moving into the instructed pose. */
  settling: boolean;
}

/**
 * Controlled session: the participant starts and stops a recording, optionally following
 * a timed protocol that tells them which expression to make. Only numbers are recorded.
 */
export class Experiment {
  private rec: SessionRecorder | null = null;
  private protocol: ProtocolStep[] | null = null;
  private mode: ExperimentMode = 'free';
  private startedAt = 0;
  private stepStarts: number[] = [];
  private finishedReport: ExperimentReport | null = null;
  private phase: ExperimentState['phase'] = 'idle';
  private lastElapsed = 0;
  private meta: { model: string; settings: ExperimentReport['settings'] } = { model: '', settings: {} };

  get recorder(): SessionRecorder | null {
    return this.rec;
  }

  get report(): ExperimentReport | null {
    return this.finishedReport;
  }

  start(mode: ExperimentMode, protocol: ProtocolStep[], meta: { model: string; settings: ExperimentReport['settings'] }): void {
    this.meta = meta;
    this.mode = mode;
    this.protocol = mode === 'guided' ? protocol : null;
    this.rec = new SessionRecorder();
    this.finishedReport = null;
    this.startedAt = performance.now();
    this.phase = 'running';
    this.lastElapsed = 0;
    this.stepStarts = [];
    let acc = 0;
    for (const s of protocol) {
      this.stepStarts.push(acc);
      acc += s.holdSeconds * 1000;
    }
  }

  private totalProtocolMs(): number {
    return this.protocol ? this.protocol.reduce((a, s) => a + s.holdSeconds * 1000, 0) : Infinity;
  }

  state(now = performance.now()): ExperimentState {
    const elapsed = this.phase === 'running' ? now - this.startedAt : this.lastElapsed;
    let stepIndex = -1;
    let stepElapsed = 0;
    if (this.protocol) {
      for (let i = 0; i < this.protocol.length; i++) {
        if (elapsed >= this.stepStarts[i]) {
          stepIndex = i;
          stepElapsed = elapsed - this.stepStarts[i];
        }
      }
    }
    return {
      phase: this.phase,
      mode: this.mode,
      elapsedMs: elapsed,
      stepIndex,
      stepElapsedMs: stepElapsed,
      settling: this.protocol !== null && stepElapsed < SETTLE_SECONDS * 1000,
    };
  }

  /** Feed one frame. Returns true when a guided protocol has just completed. */
  push(s: FrameSnapshot): boolean {
    if (this.phase !== 'running' || !this.rec) return false;
    const st = this.state(s.t);
    this.lastElapsed = st.elapsedMs;
    let instructed: EmotionId | PlayId | null = null;
    if (this.protocol && st.stepIndex >= 0 && !st.settling) instructed = this.protocol[st.stepIndex].target;
    this.rec.push(s, instructed);
    if (this.protocol && st.elapsedMs >= this.totalProtocolMs()) {
      this.stop();
      return true;
    }
    return false;
  }

  stop(): ExperimentReport | null {
    if (this.phase !== 'running' || !this.rec) return null;
    this.phase = 'finished';
    this.finishedReport = {
      title: this.mode === 'guided' ? 'EmotiVision guided session' : 'EmotiVision free session',
      mode: this.mode,
      protocol: this.protocol,
      settleSeconds: SETTLE_SECONDS,
      summary: this.rec.summary(),
      timeline: this.rec.timeline,
      generatedAtIso: new Date().toISOString(),
      model: this.meta.model,
      settings: this.meta.settings,
    };
    return this.finishedReport;
  }

  reset(): void {
    this.rec = null;
    this.protocol = null;
    this.finishedReport = null;
    this.phase = 'idle';
    this.lastElapsed = 0;
  }
}
