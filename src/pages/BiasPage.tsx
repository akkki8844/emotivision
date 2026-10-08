const FACTORS = [
  ['Lighting', 'Shadows, backlight and dim rooms change pixel patterns that the model uses as cues. Strong side light can look like a frown or hide the mouth.', 'Turn a lamp off and on while watching confidence and the quality warnings.'],
  ['Camera quality', 'Noise, compression, low resolution and auto-exposure remove fine detail such as wrinkles around the eyes.', 'Compare a laptop camera with a phone camera used as a webcam.'],
  ['Head angle', 'Training photos are mostly frontal. Turned or tilted heads fall outside what the model saw, and the landmark crop becomes less accurate.', 'Slowly turn your head and watch the yaw warning and uncertainty.'],
  ['Occlusion', 'Glasses, masks, hands, hair and beards hide the features the model relies on. The model still outputs a number, which is why abstention matters.', 'Cover your mouth and see which class takes over.'],
  ['Facial variation', 'Faces differ in age, skin tone, bone structure, wrinkles and facial hair. If some groups are rarer in training data, error rates can be higher for them.', 'Compare results between different people, with their consent, and report them as slices.'],
  ['Dataset bias', 'AffectNet is scraped from the web: it over-represents people who post photos, posed expressions and certain regions, and its classes are imbalanced.', 'See per-class recall in the Evaluation Lab: rare classes usually score worse.'],
  ['Cultural differences', 'How strongly and when people express feelings, and how observers read them, varies across cultures. A single label set assumes the categories are universal.', 'Ask people from different backgrounds what they read in the same face.'],
  ['Expression ambiguity', 'Many expressions are blends, subtle, or genuinely ambiguous (a surprised smile, a polite smile). Annotators of the training set often disagreed with each other.', 'Look at the &quot;uncertain&quot; share and the margin between the top two classes.'],
];

export function BiasPage() {
  return (
    <div className="page">
      <header className="page-head">
        <h2>Bias and limitations</h2>
        <p>Read this before trusting any number on the other screens.</p>
      </header>

      <section className="panel statement">
        <h3 className="panel-title">What this app claims, and what it does not</h3>
        <div className="two-col tight">
          <div>
            <h4 className="good">It does say</h4>
            <ul className="plain">
              <li>&quot;Geeked&quot;, &quot;Wink&quot; and &quot;Kissy face&quot; come from simple geometry rules, not from learned emotion knowledge. They label a facial <i>pose</i>.</li>
              <li>&quot;The model estimates the most likely <b>visible</b> facial-expression category.&quot;</li>
              <li>&quot;Expression uncertain&quot; when it cannot decide.</li>
              <li>Scores, not truths.</li>
            </ul>
          </div>
          <div>
            <h4 className="bad">It never says</h4>
            <ul className="plain">
              <li>&quot;The AI knows how you feel.&quot;</li>
              <li>That a category equals an inner emotion.</li>
              <li>That a person is lying, bored, dangerous, engaged or suitable for anything.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="panel">
        <h3 className="panel-title">Eight things that change the result</h3>
        <div className="factors">
          {FACTORS.map(([k, what, test]) => (
            <article key={k} className="factor">
              <h4>{k}</h4>
              <p className="small">{what}</p>
              <p className="small try"><b>Try it:</b> <span dangerouslySetInnerHTML={{ __html: test }} /></p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h3 className="panel-title">The deeper problem: appearance is not emotion</h3>
        <ul className="plain small">
          <li>A 2019 review of the scientific evidence (Barrett, Adolphs, Marsella, Martinez and Pollak, <i>Psychological Science in the Public Interest</i>) concluded that facial movements do not reliably map to specific emotions: the same feeling is expressed in different ways, and the same expression occurs with different feelings.</li>
          <li>Models trained on human-labelled photos learn what annotators <i>thought</i> a face showed. They inherit that opinion, with its cultural assumptions.</li>
          <li>Confidence is not accuracy. A model can be 95% &quot;sure&quot; and wrong, especially for people or conditions that are rare in its training data.</li>
          <li>Because of these problems the EU AI Act prohibits using AI to infer emotions of people in workplaces and educational institutions, except for narrow medical or safety reasons.</li>
          <li>Only use tools like this with the informed consent of the person in front of the camera, and never to make decisions about them.</li>
        </ul>
      </section>
    </div>
  );
}
