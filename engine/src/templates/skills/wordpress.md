## {{PROJECT_NAME}} — WordPress Patterns

### Hook Naming
- Prefix all custom hooks with the project slug: `{{PROJECT_NAME}}_` (e.g. `{{PROJECT_NAME}}_after_save_post`)
- Use `do_action()` for events, `apply_filters()` for filterable values
- Document every custom hook with a docblock: `@since`, `@param`, `@return`

### Security Rules
- **Never** echo unsanitized user input — always `esc_html()`, `esc_attr()`, `esc_url()`, or `wp_kses_post()`
- **Always** verify nonces with `wp_verify_nonce()` before processing form or AJAX submissions
- **Always** check capabilities with `current_user_can()` before any admin or privileged action
- **Always** use `$wpdb->prepare()` for raw SQL — never string-concatenate user input into queries

### Template Hierarchy
- Use template parts (`get_template_part()`) to keep templates DRY
- Pass data via `$args` array (WP 5.5+): `get_template_part('template-parts/card', null, $args)`
- Never use `query_posts()` — use `WP_Query` with explicit `$args` and `wp_reset_postdata()`

### Plugin / Theme Architecture
- Register all functionality via hooks in `functions.php` or a plugin bootstrap file
- Use `class` wrappers for plugin logic — never pollute the global namespace with plain functions
- Enqueue assets via `wp_enqueue_script()` / `wp_enqueue_style()` with correct `$deps` and `$ver`
- Separate admin and front-end enqueues: use `is_admin()` guard or separate `admin_enqueue_scripts` / `wp_enqueue_scripts` hooks

### REST API Endpoints
- Register via `register_rest_route()` in a `rest_api_init` callback
- Always set `permission_callback` — never use `__return_true` for non-public routes
- Use `validate_callback` + `sanitize_callback` on all `$args`
- Return `WP_REST_Response` or `WP_Error`

### WooCommerce (when active)
- Extend via hooks/filters only — no core file edits
- Use `WC()->cart`, `WC()->session`, `WC()->customer` singletons
- Prefer WC data stores over direct `$wpdb` queries for order/product data
