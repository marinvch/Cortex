## WordPress / PHP Conventions

### Project Structure
- `wp-content/themes/<theme>/` — active theme; child themes inherit from parent via `functions.php`
- `wp-content/plugins/<plugin>/` — plugin root; main file has plugin header comment
- `wp-content/mu-plugins/` — must-use plugins; auto-loaded, not activatable from admin
- `wp-config.php` — environment config; DB credentials, debug flags, table prefix
- Never commit credentials — use environment variables or a local `wp-config-local.php`

### WordPress Coding Standards
- Follow the [WordPress Coding Standards](https://developer.wordpress.org/coding-standards/) for naming and formatting
- Use `snake_case` for PHP functions and variables; prefix custom functions with the project slug (e.g. `mysite_get_user_meta()`)
- Use `PascalCase` for PHP classes
- Use `kebab-case` for template file names and CSS classes

### Hooks and Actions
- Register all custom behavior through actions and filters — never modify core files
- Use `add_action()` / `add_filter()` with a descriptive callback name (not anonymous closures) for debuggability
- Always pass `$priority` (default 10) and `$accepted_args` when using multiple arguments in filters
- Remove hooks with `remove_action()` / `remove_filter()` using the exact same priority and callback reference

### Security
- **Nonces**: use `wp_nonce_field()` / `wp_verify_nonce()` for all custom forms and AJAX requests
- **Sanitize** all input at the boundary: `sanitize_text_field()`, `sanitize_email()`, `absint()`, `wp_kses_post()` — choose the right sanitizer for the data type
- **Escape** all output: `esc_html()`, `esc_attr()`, `esc_url()`, `wp_kses_post()` — never echo raw user data
- **Capability checks**: use `current_user_can()` before any admin action; use `check_admin_referer()` in admin POST handlers
- Use `$wpdb->prepare()` for all custom SQL queries — never concatenate user input into SQL
- Prefix all options, post meta keys, and table names with the project slug to avoid collisions

### Database
- Prefer the WP Options API (`get_option()`, `update_option()`) for site-wide settings
- Use Post Meta (`get_post_meta()`, `update_post_meta()`) for per-post data
- Use User Meta for per-user data
- Use `WP_Query` for custom post queries; avoid `query_posts()` (breaks the main loop)
- Use `$wpdb->prepare()` for raw queries; register custom tables in `dbDelta()` migrations

### AJAX
- Register AJAX handlers via `wp_ajax_{action}` (authenticated) and `wp_ajax_nopriv_{action}` (public)
- Always verify nonce and capability in every AJAX handler before processing
- Return `wp_send_json_success()` / `wp_send_json_error()` and call `wp_die()` at the end

### Enqueue Scripts and Styles
- Always use `wp_enqueue_script()` / `wp_enqueue_style()` — never `<script>` tags directly in templates
- Set correct dependencies array to control load order
- Use `wp_localize_script()` to pass PHP data (e.g. AJAX URL, nonces) to JavaScript

### REST API
- Register custom endpoints via `register_rest_route()` in `rest_api_init`
- Validate and sanitize all params with `validate_callback` and `sanitize_callback`
- Use `permission_callback` to enforce capabilities — never use `__return_true` in production
- Return `WP_REST_Response` or `WP_Error` — do not echo directly

### WooCommerce (if present)
- Extend WooCommerce via hooks and filters — do not modify WooCommerce core files
- Use `woocommerce_before_add_to_cart_button` / `woocommerce_after_order_notes` etc. for template injection
- Use `WC()` global and WC data stores for product/order data access
- Test checkout flow changes with multiple payment gateways and guest/registered user paths
