# React Native Conventions

## App Structure

- Organize screens by feature and extract reusable UI primitives
- Keep business logic in hooks/services, not directly in screen components
- Type navigation params and API models strictly

## State and Side Effects

- Keep state local unless shared across multiple screens
- Use dedicated hooks for asynchronous effects and cancellation handling
- Handle offline and slow-network behavior explicitly

## Mobile Quality

- Ensure accessibility labels/roles for interactive elements
- Test on small and large screen sizes and both platforms where applicable
