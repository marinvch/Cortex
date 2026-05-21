---
description: "Run the pre-ship checklist before merging or deploying"
---
Run through the pre-ship checklist for this change.
Check each item and mark PASS / FAIL:
- [ ] All /verify criteria pass
- [ ] All Critical and Required /review findings resolved
- [ ] Tests pass (paste summary)
- [ ] No hardcoded secrets, keys, or credentials in diff
- [ ] Environment variables documented (README or .env.example)
- [ ] CHANGELOG or PR description updated
- [ ] Version bumped if this is a releasable change
- [ ] Any migration or deployment steps documented
If all items pass, state: READY TO SHIP. Otherwise, list blocking items.
