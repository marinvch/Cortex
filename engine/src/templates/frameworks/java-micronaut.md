## Micronaut / Java Conventions

### Architecture
- `@Controller` for HTTP endpoints — thin layer, delegates to services
- `@Singleton` services for business logic (Micronaut DI is compile-time)
- `@Repository` interfaces extending `CrudRepository` for data access
- DTOs as records or plain Java classes with `@Introspected`

### Dependency Injection
- Constructor injection preferred over field injection for testability
- `@Requires` for conditional beans (environment-specific wiring)
- `@Primary` / `@Secondary` for bean disambiguation

### Validation
- `@Valid` and Jakarta Bean Validation annotations on controller parameters
- `@Error` methods or `ExceptionHandler` for custom error responses
- Return consistent JSON error shapes — Micronaut's `Problem` or custom `ApiError`

### Configuration
- `application.yml` with `@Value` or `@ConfigurationProperties`
- Secrets via environment variables or Micronaut Secret Managers
- Never hardcode credentials — use `${ENV_VAR}` references

### Reactive
- Micronaut supports RxJava3 and Reactor — use when I/O-bound operations benefit
- `@ExecuteOn(TaskExecutors.IO)` for blocking operations in reactive context

### Testing
- `@MicronautTest` for integration tests (fast startup, no reflection scan)
- `@MockBean` to replace beans in tests
- `@Client` with `@MicronautTest` for HTTP client tests
- Testcontainers for database integration tests
