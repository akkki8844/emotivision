const CARDS = [
  {
    k: 'S',
    title: 'Science',
    body: [
      'A facial expression is a pattern of muscle movements. Contracting the zygomaticus major pulls the mouth corners up, raising the brows uses the frontalis, and tightening around the eyes uses the orbicularis oculi. These movements change where the lips, brows, eyelids and nostrils sit and how skin wrinkles and shades.',
      'A camera records none of the muscles, only light. Computer vision turns that light into measurable features: first the positions of landmarks (468 points here), then, deeper inside the network, learned detectors for edges, curves, mouth shapes and wrinkles. The network combines them into 8 scores.',
      'What is measured is visible appearance. The step from appearance to an inner feeling is a scientific hypothesis, and research suggests it is much less reliable than it looks.',
    ],
  },
  {
    k: 'T',
    title: 'Technology',
    body: [
      'The webcam turns light into a grid of numbers (pixels). A machine-learning model, an EfficientNet convolutional neural network, turns a 224 x 224 x 3 block of numbers into 8 class scores. Everything runs in your browser with WebAssembly through ONNX Runtime Web and MediaPipe.',
      'Nothing in the chain understands faces the way a person does. The model has learned statistical regularities between pixel patterns and labels given by human annotators.',
    ],
  },
  {
    k: 'E',
    title: 'Engineering',
    body: [
      'The system is a pipeline of separate stages: camera, detection, alignment, preprocessing, inference, temporal filtering, analytics and visualisation. Each stage has a clear input and output, so each can be tested alone (see npm test) and replaced.',
      'Engineering trade-offs are visible on screen: more smoothing gives a steadier label but slower reaction; a lower uncertainty threshold gives more answers but more wrong ones; a bigger model could be more accurate but slower. Latency and FPS are measured live.',
    ],
  },
  {
    k: 'A',
    title: 'Arts',
    body: [
      'A model outputs eight numbers per frame, which is invisible and meaningless to most people. Design makes it understandable: colour gives each category an identity, the overlay ties the result to the face, the stacked timeline shows change over time, and the &quot;uncertain&quot; state is shown honestly instead of hidden.',
      'Design is also an ethical tool. Wording such as &quot;most likely visible expression&quot; and a permanent disclaimer shape how people interpret the output.',
    ],
  },
  {
    k: 'M',
    title: 'Mathematics',
    body: [
      'Softmax converts scores into probabilities p_i = e^(z_i) / sum e^(z_j) that add to 1. Smoothing uses an exponential moving average, p̄_t = p̄_(t-1) + a (p_t - p̄_(t-1)) with a = 1 - e^(-dt/tau). Stability is a proportion over a time window; entropy H = -sum p ln p measures how spread the probabilities are.',
      'Reports use percentages, means, medians, percentiles and standard deviation of time-series data. Evaluation uses precision = TP/(TP+FP), recall = TP/(TP+FN), F1 = 2PR/(P+R) and a confusion matrix.',
    ],
  },
  {
    k: 'H',
    title: 'Humanities',
    body: [
      'Consent and privacy: a camera feed is sensitive personal data. This app keeps it on the device and says so, but the question remains who should be allowed to run such analysis on whom, and with what consent.',
      'Culture and bias: people from different cultures display and read expressions differently, and a model trained mostly on web photos may work better for some groups than for others.',
      'Ethics: inferring emotions from appearance is scientifically contested and has been misused in hiring, schools and policing. The EU AI Act now prohibits emotion recognition in workplaces and schools except for narrow medical or safety uses.',
    ],
  },
];

const IDEAS = [
  ['Lighting', 'Dim the room or put a lamp behind you. Does confidence drop? Does the quality gate trigger?'],
  ['Distance', 'Sit 0.5 m, 1 m and 2 m away. At which distance does the face-size warning appear?'],
  ['Head angle', 'Turn slowly from front to side. When does the model become uncertain?'],
  ['Occlusion', 'Wear glasses, a mask or put a hand over your mouth. Which classes change?'],
  ['Intensity', 'Compare a big exaggerated smile to a subtle one. How does the confidence differ?'],
  ['Posed vs real', 'Watch a funny video and compare the output to a deliberately posed smile.'],
];

export function SteamPage() {
  return (
    <div className="page">
      <header className="page-head">
        <h2>STEAM-H investigation</h2>
        <p>Human facial expression &rarr; camera &rarr; computer vision &rarr; machine learning &rarr; digital interpretation.</p>
      </header>

      <section className="panel">
        <h3 className="panel-title">Investigation question</h3>
        <p>
          How reliably can a camera and a machine-learning model estimate the <em>visible</em> category of a facial expression, and what does that tell us about the limits of reading emotions from appearance?
        </p>
      </section>

      <div className="cards">
        {CARDS.map((c) => (
          <section className="panel card" key={c.k}>
            <div className="card-head"><span className="badge-letter">{c.k}</span><h3 className="panel-title">{c.title}</h3></div>
            {c.body.map((p, i) => (
              <p className="small" key={i} dangerouslySetInnerHTML={{ __html: p }} />
            ))}
          </section>
        ))}
      </div>

      <section className="panel">
        <h3 className="panel-title">Variables you can investigate</h3>
        <p className="small muted">Change one variable at a time, run a guided session in the Experiment tab, and compare the reports.</p>
        <div className="ideas">
          {IDEAS.map(([k, v]) => (
            <div key={k} className="idea"><b>{k}</b><span className="small">{v}</span></div>
          ))}
        </div>
      </section>
    </div>
  );
}
