/* global React, Icon, Stamp, Button */
// Editorial blocks composed from spec/04-patterns.html + spec/templates/home.html.

// Section head — 240px sticky label + h2 with italic clause.
function SecHead({ label, num, children }) {
  return (
    <div className="sec-head">
      <span className="lbl">{label}<span className="num">{num}</span></span>
      <h2>{children}</h2>
    </div>
  );
}
function SecBody({ children }) {
  return <div className="sec-body">{children}</div>;
}

// Hero — stamp · h1 · dek · actions
function Hero({ stamp, headline, dek, primary, secondary, onPrimary, onSecondary }) {
  return (
    <header className="hero">
      <Stamp>{stamp}</Stamp>
      <h1>{headline}</h1>
      <p className="dek">{dek}</p>
      <div className="actions">
        {primary && <Button variant="solid" arrow onClick={onPrimary}>{primary}</Button>}
        {secondary && <Button onClick={onSecondary}>{secondary}</Button>}
      </div>
    </header>
  );
}

// Module card — used in the home triad. icon · code · h3 · body · meta
function ModuleCard({ icon, code, headline, italic, body, metaLeft, metaRight }) {
  return (
    <div className="mod">
      <div className="head">
        <Icon name={icon} size={24} />
        <span style={{
          fontFamily: 'var(--mono)', fontSize: 11,
          letterSpacing: 'var(--track-mono)', textTransform: 'uppercase',
          color: 'var(--ink-faint)',
        }}>{code}</span>
      </div>
      <h3>{headline} <span className="ital">{italic}</span></h3>
      <p>{body}</p>
      <div className="meta">
        <span>{metaLeft}</span>
        <span>{metaRight}</span>
      </div>
    </div>
  );
}
function ModuleTriad({ children }) { return <div className="modules">{children}</div>; }

// Automate list — icon + title + body row
function AutoRow({ icon, title, body }) {
  return (
    <div className="auto-row">
      <Icon name={icon} size={24} />
      <div>
        <h4>{title}</h4>
        <p>{body}</p>
      </div>
    </div>
  );
}
function AutomateList({ children }) { return <div className="automate">{children}</div>; }

// Numbox — sage-tinted four-cell key/value strip
function Numbox({ items }) {
  return (
    <div className="numbox">
      {items.map((it, i) => (
        <div key={i}>
          <span className="k">{it.k}</span>
          <span className="v">{it.v} <span className="ital">{it.u}</span></span>
        </div>
      ))}
    </div>
  );
}

// Audience column
function AudienceCol({ stamp, headline, italic, body }) {
  return (
    <div className="col">
      <Stamp>{stamp}</Stamp>
      <h4>{headline} <span className="ital">{italic}</span></h4>
      <p>{body}</p>
    </div>
  );
}
function AudienceTriad({ children }) { return <div className="audience">{children}</div>; }

// Pull quote — top + bottom hairline, Newsreader italic
function Pull({ quote, citation }) {
  return (
    <div className="pull">
      <blockquote>"{quote}"</blockquote>
      <cite>{citation}</cite>
    </div>
  );
}

// Note card — for the field-notes grid
function NoteCard({ code, headline, italic, body, date, readTime }) {
  return (
    <a className="note-card">
      <Stamp>{code}</Stamp>
      <h4>{headline} <span className="ital">{italic}</span></h4>
      <p>{body}</p>
      <div className="meta">
        <span>{date} · {readTime}</span>
        <span>Read →</span>
      </div>
    </a>
  );
}
function NotesGrid({ children }) { return <div className="notes-grid">{children}</div>; }

// End CTA — the mandatory dark closer
function EndCTA({ headline, italic, stamp, body, cta, onClick }) {
  return (
    <div className="end-cta">
      <h3>{headline} <span className="ital">{italic}</span></h3>
      <div className="right">
        <Stamp variant="on-ink">{stamp}</Stamp>
        <p>{body}</p>
        <Button variant="inverse" arrow onClick={onClick}>{cta}</Button>
      </div>
    </div>
  );
}

Object.assign(window, {
  SecHead, SecBody, Hero,
  ModuleCard, ModuleTriad,
  AutoRow, AutomateList, Numbox,
  AudienceCol, AudienceTriad,
  Pull, NoteCard, NotesGrid, EndCTA,
});
