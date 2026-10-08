const FLOW = [
  ['Camera sensor', 'Your browser asks permission, then streams frames into a <video> element in this tab.'],
  ['Canvas (memory)', 'The current frame is cropped to the face and drawn onto a 224 x 224 canvas in RAM.'],
  ['Numbers', 'The crop becomes a tensor, the model outputs 8 scores, and the scores are smoothed.'],
  ['Screen', 'Labels, charts and counters are drawn. The pixels are overwritten by the next frame.'],
];

export function PrivacyPage() {
  return (
    <div className="page">
      <header className="page-head">
        <h2>Privacy</h2>
        <p>Camera processing: Local. Here is exactly what happens to your webcam data.</p>
      </header>

      <section className="panel">
        <h3 className="panel-title">Data flow</h3>
        <ol className="flow4">
          {FLOW.map(([t, d], i) => (
            <li key={t}><span className="stage-n">{i + 1}</span><b>{t}</b><p className="small">{d}</p></li>
          ))}
        </ol>
      </section>

      <div className="two-col">
        <section className="panel">
          <h3 className="panel-title">What is not done</h3>
          <ul className="plain small">
            <li>Video and photos are <b>never uploaded</b>. The page has no upload code, and its Content-Security-Policy only allows connections to its own origin.</li>
            <li>Video and photos are <b>never recorded or saved</b>: no MediaRecorder, no screenshots, no files, no IndexedDB, no cookies, no localStorage.</li>
            <li>No analytics, no third-party scripts, fonts or CDNs. After the page loads, no network request is needed to run the analysis.</li>
            <li>No face identification: the model classifies an expression, it does not recognise who you are.</li>
            <li>The Evaluation Lab reads image files in memory and does not send them anywhere.</li>
          </ul>
        </section>
        <section className="panel">
          <h3 className="panel-title">What is kept, and for how long</h3>
          <ul className="plain small">
            <li><b>Session statistics</b> (counts, percentages, confidence and latency numbers, a 10 Hz list of class probabilities) live in this tab&apos;s memory and disappear when you close or reload it.</li>
            <li><b>Reports and results</b> are only saved if you click Download. Then they are numbers in a file on your computer, with no images.</li>
            <li><b>Stopping the camera</b> releases the device (the camera light goes off).</li>
          </ul>
          <h3 className="panel-title spaced">How to verify it yourself</h3>
          <ul className="plain small">
            <li>Open the browser developer tools, Network tab, then use the app: you will see only the app&apos;s own files, loaded once.</li>
            <li>Load the page, switch off your network connection, and start the camera: it keeps working.</li>
            <li>The code is open: search the source for <code>fetch(</code> and <code>XMLHttpRequest</code>; they are used only to load the model file from the same origin.</li>
          </ul>
        </section>
      </div>

      <section className="panel">
        <h3 className="panel-title">Consent and good practice</h3>
        <ul className="plain small">
          <li>Only analyse yourself or people who have clearly agreed. Do not point the camera at others to &quot;read&quot; them.</li>
          <li>Do not use the output to judge, grade, hire, discipline or monitor anyone.</li>
          <li>If you share a report, remember it describes a model&apos;s output about a face, which is personal data about a real person.</li>
          <li>If you host this app yourself, serve it over HTTPS and keep the same-origin policy; do not add analytics that could receive frames or results.</li>
        </ul>
      </section>
    </div>
  );
}
