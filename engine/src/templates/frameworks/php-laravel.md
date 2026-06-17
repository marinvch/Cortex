## Laravel / PHP Conventions

### MVC Structure
- `app/Http/Controllers/` — thin controllers; delegate logic to services
- `app/Services/` — business logic; keep controllers free of domain code
- `app/Models/` — Eloquent models with relationships and casts
- `app/Http/Requests/` — Form Request classes for input validation
- `app/Http/Resources/` — API resource transformers (JSON:API style)
- `routes/api.php` — stateless API routes; `routes/web.php` — session-based routes
- `database/migrations/` — versioned schema changes; never edit past migrations

### Validation
- Always use **Form Requests** (`php artisan make:request`) for validation rules
- Never validate in controllers directly — keeps controllers thin
- Return JSON errors for API routes automatically via Form Requests + `failedValidation`
- Use `$request->validated()` (not `$request->all()`) to retrieve only validated data

### Eloquent ORM
- Use Eloquent relationships (`hasMany`, `belongsTo`, `morphTo`, etc.)
- Eager load with `with()` to prevent N+1 queries; use `withCount()` for counts
- Scope queries by user with `where('user_id', auth()->id())` or a global scope
- Use model casts for type safety: `protected $casts = ['settings' => 'array'];`
- Use model factories for seeding and testing; leverage `has()` / `for()` helpers
- Index foreign keys and frequently queried columns in migrations

### Security
- CSRF protection on all state-changing web routes (automatic via `VerifyCsrfToken`)
- Parameterized queries via Eloquent — never concatenate user input into raw SQL
- Secrets in `.env` — never in config files or version control
- Use Laravel Sanctum (SPA/mobile) or Passport (OAuth2) for API auth
- Rate limit sensitive routes with `throttle` middleware
- Validate file uploads: check MIME type, extension, and file size
- Use `Storage::disk()` for file access — never reference `$_FILES` directly

### Testing
- PHPUnit + Laravel's `TestCase` with HTTP assertion helpers
- `RefreshDatabase` trait for tests that modify the DB; use transactions where possible
- `actingAs($user)` for authenticated test scenarios
- HTTP tests via `$this->getJson()`, `$this->postJson()`, `$this->assertStatus()`
- Test factories in `database/factories/` — use `User::factory()->create()` pattern
- Feature tests in `tests/Feature/`, unit tests in `tests/Unit/`

### Artisan & CLI
- Use `php artisan make:*` generators for consistency
- Extract complex scheduled jobs to dedicated `Job` classes dispatched to a queue
- Use `php artisan queue:work` in production; Horizon for Redis-backed queues
- Log structured data with `Log::info('message', ['context' => $data])`
