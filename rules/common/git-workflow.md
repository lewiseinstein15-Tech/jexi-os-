---
id: common/git-workflow
loads: always
---

# Git Workflow — Common

[JEXI-RULE common/git-workflow GW-1] Commits are small and single-purpose. The message is an imperative summary that states the WHY.

[JEXI-RULE common/git-workflow GW-2] Direct-to-main is the JEXI flow — no feature branches. Before risky work, tag a rollback point first (`pre-<milestone>`) and verify it on the remote.

[JEXI-RULE common/git-workflow GW-3] Never force-push main. Never rewrite published history.

[JEXI-RULE common/git-workflow GW-4] Keep generated artifacts out of git: build outputs, bundles, local state, secrets. Check `git status` before staging.

[JEXI-RULE common/git-workflow GW-5] A push you did not verify did not happen — confirm with `git ls-remote origin` after every push.

[JEXI-RULE common/git-workflow GW-6] Rollback tags point at the SHA BEFORE the change, so restoring is `git reset --hard <tag>` plus nothing else.
