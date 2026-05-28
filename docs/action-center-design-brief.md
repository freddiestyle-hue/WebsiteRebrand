# Action Center — design brief

**Date:** 2026-05-28
**Status:** Pre-design. Eng review paused pending design direction.
**Companion docs:** `~/.gstack/projects/gandalf/gandalf-main-design-20260528-100122.md` (eng design doc)
**Related:** `docs/hq-dashboard-design-brief.md` (the /hq curiosity surface — visual system to inherit from)
**Prior visual systems to inherit from:** Rivett v1.0 design system at `rivett-ds/` (Inter Tight + Newsreader + DM Mono, ink #0E1A2C, paper #F4F2ED, sage #E8F0D9, accent-deep #4A6E18)

---

## What this surface is for

`/action-center` is the workflow surface for the daily Rivett outreach loop. It exists because `/hq` (the analytics dashboard) has become too interesting to act on — Fred opens it, looks at the data, doesn't write outreach. The action center has one job: **show 3-5 prospects who deserve a personalized DM today, with everything needed to write that DM one click away.**

It is NOT a dashboard. It is NOT analytics. It is the inbox between Fred and the outreach he should send.

---

## The job-to-be-done

Fred opens `/action-center` in the morning. He sees 3-5 prospects ranked by engagement signal strength. For each, he can immediately see:

1. **WHO** — first name + last name + title (from Airtable) + company
2. **WHY they're here** — the specific signal that earned the row (e.g., "4 distinct people read your audit across 3 days" or "Returned and scrolled to the bottom twice")
3. **PROOF** — the engagement detail Fred would actually mention in a DM (which audit dimensions they expanded, how many sessions, peak dwell)

He clicks **Draft DM** → modal slides in with a fully-drafted LinkedIn message OR Gmail email (his choice via tab). The draft uses the prospect's audit findings + the `/cold-email` skill v1.2.0 voice. He edits if needed, clicks **Copy + open LinkedIn** (mints shortlink, copies, opens prospect's LinkedIn) or **Open in Gmail** (pre-fills compose).

He marks the row **✓ Messaged**. The row disappears from the queue forever.

Done. Three minutes per prospect.

---

## Signal types and visual treatment

These are the only signals that earn a row. Each should be distinguishable at a glance:

| Signal | Plain-English why-line | Visual emphasis |
|---|---|---|
| **Multi-viewer** (≥2 distinct people) | "N people read your audit" | Strongest — internal forward = highest-quality cold-outreach signal |
| **Returning + engaged** (≥2 sessions AND real engagement) | "Came back N times, scrolled to bottom" | Strong — sticky interest |
| **CTA click + another signal** | "Clicked Book a call after reading 100%" | Strong — intent declared |

The signal type should be the first visible thing on each row, even before the name. Reason: when Fred is in scan mode, the signal tells him "is this worth my next 3 minutes?" before he even reads the name.

---

## Anti-patterns (please don't)

- **No KPIs at the top.** No "X memo views today" / "Y CTA clicks this week." That's /hq's job. Action center is queue, not numbers.
- **No charts.** No trends, no sparklines, no time-series. The queue is a list, not a report.
- **No "recent activity" feed.** Recent reads belong on /hq. Action center is "who deserves a DM right now," not "who looked at the site."
- **No infinite scroll.** Max 5 rows. Hard limit. Forces signal threshold to stay high.
- **No "messaged 2h ago" history.** Once a row is messaged, it disappears. The history lives in Airtable.
- **No 5-section nav at top.** This page is one job.

---

## Three design directions to explore

I'd like to see at least these three flavors, plus any others worth considering:

### Direction A — "Editorial briefing"
The page reads like a one-page briefing memo. Each prospect is a paragraph-shaped row with serif body text (Newsreader) for the why-line. Strong typographic hierarchy. Reference: weekly investment memo, M&A teaser.

**Mood:** Considered, deliberate, "this is my morning brief." Slow to scan but high signal density per row.

### Direction B — "Email triage"
The page reads like an inbox. Each row is a tight horizontal strip. Signal badge → name → why-line → action buttons inline on the right. Scanned vertically in <5 seconds. Reference: Superhuman, Linear inbox view.

**Mood:** Fast, operational, "I am triaging these now." Optimized for the morning scan + decide loop.

### Direction C — "Card stack"
The page is a vertical stack of fat cards (one per prospect). Each card is a small dossier: name + company + why + audit thumbnail + draft DM CTA. Designed for the "I'm going to write this one now" mode where the card expands into the draft composer in-place.

**Mood:** Focused, "I'm on this one prospect." Less scannable but lower friction from "decided to act" → "DM drafted."

---

## Components to inherit / reuse

- **Existing `ActionQueue.astro`** has all the working machinery: heat badges, LinkedIn link generation, draft modal, Gmail/LinkedIn tab switcher, ✓ Messaged toggle, session replay drill-down. The visual treatment can change, but the underlying component should be reused / extended, not rewritten.
- **Rivett design tokens** (`rivett-ds/tokens.css`) — Inter Tight + Newsreader + DM Mono, paper / ink / sage / accent-deep. Same palette as /hq for visual continuity.
- **Heat badge component** — existing `.heat-pill` styling for HOT/WARM/COOL/COLD. May or may not map to action center's "signal type" badges; designer's call.

---

## Empty state

When no prospect crosses the signal threshold today: a single honest message.

> No real signals today. Send more outreach.

Plus a one-line link to the existing outreach queue or Airtable. Do not pad with "here's what the queue COULD show you" or recent history. Honest empty state respects the user.

---

## Mobile

Desktop-first. Fred works on desktop in the morning. Mobile is a nice-to-have but not the priority. If a design works only on desktop and is excellent there, that's fine. If it works on both gracefully, better.

---

## Performance / technical constraints

- Server-rendered Astro page (same pattern as /hq)
- Same auth as /hq (HQ_KEY cookie)
- Caching layer is already in place (Upstash Redis, 5-minute TTL via /api/cron/warm-hq)
- The shared `getTopProspects` query already loads everything needed (name, signals, sessions, Airtable info via `prospectInfo`)
- Filter applied in TS via new `isActionableProspect(p)` helper (see eng design doc)
- The draft DM modal is already built and works perfectly — don't redesign it unless there's a strong reason

---

## Decisions for the designer

I would like a recommendation on each of these:

1. **Direction A vs B vs C** (or a hybrid)? What's the right shape for the morning-scan-and-act loop?
2. **Default landing page**: should `/action-center` replace `/hq` as the default landing, or sit alongside as a sibling reached via banner? (Affects nav, bookmark muscle memory, alert email links.)
3. **Signal display**: badge + tag, sentence, paragraph, illustrated icon? How much real estate does the "why" line deserve?
4. **Draft DM affordance**: prominent CTA, hover-revealed button, or always-visible inline button?
5. **Empty state design**: minimal text, illustration, or a single "send more outreach" link to the outreach queue?

---

## Out of scope for design

- The draft DM modal interior (already exists, works, "exactly as is" per Fred)
- The /hq surface itself (separate brief, stays unchanged except for a banner pointing to /action-center)
- Email digest design (handled in eng layer)

---

## Process

After options land, Fred picks a direction. The eng review (`/plan-eng-review`) resumes against the chosen direction and ships per the eng design doc.
