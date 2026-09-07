import { FeedbackIcon, type FeedbackTone } from '../feedback-system';

const feedbackStates: Array<{
  tone: FeedbackTone;
  eyebrow: string;
  title: string;
  copy: string;
}> = [
  {
    tone: 'info',
    eyebrow: 'Helpful information',
    title: 'Your design is saved in this browser.',
    copy: 'You can keep exploring. Nothing has been ordered or charged.',
  },
  {
    tone: 'success',
    eyebrow: 'Completed',
    title: 'Reference image added.',
    copy: 'We’ll use it as visual inspiration for your design.',
  },
  {
    tone: 'reminder',
    eyebrow: 'Small next step',
    title: 'Accept the terms to continue.',
    copy: 'This keeps the next action clear without treating it as a failure.',
  },
  {
    tone: 'warning',
    eyebrow: 'Worth checking',
    title: 'Your delivery details need a quick look.',
    copy: 'Review the address before placing the order so we can ship it correctly.',
  },
  {
    tone: 'error',
    eyebrow: 'Action needed',
    title: 'We couldn’t verify your ZIP code.',
    copy: 'Check the five-digit ZIP code and try again.',
  },
];

export default function FeedbackPage() {
  return (
    <main className="feedback-page">
      <header className="feedback-page-header">
        <a aria-label="Back to Let It Be" className="feedback-wordmark" href="/">
          LET IT BE
        </a>
        <span>UI feedback system</span>
      </header>

      <section className="feedback-hero" aria-labelledby="feedback-page-heading">
        <p className="feedback-kicker">Feedback system</p>
        <h1 id="feedback-page-heading">Clear feedback, without the drama.</h1>
        <p>
          One visual language for messages, form feedback, and the moments where a customer needs a
          little guidance.
        </p>
      </section>

      <section className="feedback-principles" aria-label="Feedback principles">
        <div>
          <span>01</span>
          <strong>Say what happened</strong>
        </div>
        <div>
          <span>02</span>
          <strong>Make the next step obvious</strong>
        </div>
        <div>
          <span>03</span>
          <strong>Match the intensity to the moment</strong>
        </div>
      </section>

      <section className="feedback-specimens" aria-label="Feedback message examples">
        {feedbackStates.map((state) => (
          <article className={`feedback-message feedback-message-${state.tone}`} key={state.tone}>
            <div className="feedback-message-icon">
              <FeedbackIcon tone={state.tone} />
            </div>
            <div>
              <p>{state.eyebrow}</p>
              <h2>{state.title}</h2>
              <span>{state.copy}</span>
            </div>
          </article>
        ))}
      </section>

      <section className="feedback-form-examples" aria-labelledby="feedback-form-heading">
        <p className="feedback-kicker">In context</p>
        <h2 id="feedback-form-heading">Form feedback</h2>
        <div className="feedback-form-card">
          <label htmlFor="feedback-email">Email</label>
          <input id="feedback-email" placeholder="you@example.com" type="email" />
          <p className="feedback-field-help">
            <FeedbackIcon tone="info" /> We’ll only use this for your order updates.
          </p>
        </div>
        <div className="feedback-form-card feedback-form-card-error">
          <label htmlFor="feedback-zip">ZIP code</label>
          <input
            aria-describedby="feedback-zip-message"
            aria-invalid="true"
            id="feedback-zip"
            value="33"
            readOnly
          />
          <p className="feedback-field-help" id="feedback-zip-message">
            <FeedbackIcon tone="error" /> Enter a five-digit ZIP code.
          </p>
        </div>
        <div className="feedback-cta-example">
          <button type="button">
            Place order <span aria-hidden="true">→</span>
          </button>
          <p>
            <FeedbackIcon tone="reminder" /> Accept the terms to continue.
          </p>
        </div>
      </section>
    </main>
  );
}
