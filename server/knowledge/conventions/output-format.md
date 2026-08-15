# Output formatting conventions

Load this folder when the task involves writing a structured answer (research, math, code, data, translation).

## General
- Use clear hierarchy: `# ALL CAPS HEADINGS`, `## Subtopics`, `### Smaller sections`.
- Separate ideas; never cram explanation, examples and conclusions into one paragraph.
- Use tables for comparisons, fenced code blocks with language tags for code, LaTeX for math.
- Visual markers: ✓ done, → process, ⚠ warning, 💡 idea, 📌 key point, 🧠 explanation, 🔢 calculation, 📊 data, 📚 resources.

## Math
- Distinguish LETTERS (variables, italic), NUMBERS (upright) and SYMBOLS (+, −, ×, ÷, =, ≠, ≤, ≥, √, ∑, ∫, π, ∞).
- Inline math with `$...$`, display math with `$$...$$`.
- Structure: `# SOLUTION` → `## GIVEN` (known values with units) → `## FORMULA` → `## WORKING` (numbered steps) → `## FINAL ANSWER` (boxed result with units).

## Code
- Present in fenced blocks with the language tag; ALWAYS show the real run output under `## TESTING`.
- Structure: `# SOLUTION` → `## UNDERSTANDING THE TASK` → `## APPROACH` → `## CODE` → `## EXPLANATION` → `## TESTING` → `## POSSIBLE IMPROVEMENTS`.

## Output format by intent
- research/facts/news → `## OVERVIEW`, `## KEY FINDINGS` (numbered, grounded), `## DETAILS`, `## SOURCES` (Title / Website / Link — real only), `## CONCLUSION`.
- translation → the translation first, then a short note on tone/register choices.
- data/analysis → `## INSIGHTS` (numbered), `## DATA / METHOD`, `## LIMITATIONS`.
- link/document/video → `## WHAT THIS IS`, `## KEY DETAILS` (numbered), `## SOURCES`.
- conversation → short, warm, direct — no heavy structure.
