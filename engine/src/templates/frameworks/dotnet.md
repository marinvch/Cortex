## ASP.NET Core / .NET Conventions

### Project Structure
- `Controllers/` — thin controllers, delegate to services
- `Services/` — business logic, registered in DI
- `Models/` — domain entities
- `DTOs/` — request/response shapes
- `Data/` — DbContext and repositories

### Dependency Injection
- Register everything via DI in `Program.cs`
- Constructor injection only — no service locator pattern
- Interfaces for all services to enable testing

### Validation
- Use Data Annotations (`[Required]`, `[MaxLength]`) or FluentValidation
- `[ApiController]` enables automatic model validation (400 on invalid)
- Global exception middleware for consistent error responses

### Entity Framework
- Use async EF methods (`ToListAsync`, `FirstOrDefaultAsync`)
- Scoped `DbContext` per request
- Migrations via `dotnet ef migrations add`
- No raw SQL unless necessary; use LINQ

### Security
- ASP.NET Core Identity or JWT bearer auth
- `[Authorize]` attribute on protected endpoints
- Secrets in `appsettings.json` → `User Secrets` locally → environment variables in prod

### Testing
- xUnit for unit and integration tests
- `WebApplicationFactory<Program>` for integration tests
- Moq for mocking dependencies
