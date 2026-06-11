# AI OS Example Fixtures

These directories are reference target repos used as regression fixtures. They exist to verify stack detection and generation output for common stack combinations.

| Directory | Stack |
| --- | --- |
| `nextjs-trpc-prisma/` | Next.js + tRPC + Prisma (TypeScript) |
| `python-fastapi/` | Python + FastAPI |
| `go-service/` | Go + Gin |

Each fixture is used by `src/tests/examples.test.ts` which runs AI OS stack detection and key generators against the fixture and snapshot-tests the output.

To regenerate snapshots after intentional changes:

```bash
npm test -- --update-snapshots
```
