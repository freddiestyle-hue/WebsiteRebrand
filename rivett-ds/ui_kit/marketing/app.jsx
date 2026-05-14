/* global React, ReactDOM,
   Nav, SiteFooter, BookDiagnosticModal,
   Hero, SecHead, SecBody,
   ModuleCard, ModuleTriad,
   AutoRow, AutomateList, Numbox,
   AudienceCol, AudienceTriad,
   Pull, NoteCard, NotesGrid, EndCTA */

// The marketing surface, composed from the kit.
// This is a 1:1 recreation of spec/templates/home.html using the React components,
// plus a working "Book diagnostic" modal so the page click-thrus.

function MarketingHome() {
  const [activeId, setActiveId] = React.useState('work');
  const [bookOpen, setBookOpen] = React.useState(false);

  const book = React.useCallback(() => setBookOpen(true), []);

  return (
    <>
      <div className="page" data-screen-label="01 Marketing home">
        <Nav
          activeId={activeId}
          onNav={setActiveId}
          onBookDiagnostic={book}
        />

        <Hero
          stamp="A senior practice · Cape Town & remote"
          headline={<>Growth infrastructure <span className="ital">for operators.</span></>}
          dek="Two-week diagnostic. Six-week build. Twelve-week run. Fortnightly read-out. Specific numbers, not a deck. The honest answer is rarely the loud one — and it's almost always cheaper than the playbook says."
          primary="Book diagnostic"
          secondary="Read field notes"
          onPrimary={book}
        />

        {/* 01 The work */}
        <SecHead label="The work" num="01">
          Three modules, <span className="ital">in the same key.</span>
        </SecHead>
        <SecBody>
          <ModuleTriad>
            <ModuleCard
              icon="diagnostic" code="M · 01"
              headline="Diagnostic." italic="Two weeks."
              body="Senior eyes on your funnel, your spend, and the next ninety days. One document, one decision. £4,000."
              metaLeft={<><b>02</b> wks</>} metaRight="£4k"
            />
            <ModuleCard
              icon="stack" code="M · 02"
              headline="Build." italic={<>Stack &amp; instrumentation.</>}
              body="Pipelines, instrumentation, the first ten experiments. Six weeks. Senior hands at the keyboard, not a slide."
              metaLeft={<><b>04–06</b> wks</>} metaRight="£18k"
            />
            <ModuleCard
              icon="cadence" code="M · 03"
              headline="Run." italic="Cadence over volume."
              body="Fortnightly read-out, monthly decision memo, quarterly board pack. The work that turns a stack into a habit."
              metaLeft={<><b>£12k</b> / mo</>} metaRight="12 wk min"
            />
          </ModuleTriad>
        </SecBody>

        {/* 02 What I automate */}
        <SecHead label="Tuesday" num="02">
          What I actually do <span className="ital">on a Tuesday.</span>
        </SecHead>
        <SecBody>
          <AutomateList>
            <AutoRow
              icon="pipeline"
              title="Pipelines, end-to-end."
              body="From event to dashboard to decision. The pipe is the product."
            />
            <AutoRow
              icon="outreach"
              title="Outreach that doesn't read like outreach."
              body="Lifecycle, win-back, and inbox copy that survives a senior person reading it."
            />
            <AutoRow
              icon="numbers"
              title="The numbers, instrumented."
              body="Not a dashboard. A single weekly number that can hold up a decision."
            />
            <AutoRow
              icon="signal"
              title="Signal extraction."
              body="What changed, what's noise, what's worth a board call. A weekly briefing, not a wall of charts."
            />
            <AutoRow
              icon="memo"
              title="Memos."
              body="The decision memo, the post-mortem, the board pack. Plain language. Specific numbers."
            />
            <AutoRow
              icon="decline"
              title="Decline letters."
              body="Half the value of a senior operator is the meeting that doesn't happen. The vendor that doesn't get hired."
            />
          </AutomateList>

          <div style={{ marginTop: 'var(--sp-10)' }}>
            <Numbox items={[
              { k: 'Diagnostic', v: '02', u: 'wks' },
              { k: 'Build',      v: '04–06', u: 'wks' },
              { k: 'Run',        v: '£12k', u: '/ mo' },
              { k: 'First read', v: '14', u: 'days' },
            ]} />
          </div>
        </SecBody>

        {/* 03 Audience */}
        <SecHead label="Who hires" num="03">
          Three audiences, <span className="ital">one practice.</span>
        </SecHead>
        <SecBody>
          <AudienceTriad>
            <AudienceCol
              stamp="For founders"
              headline="Numbers are live,"
              italic="next move unclear."
              body="You have revenue and a team. You are not sure where the next 90 days of effort should land. The diagnostic."
            />
            <AudienceCol
              stamp="For operators"
              headline="You inherited"
              italic="a stack."
              body="Marketing exists, sales exists, the data exists somewhere. Senior eyes, instrumentation, and a fortnightly read-out."
            />
            <AudienceCol
              stamp="For boards"
              headline="You need"
              italic="a sober read."
              body="The portfolio company is shipping but the curve is flat. A two-week independent diagnostic, written for a board pack."
            />
          </AudienceTriad>
        </SecBody>

        {/* Pull quote */}
        <Pull
          quote="The work isn't to ship more. It's to ship the right thing, instrumented, on the right cadence — and to know within a fortnight whether it's bending the curve."
          citation="— field note 04 · Cadence over volume"
        />

        {/* 04 Field notes */}
        <SecHead label="Field notes" num="04">
          Recent reading. <span className="ital">Honest, not loud.</span>
        </SecHead>
        <SecBody>
          <NotesGrid>
            <NoteCard
              code="Note · 04"
              headline="Cadence" italic="over volume."
              body="Why shipping less but instrumented beats shipping more. The fortnightly read-out and the budget that follows."
              date="2025·09" readTime="7 min"
            />
            <NoteCard
              code="Note · 03"
              headline="The decline letter" italic="earns its keep."
              body="Half the value of a senior operator is the vendor that doesn't get hired and the meeting that doesn't happen."
              date="2025·08" readTime="5 min"
            />
            <NoteCard
              code="Note · 02"
              headline="Instrumented before clever."
              body="The order is non-negotiable. You cannot run a fortnightly read-out off intuition and a slack thread."
              date="2025·07" readTime="9 min"
            />
          </NotesGrid>
        </SecBody>

        <EndCTA
          headline="If your numbers are live but the next move is unclear,"
          italic="that's the diagnostic."
          stamp="Two-week engagement"
          body="Senior eyes on your funnel, your spend, and the next 90 days. £4k. No retainer required to start."
          cta="Book diagnostic"
          onClick={book}
        />
      </div>

      <SiteFooter />

      <BookDiagnosticModal
        open={bookOpen}
        onClose={() => setBookOpen(false)}
      />
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<MarketingHome />);
