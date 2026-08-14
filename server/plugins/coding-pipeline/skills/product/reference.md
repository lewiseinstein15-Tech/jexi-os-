# Product — Reference

Detailed templates, examples and checklists. Loaded only when the product skill executes.

## Template: PRODUCT BRIEF

```markdown
## PRODUCT BRIEF

### Problem
<one sentence>

### Scope
- IN: <what we build>
- OUT: <explicitly not built — keeps the team honest>

### User stories
- As a <role>, I want <capability>, so that <outcome>.
- (3–6 total)

### Acceptance criteria
- [ ] <testable outcome 1>
- [ ] <testable outcome 2>

### Open questions
1. <ambiguity the user must resolve>
```

## Scope modes

| Mode | When | Typical max size |
|---|---|---|
| MVP | validate an idea fast | 1 screen / 1 flow |
| Standard | real product, known users | 3–5 screens |
| Complete | polished, production | full flow + edge cases |

## Good brief vs bad brief

- BAD: "Build a todo app." → no scope, no criteria, no users.
- GOOD: "A local-first todo app for a single user: add/edit/complete/delete tasks, persisted in localStorage, with a filter for completed items. Done = CRUD works offline and survives reload."

## Acceptance criteria style guide

- Testable: "submitting an empty form shows an inline error" (not "form is nice").
- One behavior per line.
- Prefer the words: shows / returns / persists / navigates / rejects.

## Handoff checklist (before you finish)

- [ ] Problem is one sentence.
- [ ] Every requirement in the input is either in scope or listed as an open question.
- [ ] Acceptance criteria are machine-testable (a QA agent could verify each one).
- [ ] No marketing language; no implementation details (that is the Engineer's job).
