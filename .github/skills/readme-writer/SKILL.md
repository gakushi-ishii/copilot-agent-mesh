---
name: readme-writer
description: Creates or updates README.md files for projects. Use when the user requests a new README, edits to an existing README, or project documentation improvements.
user-invokable: true
---

# Workflow

Follow these steps when creating or updating a README.md:

1. Review the project codebase, tech stack, and existing documentation
2. Include all required sections in the order defined in "Section Structure" below
3. Apply every rule in "Writing Rules"
4. Verify none of the "Prohibited Patterns" are present

# Section Structure

Maintain the order below. Sections not marked **Required** may be omitted.

| # | Section | Required |
|---|---------|----------|
| 1 | Title (H1) | Yes |
| 2 | Overview | Yes |
| 3 | Table of Contents | Yes (4+ sections) |
| 4 | Prerequisites | |
| 5 | Installation / Setup | Yes |
| 6 | Get Started / Usage | Yes |
| 7 | Features | |
| 8 | Configuration / Customization | |
| 9 | Architecture / Tech Stack | |
| 10 | Command Reference | |
| 11 | Contributing | |
| 12 | License | Yes |
| 13 | Questions / Support | |

> [!NOTE]
> Reference model: [GitHub + Microsoft Teams Integration README](https://github.com/integrations/microsoft-teams).
> Key patterns to adopt: value-proposition-first overview, nested Table of Contents, command reference tables, permission scope tables, and step-by-step instructions with screenshots.

# Writing Rules

## Headings

- Use exactly **one H1** for the project title
- H2 for major sections, H3 for subsections, H4 maximum — never use H5 or deeper
- Write headings as noun phrases (e.g., "Command Reference", "Installation")

## Title and Overview

- Do **not** place badges immediately after the H1 — put them after the overview
- Lead with the value proposition: what problem the project solves and why it matters
- Keep the overview to 2–3 paragraphs in plain language accessible to first-time readers

## Table of Contents

- Place immediately after the overview when there are 4 or more sections
- Use a Markdown link list, nested up to 2 levels
- Update the ToC whenever sections are added or removed

## Instructions

- Use numbered lists — **one step = one action**
- Wrap commands in fenced code blocks with a language identifier and include expected output when helpful

## Code and Media

- Always attach a language identifier to fenced code blocks (`bash`, `javascript`, `python`, etc.)
- Use inline code only for short references; use standalone code blocks for longer commands
- Every image **must** have meaningful alt text — `![](image.png)` is prohibited
- Store images in `images/` or `docs/images/` and place them directly after the relevant step

## Tables and Callouts

- Use tables for reference data (commands, config options, permissions, etc.)
- Use `> [!NOTE]` for supplementary information and `> [!WARNING]` for cautions (GitHub Alerts syntax)

## Style

- Write in a clear, direct voice using the active tense
- Keep sentences under roughly 80 characters
- Briefly explain technical terms on first use
- Maintain consistent terminology throughout — do not alternate between synonyms for the same concept

# Prohibited Patterns

- Multiple H1 headings
- Badge walls immediately after the title
- Sprawling sections without a Table of Contents
- Code blocks without a language identifier
- Images without alt text
- Multiple operations crammed into a single step
