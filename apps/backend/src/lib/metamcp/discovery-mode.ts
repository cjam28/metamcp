import type { DiscoveryMode } from "@repo/zod-types";

import { endpointsRepository } from "../../db/repositories/endpoints.repo";
import { namespacesRepository } from "../../db/repositories/namespaces.repo";

/**
 * Resolves the effective discovery mode for a namespace / endpoint.
 *
 * Priority (highest → lowest):
 *   1. endpoint.discovery_mode_override  (if endpointUuid supplied and non-null)
 *   2. namespace.discovery_mode
 *   3. "EAGER" (safe fallback)
 */
export async function resolveDiscoveryMode(
  namespaceUuid: string,
  endpointUuid?: string,
): Promise<DiscoveryMode> {
  if (endpointUuid) {
    try {
      const endpoint = await endpointsRepository.findByUuid(endpointUuid);
      if (endpoint?.discovery_mode_override) {
        return endpoint.discovery_mode_override;
      }
    } catch {
      // fall through to namespace-level check
    }
  }

  try {
    const namespace = await namespacesRepository.findByUuid(namespaceUuid);
    if (namespace?.discovery_mode) {
      return namespace.discovery_mode;
    }
  } catch {
    // fall through to default
  }

  return "EAGER";
}
