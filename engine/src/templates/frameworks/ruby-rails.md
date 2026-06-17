## Ruby on Rails Conventions

### MVC Structure
- Thin controllers, fat models — or better: thin everything with dedicated service objects
- Service objects in `app/services/` for non-trivial business logic (plain Ruby classes)
- Form objects in `app/forms/` for complex multi-model form handling
- Query objects in `app/queries/` for reusable, composable ActiveRecord queries
- Presenters / decorators in `app/decorators/` (Draper or PORO) to keep views clean
- Background jobs in `app/jobs/` (ActiveJob + Sidekiq or Solid Queue)

### ActiveRecord
- Validate in models: `validates :email, presence: true, uniqueness: { case_sensitive: false }`
- Use named scopes for reusable query logic: `scope :active, -> { where(active: true) }`
- Eager load associations with `includes()` to prevent N+1 queries; use Bullet gem in dev
- Add DB constraints + model validations (defense in depth)
- Use `counter_cache:` for has_many count queries; avoid SELECT COUNT in loops
- Avoid callbacks for cross-model side effects — use service objects instead
- Index all foreign keys and frequently filtered/sorted columns

### Security
- `strong_parameters` — always whitelist with `permit()` in controllers
- CSRF protection enabled by default — never disable for state-changing endpoints
- Brakeman for static security analysis — run in CI
- Credentials in `config/credentials.yml.enc` (Rails >= 5.2) or env vars
- Use `bcrypt` (Devise default) for password hashing — never MD5/SHA1
- Scope database queries by the current user: `current_user.posts.find(params[:id])`
- Sanitize user-generated HTML with `rails-html-sanitizer` before rendering

### API (Rails API mode)
- `respond_to :json` (or inherit from `ActionController::API`) for API controllers
- Serializers: ActiveModel::Serializer or `jsonapi-serializer` for consistent shape
- Pagination: Kaminari (`paginate`) or Pagy (lighter, faster)
- JWT or Devise Token Auth for stateless API authentication
- Return proper HTTP status codes: 201 for created, 422 for validation errors, 404 for not found
- Version APIs under namespaced routes: `namespace :v1 { resources :posts }`

### Testing
- RSpec with FactoryBot (`spec/factories/`)
- `let` / `let!` for test data setup; `subject` for the primary object under test
- Shoulda Matchers for model validations and associations
- VCR / WebMock to stub external HTTP calls — never hit real APIs in tests
- `database_cleaner` or transactional fixtures to isolate test DB state
- System tests with Capybara + Selenium for critical user flows
- `bundle exec rspec --format documentation` for readable output

### Performance
- Cache view fragments and expensive queries with `Rails.cache` (Redis backend)
- Use `ActiveJob` for anything that doesn't need to happen synchronously
- Monitor N+1 with Bullet in development; profile with Rack Mini Profiler
- Use `select` to fetch only needed columns in large queries
- Enable `rack-attack` for rate limiting and abuse protection
