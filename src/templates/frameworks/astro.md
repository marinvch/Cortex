# Astro Conventions

## Rendering Strategy

- Prefer static/server rendering and hydrate islands only when interactivity is required
- Keep page frontmatter focused on data loading and orchestration
- Move reusable UI into components and shared data helpers

## Content and Data

- Type content collections and validate frontmatter schemas
- Keep external fetch logic centralized and cache-aware
- Normalize external data before rendering

## Performance

- Minimize client-side JavaScript by default
- Use partial hydration intentionally and measure impact when adding islands
