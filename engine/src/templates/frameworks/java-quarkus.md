## Quarkus / Java Conventions

### Architecture
- CDI beans for dependency injection (`@ApplicationScoped`, `@RequestScoped`)
- JAX-RS resources (`@Path`) for HTTP layer — delegate to services immediately
- Services contain all business logic
- Panache for data access (`PanacheEntity` or `PanacheRepository`)

### Reactive vs Imperative
- Prefer Mutiny (`Uni<T>`, `Multi<T>`) for I/O-bound operations
- Use `@Blocking` annotation when calling blocking code in a reactive context
- Never block the event loop — offload with `@Blocking` or Mutiny `runSubscriptionOn`

### Validation
- Bean Validation (`@Valid`, `@NotNull`, `@Size`) on resource parameters and DTOs
- `@ServerExceptionMapper` for centralized error handling
- Return consistent problem JSON (RFC 7807) or `RestResponse` error shapes

### Configuration
- All config in `application.properties` / `application.yml`
- Use `@ConfigProperty` for injecting values — never hardcode secrets
- Profiles (`%dev`, `%test`, `%prod`) for environment-specific config

### Testing
- `@QuarkusTest` for integration tests (starts real application)
- `@QuarkusUnitTest` for isolated unit tests
- `@InjectMock` for service mocking within `@QuarkusTest`
- Testcontainers via `@QuarkusTestResource` for databases

### Native Image
- Avoid reflection where possible — use Quarkus extensions instead
- Register classes for reflection with `@RegisterForReflection` when necessary
- Test native builds in CI: `./mvnw package -Pnative`
