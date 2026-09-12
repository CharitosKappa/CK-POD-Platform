'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';

export type SupportPageKey =
  'faq' | 'contact' | 'shipping' | 'payments' | 'returns' | 'terms' | 'privacy';

type ContentSection = {
  title: string;
  body: string;
};

const PAGE_CONTENT: Record<
  Exclude<SupportPageKey, 'faq' | 'contact'>,
  {
    eyebrow: string;
    title: string;
    lede: string;
    sections: ContentSection[];
  }
> = {
  shipping: {
    eyebrow: 'Delivery',
    title: 'Shipping & delivery',
    lede: 'A simple overview of how your custom shirt gets from creation to your door.',
    sections: [
      {
        title: 'Fulfillment',
        body: 'Each shirt is made after you place your order. We’ll begin production once your order is confirmed.',
      },
      {
        title: 'Shipping options',
        body: 'Available delivery options and their estimated arrival windows are shown at checkout before you complete your order.',
      },
      {
        title: 'Tracking',
        body: 'When your order ships, we’ll send a confirmation with tracking details to the email used at checkout.',
      },
    ],
  },
  payments: {
    eyebrow: 'Checkout',
    title: 'Payments',
    lede: 'What to expect when you are ready to place an order.',
    sections: [
      {
        title: 'Payment methods',
        body: 'The payment methods available for your order are displayed securely at checkout.',
      },
      {
        title: 'When you are charged',
        body: 'Your payment is authorized when you place an order and confirmed once your order is accepted for fulfillment.',
      },
      {
        title: 'Taxes & totals',
        body: 'Your final total, including any shipping and applicable taxes, is shown before you complete your purchase.',
      },
    ],
  },
  returns: {
    eyebrow: 'Orders',
    title: 'Returns & refunds',
    lede: 'A clear starting point if there is an issue with your order.',
    sections: [
      {
        title: 'Made for you',
        body: 'Because every shirt is made to order, return eligibility depends on the order and the reason for the request.',
      },
      {
        title: 'If something is wrong',
        body: 'Contact us with your order details and a short description of the issue. We’ll review the next steps with you.',
      },
      {
        title: 'Refunds',
        body: 'If a refund is approved, it is returned to the original payment method. Timing can vary by payment provider.',
      },
    ],
  },
  terms: {
    eyebrow: 'Legal',
    title: 'Terms & Conditions',
    lede: 'The terms that apply when you use LET IT BE and place an order.',
    sections: [
      {
        title: 'Using the store',
        body: 'Use the store responsibly and provide accurate order and contact information when you check out.',
      },
      {
        title: 'Custom designs',
        body: 'You are responsible for the design ideas and reference material you submit. Do not submit content you do not have the right to use.',
      },
      {
        title: 'Orders & fulfillment',
        body: 'Product availability, fulfillment timing, shipping, and returns are subject to the details shown during checkout and the applicable order.',
      },
    ],
  },
  privacy: {
    eyebrow: 'Legal',
    title: 'Privacy Policy',
    lede: 'How information is used to make your store experience and orders work.',
    sections: [
      {
        title: 'Information you provide',
        body: 'This may include contact, delivery, order, and account information that you choose to provide.',
      },
      {
        title: 'How it is used',
        body: 'Information is used to provide the store experience, process orders, communicate about an order, and improve the service.',
      },
      {
        title: 'Your choices',
        body: 'You can choose whether to receive optional marketing messages and can contact us with questions about your information.',
      },
    ],
  },
};

const FAQ_GROUPS = [
  {
    title: 'Designs & design credits',
    questions: [
      [
        'How do design credits work?',
        'A design credit is used when you generate a new design. Your available design credits and their history are shown in your account.',
      ],
      [
        'Can I save a design?',
        'Yes. Designs you keep can be found in Saved designs when you are signed in.',
      ],
    ],
  },
  {
    title: 'Orders & delivery',
    questions: [
      [
        'When will my shirt arrive?',
        'Production and delivery estimates are shown at checkout, before you place your order.',
      ],
      [
        'Will I receive tracking?',
        'Yes. Once an order ships, tracking details are sent to the email used at checkout.',
      ],
    ],
  },
  {
    title: 'Payments & returns',
    questions: [
      [
        'When is my card charged?',
        'Your final total is shown before you complete the order. Payment is authorized when you place it.',
      ],
      [
        'What if there is an issue with my order?',
        'Contact us with the order details and we’ll help you with the available next steps.',
      ],
    ],
  },
];

const FOOTER_LINKS: Array<{ href: string; label: string }> = [
  { href: '/faq', label: 'FAQ' },
  { href: '/contact', label: 'Contact' },
  { href: '/shipping', label: 'Shipping' },
  { href: '/payments', label: 'Payments' },
  { href: '/returns', label: 'Returns' },
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
];

function SupportHeader() {
  return (
    <header className="support-page-header">
      <a aria-label="Back to shop" className="support-page-back" href="/">
        ← <span>Shop</span>
      </a>
      <a aria-label="LET IT BE home" className="support-page-wordmark" href="/">
        LET IT BE
      </a>
      <a className="support-page-menu" href="/?menu=1" aria-label="Open menu">
        Menu
      </a>
    </header>
  );
}

function SupportFooter() {
  return (
    <footer className="support-page-footer">
      <span>LET IT BE</span>
      <nav aria-label="Support and legal links">
        {FOOTER_LINKS.map((link) => (
          <a href={link.href} key={link.href}>
            {link.label}
          </a>
        ))}
      </nav>
    </footer>
  );
}

function ContactPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setSent(false);
      setError('Enter a valid email address.');
      return;
    }
    if (!message.trim()) {
      setSent(false);
      setError('Tell us how we can help.');
      return;
    }
    setError('');
    setSent(true);
  };

  return (
    <>
      <p className="support-page-eyebrow">Support</p>
      <h1>Contact us</h1>
      <p className="support-page-lede">Have a question about a design or order? Send us a note.</p>
      <form className="contact-form" noValidate onSubmit={submit}>
        <label>
          <span>Email</span>
          <input
            autoComplete="email"
            inputMode="email"
            onChange={(event) => {
              setEmail(event.target.value);
              setError('');
            }}
            placeholder="you@example.com"
            type="email"
            value={email}
          />
        </label>
        <label>
          <span>Message</span>
          <textarea
            onChange={(event) => {
              setMessage(event.target.value);
              setError('');
            }}
            placeholder="How can we help?"
            rows={5}
            value={message}
          />
        </label>
        {error ? (
          <p className="support-form-feedback is-error" role="alert">
            {error}
          </p>
        ) : null}
        {sent ? (
          <p className="support-form-feedback is-success" role="status">
            Message sent. We’ll be in touch soon.
          </p>
        ) : null}
        <button className="support-submit" type="submit">
          Send message <span aria-hidden="true">→</span>
        </button>
      </form>
    </>
  );
}

function FaqPage() {
  return (
    <>
      <p className="support-page-eyebrow">Support</p>
      <h1>Frequently asked questions</h1>
      <p className="support-page-lede">
        The essentials for creating, ordering, and receiving your custom shirt.
      </p>
      <div className="faq-groups">
        {FAQ_GROUPS.map((group) => (
          <section className="faq-group" key={group.title}>
            <h2>{group.title}</h2>
            {group.questions.map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {question}
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}

export function SupportPage({ page }: { page: SupportPageKey }) {
  const content = page !== 'faq' && page !== 'contact' ? PAGE_CONTENT[page] : null;
  return (
    <main className="support-page">
      <SupportHeader />
      <article className="support-page-content">
        {page === 'faq' ? <FaqPage /> : null}
        {page === 'contact' ? <ContactPage /> : null}
        {content ? (
          <>
            <p className="support-page-eyebrow">{content.eyebrow}</p>
            <h1>{content.title}</h1>
            <p className="support-page-lede">{content.lede}</p>
            <div className="support-page-sections">
              {content.sections.map((section) => (
                <section key={section.title}>
                  <h2>{section.title}</h2>
                  <p>{section.body}</p>
                </section>
              ))}
            </div>
          </>
        ) : null}
      </article>
      <SupportFooter />
    </main>
  );
}
