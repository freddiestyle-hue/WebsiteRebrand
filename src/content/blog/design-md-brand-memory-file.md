---
title: "What Is DESIGN.md? The Brand Memory File AI Agents Needed."
date: 2026-05-07
lastModified: 2026-05-07
slug: design-md-brand-memory-file
tag: Guide
excerpt: "DESIGN.md turns colors, typography, spacing, components, and design rationale into a plain-text file AI agents can read before building UI."
metaDescription: "Learn what DESIGN.md is, how it works, and why AI design systems need persistent brand memory instead of one-off prompts and scattered style guides."
readTime: 6
---

**TL;DR:** DESIGN.md is a Markdown file that gives AI coding agents your visual rules before they generate UI. It combines exact tokens with written design intent. For operators, the lesson is bigger than design: AI work improves when taste, rules, and context live in memory instead of prompts.

You ask an AI agent to build a landing page.

The first screen looks surprisingly good.

Then you ask for pricing, a mobile view, a lead form, and a follow-up email. By the fourth output, the design has drifted. The colors are close but wrong. The spacing feels different. The buttons look like they came from another product.

That is the problem DESIGN.md is trying to solve.

## What Is DESIGN.md?

DESIGN.md is a plain-text design system for AI agents.

[Google describes DESIGN.md](https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-design-md/) as a way for Stitch to export or import design rules from project to project, so the tool understands the reasoning behind a design system and can generate interfaces that match the brand. Google has also open-sourced the draft specification so it can work across tools and platforms, not just inside Stitch.

The [Google Labs DESIGN.md repo](https://github.com/google-labs-code/design.md) defines it as a format for describing a visual identity to coding agents. The file has 2 layers:

1. YAML front matter with machine-readable tokens.
2. Markdown prose with human-readable design rationale.

The tokens give the agent exact values: colors, typography, spacing, corner radius, and component properties. The prose explains what those values mean and when to use them.

In plain English: it is a style guide an agent can actually use.

## Why Does A Markdown File Matter?

Because agents already understand Markdown better than most design artifacts.

A Figma file is useful for designers. A PDF brand guide is useful for a workshop. A token file is useful for a build system. None of those, by themselves, tell an AI agent what the design is trying to do.

Markdown does.

It is readable, version-controlled, editable in a repo, and easy for an agent to load with the rest of the project context. That matters because AI design work fails less from missing pixels and more from missing intent.

The agent does not only need `#8FBF3F`. It needs to know whether that green is the primary action color, a highlight color, a success state, or a decorative accent that should be used once per screen.

That difference is taste. And taste has to be written down before an agent can respect it.

## What Goes Inside DESIGN.md?

A useful DESIGN.md file should contain both values and rules.

The official spec points toward sections like overview, colors, typography, layout, elevation, shapes, components, and do's and don'ts. The exact structure will evolve because the format is still young, but the operating idea is stable.

Start with these 8 blocks:

1. **Overview:** What should the interface feel like? Who is it for?
2. **Colors:** Hex values, semantic roles, and usage limits.
3. **Typography:** Font families, sizes, weights, line heights, and where each level belongs.
4. **Layout:** Grid, max width, spacing scale, and mobile rules.
5. **Depth:** Borders, shadows, tonal layers, or the rule that you avoid them.
6. **Shapes:** Radius rules for buttons, cards, inputs, and panels.
7. **Components:** Button, card, input, nav, badge, and state rules.
8. **Do's and don'ts:** The hard guardrails that stop generic output.

The last block is more important than it looks. Agents need negative instructions. "Use the accent sparingly" is weaker than "Do not use the accent for backgrounds, gradients, or decorative blobs."

That is how a design system becomes operational.

## How Is This Different From A Style Guide?

A style guide tells a human how to judge the work. DESIGN.md tells an agent how to produce closer work before the human reviews it.

That does not make designers less important. It makes their decisions portable.

Most small companies have design taste trapped in 3 places: the founder's head, a few good pages, and the one person who says "that does not feel like us." The agent cannot read any of that unless you turn it into memory.

We made the same argument about voice in [Your Brand Voice Is Trapped in Your Head](/blog/brand-voice-trapped-in-head). Generic AI output is usually not a model problem. It is a missing-memory problem.

DESIGN.md is that argument applied to visual identity.

## What Should Operators Do First?

Do not start by building the perfect design system.

Start by documenting the 20 decisions that would stop the next AI-generated page from looking wrong.

Pull up your best homepage, landing page, sales deck, and email template. Then write down:

- The 5 colors that matter and what each one is allowed to do.
- The 4 text styles that show up most often.
- The spacing pattern that makes the work feel like your brand.
- The button and card rules you never want broken.
- The 10 things the agent should not do.

That first version might be 80 lines. Good. A short file that gets used beats a beautiful guide nobody reads.

Then test it. Ask the same agent to build the same page twice: once with the DESIGN.md file and once without it. Count how many corrections you make in each version.

The number of avoided corrections is the business case.

## Where Does DESIGN.md Fit In An Agent System?

DESIGN.md is one layer of agent memory.

It should sit beside the other files that explain how your business works: audience, offer, proof, voice, objections, and approval rules. Together, those files become the operating context for AI work.

Without them, every prompt starts cold.

With them, the agent starts with your rules, not the internet's average.

This is the bigger shift. The best AI systems will not be the ones with the longest prompts. They will be the ones with the clearest memory, the sharpest constraints, and the cleanest approval loop.

DESIGN.md is useful because it teaches that pattern in one visible place.

## FAQ

**What is DESIGN.md in simple terms?**
DESIGN.md is a Markdown file that describes your design system for AI agents. It includes exact design tokens and plain-language rules so an agent knows what colors, typography, spacing, and components to use.

**Is DESIGN.md only for designers?**
No. Designers should own the quality of the decisions, but operators benefit because the file reduces repeated correction. If AI is producing pages, decks, ads, and product surfaces, someone needs to give it reusable design memory.

**Does DESIGN.md replace Figma?**
No. Figma is still the visual workspace. DESIGN.md is the translation layer that turns design decisions into text an agent can read, version, and apply during generation.

**Can I use DESIGN.md with Codex or Claude Code?**
Yes, if the agent can read files in your project. Put the file somewhere obvious, reference it in your project instructions, and ask the agent to follow it before generating or editing UI.

**How long should the first DESIGN.md be?**
Short enough to stay useful. For a small operator, 60-120 lines is a good first target. Capture the core colors, typography, layout rules, components, and forbidden moves before writing a long brand manual.
