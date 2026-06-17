## Django Conventions

### Project Structure
- Business logic in `views.py` (thin) + `services.py` (fat)
- Models in `models.py` with explicit `__str__` methods
- URL patterns in `urls.py`, namespaced by app
- Forms/serializers in `forms.py` or `serializers.py` (DRF)

### ORM & Queries
- Use `select_related()` / `prefetch_related()` to avoid N+1 queries
- Never filter in Python what can be filtered in queryset
- Use `F()` expressions for atomic field updates
- Scope all querysets by the current user when applicable

### Security
- Always use CSRF protection — never exempt without a clear reason
- Parameterized queries via ORM — never raw SQL string formatting
- `settings.SECRET_KEY` and all credentials in environment variables
- Use `@login_required` / `LoginRequiredMixin` on protected views

### REST API (DRF)
- Serializers validate all inputs — no manual validation in views
- Use `ModelViewSet` for CRUD, class-based views for custom logic
- Pagination on all list endpoints
- Return `{count, next, previous, results}` for paginated responses

### Testing
- `pytest-django` with fixtures in `conftest.py`
- `APIClient` for API tests, `TestCase` for unit tests
- Factory Boy for model factories
