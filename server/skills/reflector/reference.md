# Reflector — Reference

## Reflection prompts
- What did the QA gate catch that the first run missed?
- Was the plan's verification step accurate, or did the real failure differ from the predicted risk?
- What single habit/tool/check would have saved the most time?
- What should the next build of the same shape do FIRST?

## Example (good)
```markdown
## REFLECTION
- Worked: thin vertical slice ran on attempt 1, so debugging stayed cheap.
- Failed: the plan said "renders fine" but the first QA pass found the goal field rendered NaN before any input — the plan's verification step missed an initial-state test.
- Lesson: every plan must include an "empty/first-load state" check in its verification step. Next build: test initial state before building features.
```

## Anti-patterns
- More than ~150 words.
- Compliments ("great job") without a transferable lesson.
- Re-narrating the whole task — keep it to the delta that changes future behavior.
