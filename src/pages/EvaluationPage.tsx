import { useRef, useState } from 'react';
import { EMOTIONS } from '../core/emotions';
import type { Engine, ModelStatus } from '../core/engine';
import { runEvaluation, type EvalFile, type EvalOptions, type EvalRun } from '../core/evalRunner';
import { downloadJson } from '../core/exporters';
import { MODEL_FACTS } from '../core/expressionModel';

const NEEDED = 'Evaluation required';
const f3 = (v: number | null) => (v === null ? 'n/a' : (v * 100).toFixed(1) + '%');

function MetricCard({ name, value, hint }: { name: string; value: string | null; hint: string }) {
  return (
    <div className={`metric ${value ? '' : 'needed'}`}>
      <span className="metric-k">{name}</span>
      <b className="metric-v mono">{value ?? NEEDED}</b>
      <small>{hint}</small>
    </div>
  );
}

function Confusion({ run }: { run: EvalRun }) {
  const { classes, confusion } = run.metrics;
  return (
    <div className="scroll">
      <table className="table matrix" aria-label="Confusion matrix">
        <thead>
          <tr>
            <th className="corner">truth &darr; / predicted &rarr;</th>
            {classes.map((c) => <th key={c}>{EMOTIONS[c].label}</th>)}
          </tr>
        </thead>
        <tbody>
          {classes.map((t, i) => {
            const rowSum = confusion[i].reduce((a, b) => a + b, 0);
            return (
              <tr key={t}>
                <th>{EMOTIONS[t].label}</th>
                {classes.map((_, j) => {
                  const v = confusion[i][j];
                  const frac = rowSum ? v / rowSum : 0;
                  return (
                    <td key={j} className="mono" title={`${v} of ${rowSum} (${(frac * 100).toFixed(1)}%)`} style={{ background: `rgba(${i === j ? '34,211,238' : '248,113,113'},${Math.min(0.85, frac * 0.9).toFixed(2)})` }}>
                      {v}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">Cell shading shows the share of each true class (row). Diagonal = correct.</p>
    </div>
  );
}

function Results({ run }: { run: EvalRun }) {
  const m = run.metrics;
  const missedTotal = Object.values(run.noFace).reduce((a, b) => a + b, 0);
  const attempted = run.evaluated + missedTotal;
  return (
    <div className="results">
      <div className="metrics">
        <MetricCard name="Accuracy" value={f3(m.accuracy)} hint={`${run.evaluated} images scored`} />
        <MetricCard name="Balanced accuracy" value={f3(m.balancedAccuracy)} hint="mean per-class recall" />
        <MetricCard name="Macro F1" value={f3(m.macroF1)} hint="unweighted class mean" />
        <MetricCard name="Weighted F1" value={f3(m.weightedF1)} hint="weighted by support" />
        {run.options.mode === 'detect' && <MetricCard name="Face found" value={attempted ? f3(run.evaluated / attempted) : 'n/a'} hint={`${missedTotal} images had no detected face`} />}
      </div>

      <h4>Per-class performance</h4>
      <div className="scroll">
        <table className="table">
          <thead>
            <tr><th>Class</th><th>Precision</th><th>Recall</th><th>F1</th><th>Support</th><th>TP</th><th title="false positives: predicted this class, truth was another">FP</th><th title="false negatives: truth was this class, predicted another">FN</th><th>No face</th></tr>
          </thead>
          <tbody>
            {m.perClass.map((c) => (
              <tr key={c.cls}>
                <td><i className="swatch" style={{ background: EMOTIONS[c.cls].color }} />{EMOTIONS[c.cls].label}</td>
                <td className="mono">{f3(c.precision)}</td>
                <td className="mono">{f3(c.recall)}</td>
                <td className="mono">{f3(c.f1)}</td>
                <td className="mono">{c.support}</td>
                <td className="mono">{c.tp}</td>
                <td className="mono">{c.fp}</td>
                <td className="mono">{c.fn}</td>
                <td className="mono">{run.noFace[c.cls] ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        <b>False positive (FP)</b>: the model said this class but the label was another. <b>False negative (FN)</b>: the label was this class but the model said another. &quot;n/a&quot; means the metric is undefined (for example, no predictions of that class).
      </p>

      <h4>Confusion matrix</h4>
      <Confusion run={run} />

      <h4>Confidence vs correctness</h4>
      <p className="small">
        Mean confidence when correct: <b className="mono">{f3(run.meanConfidenceCorrect)}</b> &middot; when wrong: <b className="mono">{f3(run.meanConfidenceWrong)}</b>.
        If these are close, the confidence score is a poor guide to when the model is right.
      </p>

      {run.topErrors.length > 0 && (
        <>
          <h4>Most confident errors</h4>
          <table className="table">
            <thead><tr><th>File</th><th>Label</th><th>Predicted</th><th>Confidence</th></tr></thead>
            <tbody>
              {run.topErrors.slice(0, 10).map((e) => (
                <tr key={e.path}><td className="mono clip">{e.path}</td><td>{EMOTIONS[e.truth].label}</td><td>{EMOTIONS[e.pred].label}</td><td className="mono">{f3(e.confidence)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <p className="muted small">
        Run on {new Date(run.startedAtIso).toLocaleString()} in {run.seconds.toFixed(0)} s. {run.filesSeen} image files seen; {run.skippedUnlabelled} skipped (folder name is not a known class{run.unknownFolders.length ? `: ${run.unknownFolders.slice(0, 6).join(', ')}` : ''}); {run.unreadable} unreadable.
      </p>
      <button className="btn" onClick={() => downloadJson('emotivision-evaluation', run)}>Download results (JSON)</button>
    </div>
  );
}

function Lab({ engine, model }: { engine: Engine; model: ModelStatus }) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<EvalOptions['mode']>('cropped');
  const [restrict, setRestrict] = useState(true);
  const [cap, setCap] = useState(100);
  const [files, setFiles] = useState<EvalFile[]>([]);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [run, setRun] = useState<EvalRun | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const pick = (list: FileList | null) => {
    if (!list) return;
    const arr: EvalFile[] = [...list].map((file) => ({ file, path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name }));
    setFiles(arr);
    setRun(null);
    if (!name && arr[0]?.path.includes('/')) setName(arr[0].path.split('/')[0]);
  };

  const start = async () => {
    setErr(null);
    try {
      await engine.loadModels();
      const pipeline = engine.pipeline!;
      abort.current = new AbortController();
      setProgress([0, 1]);
      const res = await runEvaluation(
        pipeline,
        files,
        { datasetName: name || 'unnamed dataset', mode, restrictToDatasetClasses: restrict, maxPerClass: cap, seed: 42 },
        (d, t) => setProgress([d, t]),
        abort.current.signal,
      );
      setRun(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  const busy = progress !== null;
  return (
    <section className="panel" aria-label="Evaluation lab">
      <h3 className="panel-title">Evaluation lab</h3>
      <p className="small">
        Measure this exact pipeline on a labelled image set you choose. Pick a folder whose sub-folders are named after the expression
        (for example <code>test/happy/*.jpg</code>, <code>test/sad/*.jpg</code>). Images are read in your browser and never uploaded; only the metrics are kept.
      </p>
      <div className="lab-grid">
        <label className="field"><span>Dataset name (required to report results)</span>
          <input type="text" value={name} placeholder="e.g. FER2013 test split" onChange={(e) => setName(e.target.value)} disabled={busy} />
        </label>
        <label className="field"><span>Images contain</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as EvalOptions['mode'])} disabled={busy}>
            <option value="cropped">Already-cropped faces (resize only)</option>
            <option value="detect">Full photos (detect + align first)</option>
          </select>
        </label>
        <label className="field"><span>Max images per class (0 = all)</span>
          <input type="number" min={0} max={5000} value={cap} onChange={(e) => setCap(Math.max(0, +e.target.value || 0))} disabled={busy} />
        </label>
        <label className="check"><input type="checkbox" checked={restrict} onChange={(e) => setRestrict(e.target.checked)} disabled={busy} />
          <span>Only allow classes present in the dataset (use for 7-class sets with no &quot;contempt&quot;)</span>
        </label>
      </div>
      <div className="lab-actions">
        <label className="btn">
          Choose folder
          <input type="file" hidden multiple {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={(e) => pick(e.target.files)} disabled={busy} />
        </label>
        <span className="small muted">{files.length ? `${files.length.toLocaleString()} files selected` : 'No folder selected'}</span>
        {!busy ? (
          <button className="btn primary" disabled={!files.length || !name.trim() || model.state === 'error'} onClick={start}>Run evaluation</button>
        ) : (
          <button className="btn danger" onClick={() => abort.current?.abort()}>Cancel</button>
        )}
      </div>
      {busy && progress && (
        <div className="progress" role="progressbar" aria-valuenow={progress[0]} aria-valuemax={progress[1]}>
          <i style={{ transform: `scaleX(${progress[0] / progress[1]})` }} />
          <span className="mono">{progress[0]} / {progress[1]}</span>
        </div>
      )}
      {err && <p className="error" role="alert">{err}</p>}
      {run ? (
        <>
          <h4>Results on &quot;{run.options.datasetName}&quot;</h4>
          <Results run={run} />
        </>
      ) : (
        <p className="muted small">No evaluation has been run in this session. Metrics shown above remain &quot;{NEEDED}&quot;.</p>
      )}
    </section>
  );
}

export function EvaluationPage({ engine, model }: { engine: Engine; model: ModelStatus }) {
  return (
    <div className="page">
      <header className="page-head">
        <h2>Model evaluation</h2>
        <p>How well does the model actually perform? A live demo cannot tell you. Only labelled data can.</p>
      </header>

      <section className="panel" aria-label="Current evaluation status">
        <h3 className="panel-title">Measured performance of this deployment</h3>
        <div className="metrics">
          <MetricCard name="Accuracy" value={null} hint="share of correct predictions" />
          <MetricCard name="Precision" value={null} hint="TP / (TP + FP) per class" />
          <MetricCard name="Recall" value={null} hint="TP / (TP + FN) per class" />
          <MetricCard name="F1-score" value={null} hint="harmonic mean of P and R" />
          <MetricCard name="Confusion matrix" value={null} hint="truth x prediction counts" />
        </div>
        <p className="small">
          These stay <b>{NEEDED}</b> until you run the lab below. This app does not ship any pre-computed numbers, and none are invented.
        </p>
        <div className="callout">
          <b>Published figure, not measured here.</b> The model authors report {MODEL_FACTS.reportedAffectNetAcc8}% accuracy for <code>enet_b0_8_va_mtl</code> on the 8-class AffectNet validation split
          (EmotiEffLib README). That number comes from their own face crops and pipeline on a curated benchmark; it says little about a webcam in your room, a different camera, or people unlike
          the AffectNet population. Treat it as an upper-ish reference, and measure your own conditions. The Geeked / Wink / Kissy extras are rule-based, are not part of these metrics, and have not been evaluated at all.
        </div>
      </section>

      <div className="two-col">
        <section className="panel">
          <h3 className="panel-title">How to test it properly</h3>
          <ol className="steps small">
            <li><b>Choose a labelled benchmark.</b> Examples: AffectNet (validation), FER2013 / FER+ (test), RAF-DB (test), CK+, or your own consented, labelled photos. Record the dataset name and split.</li>
            <li><b>Keep the test set separate.</b> The model was trained on AffectNet, so scores on AffectNet validation are optimistic compared with unseen datasets. Cross-dataset results are more honest.</li>
            <li><b>Match the classes.</b> The model has 8 classes incl. contempt. For 7-class sets restrict predictions to the dataset&apos;s classes (checkbox below).</li>
            <li><b>Run the same pipeline.</b> Use &quot;Full photos&quot; for in-the-wild images (tests the detector and alignment too) or &quot;Already-cropped&quot; for face-crop datasets.</li>
            <li><b>Read more than accuracy.</b> Check per-class recall and the confusion matrix: classes such as fear, disgust and contempt are small and easily confused.</li>
            <li><b>Slice the data.</b> Repeat on subsets (lighting, head pose, age, skin tone, gender, glasses) to look for bias. Large gaps between slices matter more than the overall number.</li>
            <li><b>Report uncertainty.</b> With few images per class the numbers are noisy. Use at least a few hundred per class and say how many you used.</li>
          </ol>
        </section>
        <section className="panel">
          <h3 className="panel-title">Metric definitions</h3>
          <p className="small">For one class C, counting over all test images:</p>
          <ul className="plain small">
            <li><b>TP</b> label C, predicted C &middot; <b>FP</b> label other, predicted C &middot; <b>FN</b> label C, predicted other</li>
            <li><b>Accuracy</b> = correct / all. Misleading when classes are imbalanced (a model that always says &quot;neutral&quot; can look good).</li>
            <li><b>Precision</b> = TP / (TP + FP): when it says C, how often is it right? Many false positives lower it.</li>
            <li><b>Recall</b> = TP / (TP + FN): of the real C faces, how many were found? Many false negatives lower it.</li>
            <li><b>F1</b> = 2PR / (P + R). <b>Macro-F1</b> averages F1 over classes equally, so rare classes count as much as common ones.</li>
            <li><b>Confusion matrix</b>: rows = label, columns = prediction. Off-diagonal cells show which expressions get mixed up.</li>
          </ul>
        </section>
      </div>

      <Lab engine={engine} model={model} />
    </div>
  );
}
