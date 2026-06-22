/** Single source of truth for Cortex brand strings. No bare 'ai-os' literals elsewhere. */
export const BRAND = 'cortex';
export const BRAND_TITLE = 'Cortex';
export const CONFIG_DIR = '.github/cortex';
export const MCP_SERVER_NAME = 'cortex';
export const ENV = {
  ROOT: 'CORTEX_ROOT',
  PERSONAL_ROOT: 'CORTEX_PERSONAL_ROOT',
  CONFIG: 'CORTEX_CONFIG',
  ALLOW_RUN_TOOLS: 'CORTEX_ALLOW_RUN_TOOLS',
  MCP_DEBUG: 'CORTEX_MCP_DEBUG',
} as const;
