## Flask / Python Web Conventions

### Project Structure
- Route handlers in `blueprints/` or `views/` (one module per domain)
- Business logic in `services/`
- Database models in `models/` (SQLAlchemy or similar)
- Configuration in `config.py`, secrets via environment variables
- Application factory pattern: `create_app()` in `app/__init__.py`

### Validation & Error Handling
- Validate all request data before processing (marshmallow, pydantic, or WTForms)
- Use `abort()` for HTTP errors or register error handlers with `@app.errorhandler`
- Return consistent JSON error shapes: `{"error": "message", "code": 400}`
- Never expose raw exception messages to the client

### Authentication
- Use Flask-Login or JWT (Flask-JWT-Extended) — never roll your own auth
- Secrets and tokens in environment variables — never hardcoded
- CSRF protection via Flask-WTF for form submissions

### Database
- SQLAlchemy with Flask-SQLAlchemy for ORM access
- Keep all DB access in service or repository layer — not in route handlers
- Use Flask-Migrate (Alembic) for schema migrations
- Parameterized queries only — no string interpolation in SQL

### Testing
- pytest with `pytest-flask` and an application fixture
- Fixtures in `conftest.py`; test database uses SQLite in-memory or separate test DB
- Mock external services — never hit real APIs in unit tests

### Type Hints
- All functions should have type annotations (Python 3.10+ style)
- Use `from __future__ import annotations` for forward references
