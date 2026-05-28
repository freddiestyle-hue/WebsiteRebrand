---
title: "Your Email Signature Outperforms Your Homepage. Check Your Own Data."
date: 2026-05-28
lastModified: 2026-05-28
slug: email-signature-outperforms-homepage
tag: Strategy
excerpt: "Pulled our numbers this morning. 117 people came to the homepage in 30 days. 3 filled the form. The four lines of text at the bottom of my emails outperformed all of it."
metaDescription: "I run an audit business. 117 homepage visitors and 3 conversions in 30 days. The signature on every email I send did more work. Check your own data tonight."
readTime: 8
---

**TL;DR:** I run an audit business. Pulled our numbers this morning and got annoyed at myself. 117 people came to the homepage in 30 days. 2 scrolled past the fold. 3 ran the audit form. Meanwhile the four lines of text I auto-stick at the bottom of every email I send was the only channel that drove a real diagnostic booking in the last 7 days. I've been sweating the wrong artifact.

I pulled our analytics this morning and got fucking annoyed at myself.

117 people came to the Rivett homepage in 30 days.

2 scrolled past the fold.

3 filled in the audit form.

That's the page I've been polishing for weeks. The page I redesigned twice. The page I argue about with my designer at midnight.

Meanwhile, the four lines of text I auto-stick at the bottom of every email I send, the ones I set up months ago and haven't opened since, did more work than that homepage. In the last 7 days my sig was the only channel that drove a real booking on our diagnostic page.

I've been sweating the wrong artifact for months. So have you.

## What Does the Data Actually Say?

Numbers are mine. PostHog, last 30 days, no rounding.

117 unique visitors to rivett.tech. 2 of them scrolled past the fold. 7 triggered the audit memo event. Of those 7, 3 were real prospects. The rest were bots, my own QA hits, and one click from a mate who I'd sent the URL to.

It gets worse. The audit form on the homepage is technically broken for any prospect whose site sits behind Cloudflare. Headless browser times out at 12 seconds, throws a red error box, prospect leaves. So the page that's meant to be my front door is actively pissing off the highest-intent visitors I have.

Now the signature. Same 30 days. One single link, in plain text, at the bottom of every email I sent. That link was the only thing that drove a real /diagnostic page view that converted into a booking in the last 7 days. Not LinkedIn. Not the blog. Not paid. The sig.

One line, at the bottom of every send, outperformed the entire homepage I've been building.

I read it twice. Then I closed PostHog and rewrote my sig.

## Why Does an Email Signature Beat a Homepage?

Because the audience is already paying attention.

Do the math on yourself. If you're a founder running outreach, replies, customer support, partnerships, and the occasional cold pitch, you're sending somewhere between 800 and 1,500 emails a month. Every single one of them lands in an inbox where the recipient already knows you exist. They wrote to you. You wrote to them. Someone CC'd them on you. The attention is already paid for.

Compare that to the homepage. Random traffic. Cold visitors. Most of them bounce in under 8 seconds because they don't know what you do and you have to earn the next click from a stranger.

The conversion math on cold traffic is brutal. You start from zero context.

The signature audience starts from full context. They know who you are. They opened the email because they cared about the thread. By the time their eye drops to the bottom of your message, you've already won the attention battle. The sig only has to hand them the next thing.

That's why the conversion rate is silly in your favour. You're shoving a CTA into a moment of attention you already earned. The homepage has to earn that same moment from scratch every single time, against a tab the visitor was already considering closing.

The math isn't close. It's a slaughter. And you've been ignoring it.

## What Should a Signature Actually Do?

Most signatures answer "who I am."

Name. Title. Phone. Company logo. The LinkedIn URL nobody clicks. That's a business card from 2003. It works fine if your only goal is to remind someone of your job title. It does zero work for your pipeline.

A working signature answers a different question: what do I do that you might need right now.

Three lines that actually pull weight:

1. **One credential line.** Past-tense proof, not titles. "Previously: Growth at Somewhere (Nick Huber's company)" beats "Founder at Rivett" because one is a fact and the other is a label. Show me what you've done, not what you call yourself.
2. **One CTA pointing at the strongest single thing you own.** Not your homepage. Not your Calendly. The artifact that does the convincing for you when you're not in the room. For us it's a pre-baked audit memo. For you it's whatever your single best proof asset is: a case study, a teardown, a 90-second Loom, a one-pager.
3. **One scarcity line, if it's real.** "Taking 2 clients in June." If you're not actually capacity-constrained, skip it. Fake scarcity from a stranger reads exactly like fake scarcity from a stranger.

My old sig had "AI below the judgment layer" sitting in the middle of it. The kind of jargon you write when you're trying to sound smart to people who aren't your buyer. I killed it this morning while writing this post. The new version sends every reader straight to our strongest pre-baked audit, with a credential line above it and a scarcity line below.

Change took 6 minutes. It will outperform a homepage redesign that takes 6 weeks. That's not a guess. It's already happening. I just wasn't looking.

## How Do You Test This in Your Own Business?

Open whatever analytics you use. Filter by `utm_source=email_signature` for the last 30 days.

If you're like most operators, you have zero events. Not because the sig isn't doing work, but because you never tagged the link. Your sig traffic is being eaten by `$direct`, which is the same bucket as people typing your URL, people coming from LinkedIn (which strips the referrer), and people clicking from Slack. You can't see the sig because it's wearing the same costume as everything else that converts.

Fix is one minute. Append `?utm_source=email_signature&utm_campaign=sig_v3` to the link in your sig tonight. Save. Send your next email.

Wait 30 days.

Then come back and compare that single tagged link to your other channels. Compare it to your last Google Ads spend. Compare it to the LinkedIn posts you've been agonising over. Compare it to the homepage you keep rebuilding.

We wrote about this attention gap before in [the seven-day follow-up queue post](/blog/seven-day-follow-up-queue-without-your-crm). Most operators don't have a measurement problem, they have a tagging problem. The signal exists. You just never built the lens to see it. The sig is the worst version of this because it's been sitting under your nose for years and you've never once asked it for receipts.

## Why Did You Miss This?

Because homepages look like work. Signatures look like nothing.

You see the homepage every time you open your laptop. You forward it to people. You argue with designers about the hero copy. It feels important because it has visual weight, a URL you can point at, and a deploy you can watch.

The sig is four lines of text at the bottom of an email client you barely look at. No Figma file. No agency pitches you on it. So it sits there for years, untouched, quietly doing more work than any of the things you obsess over.

This is the operator pathology in miniature. The visible artifact gets the attention. The compounding artifact gets ignored. Same reason you fuss over your office layout while your invoicing system silently misses payments. The thing in your face is not the thing doing the work.

Honest question, because this one wrecked me and I'd be a bad sport not to pass it on:

If you forwarded yourself every email you sent in the last week, and read only the bottom four lines of each, would you click anything?

If the answer is no, your sig is wallpaper. And your homepage is probably losing the silent race to your wallpaper.

That's the part that should annoy you.

## FAQ

**Doesn't a long signature make me look pushy?**
Yes, if it's long. 5 lines is the cap. Name, credential, CTA, scarcity if real, link. Anything past that is noise and people stop reading. The discipline is editorial, not visual. Cut hard.

**What about plain-text rendering?**
Build the plain-text version first, then layer the formatted version on top. Most cold prospects open in dark mode on mobile in clients that strip images and break HTML tables. If your sig only works in pristine formatted email, your sig only works for the people who already know you. Which defeats the point of having one.

**Should the CTA be a calendar link?**
No. Calendar links ask for a commitment from someone who hasn't been sold yet. The first click should be the artifact that does the persuading: a sample, a case study, a teardown, a proof. The meeting is the second click, after they're convinced. Sending strangers to your Calendly is asking them to marry someone they haven't dated.

**What if I'm B2C?**
Math holds and probably gets stronger. Every customer service reply, every order confirmation, every onboarding email has a sig. B2C operators send more emails per customer than B2B operators, not fewer. Use the sig to sell the next product, the referral, the upgrade, the review request. You already wrote the message. Add the line.

**How often should I update the signature?**
Every quarter, minimum. The CTA should reflect what your business actually wants more of right now. If the asset it points to is the same one you were promoting 6 months ago, your sig is a fossil and you're paying for it with every email you send.

**Isn't this just A/B testing 101?**
A/B testing assumes you've tested something at least once. Most operators have never tested their sig. They wrote it in their second week of running the business, never measured it, and treated it as background noise for the next decade. Measurement comes before testing. Tag the link tonight. Look at the number in 30 days. That's the whole job.
