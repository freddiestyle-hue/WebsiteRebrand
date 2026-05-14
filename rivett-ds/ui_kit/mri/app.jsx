/* global React, ReactDOM, Wordmark, Stamp, Button, Icon, Nav, SiteFooter,
   SecHead, SecBody, Pull, EndCTA */
// The 12-vital Revenue MRI. Click any vital cell to see its memo overlay.
// Click "Run a sample MRI →" to simulate a scan (score panel + bars fill in).

const VITALS = [
  { v: 'V·01', name: 'Pipeline velocity', italic: 'deals × time.',
    body: 'How fast a qualified lead clears each stage.',
    score: 'g', reading: '4.2', unit: 'deals / wk', delta: '+0.6',
    finding: 'Velocity is up across the last 14 days. The win-back sequence cleared backlog.',
    plan: 'Hold. Re-instrument after the build closes.' },
  { v: 'V·02', name: 'Decline rate', italic: 'a healthy filter.',
    body: 'Share of inbound that gets a polite no.',
    score: 'a', reading: '38', unit: '%', delta: '−2.1',
    finding: 'Decline rate dipped under 40% for the first time this quarter. Sales is letting more through.',
    plan: 'Reset the qualifier. Restore the 50% floor in the next two weeks.' },
  { v: 'V·03', name: 'Outreach reply', italic: 'real inbox response.',
    body: 'Reply rate on the 9-step lifecycle, top-of-funnel only.',
    score: 'r', reading: '11', unit: '%', delta: '−4.4',
    finding: 'Reply rate halved after the copy refresh. The new opener reads as marketing.',
    plan: 'Roll back the v3 copy. A/B against v2 baseline for one fortnight.' },
  { v: 'V·04', name: 'Cadence held', italic: 'memos shipped.',
    body: 'How many fortnightly read-outs landed on time.',
    score: 'g', reading: '9', unit: '/ 10', delta: '±0',
    finding: 'Cadence is the strongest vital. One miss in Q2, in the holiday window.',
    plan: 'Hold. This is the floor; do not let it slip.' },
  { v: 'V·05', name: 'First-call ratio', italic: 'closes inside week 02.',
    body: 'Deals closed on or before the second touch.',
    score: 'a', reading: '17', unit: '%', delta: '+1.8',
    finding: 'Direction is right but absolute number is below the 25% target.',
    plan: 'Pull the proposal forward by one call. Re-test in 4 weeks.' },
  { v: 'V·06', name: 'Instrumented', italic: 'events shipping.',
    body: 'Share of revenue events landing in the warehouse.',
    score: 'g', reading: '94', unit: '%', delta: '+3.0',
    finding: 'Coverage cleared 90% after the Stripe webhook fix. Refunds still partial.',
    plan: 'Add refunds + chargeback to the pipeline. 02 wks.' },
  { v: 'V·07', name: 'CAC payback', italic: 'months to break-even.',
    body: 'Blended payback across paid + organic.',
    score: 'r', reading: '18', unit: 'mo', delta: '+2.4',
    finding: 'Payback drifted past the 12-month gate. Paid mix is dragging the blended.',
    plan: 'Halt paid for a fortnight. Restart with a tighter creative ceiling.' },
  { v: 'V·08', name: 'NRR', italic: 'net revenue retention.',
    body: 'Trailing 90-day NRR by cohort.',
    score: 'g', reading: '118', unit: '%', delta: '+4.0',
    finding: 'NRR is the only vital running ahead of plan. Expansion is real, not survey.',
    plan: 'Lean into the expansion offer. Build it into the run cadence.' },
  { v: 'V·09', name: 'Memo pack', italic: 'on a board.',
    body: 'Whether the last quarterly memo was board-grade.',
    score: 'a', reading: '06', unit: '/ 10', delta: '+1.0',
    finding: 'Memo was useful but rubric-soft. The "what to halt" section is light.',
    plan: 'Re-template the memo. The halt list is the lede.' },
  { v: 'V·10', name: 'Halt list', italic: 'things we stopped.',
    body: 'Count of items affirmatively killed in the last 30 days.',
    score: 'i', reading: '00', unit: 'items', delta: '',
    finding: 'Insufficient data. The halt list was not maintained this period.',
    plan: 'Open a halt log on the next read-out. Floor: 02 / mo.' },
  { v: 'V·11', name: 'Reply latency', italic: 'inbox-to-action.',
    body: 'Median hours from inbound reply to a calendar invite.',
    score: 'g', reading: '11', unit: 'hrs', delta: '−2.0',
    finding: 'Latency dropped after the calendar-as-default reply pattern shipped.',
    plan: 'Hold. The 24-hour ceiling holds; do not over-engineer.' },
  { v: 'V·12', name: 'Decision throughput', italic: 'memos to decisions.',
    body: 'How many memos resulted in an explicit halt / proceed / hold.',
    score: 'a', reading: '04', unit: '/ 06', delta: '+1.0',
    finding: 'Two memos shipped without a follow-on decision. The memo is the artifact, the decision is the product.',
    plan: 'Every memo lands with a decision row. No exceptions for 04 wks.' },
];

function MRIPanel({ score, scanning }) {
  return (
    <div className="mri-panel">
      <span className="lbl">{scanning ? 'Scanning · V·09 / V·12' : 'READOUT · v1.0'}</span>
      <div className={`read ${scanning ? 'scanning' : ''}`}>
        {score} <span className="accent">/ 100</span>
      </div>
      <div className="scale">
        <span className={`seg ${score >= 1  ? 'dim-lit' : ''}`}></span>
        <span className={`seg ${score >= 21 ? 'dim-lit' : ''}`}></span>
        <span className={`seg ${score >= 41 ? 'lit'     : ''}`}></span>
        <span className={`seg ${score >= 61 ? 'lit'     : ''}`}></span>
        <span className={`seg ${score >= 81 ? 'lit'     : ''}`}></span>
      </div>
      <div className="markers">
        <span>halt</span>
        <span>amber</span>
        <span>green</span>
      </div>
      <div className="mri-readout">
        <div className="row"><span className="key">Pipeline</span><span className="val">4.2 <span className="ital">deals / wk</span></span><span className="badge green">Green</span></div>
        <div className="row"><span className="key">Decline rate</span><span className="val">38 <span className="ital">%</span></span><span className="badge amber">Amber</span></div>
        <div className="row"><span className="key">Outreach reply</span><span className="val">11 <span className="ital">%</span></span><span className="badge red">Red</span></div>
        <div className="row"><span className="key">Halt list</span><span className="val"><span className="ital">no data</span></span><span className="badge muted">Insufficient</span></div>
      </div>
    </div>
  );
}

function Vital({ v, name, italic, body, score, onOpen, filled }) {
  const SCORE_LABEL = { g: 'Green', a: 'Amber', r: 'Red', i: 'Insufficient' };
  return (
    <div className="vital" onClick={onOpen} role="button" tabIndex={0}
         onKeyDown={(e) => { if (e.key === 'Enter') onOpen?.(); }}>
      <div className="head">
        <span className="key">{v}</span>
        <span className={`score ${score}`}>{SCORE_LABEL[score]}</span>
      </div>
      <h4>{name} <span className="ital">{italic}</span></h4>
      <p>{body}</p>
      <div className="bar">
        <div className={`fill ${score}`} style={{ transform: filled ? 'scaleX(1)' : 'scaleX(0)' }}></div>
      </div>
    </div>
  );
}

function VitalDetail({ vital, onClose }) {
  if (!vital) return null;
  return (
    <div className="modal-veil open" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="vital-detail" role="dialog" aria-modal="true">
        <button className="esc" onClick={onClose}>[ESC] Close</button>
        <Stamp>{vital.v} · {SCORE_LABEL[vital.score] ?? ''}</Stamp>
        <h3>{vital.name}. <span className="ital">{vital.italic}</span></h3>
        <div className="reading">
          {vital.reading}
          <span className="u">{vital.unit}</span>
          {vital.delta && (
            <span style={{
              fontSize: 18, marginLeft: 14, color: vital.delta.startsWith('+') ? 'var(--accent-deep)' :
                                                  vital.delta.startsWith('−') ? 'var(--signal-halt)' : 'var(--ink-faint)',
              fontFamily: 'var(--mono)', letterSpacing: 'var(--track-mono)', verticalAlign: 8,
            }}>{vital.delta} · 14d</span>
          )}
        </div>
        <p className="find"><b style={{color:'var(--ink)'}}>Finding.</b> {vital.finding}</p>
        <div className="ninety">
          <span className="lbl">Next 90 days · plan</span>
          {vital.plan}
        </div>
      </div>
    </div>
  );
}
const SCORE_LABEL = { g: 'Green', a: 'Amber', r: 'Red', i: 'Insufficient' };

function MRIHome() {
  const [score, setScore] = React.useState(62);
  const [scanning, setScanning] = React.useState(false);
  const [filled, setFilled] = React.useState(true);
  const [active, setActive] = React.useState(null);
  const [activeNav, setActiveNav] = React.useState('mri');

  function runScan() {
    setScore(0);
    setFilled(false);
    setScanning(true);
    // Animate score in increments. Total ~2.2s.
    const target = 62;
    const steps = 28;
    let s = 0;
    const iv = setInterval(() => {
      s += 1;
      setScore(Math.round((target * s) / steps));
      if (s >= steps) {
        clearInterval(iv);
        setScanning(false);
        setFilled(true);
      }
    }, 60);
  }

  return (
    <>
      <div className="page" data-screen-label="02 Revenue MRI">
        <Nav activeId={activeNav} onNav={setActiveNav} onBookDiagnostic={() => alert('Book diagnostic')} />

        <header className="mri-hero">
          <div className="left">
            <Stamp>Revenue MRI · v1.0 · A 12-vital diagnostic</Stamp>
            <h1>A sober read. <span className="ital">In a fortnight.</span></h1>
            <p className="dek">
              Twelve vitals, scored against thresholds drawn from a hundred prior practices.
              The output is a one-page memo: the diagnosis, the next 90 days, and what to halt.
              No dashboard. No charts wall. One document, one decision.
            </p>
            <div className="mri-actions">
              <Button variant="solid" arrow onClick={runScan}>Run a sample MRI</Button>
              <Button>Book the MRI</Button>
            </div>
          </div>
          <div className="right">
            <MRIPanel score={score} scanning={scanning} />
          </div>
        </header>

        <SecHead label="Rubric" num="01">
          Twelve vitals, <span className="ital">in four bands.</span>
        </SecHead>
        <SecBody>
          <p style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 21, lineHeight: 1.45, color: 'var(--ink-dim)', maxWidth: 680, margin: '0 0 var(--sp-8)' }}>
            Each vital scores green / amber / red / insufficient.
            <span style={{ color: 'var(--ink)' }}> A red is a finding. An insufficiency is a question that has not been asked.</span>
          </p>
          <div className="vitals">
            {VITALS.map((v, i) => (
              <Vital key={v.v} {...v} filled={filled} onOpen={() => setActive(v)} />
            ))}
          </div>
        </SecBody>

        <SecHead label="Process" num="02">
          Four steps, <span className="ital">over fourteen days.</span>
        </SecHead>
        <SecBody>
          <div className="timeline">
            <div className="step">
              <span className="day">Day · 01–03</span>
              <div className="num">01</div>
              <h4>Read-in.</h4>
              <p>You send the numbers. We read in the warehouse, the stripe, the dashboard, the meeting notes.</p>
            </div>
            <div className="step">
              <span className="day">Day · 04–07</span>
              <div className="num">02</div>
              <h4>Score.</h4>
              <p>Twelve vitals scored against the rubric. Every red is verified twice. Every insufficiency is logged.</p>
            </div>
            <div className="step">
              <span className="day">Day · 08–12</span>
              <div className="num">03</div>
              <h4>Memo.</h4>
              <p>One page. The diagnosis, the 90-day plan, the halt list. Drafted, reviewed, drafted again.</p>
            </div>
            <div className="step">
              <span className="day">Day · 13–14</span>
              <div className="num">04</div>
              <h4>Read-out.</h4>
              <p>A live read with you and your board, if you want one. 40–60 <span style={{fontFamily:'var(--serif)',fontStyle:'italic',color:'var(--ink-dim)'}}>min.</span></p>
            </div>
          </div>
        </SecBody>

        <Pull
          quote="A red is a finding. An insufficiency is a question that has not been asked."
          citation="— rubric note · 2026·05"
        />

        <EndCTA
          headline="If your numbers are live but the curve is flat,"
          italic="the MRI is the next call."
          stamp="Two-week engagement · £4k"
          body="One document, one decision. The MRI is the diagnostic — the same scope, named for the tool."
          cta="Book the MRI"
          onClick={() => alert('Book the MRI')}
        />
      </div>

      <SiteFooter />

      <VitalDetail vital={active} onClose={() => setActive(null)} />
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<MRIHome />);
