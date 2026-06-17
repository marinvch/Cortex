# Drizzle ORM Conventions

## Schema and Migrations

- Keep schema definitions versioned and aligned with migration history
- Use explicit column types and constraints; avoid ambiguous defaults
- Name tables and indexes consistently with project conventions

## Query Layer

- Keep query composition in repository/data-access modules
- Avoid leaking raw query details into route/controller layers
- Scope user-owned records by authenticated identity boundaries

## Safety

- Validate input at service boundaries before query construction
- Favor composable typed queries over ad-hoc string SQL
