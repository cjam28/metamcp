# Fork Changes (cjam28/metamcp)

This document summarises all commits made in this fork beyond the upstream `metatool-ai/metamcp` baseline.

## Commit History (newest first)

| Tag | Commit | Summary |
|-----|--------|---------|
| — | feat: lazy tool discovery (EAGER/LAZY per namespace/endpoint) | DB schema, 3 meta-tools, middleware, UI toggles |
| v2.4.38-cjam | feat(oauth): persist token_endpoint and refresh expired access tokens | Auto-refresh OAuth access tokens using stored refresh_token |
| v2.4.37 | ux: move toasts to bottom-right | Avoid toasts obscuring header buttons |
| v2.4.36 | fix: escape quotes in tool-management title attribute | Fix JSX syntax error in title attribute |
| v2.4.35 | ux: remove auto-connect on server detail page | Tools load from DB; explicit "Test Live Connection" button |
| v2.4.34 | security: fix SSRF, IDOR, CSRF, and correctness bugs | Code-review-driven security hardening |
| v2.4.33 | fix: prevent duplicate auto-connect and stacked connection toasts | Stable useEffect deps, immediate connecting status |
| v2.4.32 | feat: multi-select and bulk delete for MCP servers list | @tanstack/react-table checkboxes + bulk delete |
| v2.4.31 | feat: add loading status feedback for OAuth and server connection flows | Sonner toasts + step-by-step progress card |
| v2.4.30 | fix: proxy OAuth discovery/registration/token-exchange through backend | Bypass CORS for downstream MCP server OAuth flows |
| v2.4.29 | fix: move OAuth hooks after server/connection declarations in page.tsx | Fix TypeScript "used before declaration" build error |
| v2.4.28 | fix: OAuth2 on-demand for STREAMABLE_HTTP servers (Phases 1–4) | Full server-side OAuth challenge detection and UI flow |
| v2.4.27 | fix: temporarily enable signup during bootstrap user creation | Allow bootstrap to create users even when registration is locked |
| — | ci: build linux amd64 images only | Remove ARM builds from GitHub Actions |
| — | fix: apply registration controls after bootstrap user creation | Re-lock registration after bootstrap completes |
| — | fix: avoid Portainer startup deadlock on postgres health gate | Remove `condition: service_healthy` from app depends_on |
| — | ci: make attest-build-provenance non-fatal | Tolerate Sigstore tlog intermittent failures |
| — | chore: switch image to fork ghcr.io/cjam28/metamcp:latest | Point Portainer to fork image |
| — | fix: guard sessionStorage access against SSR in OAuth provider | Fix ReferenceError during Next.js server-side rendering |
| — | chore: add json-file logging driver with rotation to both services | Prevent unbounded log growth |
| — | chore: set default LOG_LEVEL to info | Reduce log noise |
| — | fix: give NEXT_PUBLIC_APP_URL its own substitution variable | Fix env var interpolation in docker-compose |
| — | fix: portainer deployment config | Correct Portainer stack configuration |
| — | bump better-auth / tailwind / express / nextjs | Dependency updates |

## Key Features Added

### OAuth for STREAMABLE_HTTP Remote MCPs
- Server-side OAuth challenge detection (401 WWW-Authenticate)
- Backend-proxied discovery, DCR, and token exchange (no CORS issues)
- Step-by-step progress UI with Sonner toasts
- OAuth token auto-refresh using stored refresh_token + token_endpoint

### Security Hardening
- SSRF protection: URL allowlist for outbound OAuth requests
- IDOR protection: ownership checks on all mutating endpoints
- CSRF protection: state parameter validation in OAuth callbacks

### UX Improvements
- Multi-select + bulk delete on MCP servers list
- Toast notifications moved to bottom-right
- Explicit "Test Live Connection" replaces auto-connect on server detail page

### Lazy Tool Discovery (namespace/endpoint configurable)
- EAGER mode (default): all tools listed upfront
- LAZY mode: only 3 meta-tools returned (`metamcp__search_tools`, `metamcp__list_servers`, `metamcp__execute_tool`)
- `discovery_mode` column on `namespaces` table
- `discovery_mode_override` nullable column on `endpoints` table
- UI toggle in namespace edit dialog; dropdown in endpoint create/edit form
