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
import { z } from "zod";

import { protectedProcedure, router } from "../../trpc";

// Define the OAuth router with procedure definitions
// The actual implementation will be provided by the backend
export const createOAuthRouter = (
  // These are the implementation functions that the backend will provide
  implementations: {
    get: (
      input: z.infer<typeof GetOAuthSessionRequestSchema>,
    ) => Promise<z.infer<typeof GetOAuthSessionResponseSchema>>;
    upsert: (
      input: z.infer<typeof UpsertOAuthSessionRequestSchema>,
    ) => Promise<z.infer<typeof UpsertOAuthSessionResponseSchema>>;
    delete: (
      input: z.infer<typeof DeleteOAuthSessionRequestSchema>,
    ) => Promise<z.infer<typeof DeleteOAuthSessionResponseSchema>>;
    initiateFlow: (
      input: z.infer<typeof InitiateOAuthFlowRequestSchema>,
    ) => Promise<z.infer<typeof InitiateOAuthFlowResponseSchema>>;
    completeFlow: (
      input: z.infer<typeof CompleteOAuthFlowRequestSchema>,
    ) => Promise<z.infer<typeof CompleteOAuthFlowResponseSchema>>;
  },
) => {
  return router({
    // Protected: Get OAuth session by MCP server UUID
    get: protectedProcedure
      .input(GetOAuthSessionRequestSchema)
      .output(GetOAuthSessionResponseSchema)
      .query(async ({ input }) => {
        return await implementations.get(input);
      }),

    // Protected: Upsert OAuth session
    upsert: protectedProcedure
      .input(UpsertOAuthSessionRequestSchema)
      .output(UpsertOAuthSessionResponseSchema)
      .mutation(async ({ input }) => {
        return await implementations.upsert(input);
      }),

    // Protected: Delete (clear) OAuth session to force re-authorization
    delete: protectedProcedure
      .input(DeleteOAuthSessionRequestSchema)
      .output(DeleteOAuthSessionResponseSchema)
      .mutation(async ({ input }) => {
        return await implementations.delete(input);
      }),

    // Protected: Initiate server-side OAuth flow (discovery + DCR + PKCE, no browser CORS)
    initiateFlow: protectedProcedure
      .input(InitiateOAuthFlowRequestSchema)
      .output(InitiateOAuthFlowResponseSchema)
      .mutation(async ({ input }) => {
        return await implementations.initiateFlow(input);
      }),

    // Protected: Complete server-side OAuth flow (token exchange, no browser CORS)
    completeFlow: protectedProcedure
      .input(CompleteOAuthFlowRequestSchema)
      .output(CompleteOAuthFlowResponseSchema)
      .mutation(async ({ input }) => {
        return await implementations.completeFlow(input);
      }),
  });
};
