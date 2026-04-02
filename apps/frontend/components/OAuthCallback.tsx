"use client";

import { CheckCircle, Circle, Loader2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { SESSION_KEYS } from "../lib/constants";
import { vanillaTrpcClient } from "../lib/trpc";

type StepStatus = "pending" | "active" | "done" | "error";

interface OAuthStep {
  label: string;
  detail?: string;
  status: StepStatus;
}

const StepIcon = ({ status }: { status: StepStatus }) => {
  if (status === "done")
    return <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />;
  if (status === "active")
    return (
      <Loader2 className="w-5 h-5 text-blue-500 shrink-0 animate-spin" />
    );
  if (status === "error")
    return <XCircle className="w-5 h-5 text-red-500 shrink-0" />;
  return <Circle className="w-5 h-5 text-gray-300 shrink-0" />;
};

const OAuthCallback = () => {
  // Intentionally no useRef — useRef(false) resets on remount in React 18 Strict Mode,
  // allowing duplicate completeFlow calls. A sessionStorage flag survives remounts.
  const [steps, setSteps] = useState<OAuthStep[]>([
    { label: "Authorization received", status: "done" },
    { label: "Exchanging tokens with server", status: "active" },
    { label: "Completing setup", status: "pending" },
  ]);

  const updateStep = (
    index: number,
    patch: Partial<OAuthStep>,
  ) => {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    );
  };

  useEffect(() => {
    const handleCallback = async () => {
      // Strict Mode guard: if another effect invocation already claimed this callback,
      // bail out immediately to prevent duplicate token exchanges.
      if (sessionStorage.getItem(SESSION_KEYS.OAUTH_CALLBACK_PROCESSING)) {
        return;
      }
      sessionStorage.setItem(SESSION_KEYS.OAUTH_CALLBACK_PROCESSING, "1");

      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const state = params.get("state");
      const mcpServerUuid = sessionStorage.getItem(SESSION_KEYS.MCP_SERVER_UUID);

      if (!code || !state || !mcpServerUuid) {
        console.error("Missing required OAuth callback parameters");
        updateStep(1, { status: "error", detail: "Missing callback parameters" });
        sessionStorage.removeItem(SESSION_KEYS.OAUTH_CALLBACK_PROCESSING);
        setTimeout(() => {
          window.location.href = "/mcp-servers";
        }, 2000);
        return;
      }

      try {
        // Token exchange runs server-side via tRPC — no browser CORS issues.
        // The `state` param is forwarded so the backend can verify it against the stored
        // value, preventing CSRF attacks.
        const result = await vanillaTrpcClient.frontend.oauth.completeFlow.mutate(
          {
            mcp_server_uuid: mcpServerUuid,
            code,
            state,
          },
        );

        // Clean up session storage regardless of outcome
        sessionStorage.removeItem(SESSION_KEYS.SERVER_URL);
        sessionStorage.removeItem(SESSION_KEYS.MCP_SERVER_UUID);
        sessionStorage.removeItem(SESSION_KEYS.OAUTH_CALLBACK_PROCESSING);

        if (result.success) {
          updateStep(1, { status: "done" });
          updateStep(2, { status: "active", detail: "Redirecting..." });
          window.location.href = `/mcp-servers/${mcpServerUuid}`;
        } else {
          console.error("OAuth completion failed:", result.message);
          updateStep(1, {
            status: "error",
            detail: result.message ?? "Token exchange failed",
          });
          setTimeout(() => {
            window.location.href = "/mcp-servers";
          }, 3000);
        }
      } catch (error) {
        console.error("OAuth callback error:", error);
        const msg = error instanceof Error ? error.message : "Unexpected error";
        updateStep(1, { status: "error", detail: msg });
        sessionStorage.removeItem(SESSION_KEYS.SERVER_URL);
        sessionStorage.removeItem(SESSION_KEYS.MCP_SERVER_UUID);
        sessionStorage.removeItem(SESSION_KEYS.OAUTH_CALLBACK_PROCESSING);
        setTimeout(() => {
          window.location.href = "/mcp-servers";
        }, 3000);
      }
    };

    void handleCallback();
  }, []);

  const doneCount = steps.filter((s) => s.status === "done").length;
  const hasError = steps.some((s) => s.status === "error");
  const progressPct = Math.round((doneCount / steps.length) * 100);

  return (
    <div className="flex items-center justify-center h-screen bg-background">
      <div className="w-full max-w-sm mx-4 rounded-xl border border-border bg-card shadow-sm p-6 space-y-5">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">
            OAuth Authorization
          </h2>
          <p className="text-xs text-muted-foreground">
            Completing your connection securely…
          </p>
        </div>

        {/* Progress bar */}
        <div className="relative h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${
              hasError ? "bg-red-500" : "bg-blue-500"
            }`}
            style={{ width: `${hasError ? 100 : progressPct}%` }}
          />
        </div>

        {/* Step list */}
        <ol className="space-y-3">
          {steps.map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <StepIcon status={step.status} />
              <div className="min-w-0">
                <p
                  className={`text-sm leading-5 ${
                    step.status === "pending"
                      ? "text-muted-foreground"
                      : step.status === "error"
                        ? "text-red-600 font-medium"
                        : "text-foreground font-medium"
                  }`}
                >
                  {step.label}
                </p>
                {step.detail && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {step.detail}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
};

export default OAuthCallback;
