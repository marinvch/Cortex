## Java Conventions

### Architecture
- Separate concerns: presentation layer → service layer → data access layer
- Use interfaces for services to keep implementations swappable
- Avoid static utility classes — prefer dependency injection
- Keep classes small and focused (Single Responsibility)

### Code Quality
- Immutable value objects where possible — use records (Java 14+) or `final` fields
- Avoid nulls — use `Optional<T>` for potentially absent values
- No raw types — always use generics with type parameters
- `var` for local variables is fine when type is obvious from the right-hand side

### Error Handling
- Use checked exceptions for recoverable conditions, unchecked for programming errors
- Never swallow exceptions with empty catch blocks
- Log at the right level: `ERROR` for unexpected failures, `WARN` for recoverable issues

### Testing
- JUnit 5 (`@Test`, `@BeforeEach`, `@ParameterizedTest`)
- Mockito for mocking dependencies
- AssertJ for fluent assertions
- Integration tests with Testcontainers for real database/service dependencies

### Build & Dependencies
- Maven or Gradle — keep dependency versions in properties or version catalog
- No snapshot dependencies in release builds
- Run `mvn dependency:analyze` or `./gradlew dependencies` periodically to audit deps

### Security
- Validate all external input before processing
- Parameterized queries only — no string concatenation in SQL
- Secrets via environment variables or a secrets manager — never in source code
