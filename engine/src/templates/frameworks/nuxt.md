# Nuxt Conventions

## Architecture

- Prefer server-rendered pages by default and use client-only behavior only where necessary
- Keep data fetching in composables/services, not deeply inside UI trees
- Split route-level concerns from reusable presentation components

## Data and Validation

- Validate route params and external API payloads at the boundary
- Keep shared DTO/types in a dedicated types folder
- Normalize external data before passing to components

## API and Security

- Keep server routes thin and delegate to services for business logic
- Do not trust client-provided identity context; use validated session/token data
- Keep secrets in environment files and never commit values
