---
title: "Your Email Signature Outperforms Your Homepage. Check Your Own Data."
date: 2026-05-28
lastModified: 2026-05-28
slug: email-signature-outperforms-homepage
tag: Strategy
excerpt: "Our homepage got 117 visitors in 30 days. Three of them ran the audit form. The line of text at the bottom of every email I sent did more work."
metaDescription: "Our homepage got 117 visitors and 3 conversions in 30 days. The line of text at the bottom of every email I send did more work. Check your own data."
readTime: 7
---

**TL;DR:** I run an audit business. Our homepage pulled 117 unique visitors in 30 days. Two scrolled past the fold. Three filled in the form. Meanwhile the line of text auto-appending to every email I sent was the only channel that converted to a real diagnostic view in the last 7 days. The signature is the funnel. The homepage is a stage prop.

Open your sent folder.

Scroll to the last email you sent today and look at the bottom four lines of text. The ones you set up in 2019 and stopped thinking about.

Now ask when you last touched them.

I pulled our own analytics this morning and the answer wrecked me. Our homepage, the page I've been rebuilding all month, got 117 unique visitors in the last 30 days. Two of them scrolled past the fold. Three of them ran our audit form. The signature I set up months ago and never opened again has been quietly outperforming it.

That's not a marketing observation. That's a confession.

## What Does the Data Actually Say?

The homepage at rivett.tech got 117 unique visitors in the last 30 days. PostHog event data, no estimation.

Two of them scrolled past the fold. Seven of them triggered the audit memo event. Of those seven, three were prospects I'd actually want to talk to. The rest were bots, my own QA hits, and one accidental click from a friend.

The form on the homepage is also technically broken for any prospect whose site sits behind Cloudflare or a serious bot challenge. The headless browser times out at 12 seconds, returns an error box, and the visitor leaves. The page that's meant to be the front door of the business is actively losing trust on the highest-intent visitors.

Meanwhile, in the same 30 days, the only channel that drove a real conversion to our diagnostic booking page was the link in my email signature. Not LinkedIn outreach. Not the blog. Not paid. The sig.

One line, at the bottom of every email I've sent for months, out-converted the entire homepage I sweated over.

## Why Does an Email Signature Beat a Homepage?

Because the audience is already warm.

Do the math on yourself. If you're a founder running outreach, replies, customer support, partnerships, and the occasional cold pitch, you're sending somewhere between 800 and 1,500 emails a month. Every single one of them lands in an inbox where the recipient already knows you exist. They wrote to you. You wrote to them. They were CC'd on something. The attention is already paid for.

Now compare that to the homepage. Random traffic. Cold visitors. Most of them bounce in under 8 seconds because they don't know what you do yet and you have to earn the next click. The conversion math on cold traffic is brutal because you're starting from zero context.

The signature audience starts from full context. They know who you are. They opened the email because they care about the thread. By the time their eye reaches the bottom of your message, you've already won the attention battle. The only thing the sig has to do is hand them the next thing to look at.

That's why the conversion rate is silly in your favour. You are inserting a CTA into a moment of attention that you already earned. The homepage has to earn that same moment from scratch, every single time, against a tab they were already considering closing.

## What Should a Signature Actually Do?

Most signatures answer "who I am."

Name. Title. Phone. Company logo. The Linkedin URL nobody clicks. That's a business card from 2003. It works fine if your only goal is to remind someone of your job description.

A working signature answers a different question: "what do I do that you might need right now?"

Three lines that actually pull weight:

1. **One credential line.** Previously, Built, Shipped, Ran. Past-tense proof, not titles. "Previously: Growth at Somewhere (Nick Huber's company)" does more than "Founder at Rivett." One pulls trust. The other pulls indifference.
2. **One CTA pointing at the strongest single artifact you own.** Not your homepage. Not your calendar. The thing that does the convincing for you when you're not in the room. For us it's a pre-baked audit memo. For you it might be a case study, a teardown, a 90-second Loom, a one-pager.
3. **One scarcity line, if it's real.** "Taking 2 clients in June." If you're not actually capacity-constrained, skip it. Fake scarcity from a stranger is just noise.

Our old sig had the line "AI below the judgment layer" in the middle. The kind of jargon you write when you're trying to sound smart to people who aren't your buyer. I killed it this morning. The new version sends every reader straight to our strongest pre-baked audit, with a credential line above it and a scarcity line below.

The change took six minutes. It will outperform a homepage redesign that takes six weeks.

## How Do You Test This in Your Own Business?

Open whatever analytics you use. Filter by `utm_source=email_signature` for the last 30 days.

If you're like most operators, you have zero events. Not because the signature isn't doing work, but because you never tagged the link. The traffic is being absorbed into your `$direct` bucket, which is the same bucket as people typing your URL, people clicking from LinkedIn (which strips referrer), and people coming from Slack. You can't see your sig because it's wearing the same costume as everything else.

The fix is one minute. Append `?utm_source=email_signature&utm_campaign=sig_v3` to the link in your signature tonight. Save. Send your next email.

Wait 30 days.

Then come back and compare that single tagged link to your other channels. Compare it to your last Google Ads spend. Compare it to the LinkedIn posts you've been agonising over. Compare it to your homepage.

We wrote about this attention gap before in [the seven-day follow-up queue post](/blog/seven-day-follow-up-queue-without-your-crm): most operators don't have a measurement problem, they have a tagging problem. The signal exists. You just never built the lens to see it. The sig is the most extreme version of this, because it has been sitting under your nose for years.

## Why Did You Miss This?

Because homepages look like work. Signatures look like nothing.

You see the homepage every time you open your laptop. You forward it to people. You ask designers about it. You debate the hero copy at dinner. It feels important because it has visual weight and a URL you can point at.

The sig is four lines of text at the bottom of an email client you barely look at. It has no URL of its own. There's no Figma file for it. No agency pitches you on it. So it sits there, untouched, for years, quietly doing more work than any of the things you actually optimise.

This is the operator pathology in miniature. The visible artifact gets the attention. The compounding artifact gets ignored. Same reason you fuss over your office while your invoicing system silently misses payments. The thing in your face is not the thing doing the work.

The honest question this leaves me with, and that I'd ask you to sit with before closing this tab:

If you forwarded yourself every email you sent in the last week, and read only the bottom four lines of each one, would you click anything?

If the answer is no, your signature is wallpaper. And your homepage is probably losing the silent race to wallpaper.

## FAQ

**Doesn't a long signature make me look pushy?**
Yes, if it's long. Five lines is the cap. Name, credential, CTA, scarcity if real, link. Anything past that turns into noise and people stop reading. The discipline is editorial, not visual.

**What about plain-text rendering?**
Build the plain-text version first, then layer the formatted version on top. Most cold prospects open in dark mode on mobile in clients that strip images and break HTML tables. If your sig only works in pristine formatted email, your sig only works for the people who already know you.

**Should the CTA be a calendar link?**
No. Calendar links ask for a commitment from someone who hasn't been sold yet. The first click should be the artifact that does the persuading: a sample, a case study, a teardown, a proof. The meeting is the second click, after they're convinced. Sending strangers to your Calendly is asking them to marry someone they haven't dated.

**What if I'm B2C?**
The math holds and probably gets stronger. Every customer service reply, every order confirmation, every onboarding email has a sig. B2C operators send more emails per customer than B2B operators, not fewer. Use the sig to sell the next product, the referral, the upgrade, the review request. You already wrote the message. Add the line.

**How often should I update the signature?**
Every quarter at minimum. The CTA should reflect what your business actually wants more of right now. If the asset it points to is the same one you were promoting six months ago, your sig is a fossil and you're paying for it with every email you send.

**Isn't this just A/B testing 101?**
A/B testing assumes you've tested something at least once. Most operators have never tested their sig. They wrote it in their second week of running the business, never measured it, and treated it as background noise for the next decade. Measurement comes before testing. Start by tagging the link tonight and looking at the number in 30 days.
