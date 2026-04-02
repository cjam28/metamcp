"use client";

import { useEffect, useRef } from "react";

import { useTranslations } from "@/hooks/useTranslations";

import { SESSION_KEYS } from "../lib/constants";
import { vanillaTrpcClient } from "../lib/trpc";

const OAuthCallback = () => {
  const { t } = useTranslations();
  const hasProcessedRef = useRef(false);

  useEffect(() => {
    const handleCallback = async () => {
      if (hasProcessedRef.current) {
        return;
      }
      hasProcessedRef.current = true;

      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const mcpServerUuid = sessionStorage.getItem(SESSION_KEYS.MCP_SERVER_UUID);

      if (!code || !mcpServerUuid) {
        console.error("Missing required OAuth callback parameters");
        window.location.href = "/mcp-servers";
        return;
      }

      try {
        // Token exchange runs server-side via tRPC — no browser CORS issues.
        const result = await vanillaTrpcClient.frontend.oauth.completeFlow.mutate(
          {
            mcp_server_uuid: mcpServerUuid,
            code,
          },
        );

        // Clean up session storage regardless of outcome
        sessionStorage.removeItem(SESSION_KEYS.SERVER_URL);
        sessionStorage.removeItem(SESSION_KEYS.MCP_SERVER_UUID);

        if (result.success) {
          window.location.href = `/mcp-servers/${mcpServerUuid}`;
        } else {
          console.error("OAuth completion failed:", result.message);
          window.location.href = "/mcp-servers";
        }
      } catch (error) {
        console.error("OAuth callback error:", error);
        sessionStorage.removeItem(SESSION_KEYS.SERVER_URL);
        sessionStorage.removeItem(SESSION_KEYS.MCP_SERVER_UUID);
        window.location.href = "/mcp-servers";
      }
    };

    void handleCallback();
  }, []);

  return (
    <div className="flex items-center justify-center h-screen">
      <p className="text-lg text-gray-500">
        {t("common:oauth.processingCallback")}
      </p>
    </div>
  );
};

export default OAuthCallback;
