## Go Module Conventions

### Project Layout (Standard Go Layout)
- `cmd/` — main packages (entry points); one subdirectory per binary
- `internal/` — private application code; cannot be imported by external modules
- `pkg/` — reusable library code (only if explicitly intended to be exported)
- `api/` — API definitions (protobuf, OpenAPI, JSON Schema)
- `configs/` — configuration file templates
- `docs/` — documentation files
- `scripts/` — scripts for build, install, analysis
- `test/` — additional external test apps and test data

### Code Style
- `gofmt` / `goimports` on all files — no exceptions; enforce in CI
- Follow [Effective Go](https://go.dev/doc/effective_go) idioms
- Short variable names for small scopes (`i`, `err`, `v`), descriptive for package-level
- No global mutable state outside `main`; prefer dependency injection
- Use `iota` for enumerations; avoid bare integer constants
- Prefer table-driven tests with `t.Run` subtests for clarity

### Error Handling
- **Always** check and handle errors — never discard with `_`
- Wrap errors with context: `fmt.Errorf("loading config: %w", err)`
- Use `errors.Is` / `errors.As` for error type checks
- Define sentinel errors with `errors.New` or custom `error` types with `Error() string`
- Return errors up the call stack; log only at the top level (don't log and return)
- Avoid `panic` in library code — reserve for truly unrecoverable states

### Concurrency
- Use `context.Context` for cancellation/timeouts — always pass as first argument
- Prefer channels over shared memory for goroutine communication
- Use `sync.WaitGroup` or `golang.org/x/sync/errgroup` for goroutine orchestration
- Always close channels from the sender, not the receiver
- Use `sync.Mutex` / `sync.RWMutex` to protect shared data; document lock ownership
- Avoid goroutine leaks — every goroutine needs a clear exit path

### Testing
- Table-driven tests preferred; use `t.Run("name", func(t *testing.T) { ... })`
- `testify/assert` and `testify/require` for assertions if already a dependency
- Interface mocks with `mockery` or hand-rolled structs implementing the interface
- Integration tests in `_test` packages (black-box testing)
- Use `t.Parallel()` where tests are independent to speed up test runs
- `go test -race` in CI to detect data races

### Modules
- All imports use the full module path (no relative imports)
- Run `go mod tidy` before committing; keep `go.sum` up to date
- Pin external dependencies — avoid `replace` directives in production
- Use `go.work` for multi-module workspaces in monorepos
- Minimize dependency surface area; prefer standard library when feasible

### API Design (if applicable)
- Use `net/http` or a thin router (Chi, Gin, Echo) — avoid heavy opinionated frameworks
- Return proper HTTP status codes; use `encoding/json` for JSON responses
- Validate all request inputs before processing
- Use middleware for cross-cutting concerns (auth, logging, tracing)
