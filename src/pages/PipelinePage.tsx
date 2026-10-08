import { MODEL_FACTS } from '../core/expressionModel';
import { DEFAULT_TEMPORAL } from '../core/temporal';
import { QUALITY_LIMITS } from '../core/alignment';

const STAGES = [
  { n: '1', t: 'Camera', d: 'getUserMedia opens the webcam. Frames stay inside a <video> element; no recording API is used.', f: 'core/camera.ts' },
  { n: '2', t: 'Face detection', d: 'MediaPipe Face Mesh (a BlazeFace detector followed by a 468-point landmark network) runs in WebAssembly and returns face landmarks for the largest/most confident face.', f: 'core/faceTracker.ts' },
  { n: '3', t: 'Alignment / normalisation', d: 'The eye line gives the head roll. The frame is rotated so the eyes are level and a square crop that covers all landmarks (plus a margin) is warped to 224 x 224. Distance and position are normalised away.', f: 'core/alignment.ts' },
  { n: '4', t: 'Quality gate', d: 'Face size, brightness, blur and a yaw proxy are measured on the crop. Severe cases force the verdict to "uncertain" instead of guessing.', f: 'core/alignment.ts' },
  { n: '5', t: 'Expression model', d: 'EfficientNet-B0 (ONNX) maps the crop to 8 logits; softmax gives class scores. Pixels are scaled to 0..1 and normalised with ImageNet mean/std.', f: 'core/expressionModel.ts' },
  { n: '6', t: 'Temporal smoothing', d: 'A time-constant moving average of the probabilities, hysteresis on the displayed label, and a rolling-window stability score. Low confidence or a near-tie yields "uncertain".', f: 'core/temporal.ts' },
  { n: '6b', t: 'Extras (rule-based)', d: 'Separate from the network: landmark geometry (eye openings, mouth shape and tilt, brow asymmetry) and a tongue-colour cue in the aligned crop drive the Geeked, Wink and Kissy states with hand-set thresholds and hold times. Experimental and not evaluated.', f: 'core/play.ts' },
  { n: '7', t: 'Analytics', d: 'Only numbers are accumulated: time per category, confidence statistics, latency, state transitions.', f: 'core/analytics.ts' },
  { n: '8', t: 'Visualisation', d: 'Canvas overlay, probability bars, distribution chart, timeline and report.', f: 'components/*' },
];

export function PipelinePage() {
  const T = DEFAULT_TEMPORAL;
  const Q = QUALITY_LIMITS;
  return (
    <div className="page">
      <header className="page-head">
        <h2>Pipeline and model</h2>
        <p>Camera &rarr; face detection &rarr; alignment &rarr; expression model &rarr; temporal smoothing &rarr; confidence analysis &rarr; visualisation.</p>
      </header>

      <section className="panel">
        <h3 className="panel-title">The pipeline, stage by stage</h3>
        <ol className="stages">
          {STAGES.map((s) => (
            <li key={s.n}>
              <span className="stage-n">{s.n}</span>
              <div><b>{s.t}</b><p className="small">{s.d}</p><code>{s.f}</code></div>
            </li>
          ))}
        </ol>
      </section>

      <div className="two-col">
        <section className="panel">
          <h3 className="panel-title">Model card</h3>
          <dl className="kv stacked">
            <div><dt>Name</dt><dd>{MODEL_FACTS.name} (HSEmotion / EmotiEffLib)</dd></div>
            <div><dt>Architecture</dt><dd>EfficientNet-B0 convolutional network, about 16 MB (ONNX), multi-task head. Pre-trained for face identification on VGGFace2, then trained on AffectNet to classify expressions and regress valence and arousal.</dd></div>
            <div><dt>Training data</dt><dd>AffectNet: over a million web images, about half of them manually labelled. Besides the 8 class labels, AffectNet provides valence and arousal values, which the multi-task (&quot;mtl&quot;) variant also learns.</dd></div>
            <div><dt>Classes</dt><dd>8: anger, contempt, disgust, fear, happiness, neutral, sadness, surprise. Contempt is outside the seven categories in the brief, so it is shown with a + mark.</dd></div>
            <div><dt>Input</dt><dd>224 x 224 RGB face crop, values / 255, then (x - mean) / std with ImageNet mean [0.485, 0.456, 0.406] and std [0.229, 0.224, 0.225]; NCHW float32.</dd></div>
            <div><dt>Output</dt><dd>10 numbers: 8 logits (the app applies softmax) plus valence and arousal. Scores are not calibrated probabilities.</dd></div>
            <div><dt>Reported accuracy</dt><dd>{MODEL_FACTS.reportedAffectNetAcc8}% on AffectNet 8-class validation, as published by the authors (chance level is 12.5%). Not measured by this app.</dd></div>
            <div><dt>Source</dt><dd>{MODEL_FACTS.source}</dd></div>
          </dl>
        </section>

        <section className="panel">
          <h3 className="panel-title">Why this model</h3>
          <ul className="plain small">
            <li><b>Runs in the browser.</b> 16 MB and a few hundred million operations per image, so inference stays on the device with real-time speed on ordinary laptops.</li>
            <li><b>Documented accuracy on a standard benchmark.</b> The authors publish AffectNet results and have placed in several Affective Behavior Analysis in-the-wild (ABAW) competitions with this model family.</li>
            <li><b>Multi-task variant.</b> <code>enet_b0_8_va_mtl</code> has the same size and speed as the plain 8-class checkpoint, reports slightly higher AffectNet accuracy (61.93% vs 61.32%) and adds valence/arousal, which powers the affect map and the &quot;Excited / Calm / Tense...&quot; regions.</li>
            <li><b>Cost/accuracy trade-off.</b> The larger <code>enet_b2_8</code> model reports 63.03% (vs 61.32%) on AffectNet but is about twice the size and, on the authors&apos; phone benchmark, about 3x slower (191 ms vs 59 ms). A 1.1 point gain did not justify that cost for a live demo.</li>
            <li><b>Open and portable.</b> Published as ONNX; code under Apache-2.0. Check the licence of the weights and of AffectNet before any commercial use.</li>
            <li><b>Not chosen because it is &quot;world-class&quot;.</b> A pre-trained model is only a component. 61% on its own benchmark means it is wrong on roughly four images in ten, which is why this app adds smoothing, abstention and evaluation tooling around it.</li>
          </ul>
          <h3 className="panel-title spaced">Known limitations of the model</h3>
          <ul className="plain small">
            <li>Web-scraped training photos favour posed, exaggerated, mostly frontal expressions; real, subtle expressions are harder.</li>
            <li>Class imbalance: happy and neutral are far more common than contempt, disgust or fear, so rare classes are less reliable.</li>
            <li>Labels are human judgements with substantial disagreement between annotators, so the &quot;ground truth&quot; is itself uncertain.</li>
            <li>The labels reflect one cultural reading of faces. See Bias &amp; limits.</li>
            <li>Valence/arousal are regressions on annotator ratings and are noisier than the class decision; the region names (Excited, Calm...) only describe where the point lies.</li>
          </ul>
        </section>
      </div>

      <section className="panel">
        <h3 className="panel-title">Design parameters (all adjustable in code)</h3>
        <div className="scroll">
          <table className="table">
            <thead><tr><th>Parameter</th><th>Default</th><th>Purpose</th><th>Basis</th></tr></thead>
            <tbody>
              <tr><td>EMA time constant</td><td className="mono">{T.emaTauMs} ms</td><td>Steadier probabilities independent of frame rate</td><td>Engineering choice</td></tr>
              <tr><td>Stability window</td><td className="mono">{T.windowMs} ms</td><td>Share of frames agreeing with the shown label</td><td>Engineering choice</td></tr>
              <tr><td>Uncertainty threshold</td><td className="mono">{T.confidenceThreshold * 100}%</td><td>Report &quot;uncertain&quot; below this smoothed confidence</td><td>Not calibrated: tune with the Evaluation Lab</td></tr>
              <tr><td>Margin threshold</td><td className="mono">{T.marginThreshold * 100} pts</td><td>Uncertain if the top two classes are nearly tied</td><td>Engineering choice</td></tr>
              <tr><td>Label hysteresis</td><td className="mono">{T.hysteresis * 100} pts</td><td>A new class must lead by this much to replace the shown label</td><td>Engineering choice</td></tr>
              <tr><td>Face-size gate</td><td className="mono">&lt; {Q.minFacePxHard}px blocks, &lt; {Q.minFacePxSoft}px warns</td><td>Tiny faces are upscaled heavily</td><td>Engineering choice</td></tr>
              <tr><td>Darkness gate</td><td className="mono">luma &lt; {Q.darkHard} blocks, &lt; {Q.darkSoft} warns</td><td>Dark crops carry little expression information</td><td>Engineering choice</td></tr>
              <tr><td>Head-turn gate</td><td className="mono">|yaw| &gt; {Q.yawHard} blocks, &gt; {Q.yawSoft} warns</td><td>Profile faces fall outside the training distribution</td><td>Landmark proxy, not a true pose angle</td></tr>
            </tbody>
          </table>
        </div>
        <p className="muted small">These are design choices, not scientifically derived constants. They are exposed so you can test how they change the results.</p>
      </section>
    </div>
  );
}
