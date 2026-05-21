---
description: "Review staged changes with Critical / Required / Optional / FYI severity labels"
---
Review the staged or specified changes using the review severity taxonomy.
For each finding, output:
```markdown
**File:** <path>
**Line(s):** <range>
**Severity:** Critical | Required | Optional | FYI
**Finding:** <one-line summary>
**Detail:** <explanation and suggested fix>
```
Severity guide:
- **Critical** — must fix before merge (security, data loss, incorrect behavior)
- **Required** — must fix before merge (missing tests, convention violations, broken contracts)
- **Optional** — improve if time allows (readability, minor duplication)
- **FYI** — informational, no action needed
End with a summary table sorted Critical first.
