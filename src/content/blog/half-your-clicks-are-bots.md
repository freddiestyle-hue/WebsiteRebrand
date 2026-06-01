---
title: "Your Link Got 40 Clicks. 12 Were Human."
date: 2026-06-03
lastModified: 2026-06-03
slug: half-your-clicks-are-bots
tag: Insights
excerpt: "Every link you share gets fetched by preview bots and security scanners before a person sees it. Most of your click count has no pulse."
metaDescription: "Unfurl bots and email security scanners click your links before any human does. If you are not filtering them, your engagement numbers are mostly robots."
readTime: 6
---

**TL;DR:** Every link you post or send gets fetched by machines before a human touches it. Preview bots build the little card. Corporate security scanners pre-click every link in every email. Naive trackers count all of it as engagement. The result is a click number that feels great and means almost nothing. Until you filter the bots, you are optimizing for the approval of robots.

You shared a post. It got 40 clicks. Nice morning.

Now the deflating question: how many of those 40 were people?

If you are counting raw clicks, you do not know. And the honest answer is usually "fewer than you think."

## What Is Clicking Your Links When Nobody Is Home?

Two kinds of machines, both invisible, both counted as humans by default.

The first is the preview bot. When you drop a link into LinkedIn, Slack, Facebook, iMessage, or X, the platform sends a bot to fetch your page so it can build the little preview card with the image and headline. That fetch hits your link. A basic click tracker sees a request and records a click. No human has seen anything yet.

The second is the security scanner. When you email a link to anyone at a company of meaningful size, their email security - Microsoft SafeLinks, Proofpoint, Mimecast - fetches that link first to check it is not malicious. Sometimes it fetches every link, for every recipient, the instant the mail arrives. Again: counted as a click. Again: no human.

Your link is busy. Most of the visitors are robots.

## Why Does One Share Spawn Phantom Clicks?

Because the preview card is a feature, and the feature costs you a fetch.

Think about what has to happen for that clean LinkedIn card to render. The platform cannot show an image and a headline it has not seen. So the moment you hit post - before a single person scrolls past it - LinkedIn's bot has already requested your URL to pull the metadata.

Share the same link in three Slack channels and a couple of DMs, and each surface unfurls it again. That is several machine fetches before the first human thumb arrives. On a post that "got 40 clicks," a real chunk of the early count is the platforms talking to themselves.

This is the same referrer-stripping world we covered in [direct traffic is not direct](/blog/direct-traffic-is-not-direct). The platforms are mediating every link, and the mediation leaves fingerprints you are probably counting as customers.

## Why Is Email Even Worse Than Social?

Because security scanners do not fetch once. They fetch per recipient, sometimes more.

A social post gets unfurled a handful of times. A cold email to 200 people at corporate domains can generate hundreds of scanner hits, because each company's security layer independently pre-clicks the links on the way in. Send a sequence and it compounds.

We learned this on ourselves. Our internal dashboard started showing engagement on prospect pages that looked promising until the pattern got weird - clicks arriving in tight machine-timed bursts, from data-center IPs, seconds after a send, with no scroll and no dwell. It was Microsoft SafeLinks pre-scanning the links, not prospects reading. We were briefly celebrating our own email provider.

If you have ever watched an email tool report a 60% click rate and thought "that seems high," it was. Reported email click rates are some of the most inflated numbers in marketing, precisely because the security scanners are indistinguishable from eager readers unless you go looking.

## What Does the Inflation Actually Cost You?

You act on noise and call it signal.

The damage is not vanity, it is decisions. Three of them:

- **You credit the wrong message.** Variant A "beat" variant B by clicks, but the gap was scanner volume, not human interest. You scale the worse message.
- **You chase ghosts.** Your tool flags a lead as "clicked twice, hot." You spend a real follow-up on someone whose corporate firewall did the clicking. The lead never saw it.
- **You misread the channel.** Email looks like it crushes social on click rate, so you shift effort - toward the channel whose numbers are the most contaminated.

Every one of those is a real hour or a real dollar spent because a robot looked like a buyer.

So here is the question to sit with. The last time something "got great engagement," how many of those clicks had a pulse?

## How Do You Filter the Bots Out?

You separate the machines from the people, and you only count the people.

The good news is that bots mostly announce themselves. They identify in the user-agent string - `LinkedInBot`, `facebookexternalhit`, `Slackbot`, `Twitterbot`, `WhatsApp`, `TelegramBot`, and the rest. Security scanners are sneakier but leave a profile: data-center IP, no scroll, no dwell, a fetch timed to the send rather than to a human waking up.

When I rebuilt our own link tracking, the bot filter was not an afterthought, it was the point. Every incoming click gets checked against a list of known bot fingerprints - around nineteen patterns and growing - before it counts. Bot hits get logged in a separate bucket so the preview previews still work, but they never touch the human number. The day that filter went live, our "engagement" dropped. It also became true for the first time.

You do not need to build this from scratch. But you do need a tracker that distinguishes a bot from a buyer. If yours reports one number called "clicks," assume it is counting robots.

## What Is Left After You Filter?

Smaller numbers that you can actually trust.

This is the trade nobody markets, because "your real engagement is lower than you thought" is a hard sell. But a filtered click is worth more than ten raw ones, because you can build on it. When a filtered human click comes in - real device, real dwell, a scroll - you can follow up knowing a person was there. That is a signal worth acting on, the kind that should feed straight into a [follow-up queue](/blog/your-leads-are-not-cold-they-are-decaying) while the intent is fresh.

The raw number flatters you. The filtered number pays you. One tells you a robot fetched your metadata. The other tells you a human leaned in.

Pick the number you would bet a follow-up on.

## FAQ

**How many of my clicks are actually bots?**
It varies by channel, but the ranges are large enough to change decisions. Social posts pick up a handful of unfurl-bot fetches per share. Cold email to corporate domains can see security scanners drive a large share of total "clicks," sometimes the majority. The only way to know your number is to filter by user agent and behavior and compare.

**Don't analytics platforms already remove bots?**
Partly. Most filter known crawlers from pageview reports. But link-level click counters - the ones in email tools, link shorteners, and social schedulers - frequently do not, or do it incompletely. Security-scanner traffic in particular slips through because it does not look like a classic crawler.

**Why do email click rates look so much higher than open rates make sense?**
Because security scanners pre-click links to inspect them. Microsoft SafeLinks, Proofpoint, and Mimecast all do this. On a list heavy with corporate addresses, scanner clicks can inflate the click rate well past what human behavior would produce.

**What is the simplest fix if I am not technical?**
Use a tracker that explicitly separates bot and human clicks, and look at clicks alongside behavior - scroll, dwell, return visits. A "click" with zero seconds on the page is almost never a person. If your tool cannot show you that, treat its click count as a ceiling, not a measurement.

**Does filtering bots make my numbers look worse to my boss or client?**
At first, yes. The filtered number is lower. It is also defensible, repeatable, and safe to make decisions on. A smaller true number beats a big fake one the moment anyone asks "so what did we do because of this?"
