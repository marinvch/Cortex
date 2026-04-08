# Svelte Conventions

## Component Structure

- Keep components small and focused; extract reusable behavior into modules/stores
- Use TypeScript for props and exported contracts
- Avoid deeply nested reactive statements when a derived helper is clearer

## State and Reactivity

- Prefer derived stores for computed cross-component state
- Keep side effects explicit and isolate them in lifecycle blocks or services
- Validate external input before writing to stores

## API Integration

- Keep network and business logic out of view components
- Normalize server responses and map to typed UI models
