import { useEffect, useState, type ReactNode } from 'react';
import { colorOf, labelOf } from '../core/emotions';
import type { Engine } from '../core/engine';
import { DEFAULT_PROTOCOL, ExperimentMode, ExperimentReport, SETTLE_SECONDS } from '../core/experiment';
import { MODEL_FACTS } from '../core/expressionModel';
import type { FrameSnapshot } from '../core/types';
import { usePoll } from '../hooks/useEngine';
import { ReportView } from './ReportView';
import { TimelineChart } from './TimelineChart';

interface Props {
  engine: Engine;
  snap: FrameSnapshot;
  cameraOn: boolean;
  settingsSummary: Record<string, number | boolean | string>;
  cameraSlot: ReactNode;
}

function Flow({ engine, snap, instructedLabel }: { engine: Engine; snap: FrameSnapshot; instructedLabel: string | null }) {
  const d = snap.decision;
  const stats = usePoll(() => engine.experiment.recorder?.liveStats() ?? null, 300);
  const play = snap.play?.active ?? null;
  const verdict = play ? labelOf(play) : d.status === 'confident' && d.label ? labelOf(d.label) : d.status === 'uncertain' ? 'Uncertain' : d.status === 'warming' ? 'Analysing' : 'No face';
  const col = play ? colorOf(play) : d.status === 'confident' && d.label ? colorOf(d.label) : '#64748b';
  return (
    <ol className="flow" aria-label="Input to model prediction to confidence to data">
      <li>
        <span className="flow-k">Input</span>
        <b>{instructedLabel ?? 'Your face'}</b>
        <small>{instructedLabel ? 'Instructed pose' : 'Free expression'}</small>
      </li>
      <li className="arrow" aria-hidden="true">&rarr;</li>
      <li>
        <span className="flow-k">Model prediction</span>
        <b style={{ color: col }}>{verdict}</b>
        <small>{MODEL_FACTS.name.split(' ')[1]}</small>
      </li>
      <li className="arrow" aria-hidden="true">&rarr;</li>
      <li>
        <span className="flow-k">Confidence</span>
        <b className="mono">{d.status === 'confident' || d.status === 'uncertain' ? `${(d.confidence * 100).toFixed(0)}%` : '--'}</b>
        <small>smoothed</small>
      </li>
      <li className="arrow" aria-hidden="true">&rarr;</li>
      <li>
        <span className="flow-k">Data</span>
        <b className="mono">{stats ? stats.framesWithFace.toLocaleString() : 0}</b>
        <small>frames with a face</small>
      </li>
    </ol>
  );
}

export function ExperimentPanel({ engine, snap, cameraOn, settingsSummary, cameraSlot }: Props) {
  const [mode, setMode] = useState<ExperimentMode>('guided');
  const [hold, setHold] = useState(8);
  const [report, setReport] = useState<ExperimentReport | null>(engine.experiment.report);
  const st = usePoll(() => engine.experiment.state(), 100);

  useEffect(() => engine.experimentEvents.on(() => setReport(engine.experiment.report)), [engine]);

  const protocol = DEFAULT_PROTOCOL.map((s) => ({ ...s, holdSeconds: hold }));
  const running = st.phase === 'running';
  const step = running && mode === 'guided' && st.stepIndex >= 0 ? protocol[st.stepIndex] : null;
  const total = protocol.length * hold;

  const start = () => {
    setReport(null);
    engine.experiment.start(mode, protocol, { model: MODEL_FACTS.name, settings: settingsSummary });
  };
  const stop = () => {
    setReport(engine.experiment.stop());
  };

  return (
    <div className="exp">
      <div className="exp-top">
      {cameraSlot}
      <section className="panel" aria-label="Experiment controls">
        <h3 className="panel-title">Controlled experiment</h3>
        <p className="muted small">
          Run a session and watch how the model output changes as your visible expression changes. Only numbers are recorded; no video or images are stored.
        </p>
        <Flow engine={engine} snap={snap} instructedLabel={step ? labelOf(step.target) : null} />

        {!running && (
          <div className="exp-setup">
            <div className="seg" role="group" aria-label="Session type">
              <button className={mode === 'guided' ? 'on' : ''} onClick={() => setMode('guided')}>Guided protocol</button>
              <button className={mode === 'free' ? 'on' : ''} onClick={() => setMode('free')}>Free session</button>
            </div>
            {mode === 'guided' ? (
              <>
                <p className="small">
                  You will be asked to hold nine expressions in turn (the seven basic ones plus two playful extras). The first {SETTLE_SECONDS} s of each step are excluded so you can move into the pose.
                  Total {total} s.
                </p>
                <label className="field inline">
                  <span>Hold each for <b className="mono">{hold} s</b></span>
                  <input type="range" min={5} max={15} step={1} value={hold} onChange={(e) => setHold(+e.target.value)} />
                </label>
              </>
            ) : (
              <p className="small">Make any expressions you like. Press Stop when you are done to generate the report.</p>
            )}
            <button className="btn primary" disabled={!cameraOn} onClick={start}>
              Start session
            </button>
            {!cameraOn && <p className="muted small">Start the camera first.</p>}
          </div>
        )}

        {running && (
          <div className="exp-run">
            {step ? (
              <div className="prompt" style={{ borderColor: st.settling ? 'var(--line)' : colorOf(step.target) }}>
                <span className="muted small">Step {st.stepIndex + 1} of {protocol.length}</span>
                <div className="prompt-big" style={{ color: colorOf(step.target) }}>
                  {step.target === 'geeked' ? 'Go geeked: tongue out, silly face' : step.target === 'wink' ? 'Wink with one eye' : `Make a ${labelOf(step.target).toLowerCase()} expression`}
                </div>
                <span className="small">
                  {st.settling
                    ? `Get into position... recording starts in ${Math.max(0, SETTLE_SECONDS - st.stepElapsedMs / 1000).toFixed(1)} s`
                    : `Recording, hold it (${Math.max(0, step.holdSeconds - st.stepElapsedMs / 1000).toFixed(0)} s left)`}
                </span>
                <div className="progress"><i style={{ transform: `scaleX(${Math.min(1, st.elapsedMs / 1000 / total)})` }} /></div>
              </div>
            ) : (
              <div className="prompt">
                <div className="prompt-big">Recording</div>
                <span className="mono">{(st.elapsedMs / 1000).toFixed(0)} s</span>
              </div>
            )}
            <button className="btn danger" onClick={stop}>Stop and generate report</button>
          </div>
        )}
      </section>
      </div>

      <div className="exp-stack">
      {(running || report) && (
        <TimelineChart
          title={running ? 'Session timeline (live)' : 'Session timeline'}
          live={running}
          windowSec={0}
          height={210}
          getPoints={() => (running ? engine.experiment.recorder?.timeline ?? [] : report?.timeline ?? [])}
        />
      )}

      {report && !running && <ReportView report={report} />}
      </div>
    </div>
  );
}

