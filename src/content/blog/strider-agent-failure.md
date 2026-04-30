---
tag: Company
title: "Strider was the wanderer I wasn't ready to lead with."
date: 2026-04-08
lastModified: 2026-04-16
slug: strider-agent-failure
excerpt: "My first SDR agent failed spectacularly. Here's what breaking taught me about building agents that actually work."
metaDescription: "How my first agent failed and what I learned rebuilding it. The Strider to Aragorn journey."
readTime: 4
---

**TL;DR:** My first SDR agent qualified zero out of every fifteen prospects. Not because the code was broken - because I built the filters against an invented ICP instead of real closed deals. I rebuilt it from scratch against actual customer data. The second version qualified 9 out of 82. Here is what failure taught me and why your first agent will probably fail the same way.

Three weeks into building agents, I shipped Strider and watched him wander into the wilderness.

Strider was our first SDR agent. And I named him right - a hunter in the wild, tracking signals that were never there. Searching. Always searching. Never finding.

The logic looked clean: find prospects matching our ideal customer profile, enrich them, queue them for outreach.

But the ICP filter was too rigid. Obsessively rigid. Every run: 15 inbound signals. Zero qualified.

0/15.

Strider would pick up a scent and lose it immediately. He was a hunter without prey, tracking ghosts. Not a bug. A design flaw. I had built guardrails so tight that nothing could slip through. Strider was doing exactly what I told him to do. He was just doing it in a dead forest.

## What Was Wrong with Strider?

The ICP was invented. That was the whole problem.

"Series B SaaS. $5M-50M ARR. US-based. HubSpot user. Hired a VP of Growth in the last 90 days."

Clean. Specific. Defensible. Completely fictional.

I had never run an agent at scale. Never actually seen what signal converts. So I invented it. Made up criteria and hoped they would work.

Strider executed flawlessly against those invented criteria. Which meant he was perfectly, completely useless.

This is what happens when you build from theory instead of from the ground. You get an agent that is rigorous about the wrong things. Excellent tracking skills - for prey that does not exist.

## What Did I Do When the Numbers Were 0/15?

I rebuilt. Tweaking was not the move.

0/15 is a signal. Not the signal I wanted, but a signal nonetheless. I could sand down Strider's filters and hope something changed. Or I could start from what is actually true.

Aragorn was not a wanderer. Aragorn was a king who knew exactly what he was looking for because he had seen it before.

Different architecture entirely:

1. **Pull every customer who actually signed.** Not prospects. Not theory. Customers. Real.
2. **Study what they had in common.** Not my guesses. Their actual patterns - firmographics, tech stack, news signals, hiring. Real data.
3. **Build the agent against those patterns.** If a new prospect matches what we have closed before, qualify. If not, reject.
4. **Let him learn.** Every outreach that worked taught him something. Every bounce taught him something else. The pattern got sharper.

This is not theory. This is empiricism. Building on what is true, not what you hope is true.

## What Happened When Aragorn Ran?

82 signals came in. Aragorn enriched all of them. 29 qualified. 9 got personalised outreach - written by the agent, specific to each company, based on real enrichment.

9/82. 11% to outreach.

Not perfect. But real. And more importantly - alive. Every response taught him something. Every rejection taught him something different. The agent was learning, adapting, getting sharper.

Strider wandered in circles. Aragorn led.

## What Does Strider Teach You About Building Agents?

Three lessons that apply to every agent you build.

### You Do Not Know Your Signal. You Think You Do.

Strider did not fail because he was a bad agent. He failed because I built him on invented signal.

The fix is not tweaking. It is learning what signal actually converts, then rebuilding against that reality. Stop guessing. Start learning.

### Speed Beats Perfection

I could have spent 3 more months perfecting Strider. Instead I shipped him, watched him fail, and rebuilt in 2 weeks. 5 weeks total. Massive learning.

The founders winning with agents are not the ones who get it right on day 1. They are the ones who fail fast, learn ruthlessly, and rebuild immediately.

### First Failure Is Your Best Teacher

0/15 is brutal feedback. You cannot hide from it. You cannot blame the market. That teaches you everything you need to know: start over.

Your first agent will fail. When it does, pay attention. The failure is the education.

## FAQ

**Should I ship my first agent even if I am not confident about the signal?**
Yes. Ship it. Watch it fail. Learn. Rebuild. That cycle teaches you more than months of planning ever could.

**When do I tweak vs. rebuild?**
If the agent is 70%+ accurate, tweak. Below 50%, rebuild. Strider was at 0% - rebuild was the only move.

**Doesn't this mean agentic systems are unreliable?**
It means your first version will teach you what reliable means. Version two is much more reliable because it is built on real signal.

**How long does this take?**
Strider to Aragorn was 3 weeks. Your timeline depends on how much data you have and how fast you iterate.

**What if I do not have historical closed deals?**
Use whatever real signal you have. Traffic sources. Inbound quality. Customer interviews. Build the pattern from truth, not theory.

**Can I avoid shipping a Strider?**
No. Every founder building agents thinks they know their signal better than they do. The move is not to avoid failure. It is to fail fast and learn faster than your competition.
