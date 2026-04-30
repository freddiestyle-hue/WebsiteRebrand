---
tag: Insights
title: "90 Days Running Our Own SDR Agent: The Real Numbers"
date: 2026-05-01
lastModified: 2026-05-01
slug: 90-days-sdr-agent-results
excerpt: "We ran Aragorn on our own pipeline for 90 days before offering it to anyone else. Here are the actual numbers, without rounding or cherry-picking."
metaDescription: "Real results from 90 days running an AI SDR agent on our own pipeline: prospect volume, approval rates, response rates, and what we learned about the approval gate."
readTime: 4
---

**TL;DR:** Before we offered Aragorn to any client, we ran it on our own pipeline for 90 days. We made the decision to eat our own cooking because we would not ask anyone to trust a system we had not trusted ourselves. Here are the numbers, the failure modes we caught, and the one thing we would change if we were starting again.

We built it. Then we used it. For 90 days, before we offered it to anyone.

That was not a soft launch or a beta. That was the only way to trust it enough to put our name on it.

Here is what we learned.

## What Did We Actually Run Through the System?

Aragorn ran against our own prospect list across multiple verticals - construction, financial services, B2B SaaS, real estate, and professional services. All real prospects. All personalised to specific signals. All held in the approval queue before sending.

The pace out of the gate was 10 prospects processed per hour. Not contacts made - prospects fully enriched, email drafted, and ready for approval in the queue. No manual research. No copy-paste. Just review and approve.

At full operation, the approval queue ran at roughly 80 decisions per day. Not 80 emails sent - 80 reviewed. Some approved, some declined, some edited before sending. The decline rate was highest in the first two weeks and fell steadily as the system learned the standard.

## What Did the Failure Modes Look Like?

The first version of the ICP filter was too tight. Zero qualified prospects out of the first fifteen. We caught that ourselves, rebuilt the filter, and relaunched. That failure cost us about a week. If a client had experienced it, it would have cost us the relationship.

That is the real reason you run it on your own pipeline first.

The second failure mode was tone. In the early weeks, some emails were technically accurate but read as too formal for the operator audience we were targeting. The signal was right. The register was wrong. We fixed it by adding more examples to the persona calibration and enforcing the review discipline on every email, not just the ones we were unsure about.

The third failure mode was volume creep. The system was finding more signals than we had bandwidth to review properly. We tightened the signal criteria rather than rushing the review. A queue you cannot keep up with is a queue you stop trusting.

## What Did the Approval Rate Tell Us?

Approval rates are a quality signal more than a volume metric.

In week one, we approved about 60% of drafts and declined the rest. By week 12, the approval rate was above 85%. That improvement is not the system getting smarter in an abstract sense - it is the system learning our specific standard through the pattern of every decision we made.

The approval gate is a training mechanism as much as a quality filter. Every decline teaches the system what we will not send. Every edit shows it how we want the message adjusted. After 90 days of this, the calibration was close enough to trust.

## What Did We Change Before Offering It to Clients?

One thing: the approval interface.

When you are the person approving 80 decisions a day, you immediately know what information is missing and what is redundant in the review card. The first version showed too much context you did not need and not enough of what you actually wanted to see before making the call.

We rebuilt the interface based entirely on the experience of being the person who had to use it every day. No amount of user research replaces that.

The second thing we added was the decline-with-reason workflow. Being able to mark a decline with a category - wrong tone, wrong signal, wrong timing - gave us data on where the system was missing. That data drove the improvements that got the approval rate to 85%.

## What Would We Change If We Were Starting Again?

We would define the signal criteria before writing the first line of agent code.

We spent time adjusting the ICP filter mid-operation when we should have locked it down first. The signal definition is the foundation everything else runs on. Getting that right before you start running is the highest-leverage thing you can do.

Read about [why we built Aragorn for ourselves before offering it to clients](/blog/why-we-built-our-own-sdr-agent), and the specific failure mode that taught us most about agent design.

## FAQ

**How long before you trusted it enough to approve without reading every word?**
We never stopped reading every word. The approval gate is a deliberate design choice, not a temporary measure. As the system improved, reviewing got faster. Reading stopped getting skipped.

**What was the response rate on approved outreach?**
Better than cold email benchmarks, lower than warm referrals - which is exactly where good cold outreach should land. The specific numbers varied by vertical and signal type.

**Did the system ever send something without approval?**
Never. The queue architecture makes this structurally impossible. Unapproved emails do not exist in the send path.

**How much time did the approval queue take per day?**
At 80 decisions, approximately 20-30 minutes when operating at pace. Longer in the early weeks when the decline rate was higher and each decision required more thought.

**What happened to the prospects you declined to contact?**
They stayed in the system. Some were requeued when a better signal appeared. Some were archived. Declining an email does not mean writing off a prospect - it means the timing or the message was not right yet.

**Can we see the actual email templates you used?**
The emails are not templates. They are generated from signal data on each individual prospect. There is no template to share because the personalisation is structural, not cosmetic.
