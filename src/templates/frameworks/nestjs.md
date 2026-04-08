# NestJS Conventions

## Module Design

- Organize by feature module with controller, service, and DTO boundaries
- Keep controllers thin; business logic belongs in services
- Use providers for cross-cutting concerns and shared integrations

## Validation and Errors

- Validate request payloads with DTOs and class-validator
- Map domain errors to consistent HTTP responses
- Guard sensitive routes with auth/role guards

## Data Access

- Keep database access in repositories/services, not controllers
- Scope queries by authenticated user or tenant where applicable
