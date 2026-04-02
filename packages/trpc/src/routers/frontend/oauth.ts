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
      userId: string,
    ) => Promise<z.infer<typeof GetOAuthSessionResponseSchema>>;
    upsert: (
      input: z.infer<typeof UpsertOAuthSessionRequestSchema>,
      userId: string,
    ) => Promise<z.infer<typeof UpsertOAuthSessionResponseSchema>>;
    delete: (
      input: z.infer<typeof DeleteOAuthSessionRequestSchema>,
      userId: string,
    ) => Promise<z.infer<typeof DeleteOAuthSessionResponseSchema>>;
    initiateFlow: (
      input: z.infer<typeof InitiateOAuthFlowRequestSchema>,
      userId: string,
    ) => Promise<z.infer<typeof InitiateOAuthFlowResponseSchema>>;
    completeFlow: (
      input: z.infer<typeof CompleteOAuthFlowRequestSchema>,
      userId: string,
    ) => Promise<z.infer<typeof CompleteOAuthFlowResponseSchema>>;
  },
) => {
  return router({
    // Protected: Get OAuth session by MCP server UUID
    get: protectedProcedure
      .input(GetOAuthSessionRequestSchema)
      .output(GetOAuthSessionResponseSchema)
      .query(async ({ input, ctx }) => {
        return await implementations.get(input, ctx.user.id);
      }),

    // Protected: Upsert OAuth session
    upsert: protectedProcedure
      .input(UpsertOAuthSessionRequestSchema)
      .output(UpsertOAuthSessionResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.upsert(input, ctx.user.id);
      }),

    // Protected: Delete (clear) OAuth session to force re-authorization
    delete: protectedProcedure
      .input(DeleteOAuthSessionRequestSchema)
      .output(DeleteOAuthSessionResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.delete(input, ctx.user.id);
      }),

    // Protected: Initiate server-side OAuth flow (discovery + DCR + PKCE, no browser CORS)
    initiateFlow: protectedProcedure
      .input(InitiateOAuthFlowRequestSchema)
      .output(InitiateOAuthFlowResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.initiateFlow(input, ctx.user.id);
      }),

    // Protected: Complete server-side OAuth flow (token exchange, no browser CORS)
    completeFlow: protectedProcedure
      .input(CompleteOAuthFlowRequestSchema)
      .output(CompleteOAuthFlowResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.completeFlow(input, ctx.user.id);
      }),
  });
};
