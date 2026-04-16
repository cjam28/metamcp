import {
  buildMetaToolsListResult,
  executeMetaTool,
  isMetaTool,
} from "../lazy-tools-handler";
import { resolveDiscoveryMode } from "../discovery-mode";
import type {
  CallToolHandler,
  CallToolMiddleware,
  ListToolsHandler,
  ListToolsMiddleware,
} from "./functional-middleware";

interface LazyDiscoveryOptions {
  namespaceUuid: string;
  endpointUuid?: string;
}

/**
 * Outermost list-tools middleware.
 * If discovery mode resolves to LAZY, returns the 3 meta-tools immediately
 * without invoking the original eager fan-out handler.
 */
export function createLazyDiscoveryListToolsMiddleware(
  options: LazyDiscoveryOptions,
): ListToolsMiddleware {
  return (next: ListToolsHandler): ListToolsHandler => {
    return async (request, context) => {
      const mode = await resolveDiscoveryMode(
        options.namespaceUuid,
        options.endpointUuid,
      );

      if (mode === "LAZY") {
        return buildMetaToolsListResult();
      }

      return next(request, context);
    };
  };
}

/**
 * Outermost call-tool middleware.
 * If the called tool is a meta-tool, dispatch to the meta-tool handler.
 * Otherwise fall through to the normal (eager) call-tool chain.
 */
export function createLazyDiscoveryCallToolMiddleware(
  options: LazyDiscoveryOptions,
): CallToolMiddleware {
  return (next: CallToolHandler): CallToolHandler => {
    return async (request, context) => {
      const toolName = request.params.name;

      if (isMetaTool(toolName)) {
        return executeMetaTool(
          toolName,
          (request.params.arguments ?? {}) as Record<string, unknown>,
          context.namespaceUuid,
          context.sessionId,
        );
      }

      return next(request, context);
    };
  };
}
