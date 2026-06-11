# Vue Conventions

## Component Design

- Use script setup with TypeScript for all new components
- Keep components focused on UI concerns and move business logic to composables/services
- Prefer explicit props/emits contracts over implicit event coupling

## State and Data Flow

- Keep local component state minimal and derive computed values when possible
- Consolidate shared state in stores/composables, not ad-hoc globals
- Validate external data before putting it into reactive state

## Quality

- Keep template logic simple; extract complex transforms into methods/computed values
- Add unit tests for complex composables and interaction-heavy components
