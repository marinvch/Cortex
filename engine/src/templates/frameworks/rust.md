## Rust Conventions

### Project Structure
- `src/main.rs` — binary entry point; `src/lib.rs` — library entry point
- Modules as files (`src/auth.rs`) or folders (`src/auth/mod.rs`)
- Integration tests in `tests/` (each file is a separate test binary)
- Benchmarks in `benches/` (use `criterion` crate for statistical benchmarks)
- Examples in `examples/` — runnable with `cargo run --example name`
- Workspace members in `Cargo.toml` `[workspace]` for monorepos

### Error Handling
- Use `anyhow` for application-level errors (adds context and backtraces)
- Use `thiserror` to define typed errors in libraries
- Prefer `?` operator over explicit `match` for error propagation
- Never use `unwrap()` in production code — use `expect("context")` at minimum
- Return `Result<T, E>` from all fallible functions; avoid panics in library code
- Log errors at the outermost boundary, not inside utility functions

### Ownership & Lifetimes
- Prefer owned types over references in public APIs where cloning is cheap
- Use `Arc<T>` for shared ownership across threads; `Rc<T>` in single-threaded only
- `Clone` derive is fine for small types; benchmark before cloning large data in hot paths
- Avoid unnecessary lifetime annotations — let the borrow checker infer where possible
- Use `Cow<'_, str>` for functions that may or may not own string data

### Async (Tokio)
- Use `tokio` as the async runtime with `#[tokio::main]` on `main`
- `async fn` for async functions; annotate trait methods carefully (`async_trait` or AFIT)
- Use `tokio::spawn` for background tasks; `tokio::join!` / `tokio::select!` for concurrency
- `tokio::sync::{Mutex, RwLock}` for async-safe shared state
- Avoid blocking calls inside async context — use `tokio::task::spawn_blocking` if needed

### Code Style
- `rustfmt` on all files — run via `cargo fmt`; enforce in CI
- `clippy` warnings must pass: `cargo clippy -- -D warnings`
- Derive macros in order: `Debug`, `Clone`, `PartialEq`, `Eq`, `Hash`, `serde::Serialize/Deserialize`
- Prefer `impl Trait` return types for flexibility; use named types in public APIs
- Keep functions small; extract logic into helpers with descriptive names

### Testing
- Unit tests in the same file under `#[cfg(test)] mod tests { ... }`
- Integration tests in `tests/` — each `.rs` file is a separate binary
- Use `pretty_assertions` for readable diff output on failures
- Mock with `mockall` or build test doubles that implement the same trait
- Run with `cargo test` (all tests) or `cargo nextest run` for parallel runs

### Security
- Validate all external inputs — never trust untrusted data
- Use `secrecy::Secret<T>` for sensitive values (keys, passwords) to prevent accidental logging
- Audit dependencies with `cargo audit`; pin versions in `Cargo.lock`
- Prefer `safe` code; `unsafe` blocks must be reviewed, documented, and minimized
