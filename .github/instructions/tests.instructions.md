---
applyTo: "**/*.test.ts, **/*.test.tsx, **/*.spec.ts, **/*.spec.tsx, **/*.test.js, **/*.spec.js"
---
# Test Rules — ai-os
- Use Vitest as the test framework
- One assertion concept per test (avoid multiple unrelated assertions)
- Test descriptions must be descriptive: `it("returns 401 when token is missing")`
- Mock external services and databases in unit tests
- Do not import from `dist/` or `build/` in tests