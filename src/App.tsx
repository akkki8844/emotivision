import { useEffect, useMemo, useState } from 'react';
import { CameraStage } from './components/CameraStage';
import { AffectMap, ExtrasPanel } from './components/ExtrasPanel';
import { DistributionChart, LiveAnalysis, ModelInfo, ProbabilityBars, SessionStats } from './components/Dashboard';
import { ExperimentPanel } from './components/ExperimentPanel';
import { applySettings, DEFAULT_UI, SettingsPanel, type UiSettings } from './components/SettingsPanel';
import { TimelineChart } from './components/TimelineChart';
import { useEngine, useSnapshot } from './hooks/useEngine';
import { BiasPage } from './pages/BiasPage';
import { EvaluationPage } from './pages/EvaluationPage';
import { PipelinePage } from './pages/PipelinePage';
import { PrivacyPage } from './pages/PrivacyPage';
import { SteamPage } from './pages/SteamPage';

const TABS = [
  ['live', 'Live'],
  ['experiment', 'Experiment'],
  ['evaluation', 'Model evaluation'],
  ['pipeline', 'Pipeline & model'],
  ['steam', 'STEAM-H'],
  ['bias', 'Bias & limits'],
  ['privacy', 'Privacy'],
] as const;
type Tab = (typeof TABS)[number][0];

export function App() {
  const { engine, model, camera } = useEngine();
  const snap = useSnapshot(engine);
  const [tab, setTab] = useState<Tab>('live');
  const [ui, setUi] = useState<UiSettings>(DEFAULT_UI);

  // Start loading the detector and model immediately so they are ready when the camera starts.
  useEffect(() => {
    engine.loadModels().catch(() => undefined);
  }, [engine]);

  useEffect(() => {
    if (model.state === 'ready') applySettings(engine, ui);
  }, [engine, model.state, ui]);

  // Only the camera tabs need inference running; pause it elsewhere to save CPU.
  const workspace = tab === 'live' || tab === 'experiment';
  useEffect(() => {
    engine.setPaused(!workspace);
  }, [engine, workspace]);

  const on = camera.state === 'on';
  const modelPill =
    model.state === 'ready'
      ? { cls: 'ok', text: 'Model ready' }
      : model.state === 'loading'
        ? { cls: 'info', text: model.step }
        : model.state === 'error'
          ? { cls: 'bad', text: 'Model error' }
          : { cls: '', text: 'Model idle' };

  const settingsSummary = useMemo(
    () => ({
      uncertaintyThreshold: ui.confidenceThreshold,
      smoothingMs: ui.smoothingMs,
      cropMargin: ui.cropMargin,
      alignFace: ui.align,
      extrasSensitivity: ui.extrasSensitivity,
    }),
    [ui],
  );

  const stage = (
    <CameraStage engine={engine} snap={snap} camera={camera} model={model} showLandmarks={ui.showLandmarks} />
  );

  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <div className="brand">
            <span className="logo" aria-hidden="true"><i /></span>
            EmotiVision<small>Expression research</small>
          </div>
          <nav className="tabs" role="tablist" aria-label="Sections">
            {TABS.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
            ))}
          </nav>
          <div className="pills">
            <span className={`pill ${modelPill.cls}`}><span className="dot" />{modelPill.text}</span>
            <span className="pill local"><span className="dot" />Camera processing: Local</span>
          </div>
        </div>
        <div className="disclaimer-bar">
          Outputs are AI-estimated facial-expression categories, not measurements of anyone&apos;s true internal emotional state.
        </div>
      </header>

      <main>
        {tab === 'live' && (
          <div className="workspace">
            <div className="col">
              {stage}
              <TimelineChart getPoints={() => engine.live.timeline} />
              <ProbabilityBars snap={snap} />
            </div>
            <div className="col">
              <LiveAnalysis snap={snap} active={on} />
              <AffectMap engine={engine} snap={snap} />
              <ExtrasPanel snap={snap} />
              <DistributionChart engine={engine} />
              <SessionStats engine={engine} />
              <ModelInfo model={model} snap={snap} />
              <SettingsPanel value={ui} onChange={setUi} />
            </div>
          </div>
        )}

        {tab === 'experiment' && (
          <ExperimentPanel engine={engine} snap={snap} cameraOn={on} settingsSummary={settingsSummary} cameraSlot={stage} />
        )}

        {tab === 'evaluation' && <EvaluationPage engine={engine} model={model} />}
        {tab === 'pipeline' && <PipelinePage />}
        {tab === 'steam' && <SteamPage />}
        {tab === 'bias' && <BiasPage />}
        {tab === 'privacy' && <PrivacyPage />}
      </main>
    </>
  );
}
