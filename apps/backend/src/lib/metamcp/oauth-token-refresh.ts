import logger from "@/utils/logger";

import { oauthSessionsRepository } from "../../db/repositories/oauth-sessions.repo";

/** Clock skew / network delay buffer before treating access_token as expired */
const OAUTH_EXPIRY_BUFFER_MS = 60_000;

function isOAuthAccessTokenExpired(
  sessionUpdatedAt: Date,
  expiresInSeconds: number | undefined,
): boolean {
  if (expiresInSeconds === undefined || expiresInSeconds === null) {
    return false;
  }
  const expiryMs = sessionUpdatedAt.getTime() + expiresInSeconds * 1000;
  return Date.now() >= expiryMs - OAUTH_EXPIRY_BUFFER_MS;
}

type OauthSessionRow = NonNullable<
  Awaited<ReturnType<typeof oauthSessionsRepository.findByMcpServerUuid>>
>;

/**
 * If the stored access token is past expiry (with buffer) and we have
 * refresh_token + token_endpoint, exchange for new tokens and persist.
 * Otherwise returns the existing tokens unchanged.
 */
export async function refreshOAuthTokensIfExpired(
  mcpServerUuid: string,
  session: OauthSessionRow,
): Promise<NonNullable<OauthSessionRow["tokens"]>> {
  const { tokens, client_information, updated_at } = session;
  if (!tokens) {
    throw new Error("refreshOAuthTokensIfExpired: session has no tokens");
  }

  const tokenEndpoint = client_information?.token_endpoint;
  const clientId = client_information?.client_id;
  const clientSecret = client_information?.client_secret;

  if (
    !isOAuthAccessTokenExpired(updated_at, tokens.expires_in) ||
    !tokens.refresh_token ||
    !tokenEndpoint ||
    !clientId
  ) {
    return tokens;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
    client_id: clientId,
  });
  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  try {
    const tokenRes = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => "");
      logger.warn(
        `OAuth token refresh failed for server ${mcpServerUuid} (${tokenRes.status}): ${errText}`,
      );
      return tokens;
    }

    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      token_type?: string;
      expires_in?: number;
      refresh_token?: string;
      scope?: string;
    };

    const newTokens = {
      access_token: tokenData.access_token,
      token_type: tokenData.token_type ?? tokens.token_type,
      ...(tokenData.expires_in !== undefined &&
        tokenData.expires_in !== null && {
          expires_in: tokenData.expires_in,
        }),
      ...((tokenData.refresh_token ?? tokens.refresh_token) && {
        refresh_token: tokenData.refresh_token ?? tokens.refresh_token,
      }),
      ...((tokenData.scope ?? tokens.scope) && {
        scope: tokenData.scope ?? tokens.scope,
      }),
    };

    await oauthSessionsRepository.upsert({
      mcp_server_uuid: mcpServerUuid,
      tokens: newTokens,
    });

    logger.info(`OAuth access token refreshed for MCP server ${mcpServerUuid}`);
    return newTokens;
  } catch (error) {
    logger.warn(
      `OAuth token refresh error for server ${mcpServerUuid}:`,
      error,
    );
    return tokens;
  }
}
