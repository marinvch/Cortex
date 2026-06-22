import { describe, it, expect } from 'vitest';
import { BRAND, BRAND_TITLE, CONFIG_DIR, MCP_SERVER_NAME, ENV } from '../brand.js';

describe('brand', () => {
  it('exposes the canonical Cortex constants', () => {
    expect(BRAND).toBe('cortex');
    expect(BRAND_TITLE).toBe('Cortex');
    expect(CONFIG_DIR).toBe('.github/cortex');
    expect(MCP_SERVER_NAME).toBe('cortex');
    expect(ENV).toEqual({
      ROOT: 'CORTEX_ROOT',
      PERSONAL_ROOT: 'CORTEX_PERSONAL_ROOT',
      CONFIG: 'CORTEX_CONFIG',
      ALLOW_RUN_TOOLS: 'CORTEX_ALLOW_RUN_TOOLS',
      MCP_DEBUG: 'CORTEX_MCP_DEBUG',
    });
  });
});
