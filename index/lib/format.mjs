// format.mjs — the one number that says what shape an index.json is in, and where it lives.
//
// It stays the smallest module in this package, so that a *reader* of an index can check the
// version without importing the *writer*. `build.mjs` pulls in the walker, the language table,
// the import resolvers, the stack detector and `child_process`; `cortex-next.mjs` and
// `cortex-view.mjs` want one string.
//
// The values are defined in `core/index-file.js`, because the `graph` MCP tool reads the same index
// and must refuse the same formats. `build.mjs` re-exports the version, and `open.mjs` re-exports
// both of these, so a CLI still asks the front door for everything.

export { INDEX_REL, INDEX_VERSION, defaultIndexPath } from "../../core/index-file.js";
