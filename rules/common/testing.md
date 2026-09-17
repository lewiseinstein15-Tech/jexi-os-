---
id: common/testing
loads: always
---

# Testing — Common

[JEXI-RULE common/testing TN-1] A bug fix ships together with the test that would have caught it.

[JEXI-RULE common/testing TN-2] Tests are deterministic: no network, no sleeps, no wall-clock dependence. Inject and fake the clock.

[JEXI-RULE common/testing TN-3] Classify failures before fixing: zero diff against the baseline commit means PRE-EXISTING (record it, move on); a changed file means REGRESSION (fix before anything else).

[JEXI-RULE common/testing TN-4] Run the real command, not the flattering subset: `cd server && npm test`.

[JEXI-RULE common/testing TN-5] One assertion per behavior. Test names state the behavior under test, not the method called.

[JEXI-RULE common/testing TN-6] A skipped test must print WHY it skipped — an honest environment gate, never a silent skip.

[JEXI-RULE common/testing TN-7] Never weaken an assertion to make a test pass. Fix the test or fix the code; never blur both.
