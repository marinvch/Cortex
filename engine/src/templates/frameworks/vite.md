## Vite Build Tool Conventions

### Project Setup

- `vite.config.ts` at project root — use typed config with `defineConfig()`
- Dev server: `vite` (or `vite dev`); build: `vite build`; preview: `vite preview`
- Source in `src/`, static assets in `public/` (served at root, not processed)

### Config Patterns

- Use `resolve.alias` for path aliases: `{ '@': resolve(__dirname, 'src') }`
- Environment variables must be prefixed `VITE_` to be exposed to client code
- Access via `import.meta.env.VITE_MY_VAR` — strongly type in `vite-env.d.ts`
- Never expose server secrets — only `VITE_`-prefixed vars are bundled

### Assets & CSS

- Import assets directly: `import logo from './logo.svg'` → returns URL string
- CSS Modules: files named `*.module.css` — use `styles.className` pattern
- CSS pre-processors (Sass/Less) require only the corresponding dev dep, no plugin

### Plugins

- Use official plugins: `@vitejs/plugin-react`, `@vitejs/plugin-vue`, `vite-plugin-svelte`
- Load plugins in `plugins: []` array in `vite.config.ts`
- Prefer lightweight maintained plugins over heavy multi-purpose ones

### Build Optimization

- Code splitting is automatic via dynamic `import()` — use lazy routes
- `build.rollupOptions.output.manualChunks` for explicit vendor chunking
- `build.target` default is `'modules'` — change only for legacy browser support
- Analyze bundle with `rollup-plugin-visualizer`

### Testing

- Vitest is the recommended test runner (shares Vite config)
- `import { describe, it, expect } from 'vitest'` — no globals needed by default
- Enable `globals: true` in vitest config to use Jest-compatible globals
