import {
  CompleteOAuthFlowRequestSchema,
  CompleteOAuthFlowResponseSchema,
  DeleteOAuthSessionRequestSchema,
  DeleteOAuthSessionResponseSchema,
  GetOAuthSessionRequestSchema,
  GetOAuthSessionResponseSchema,
  InitiateOAuthFlowRequestSchema,
  InitiateOAuthFlowResponseSchema,
  UpsertOAuthSessionRequestSchema,
  UpsertOAuthSessionResponseSchema,
} from "@repo/zod-types";
import crypto from "node:crypto";
import { z } from "zod";

import logger from "@/utils/logger";

import {
  mcpServersRepository,
  oauthSessionsRepository,
} from "../db/repositories";
import { OAuthSessionsSerializer } from "../db/serializers";

/**
 * Asserts that the authenticated user owns (or has access to) the given MCP server.
 * Throws an Error if not found or if the server belongs to a different user.
 */
async function assertServerOwnership(
  mcp_server_uuid: string,
  userId: string,
): Promise<void> {
  const server = await mcpServersRepository.findByUuid(mcp_server_uuid);
  if (!server) {
    throw new Error("MCP server not found");
  }
  // null user_id means the server is shared/public within the instance
  if (server.user_id !== null && server.user_id !== userId) {
    throw new Error("Access denied");
  }
}

export const oauthImplementations = {
  delete: async (
    input: z.infer<typeof DeleteOAuthSessionRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof DeleteOAuthSessionResponseSchema>> => {
    try {
      await assertServerOwnership(input.mcp_server_uuid, userId);
      await oauthSessionsRepository.deleteByMcpServerUuid(
        input.mcp_server_uuid,
      );
      return {
        success: true as const,
        message: "OAuth session deleted successfully",
      };
    } catch (error) {
      logger.error("Error deleting OAuth session:", error);
      return {
        success: false as const,
        message:
          error instanceof Error ? error.message : "Failed to delete OAuth session",
      };
    }
  },

  get: async (
    input: z.infer<typeof GetOAuthSessionRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof GetOAuthSessionResponseSchema>> => {
    try {
      await assertServerOwnership(input.mcp_server_uuid, userId);
      const session = await oauthSessionsRepository.findByMcpServerUuid(
        input.mcp_server_uuid,
      );

      if (!session) {
        return {
          success: false as const,
          message: "OAuth session not found",
        };
      }

      return {
        success: true as const,
        data: OAuthSessionsSerializer.serializeOAuthSession(session),
        message: "OAuth session retrieved successfully",
      };
    } catch (error) {
      logger.error("Error fetching OAuth session:", error);
      return {
        success: false as const,
        message:
          error instanceof Error ? error.message : "Failed to fetch OAuth session",
      };
    }
  },

  upsert: async (
    input: z.infer<typeof UpsertOAuthSessionRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof UpsertOAuthSessionResponseSchema>> => {
    try {
      await assertServerOwnership(input.mcp_server_uuid, userId);
      const session = await oauthSessionsRepository.upsert({
        mcp_server_uuid: input.mcp_server_uuid,
        ...(input.client_information && {
          client_information: input.client_information,
        }),
        ...(input.tokens && { tokens: input.tokens }),
        ...(input.code_verifier && { code_verifier: input.code_verifier }),
      });

      if (!session) {
        return {
          success: false as const,
          error: "Failed to upsert OAuth session",
        };
      }

      return {
        success: true as const,
        data: OAuthSessionsSerializer.serializeOAuthSession(session),
        message: "OAuth session upserted successfully",
      };
    } catch (error) {
      logger.error("Error upserting OAuth session:", error);
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Internal server error",
      };
    }
  },

  /**
   * Server-side OAuth initiation: performs discovery + dynamic client registration
   * entirely in Node.js so the browser never touches the remote OAuth server directly
   * (which would be blocked by CORS).
   *
   * Stores { codeVerifier, state, tokenEndpoint, redirectUri, clientId } as JSON in
   * the `code_verifier` DB column for retrieval during completeFlow.
   */
  initiateFlow: async (
    input: z.infer<typeof InitiateOAuthFlowRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof InitiateOAuthFlowResponseSchema>> => {
    const { mcp_server_uuid, redirect_uri } = input;

    try {
      // Verify user owns this server and retrieve the stored URL from DB (SSRF/IDOR fix)
      const server = await mcpServersRepository.findByUuid(mcp_server_uuid);
      if (!server) {
        return { success: false as const, message: "MCP server not found" };
      }
      if (server.user_id !== null && server.user_id !== userId) {
        return { success: false as const, message: "Access denied" };
      }
      const mcp_server_url = server.url;
      if (!mcp_server_url) {
        return {
          success: false as const,
          message: "MCP server has no URL configured",
        };
      }

      // --- Step 1: discover the OAuth authorization server ---
      const baseUrl = new URL(mcp_server_url);
      const serverBaseUrl = `${baseUrl.protocol}//${baseUrl.host}`;

      let authServerUrl = serverBaseUrl;
      try {
        const prRes = await fetch(
          `${mcp_server_url}/.well-known/oauth-protected-resource`,
          { headers: { Accept: "application/json" } },
        );
        if (prRes.ok) {
          const prData = (await prRes.json()) as {
            authorization_servers?: string[];
          };
          if (prData.authorization_servers?.[0]) {
            authServerUrl = prData.authorization_servers[0];
          }
        }
      } catch {
        // fall through to base URL fallback already set above
      }

      // --- Step 2: fetch authorization server metadata ---
      let authorizationEndpoint: string | undefined;
      let tokenEndpoint: string | undefined;
      let registrationEndpoint: string | undefined;

      for (const metaPath of [
        "/.well-known/oauth-authorization-server",
        "/.well-known/openid-configuration",
      ]) {
        try {
          const asRes = await fetch(`${authServerUrl}${metaPath}`, {
            headers: { Accept: "application/json" },
          });
          if (asRes.ok) {
            const asData = (await asRes.json()) as {
              authorization_endpoint?: string;
              token_endpoint?: string;
              registration_endpoint?: string;
            };
            authorizationEndpoint = asData.authorization_endpoint;
            tokenEndpoint = asData.token_endpoint;
            registrationEndpoint = asData.registration_endpoint;
            if (authorizationEndpoint) break;
          }
        } catch {
          // try next path
        }
      }

      if (!authorizationEndpoint || !tokenEndpoint) {
        return {
          success: false as const,
          message: `Could not discover OAuth metadata for ${authServerUrl}`,
        };
      }

      // --- Step 3: get or register OAuth client ---
      const existingSession = await oauthSessionsRepository.findByMcpServerUuid(
        mcp_server_uuid,
      );

      let clientId: string;
      let clientSecret: string | undefined;

      if (existingSession?.client_information?.client_id) {
        clientId = existingSession.client_information.client_id;
        clientSecret = existingSession.client_information.client_secret ?? undefined;
        logger.info(`Reusing existing OAuth client_id for ${mcp_server_uuid}`);
      } else if (registrationEndpoint) {
        const regRes = await fetch(registrationEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            redirect_uris: [redirect_uri],
            token_endpoint_auth_method: "none",
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            client_name: "MetaMCP",
            client_uri: "https://github.com/metatool-ai/metamcp",
          }),
        });

        if (!regRes.ok) {
          const errText = await regRes.text();
          return {
            success: false as const,
            message: `Dynamic client registration failed (${regRes.status}): ${errText}`,
          };
        }

        const regData = (await regRes.json()) as {
          client_id: string;
          client_secret?: string;
          client_id_issued_at?: number;
          client_secret_expires_at?: number;
        };

        clientId = regData.client_id;
        clientSecret = regData.client_secret;

        await oauthSessionsRepository.upsert({
          mcp_server_uuid,
          client_information: {
            client_id: clientId,
            ...(clientSecret && { client_secret: clientSecret }),
            ...(regData.client_id_issued_at && {
              client_id_issued_at: regData.client_id_issued_at,
            }),
            ...(regData.client_secret_expires_at && {
              client_secret_expires_at: regData.client_secret_expires_at,
            }),
          },
        });

        logger.info(`Registered new OAuth client for ${mcp_server_uuid}: ${clientId}`);
      } else {
        return {
          success: false as const,
          message:
            "No stored client credentials and no registration endpoint available",
        };
      }

      // --- Step 4: generate PKCE code verifier + challenge ---
      const codeVerifierBytes = crypto.randomBytes(32);
      const codeVerifier = codeVerifierBytes
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");

      const codeChallenge = crypto
        .createHash("sha256")
        .update(codeVerifier)
        .digest("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");

      const state = crypto.randomBytes(16).toString("hex");

      // Store everything needed for completeFlow as JSON in the code_verifier column,
      // including `state` so completeFlow can verify the callback is authentic (CSRF fix).
      await oauthSessionsRepository.upsert({
        mcp_server_uuid,
        code_verifier: JSON.stringify({
          codeVerifier,
          state,
          tokenEndpoint,
          redirectUri: redirect_uri,
          clientId,
          ...(clientSecret && { clientSecret }),
        }),
      });

      // --- Step 5: build the authorization URL ---
      const authUrl = new URL(authorizationEndpoint);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("redirect_uri", redirect_uri);
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("code_challenge", codeChallenge);
      authUrl.searchParams.set("code_challenge_method", "S256");

      return {
        success: true as const,
        authorization_url: authUrl.toString(),
      };
    } catch (error) {
      logger.error("Error initiating OAuth flow:", error);
      return {
        success: false as const,
        message:
          error instanceof Error ? error.message : "OAuth initiation failed",
      };
    }
  },

  /**
   * Server-side OAuth completion: exchanges the authorization code for tokens
   * entirely in Node.js (no browser CORS), then persists the tokens in the DB.
   */
  completeFlow: async (
    input: z.infer<typeof CompleteOAuthFlowRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof CompleteOAuthFlowResponseSchema>> => {
    const { mcp_server_uuid, code, state: receivedState } = input;

    try {
      await assertServerOwnership(mcp_server_uuid, userId);

      const session =
        await oauthSessionsRepository.findByMcpServerUuid(mcp_server_uuid);

      if (!session?.code_verifier) {
        return {
          success: false as const,
          message: "No pending OAuth session found — please initiate the flow again",
        };
      }

      let parsed: {
        codeVerifier: string;
        state: string;
        tokenEndpoint: string;
        redirectUri: string;
        clientId: string;
        clientSecret?: string;
      };

      try {
        parsed = JSON.parse(session.code_verifier);
      } catch {
        return {
          success: false as const,
          message: "OAuth session data is corrupted — please re-authorize",
        };
      }

      const { codeVerifier, state: storedState, tokenEndpoint, redirectUri, clientId, clientSecret } = parsed;

      // Verify OAuth state to prevent CSRF attacks
      if (!storedState || storedState !== receivedState) {
        logger.warn(`OAuth state mismatch for ${mcp_server_uuid}: expected ${storedState}, got ${receivedState}`);
        return {
          success: false as const,
          message: "OAuth state mismatch — possible CSRF attack. Please re-authorize.",
        };
      }

      // --- Exchange auth code for tokens ---
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      });
      if (clientSecret) {
        body.set("client_secret", clientSecret);
      }

      const tokenRes = await fetch(tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        return {
          success: false as const,
          message: `Token exchange failed (${tokenRes.status}): ${errText}`,
        };
      }

      const tokenData = (await tokenRes.json()) as {
        access_token: string;
        token_type?: string;
        expires_in?: number;
        refresh_token?: string;
        scope?: string;
      };

      // Persist tokens and clear the one-time code_verifier JSON.
      // Use !== undefined checks (not truthiness) so that expires_in: 0 is preserved.
      await oauthSessionsRepository.upsert({
        mcp_server_uuid,
        tokens: {
          access_token: tokenData.access_token,
          token_type: tokenData.token_type ?? "Bearer",
          ...(tokenData.expires_in !== undefined &&
            tokenData.expires_in !== null && {
              expires_in: tokenData.expires_in,
            }),
          ...(tokenData.refresh_token && {
            refresh_token: tokenData.refresh_token,
          }),
          ...(tokenData.scope && { scope: tokenData.scope }),
        },
        code_verifier: null,
      });

      logger.info(`OAuth flow completed successfully for ${mcp_server_uuid}`);
      return {
        success: true as const,
        message: "OAuth flow completed successfully",
      };
    } catch (error) {
      logger.error("Error completing OAuth flow:", error);
      return {
        success: false as const,
        message:
          error instanceof Error ? error.message : "OAuth completion failed",
      };
    }
  },
};
