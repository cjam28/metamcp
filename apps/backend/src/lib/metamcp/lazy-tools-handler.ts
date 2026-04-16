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
import { and, asc, eq, ilike, sql } from "drizzle-orm";

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

/** Prevent user-supplied `%` / `_` from widening ILIKE matches. */
function sanitizeIlikeToken(token: string): string {
  return token.replace(/[%_\\]/g, "").trim();
}

/** Split query into tokens; each token must match (AND) for multi-word search. */
function tokenizeSearchQuery(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map(sanitizeIlikeToken)
    .filter((t) => t.length > 0);
}

/** Short list of input schema property keys to help the model build execute_tool arguments. */
function summarizeToolSchemaProperties(toolSchema: unknown): string {
  if (!toolSchema || typeof toolSchema !== "object") return "";
  const obj = toolSchema as { properties?: Record<string, unknown> };
  if (!obj.properties || typeof obj.properties !== "object") return "";
  const keys = Object.keys(obj.properties);
  if (keys.length === 0) return "";
  const shown = keys.slice(0, 12);
  const more = keys.length > shown.length ? " …" : "";
  return `[${shown.join(", ")}${more}]`;
}

/** The three meta-tool definitions returned in tools/list when LAZY mode is active. */
export const META_TOOLS: Tool[] = [
  {
    name: META_TOOL_NAMES.SEARCH_TOOLS,
    title: "Search tools (lazy discovery)",
    description: [
      "PRIMARY discovery step in lazy mode: search the cached tool catalog for this namespace.",
      "Matches tool name, description, namespace-specific overrides, and server name/description. Multi-word queries require each word to match somewhere (AND across words).",
      "Flow: (1) search_tools with task keywords → (2) read lines for exact server + tool names → (3) metamcp__execute_tool. If you need integration names first, call metamcp__list_servers.",
      "Tips: use task verbs/nouns (e.g. send email, list invoices); try synonyms if no hits; narrow with the optional server filter.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Keywords or short phrase; whitespace splits into tokens (each token must match). Case-insensitive.",
        },
        server: {
          type: "string",
          description:
            "Optional substring filter on MCP server name (case-insensitive).",
        },
        limit: {
          type: "number",
          description: "Max results (default 20, max 100).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: META_TOOL_NAMES.LIST_SERVERS,
    title: "List MCP servers (lazy discovery)",
    description: [
      "Lists upstream MCP servers in this namespace (name and description).",
      "Use when the user asks what integrations exist, or to copy exact server_name values for metamcp__execute_tool.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: META_TOOL_NAMES.EXECUTE_TOOL,
    title: "Execute a downstream MCP tool (dispatcher)",
    description: [
      "Invokes a real tool on an upstream MCP server — the only way to call non-meta tools in lazy mode.",
      "server_name and tool_name must match metamcp__search_tools / metamcp__list_servers output (tool_name is the upstream tool id, not metamcp__*).",
      "arguments must follow that tool's input schema; use search_tools parameter hints when present.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        server_name: {
          type: "string",
          description:
            "MCP server name for this namespace (as shown in search_tools / list_servers).",
        },
        tool_name: {
          type: "string",
          description: "Upstream tools/call name (exact string from search results).",
        },
        arguments: {
          type: "object",
          description: "JSON object; keys should match the tool input schema.",
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

/** One token must match name, descriptions, overrides, or server fields. */
function tokenMatchesSql(token: string) {
  const pat = `%${token}%`;
  return sql`(
    ${toolsTable.name} ILIKE ${pat}
    OR COALESCE(${toolsTable.description}, '') ILIKE ${pat}
    OR COALESCE(${namespaceToolMappingsTable.override_name}, '') ILIKE ${pat}
    OR COALESCE(${namespaceToolMappingsTable.override_description}, '') ILIKE ${pat}
    OR COALESCE(${namespaceToolMappingsTable.override_title}, '') ILIKE ${pat}
    OR ${mcpServersTable.name} ILIKE ${pat}
    OR COALESCE(${mcpServersTable.description}, '') ILIKE ${pat}
  )`;
}

async function handleSearchTools(
  args: Record<string, unknown>,
  namespaceUuid: string,
): Promise<CallToolResult> {
  const query = String(args.query ?? "");
  const serverFilter = args.server
    ? sanitizeIlikeToken(String(args.server))
    : undefined;
  const limit = Math.min(Number(args.limit ?? 20), 100);

  const tokens = tokenizeSearchQuery(query);
  if (tokens.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: 'Provide at least one search word in "query" (letters/numbers). Example: "email send" or "unifi client".',
        },
      ],
      isError: true,
    };
  }

  try {
    const tokenPredicates = tokens.map((t) => tokenMatchesSql(t));
    const rows = await db
      .select({
        toolName: sql<string>`COALESCE(${namespaceToolMappingsTable.override_name}, ${toolsTable.name})`,
        toolDescription: sql<string>`COALESCE(${namespaceToolMappingsTable.override_description}, ${namespaceToolMappingsTable.override_title}, ${toolsTable.description}, '')`,
        serverName: mcpServersTable.name,
        toolSchema: toolsTable.toolSchema,
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
          ...tokenPredicates,
          serverFilter
            ? ilike(mcpServersTable.name, `%${serverFilter}%`)
            : undefined,
        ),
      )
      .orderBy(asc(mcpServersTable.name), asc(toolsTable.name))
      .limit(limit);

    const text =
      rows.length === 0
        ? `No tools found for ${tokens.map((t) => `"${t}"`).join(" AND ")}. Try fewer or broader keywords, or use metamcp__list_servers to see integrations.`
        : [
            `Matched ${rows.length} tool(s) (tokens: ${tokens.join(", ")}). Lines: server | tool | description | param hints`,
            ...rows.map((r) => {
              const hints = summarizeToolSchemaProperties(r.toolSchema);
              const hintSuffix = hints ? `  |  ${hints}` : "";
              return `server: ${r.serverName}  |  tool: ${r.toolName}  |  ${r.toolDescription ?? ""}${hintSuffix}`;
            }),
          ].join("\n");

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
        : [
            "Use these exact server names as server_name in metamcp__execute_tool:",
            ...rows.map((r) =>
              r.description ? `${r.name} — ${r.description}` : r.name,
            ),
          ].join("\n");

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
