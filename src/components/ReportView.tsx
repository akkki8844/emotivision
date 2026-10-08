import { affectRegion, colorOf, labelOf, MODEL_CLASSES, PLAY_IDS, StateKey } from '../core/emotions';
import { Circumplex } from './Circumplex';
import type { ExperimentReport } from '../core/experiment';
import { downloadJson, downloadTimelineCsv, fmtState } from '../core/exporters';

const DIST_KEYS: StateKey[] = [...MODEL_CLASSES, ...PLAY_IDS, 'uncertain'];

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="stat">
      <span>{k}</span>
      <b className="mono">{v}</b>
    </div>
  );
}

export function ReportView({ report }: { report: ExperimentReport }) {
  const s = report.summary;
  const dur = s.durationMs / 1000;
  const coverage = s.framesProcessed ? (s.framesWithFace / s.framesProcessed) * 100 : 0;
  const max = Math.max(1, ...DIST_KEYS.map((k) => s.percent[k]));
  const cs = s.confidenceStats;
  const verdictSeconds = DIST_KEYS.reduce((a, k) => a + s.seconds[k], 0);

  const print = () => {
    document.body.classList.add('print-report');
    window.print();
    setTimeout(() => document.body.classList.remove('print-report'), 500);
  };

  return (
    <article className="panel report" aria-label="Session report">
      <header className="report-head">
        <div>
          <h3 className="panel-title big">{report.title}</h3>
          <p className="muted small">
            {new Date(report.generatedAtIso).toLocaleString()} &middot; {report.mode === 'guided' ? 'Guided protocol' : 'Free session'} &middot; model: {report.model}
          </p>
        </div>
        <div className="report-actions no-print">
          <button className="btn" onClick={print}>Print / save as PDF</button>
          <button className="btn" onClick={() => downloadJson('emotivision-report', report)}>JSON</button>
          <button className="btn" onClick={() => downloadTimelineCsv(report)}>Timeline CSV</button>
        </div>
      </header>

      <div className="callout">
        <b>Observed model outputs, not emotions.</b> Every figure below is what an AI model <em>output</em> for the visible facial expression in front of the camera. It is an estimate of a
        visual category and is not evidence of what the participant actually felt.
      </div>

      <h4>Summary</h4>
      <div className="stats">
        <Stat k="Duration" v={`${dur.toFixed(1)} s`} />
        <Stat k="Frames analysed" v={s.framesProcessed.toLocaleString()} />
        <Stat k="Frames with a face" v={`${s.framesWithFace.toLocaleString()} (${coverage.toFixed(0)}%)`} />
        <Stat k="Avg inference latency" v={`${s.avgInferenceMs.toFixed(1)} ms`} />
        <Stat k="Avg pipeline latency" v={`${s.avgPipelineMs.toFixed(1)} ms`} />
        <Stat k="Avg FPS" v={s.avgFps.toFixed(1)} />
        <Stat k="Most frequent output" v={s.mostFrequent ? labelOf(s.mostFrequent) : '--'} />
        <Stat k="No-face time" v={`${s.noFaceSeconds.toFixed(1)} s`} />
      </div>

      <h4>Expression distribution (model output)</h4>
      <p className="muted small">Share of the {verdictSeconds.toFixed(1)} s in which the model produced a verdict. &quot;Uncertain&quot; means confidence was below threshold.</p>
      <ul className="dist">
        {DIST_KEYS.map((k) => (
          <li key={k}>
            <span className="bar-label">{labelOf(k)}</span>
            <span className="bar-track"><span className="bar-fill" style={{ transform: `scaleX(${s.percent[k] / max})`, background: colorOf(k) }} /></span>
            <span className="bar-val mono">{s.percent[k].toFixed(1)}% <small>({s.seconds[k].toFixed(1)} s)</small></span>
          </li>
        ))}
      </ul>

      <h4>Valence and arousal</h4>
      <p className="muted small">
        Mean over the session: valence {s.avgValence >= 0 ? '+' : ''}{s.avgValence.toFixed(2)}, arousal {s.avgArousal >= 0 ? '+' : ''}{s.avgArousal.toFixed(2)} (region: {affectRegion(s.avgValence, s.avgArousal)}).
        Each dot is one 10 Hz sample of the network&apos;s regression output; the ring is the mean.
      </p>
      <Circumplex
        size={300}
        trail={report.timeline.filter((p) => p.state !== 'no-face' && (p.v !== 0 || p.a !== 0)).map((p) => ({ v: p.v, a: p.a, color: colorOf(p.state as StateKey) }))}
        mean={{ v: s.avgValence, a: s.avgArousal }}
      />

      <h4>Confidence statistics</h4>
      {cs ? (
        <table className="table">
          <thead>
            <tr><th>Mean</th><th>Median</th><th>10th pct</th><th>90th pct</th><th>Min</th><th>Max</th><th>Std dev</th><th>n (10 Hz samples)</th></tr>
          </thead>
          <tbody>
            <tr className="mono">
              {[cs.mean, cs.median, cs.p10, cs.p90, cs.min, cs.max].map((v, i) => <td key={i}>{(v * 100).toFixed(1)}%</td>)}
              <td>{(cs.std * 100).toFixed(1)} pts</td>
              <td>{cs.n}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <p className="muted small">No confident or uncertain verdicts were recorded.</p>
      )}
      <p className="muted small">
        Smoothed mean confidence {(s.avgConfidence * 100).toFixed(1)}%; raw per-frame mean {(s.avgRawConfidence * 100).toFixed(1)}%. Softmax confidence is a score, not a calibrated probability of being correct.
      </p>

      <h4>Observed changes</h4>
      {s.transitions.length ? (
        <table className="table">
          <thead><tr><th>Time</th><th>From</th><th>To</th><th>Confidence</th></tr></thead>
          <tbody>
            {s.transitions.slice(0, 60).map((t, i) => (
              <tr key={i}>
                <td className="mono">{(t.t / 1000).toFixed(1)} s</td>
                <td>{fmtState(t.from)}</td>
                <td><i className="swatch" style={{ background: t.to === 'no-face' ? '#334155' : colorOf(t.to as StateKey) }} />{fmtState(t.to)}</td>
                <td className="mono">{t.to === 'no-face' ? '--' : `${(t.confidence * 100).toFixed(0)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small">The reported state did not change during this session.</p>
      )}
      {s.transitions.length > 60 && <p className="muted small">Showing the first 60 of {s.transitions.length} changes. The CSV contains the full timeline.</p>}

      {s.agreement && (
        <>
          <h4>Agreement with the instructed expression</h4>
          <p className="muted small">
            Rows are the expression the participant was asked to make; columns are what the model reported (% of recorded time, first {report.settleSeconds} s of each step excluded).
            Posed expressions are not ground truth: a mismatch can mean the pose was not typical, not only that the model was wrong. This is <b>not</b> a model accuracy figure.
          </p>
          <div className="scroll">
            <table className="table matrix">
              <thead>
                <tr>
                  <th>Asked for</th>
                  {DIST_KEYS.map((k) => <th key={k}>{labelOf(k)}</th>)}
                  <th>Agreed</th>
                </tr>
              </thead>
              <tbody>
                {s.agreement.map((row) => (
                  <tr key={row.instructed}>
                    <th>{labelOf(row.instructed)}</th>
                    {DIST_KEYS.map((k) => {
                      const v = row.totalSeconds ? row.seconds[k] / row.totalSeconds : 0;
                      const hit = k === row.instructed;
                      return (
                        <td key={k} className="mono" style={{ background: `rgba(${hit ? '34,211,238' : '248,113,113'},${Math.min(0.75, v * 0.8).toFixed(2)})` }}>
                          {(v * 100).toFixed(0)}
                        </td>
                      );
                    })}
                    <td className="mono"><b>{row.totalSeconds ? ((row.seconds[row.instructed] / row.totalSeconds) * 100).toFixed(0) : '--'}%</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h4>How to read this report</h4>
      <ul className="plain small">
        <li><b>Observed:</b> the model assigned the listed categories to the pixels of the aligned face crop, with the listed scores.</li>
        <li><b>Not observed:</b> the participant&apos;s actual emotion. A smile can be polite, a neutral face can hide strong feelings, and expressions vary across people and cultures.</li>
        <li>Results depend on lighting, camera, head angle, occlusion and the demographics of the training data. One session of one person is an anecdote, not a measurement of model quality.</li>
        <li>Settings used: {Object.entries(report.settings).map(([k, v]) => `${k}=${String(v)}`).join(', ') || 'defaults'}.</li>
      </ul>
    </article>
  );
}
