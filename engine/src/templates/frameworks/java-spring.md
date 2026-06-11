## Spring Boot / Java Conventions

### Layered Architecture
- `@RestController` — HTTP layer only (parse request, call service, return response)
- `@Service` — business logic
- `@Repository` — data access (Spring Data JPA or custom)
- `@Entity` — JPA entities in `model/` package

### Validation
- Use Bean Validation (`@Valid`, `@NotNull`, `@Size`) on DTO classes
- `@ControllerAdvice` for global exception handling
- Return `ProblemDetail` (RFC 7807) or consistent `ApiError` JSON

### Security
- Spring Security for authentication — never implement custom auth from scratch
- `@PreAuthorize` for method-level security
- Secrets in `application.properties` / environment variables — never in code
- CSRF protection enabled by default — only disable for stateless APIs

### JPA & Transactions
- `@Transactional` on service methods that modify state
- Use projections or DTOs for read-only queries (avoid over-fetching)
- Avoid N+1: use `JOIN FETCH` or `@EntityGraph`
- Migrations via Flyway or Liquibase

### Testing
- `@SpringBootTest` for integration tests
- `@WebMvcTest` for controller unit tests (mock service layer)
- `@DataJpaTest` for repository tests
- Testcontainers for database integration tests
