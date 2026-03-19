import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Bridge } from './bridge.js';
import { registerTools } from './tools.js';

const PORT = parseInt(process.env.FIGMA_WS_PORT || '3055', 10);

const server = new McpServer({
  name: 'figma-slide-mcp',
  version: '0.1.0'
});

const bridge = new Bridge({ port: PORT });

registerTools(server, bridge);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[figma-slide-mcp] MCP server running on stdio');
  console.error(`[figma-slide-mcp] WebSocket server listening on ws://localhost:${PORT}`);
  console.error('[figma-slide-mcp] Waiting for Figma plugin connection...');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
