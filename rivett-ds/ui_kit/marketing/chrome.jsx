/* global React, Wordmark, Button, Stamp */
// Page chrome: Nav, Footer, BookDiagnosticModal.

const NAV_LINKS = [
  { id: 'work', label: 'The work' },
  { id: 'notes', label: 'Field notes' },
  { id: 'mri', label: 'Revenue MRI' },
  { id: 'about', label: 'About' },
];

function Nav({ activeId, onNav, onBookDiagnostic }) {
  return (
    <nav className="site-nav">
      <Wordmark size="md" />
      <div className="links">
        {NAV_LINKS.map(l => (
          <a
            key={l.id}
            className={activeId === l.id ? 'active' : ''}
            onClick={(e) => { e.preventDefault(); onNav?.(l.id); }}
            href={`#${l.id}`}
          >
            {l.label}
          </a>
        ))}
      </div>
      <Button variant="solid" size="sm" onClick={onBookDiagnostic} arrow>
        Book diagnostic
      </Button>
    </nav>
  );
}

function SiteFooter() {
  return (
    <footer className="site-foot">
      <div className="page">
        <div className="row">
          <div>
            <Wordmark size="md" inverse />
          </div>
          <div className="col">
            <span className="col-h">The work</span>
            <a>Diagnostic</a>
            <a>Build</a>
            <a>Run</a>
            <a>Revenue MRI</a>
          </div>
          <div className="col">
            <span className="col-h">Field notes</span>
            <a>All notes</a>
            <a>Cadence</a>
            <a>Instrumentation</a>
            <a>Decline</a>
          </div>
          <div className="col">
            <span className="col-h">Contact</span>
            <a>tom@rivett.tech</a>
            <a>Calendar</a>
            <a>NDA</a>
          </div>
        </div>
        <div className="bot">
          <span>© rivett · 2026</span>
          <span>v1.0 · Cape Town &amp; remote</span>
        </div>
      </div>
    </footer>
  );
}

// Diagnostic-booking modal. Click-thru: name + email + stage → "Saved" stamp.
// Mirrors the components spec (full-bleed overlay, paper card, ESC chip).
function BookDiagnosticModal({ open, onClose }) {
  const [submitted, setSubmitted] = React.useState(false);
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [stage, setStage] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Reset on close
  React.useEffect(() => {
    if (!open) {
      setTimeout(() => { setSubmitted(false); setName(''); setEmail(''); setStage(''); }, 200);
    }
  }, [open]);

  function submit(e) {
    e.preventDefault();
    setSubmitted(true);
  }

  return (
    <div
      className={`modal-veil ${open ? 'open' : ''}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      aria-hidden={!open}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <button className="esc" onClick={onClose} aria-label="Close">[ESC] Close</button>
        {!submitted ? (
          <>
            <Stamp>Two-week engagement · £4k</Stamp>
            <h3 id="modal-title">Book the diagnostic. <span className="ital">No retainer required.</span></h3>
            <p className="dek">
              Senior eyes on your funnel, your spend, and the next ninety days. One document, one decision.
            </p>
            <form className="form" onSubmit={submit}>
              <div className="field">
                <label htmlFor="bd-name">Name <span className="req">REQUIRED</span></label>
                <input id="bd-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="bd-email">Email <span className="req">REQUIRED</span></label>
                <input id="bd-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="bd-stage">Where are the numbers? <span style={{color:'var(--ink-faint)', marginLeft:6}}>(stripe URL, sheet, slack — anything)</span></label>
                <input id="bd-stage" className="input" placeholder="stripe.com/… or pasted in a follow-up email" value={stage} onChange={(e) => setStage(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 'var(--sp-3)', marginTop: 'var(--sp-3)' }}>
                <Button variant="solid" type="submit" arrow>Book diagnostic</Button>
                <Button type="button" onClick={onClose}>Cancel</Button>
              </div>
            </form>
          </>
        ) : (
          <>
            <Stamp>Saved · 2026·05</Stamp>
            <h3>One moment. <span className="ital">Reading the curve.</span></h3>
            <div className="saved">
              <Stamp variant="neutral">REPLY WITHIN 48 HOURS</Stamp>
              <p>
                Thanks {name || 'there'}. We'll reply to <b style={{color:'var(--ink)'}}>{email || 'your inbox'}</b> with two diagnostic slots and a one-page intake. No retainer required to start.
              </p>
              <Button onClick={onClose}>Back to the page</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { Nav, SiteFooter, BookDiagnosticModal });
