# Angular Conventions

## Feature Organization

- Prefer standalone components and feature-oriented folders
- Keep components thin and move business logic to injectable services
- Use typed interfaces/models for HTTP request and response payloads

## Forms and Validation

- Use reactive forms for non-trivial input flows
- Keep validation rules centralized and reusable
- Validate all external input at controller/endpoint boundaries

## Data and Performance

- Use RxJS streams intentionally; avoid unnecessary subscriptions
- Unsubscribe/cleanup long-lived streams in component lifecycle
- Keep change detection predictable and avoid hidden side effects
