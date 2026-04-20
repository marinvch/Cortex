import { describe, expect, it } from 'vitest';
import { getAllMcpTools as getGeneratorTools } from '../mcp-tools.js';
import { getAllMcpTools as getRuntimeTools } from '../mcp-server/tool-definitions.js';

describe('MCP tool definition parity', () => {
  it('runtime MCP tools match shared generator tool catalog', () => {
    const generatorTools = getGeneratorTools();
    const runtimeTools = getRuntimeTools();

    expect(runtimeTools.length).toBe(generatorTools.length);

    for (let i = 0; i < generatorTools.length; i++) {
      expect(runtimeTools[i]).toEqual({
        name: generatorTools[i].name,
        description: generatorTools[i].description,
        inputSchema: generatorTools[i].inputSchema,
      });
    }
  });
});
