/**
 * Lazy Tool Discovery — Meta-tools
 *
 * When a namespace/endpoint is configured for LAZY discovery, these three
 * meta-tools are returned instead of the full tool catalog.  The model can
 * search the DB-cached tool index, list connected servers, and finally
 * execute any real tool by delegating through metamcp__execute_tool.
 *
 * No session-scoped activation map is required — the dispatcher connects to
 * the downstream server on demand and runs the call in one shot.
 */

import {
  CompatibilityCallToolResultSchema,
  type CallToolResult,
  type ListToolsResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { and, eq, ilike, or } from "drizzle-orm";

import logger from "@/utils/logger";

import { db } from "../../db/index";
import {
  mcpServersTable,
  namespaceServerMappingsTable,
  namespaceToolMappingsTable,
  toolsTable,
} from "../../db/schema";
import { getMcpServers } from "./fetch-metamcp";
import { mcpServerPool } from "./mcp-server-pool";

export const META_TOOL_PREFIX = "metamcp__";

export const META_TOOL_NAMES = {
  SEARCH_TOOLS: `${META_TOOL_PREFIX}search_tools`,
  LIST_SERVERS: `${META_TOOL_PREFIX}list_servers`,
  EXECUTE_TOOL: `${META_TOOL_PREFIX}execute_tool`,
} as const;

export function isMetaTool(toolName: string): boolean {
  return toolName.startsWith(META_TOOL_PREFIX);
}

/** The three meta-tool definitions returned in tools/list when LAZY mode is active. */
export const META_TOOLS: Tool[] = [
  {
    name: META_TOOL_NAMES.SEARCH_TOOLS,
    description:
      "Search the tool index for tools matching a query. Use this to discover available tools before calling them via metamcp__execute_tool.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search term matched against tool name and description (case-insensitive).",
        },
        server: {
          type: "string",
          description:
            "Optional: limit results to tools from this server (by server name).",
        },
        limit: {
          type: "number",
          description: "Max number of results to return (default 20, max 100).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: META_TOOL_NAMES.LIST_SERVERS,
    description:
      "List all MCP servers connected to this namespace, with their names and descriptions.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: META_TOOL_NAMES.EXECUTE_TOOL,
    description:
      "Execute a tool on a connected MCP server. Use metamcp__search_tools first to find the exact server_name and tool_name. Arguments must match the tool's input schema.",
    inputSchema: {
      type: "object",
      properties: {
        server_name: {
          type: "string",
          description: "The exact server name as returned by metamcp__search_tools or metamcp__list_servers.",
        },
        tool_name: {
          type: "string",
          description: "The exact tool name (without the server prefix).",
        },
        arguments: {
          type: "object",
          description: "Arguments to pass to the tool.",
        },
      },
      required: ["server_name", "tool_name"],
    },
  },
];

export function buildMetaToolsListResult(): ListToolsResult {
  return { tools: META_TOOLS };
}

// ---------------------------------------------------------------------------
// Individual meta-tool handlers
// ---------------------------------------------------------------------------

async function handleSearchTools(
  args: Record<string, unknown>,
  namespaceUuid: string,
): Promise<CallToolResult> {
  const query = String(args.query ?? "");
  const serverFilter = args.server ? String(args.server) : undefined;
  const limit = Math.min(Number(args.limit ?? 20), 100);

  try {
    const rows = await db
      .select({
        toolName: toolsTable.name,
        toolDescription: toolsTable.description,
        serverName: mcpServersTable.name,
      })
      .from(toolsTable)
      .innerJoin(
        namespaceToolMappingsTable,
        eq(toolsTable.uuid, namespaceToolMappingsTable.tool_uuid),
      )
      .innerJoin(
        mcpServersTable,
        eq(toolsTable.mcp_server_uuid, mcpServersTable.uuid),
      )
      .where(
        and(
          eq(namespaceToolMappingsTable.namespace_uuid, namespaceUuid),
          eq(namespaceToolMappingsTable.status, "ACTIVE"),
          or(
            ilike(toolsTable.name, `%${query}%`),
            ilike(toolsTable.description, `%${query}%`),
          ),
          serverFilter
            ? ilike(mcpServersTable.name, `%${serverFilter}%`)
            : undefined,
        ),
      )
      .limit(limit);

    const text =
      rows.length === 0
        ? `No tools found matching "${query}".`
        : rows
            .map(
              (r) =>
                `server: ${r.serverName}  |  tool: ${r.toolName}  |  ${r.toolDescription ?? ""}`,
            )
            .join("\n");

    return {
      content: [{ type: "text", text }],
    };
  } catch (error) {
    logger.error("metamcp__search_tools error:", error);
    return {
      content: [{ type: "text", text: `Search failed: ${String(error)}` }],
      isError: true,
    };
  }
}

async function handleListServers(
  namespaceUuid: string,
): Promise<CallToolResult> {
  try {
    const rows = await db
      .select({
        name: mcpServersTable.name,
        description: mcpServersTable.description,
        status: namespaceServerMappingsTable.status,
      })
      .from(mcpServersTable)
      .innerJoin(
        namespaceServerMappingsTable,
        eq(mcpServersTable.uuid, namespaceServerMappingsTable.mcp_server_uuid),
      )
      .where(
        and(
          eq(namespaceServerMappingsTable.namespace_uuid, namespaceUuid),
          eq(namespaceServerMappingsTable.status, "ACTIVE"),
        ),
      );

    const text =
      rows.length === 0
        ? "No active servers in this namespace."
        : rows
            .map((r) => `${r.name}${r.description ? ` — ${r.description}` : ""}`)
            .join("\n");

    return {
      content: [{ type: "text", text }],
    };
  } catch (error) {
    logger.error("metamcp__list_servers error:", error);
    return {
      content: [{ type: "text", text: `List servers failed: ${String(error)}` }],
      isError: true,
    };
  }
}

async function handleExecuteTool(
  args: Record<string, unknown>,
  namespaceUuid: string,
  sessionId: string,
): Promise<CallToolResult> {
  const serverName = String(args.server_name ?? "");
  const toolName = String(args.tool_name ?? "");
  const toolArgs = (args.arguments ?? {}) as Record<string, unknown>;

  if (!serverName || !toolName) {
    return {
      content: [
        {
          type: "text",
          text: "server_name and tool_name are required.",
        },
      ],
      isError: true,
    };
  }

  try {
    const serverParams = await getMcpServers(namespaceUuid, false);

    // Find the server by name
    const serverEntry = Object.entries(serverParams).find(
      ([, params]) =>
        (params.name ?? "").toLowerCase() === serverName.toLowerCase(),
    );

    if (!serverEntry) {
      return {
        content: [
          {
            type: "text",
            text: `Server "${serverName}" not found in this namespace. Use metamcp__list_servers to see available servers.`,
          },
        ],
        isError: true,
      };
    }

    const [mcpServerUuid, params] = serverEntry;

    const session = await mcpServerPool.getSession(
      sessionId,
      mcpServerUuid,
      params,
      namespaceUuid,
    );

    if (!session) {
      return {
        content: [
          {
            type: "text",
            text: `Could not connect to server "${serverName}". It may require OAuth authorization.`,
          },
        ],
        isError: true,
      };
    }

    const result = await session.client.request(
      {
        method: "tools/call",
        params: {
          name: toolName,
          arguments: toolArgs,
        },
      },
      CompatibilityCallToolResultSchema,
    );

    return result as CallToolResult;
  } catch (error) {
    logger.error(
      `metamcp__execute_tool error (server=${serverName}, tool=${toolName}):`,
      error,
    );
    return {
      content: [
        {
          type: "text",
          text: `Tool execution failed: ${String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export async function executeMetaTool(
  toolName: string,
  args: Record<string, unknown>,
  namespaceUuid: string,
  sessionId: string,
): Promise<CallToolResult> {
  switch (toolName) {
    case META_TOOL_NAMES.SEARCH_TOOLS:
      return handleSearchTools(args, namespaceUuid);
    case META_TOOL_NAMES.LIST_SERVERS:
      return handleListServers(namespaceUuid);
    case META_TOOL_NAMES.EXECUTE_TOOL:
      return handleExecuteTool(args, namespaceUuid, sessionId);
    default:
      return {
        content: [{ type: "text", text: `Unknown meta-tool: ${toolName}` }],
        isError: true,
      };
  }
}
