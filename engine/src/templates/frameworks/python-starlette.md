## Starlette / Python ASGI Conventions

### Project Structure
- Route handlers in `routes/` or as class-based endpoints
- Middleware registered on the `Starlette` app instance
- Business logic in `services/`
- Database models in `models/`, schemas in `schemas/`
- Application configured via `config.py` or `starlette.config`

### Validation & Error Handling
- Validate request bodies with Pydantic models or marshmallow
- Use HTTP exceptions from `starlette.exceptions` (`HTTPException`)
- Register custom error handlers with `@app.exception_handler`
- Return consistent JSON error shapes: `{"detail": "message"}`

### Async
- All route handlers must be `async def` — Starlette is ASGI-native
- Use `asyncio` for concurrent operations, not threads
- Database: prefer async drivers (asyncpg, aiomysql, Motor) or async SQLAlchemy

### Authentication
- Use `AuthenticationMiddleware` or a custom ASGI middleware
- JWT verification in middleware — never trust client-supplied user IDs
- Secrets in environment variables — never hardcoded

### Testing
- pytest with `httpx.AsyncClient` and `starlette.testclient.TestClient`
- `anyio` or `asyncio` pytest markers for async tests
- Mock external services — never hit real APIs in tests

### Type Hints
- All functions must have type annotations (Python 3.10+ syntax)
- Use `from __future__ import annotations` for forward references
- No bare `dict` or `list` — use typed generic forms
