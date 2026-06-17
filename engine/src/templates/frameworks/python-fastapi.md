## FastAPI / Python Backend Conventions

### Project Structure
- Route handlers in `routers/` (one file per domain)
- Business logic in `services/`
- Database models in `models/`, Pydantic schemas in `schemas/`
- Utilities in `utils/` or `lib/`

### Validation
- Use **Pydantic v2** models for all request/response schemas
- Never access `request.body` raw — always declare typed Pydantic models
- Validate environment variables via `pydantic-settings`

### Error Handling
- Raise `HTTPException` with appropriate status codes
- Use custom exception handlers for domain errors
- Return consistent JSON: `{ "detail": "..." }` or `{ "error": "..." }`

### Async
- Use `async def` for all route handlers and I/O-bound operations
- Use `asyncio` for concurrent operations, not threads
- Database: prefer async SQLAlchemy or async drivers

### Type Hints
- All functions must have type hints (Python 3.11+ syntax)
- Use `from __future__ import annotations` for forward references
- No bare `dict` or `list` — use `dict[str, Any]`, `list[str]` etc.

### Testing
- pytest with `httpx.AsyncClient` for integration tests
- Fixtures in `conftest.py`
- Mock external services, never hit real APIs in tests
