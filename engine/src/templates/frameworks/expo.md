# Expo Conventions

## Project Setup

- Keep environment-specific config in Expo config files and runtime-safe env boundaries
- Avoid committing secrets in app config or source files
- Keep native plugin usage documented and centralized

## Code Organization

- Use feature folders for screens, hooks, and services
- Keep UI components presentational and business rules in hooks/services
- Use TypeScript for route params and API payloads

## Runtime Behavior

- Handle permissions and device capability checks explicitly
- Gracefully handle background/foreground lifecycle transitions
