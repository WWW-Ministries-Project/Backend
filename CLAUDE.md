# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Node version: **18.18.0** (`.nvmrc` / `.node-version`).

- `npm run dev` — Watch mode via `ts-node-dev`. Entry is repo-root `index.ts` (not under `src/`).
- `npm run build` — `tsc` emit to `dist/`, then `copy:libs` copies non-TS assets under `src/libs/` (e.g. `eventReports/` templates) into `dist/src/libs`. Skipping `copy:libs` breaks report generation at runtime.
- `npm start` — `rimraf` + build + run `dist/index.js`.
- `npm run prod` — Build + run with New Relic (`node -r newrelic dist/index.js`).
- `npm run migrate` — `prisma migrate deploy && prisma generate`. Use this after pulling; the Dockerfile also runs it on container start.
- `npm run migrate:2` — Regenerate Prisma client only (no DB writes).

Requires `.env` with `DATABASE_URL`, `SHADOW_DATABASE_URL` (MySQL), `JWT_SECRET`, `PORT`. Optional: `RUN_BACKGROUND_JOBS=false` disables cron registration (see below), `PRISMA_TX_MAX_WAIT_MS`, `PRISMA_TX_TIMEOUT_MS`.

No test runner, linter, or formatter is configured — do not fabricate `npm test`/`npm run lint` invocations.

## Architecture

Single Express app, no microservices. All requests flow: `index.ts` → global middleware → `src/routes/appRouter.ts` → per-module `Router` → controller → service → Prisma.

### Module layout (`src/modules/<domain>/`)

Each domain follows a **controller + route + service** convention (e.g. `user/userController.ts`, `userRoutes.ts`, `userService.ts`). `src/modules/index.ts` re-exports the core set; newer routers (programs, notifications, finance/*, ai, appointment, theme, settings, marketplace, orders, products, devices, lifeCenterMangement, visitorManagement) are imported directly in `appRouter.ts`.

Note the capitalization quirks preserved throughout the tree: `src/middleWare/` (capital W), `src/Models/` (capital M), `lifeCenterMangement` (typo), `eventContoller.ts` (typo). Match these exactly in imports.

### Prisma

Single shared client at `src/Models/context.ts` — `export const prisma`. Always import from there; do not instantiate `new PrismaClient()` elsewhere. Transaction defaults come from env (`PRISMA_TX_MAX_WAIT_MS`, `PRISMA_TX_TIMEOUT_MS`).

Schema (`prisma/schema.prisma`, ~2100 lines, MySQL) is the canonical data model — 130+ models covering members, events, requisitions, notifications, finance, marketplace, biometric attendance, etc. Prefer reading the schema over guessing field names; relations are heavily aliased (see `user` model's `@relation("...")` blocks).

Migrations use timestamped folders in `prisma/migrations/`. CI (`CICD/prisma-migration.yml`) runs `prisma migrate deploy` on every push to `main`.

### AuthZ — `src/middleWare/authorization.ts`

`Permissions` class exports:
- `protect` — JWT verification (`process.env.JWT_SECRET`), attaches decoded payload to `req.user`.
- Domain-specific guards like `can_view_member_details`, `can_manage_requisitions_scoped`, `can_view_visitor_followups_scoped`, etc. Route registration pattern: `router.get("/x", [protect, permissions.can_view_...], controllerFn)`.
- Underlying `checkPermission(type, "view" | "manage" | "admin", errorMessage)` reads the user's JSON `permissions` blob and resolves keys through `PERMISSION_KEY_ALIASES` (e.g. `Visitors` falls back to `Members`; `AI` falls back to `Settings` → `Access_rights`). When adding a permission domain, extend that alias map — do not add ad-hoc lookups.
- Requisition manage checks additionally consult `canUserManageRequisitionByApproverRole` so approvers without a permission bit can still act on requests assigned to them.

Scoped variants (`*_scoped`) enforce branch/department/user-ownership filters — reuse them instead of writing new scope logic.

### Global middleware chain (`index.ts`)

`cors` → `express.json({ limit: "25mb" })` → `express.urlencoded` → `logRequests` (Winston) → `responseMessageEnhancer` → `appRouter` → Swagger at `/api-docs` → `/metrics` (prom-client default metrics) → `notFoundHandler` → `globalErrorHandler`.

- `responseMessageEnhancer` monkey-patches `res.json` to rewrite `message`/`error` strings through `toUserFriendlyMessage`. Skipped for `/api-docs` and `/metrics`. Downstream code can throw or return raw messages; the middleware humanizes them.
- `globalErrorHandler` (`src/middleWare/errorHandler.ts`) normalizes `AppError`, `InputValidationError`, and `Prisma.PrismaClientKnownRequestError` (P2002/P2003/P2025 have bespoke messages — the P2003 requisition-event branch is intentional). Throw these custom errors from controllers/services rather than calling `res.status(...).json(...)` directly whenever possible.
- Controllers rely on `express-async-errors` (imported at top of `index.ts`), so async throws propagate to the global handler — no need for try/catch around every await.

### Background jobs (`src/cron-jobs/`)

Cron files are `require`d at boot from `index.ts` and self-register with `node-cron` on import. Gate: `RUN_BACKGROUND_JOBS` env — set to `false`/`0`/`no` on non-primary workers to prevent duplicate scheduling. Currently registered: hubtel payment reconciliation, requisition notifications, follow-up notifications, notification retention, push retry, SMS retry, event reminders.

### Integrations

- Reports: `docx` + Puppeteer generate DOCX/PDF from templates in `src/libs/eventReports/`. Puppeteer runs with sandbox args (see recent commits) and reads a logo asset — guard file reads.
- Storage: AWS S3 via `@aws-sdk/client-s3` + presigned URLs (`src/utils/s3.ts`, `upload.ts`).
- Email: `nodemailer` with templates under `src/utils/mail_templates/`.
- AI: `@anthropic-ai/sdk`, `@google/genai`, `openai` — routed under `/ai`, `/api/ai`, `/api/v1/ai` (all three mounts point at `aiRouter`).
- Notifications: in-app + web-push (`web-push`) + SMS via async delivery-job tables with retry crons.
- Observability: Winston (daily rotating file under `logs/`), Prometheus (`/metrics`), New Relic in `npm run prod`.

## Conventions

- **Do not create new Prisma clients** — import `prisma` from `src/Models/context.ts`.
- **Add routes to a module's `*Route.ts`** and mount from `appRouter.ts`. Existing modules use `Router()` factory, protected by `[protect, permissions.<guard>]`.
- **Preserve the quirky paths** (`middleWare/`, `Models/`, `eventContoller.ts`, `lifeCenterMangement/`) when editing — renaming them is out of scope for feature work and will break many imports.
- **Permissions changes** should be modeled by extending `PERMISSION_KEY_ALIASES` and reusing `checkPermission` / scoped helpers rather than hand-rolling checks in controllers.
- **User-facing error strings** are rewritten by `responseMessageEnhancer` — write plain messages and let the middleware polish them.
- **Build assets** under `src/libs/` must be picked up by `copy:libs`; if you add a new asset dir, extend the glob or the artifact will be missing in `dist/`.

## Frontend

Companion frontend repo: `/Users/akwaah/Documents/GitHub/Frontend`. Consult it for client-side contracts, API call shapes, and payload/response expectations when changing endpoints. Frontend integration guides also live under `docs/` here (e.g. `FRONTEND_AUTH_AUTHZ_GUIDELINES.md`, `IN_APP_NOTIFICATIONS_FRONTEND_IMPLEMENTATION_GUIDE.md`, `REQUISITION_APPROVAL_FRONTEND_IMPLEMENTATION_GUIDE.md`).

## Deployment

Dockerfile: `node:18-alpine`, exposes `8000`, runs `npm run migrate && npm run prod`. Compose file mounts `./logs`. Additional workflows in `CICD/` cover Docker image build, EC2 CD, and Render deploy. GitHub Actions in `.github/workflows/prod-deploy.yml`.
