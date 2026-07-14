# M.Design Query Dictionary

Centralized, searchable dictionary of SQL / PL/SQL queries for M.Design's Support department (extensible to GIS, DevOps, Sales Ops). It is a **pure system of record**: queries run against **client-owned Oracle databases**, entirely outside this platform. **The platform never connects to any client database** — validation is 100% static/offline, and export/copy is a first-class action.

## Run (Docker)

```bash
docker compose up -d      # Postgres 16 + Next.js dev server
# → http://localhost:3000
```

First start installs npm dependencies into a named volume (takes a minute). The schema is created and seeded automatically on first request. Sign in with a seeded account (default password below); accounts are **admin-provisioned only** — there is no self-registration. SSO is the production replacement (see below).

**Production** (optimized build — noticeably faster than dev mode):

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Dev and prod share the same `.env` and database volume; run one or the other (both bind port 3000).

Reset the database (re-runs the seed): `docker compose stop web db && docker volume rm mdquery_dbdata && docker compose up -d`.

### Performance notes

- Postgres carries scope/sort indexes plus pg_trgm GIN indexes for `%term%` search — list/search stay fast as dictionaries grow.
- Editor lint runs client-side (zero network per keystroke); the server re-validates authoritatively on save.
- Lists and detail pages use a stale-while-revalidate client cache, and hovering a row prefetches its detail — navigation paints instantly.
- List payloads exclude query bodies; sessions are micro-cached server-side (15s TTL, invalidated on admin changes).

## What's implemented (v1)

- **Public Dictionary** — curated, versioned, read-only for standard users; searchable/filterable/sortable (recent, popular, tag). Seeded with parameterized templates derived from real Support-engineering queries (Marlin-style fiber schemas: `COMMON`/`NETWORK`/`INFRA`, EDITSTATUS soft-deletes, edit-session merges).
- **Private Dictionary** — full CRUD, per-user tag uniqueness, tag rename never breaks favorites/history (immutable internal id), client/engagement labels (metadata only).
- **Clone with lineage** — public → private copy keeps `source_query_id` + a body snapshot; when the public source changes, the clone shows a "Public version updated — review changes?" diff banner with a "mark reviewed" re-baseline.
- **Editor Mode / Form Mode** — Monaco editor with inline lint markers; Form Mode auto-detects `:bind` variables (assignment `:=` and `:old/:new` excluded), renders typed inputs (text/number/date/enum), and produces a resolved copy with Oracle literals (`TO_DATE(...)` for dates, `''`-escaped strings).
- **Static validation pipeline** (`src/lib/validation.ts`) — string/comment-aware scanner, statement splitting, PL/SQL block detection. Rules: **UPDATE/DELETE without WHERE → typed `CONFIRM` gate**; DDL → explicit irreversibility acknowledgment; `EXECUTE IMMEDIATE` + `||` concatenation → injection warning; missing EXCEPTION handler advisory; `SELECT *` and literal-vs-bind best-practice notes; unbalanced parens/unterminated strings → errors with line/col. Findings panel (Errors/Warnings/Info) click-jumps to the line.
- **Safety classification** — 🟢 safe / 🟡 scoped write / 🔴 high risk, computed on every save; a workflow's badge is its highest-risk step.
- **Favorites** — per-user, pinned section on top of every list.
- **Sharing** — copy-based, point-in-time snapshot; recipient accepts/dismisses from the Inbox; copy carries `shared_from`; no sync in either direction. Workflow shares copy the step queries too.
- **Promotion & public edits** — review requests with peer approval: curators/admins **or any Support engineer** can approve, **requester ≠ reviewer enforced server-side (admins included)**; rejection requires notes; resubmission stays linked to the thread (`parent_request_id`); reviewers see the diff + submission-time static validation.
- **Stale flags** — any user flags a public entry with a note → amber badge + curator queue; curators resolve (clear with note) without unpublishing.
- **Workflows** — ordered steps referencing dictionary queries, explicit source → target param mapping (`step_1.child_id → :sheath_id`), run view with manual value entry (v1: paste values from your external run), resolved ordered script as output (copy or export). Seeded example: `delete-sheath-cleanup`.
- **Version history** — every save (manual/AI/restore/review) snapshots body+tag+title+risk with author; restorable; restores go through the same validation pipeline.
- **Export** — annotated `.sql` per query or per workflow, SQL Developer or SQL*Plus flavor; resolved values supported.
- **AI Query Copilot** — right-docked chat panel; Edit (proposed diff with Accept/Reject — never auto-commit), Explain, Review. Server-side proxy only (`/api/ai`); risk-escalation guard (removing WHERE / SELECT→DML) requires extra confirmation; accepted edits still pass full validation on save. **No provider configured → deterministic static-analyzer fallback.** Behavior contract: never claims knowledge of live schemas.
- **UX** — dark-first VS Code-style theme (light available), monospace for code/tags, `Ctrl+K` command palette, collapsible left rail, breadcrumb + PUBLIC/PRIVATE indicator, keyboard save (`Ctrl+S`), aria-labels on icon buttons.

## Configuration

| Env var | Purpose |
| --- | --- |
| `DATABASE_URL` | Platform metadata store (the **only** database this app talks to) |
| `SESSION_SECRET` | HMAC key for session cookies |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | Optional OpenAI-compatible endpoint for the copilot (Groq/Together/Ollama serving an open-weight SQL-capable model). Unset → offline fallback |

## Architecture notes

- **Next.js 15 App Router**, one codebase/deployment. All security-critical logic lives in Route Handlers: self-approval block, tag uniqueness, WHERE/DDL gates, AI proxy.
- **Postgres** metadata store (schema in `src/lib/db.ts`, bootstrapped idempotently). Compose runs it alongside the app; swapping to managed Postgres/Supabase is a connection-string change.
- **No client DB connectivity anywhere** — no pooling, no credential vaulting, no execution. Deliberate scope boundary.
- **Auth** — email + password sign-in (scrypt hashes, HMAC-signed session cookies, deactivated accounts blocked at every request). **User management** (`/admin/users`, admin-only): create accounts, change role/department, reset passwords, deactivate/reactivate — with self-demotion and last-active-admin protection. Production: SSO via the M.Design IdP (OIDC through NextAuth.js/Supabase Auth), mapping role claims to `users.role`.
- **Parser** — the scanner/heuristics in `validation.ts` are dependency-free; production upgrade path is an ANTLR PL/SQL grammar behind the same `LintFinding` interface.

## v1 decisions on the spec's open questions (§8)

1. **Stale-flag resolution**: clearing the badge (with the curator's judgment) is enough for v1; unpublish remains a separate curator action. A formal resolution state (`confirmed stale — unpublished` vs `confirmed fine`) is a small schema addition later.
2. **Approval guardrails**: a single peer approval regardless of risk level in v1. If tightened later: require 2 approvals for 🔴 entries — the `review_requests` table supports this with an approvals-count column.

## Seed users

Default password for all seeded accounts: **`ChangeMe123!`** (admins should reset these via User Management).

| User | Role | Department |
| --- | --- | --- |
| musa.haruna@mdesignsolutions.be | admin | Support |
| ada.verstraete@mdesignsolutions.be | curator | Support |
| lena.vos@mdesignsolutions.be | user | Support |
| jonas.peeters@mdesignsolutions.be | user | Support |
| mira.claes@mdesignsolutions.be | lead | GIS |
