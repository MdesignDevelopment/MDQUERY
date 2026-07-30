import { Pool, types } from 'pg';

// Return timestamps as ISO strings, not JS Dates (keeps JSON serialization stable)
types.setTypeParser(1114, (v) => new Date(v + 'Z').toISOString());
types.setTypeParser(1184, (v) => new Date(v).toISOString());

const globalAny = globalThis as unknown as { __mdqPool?: Pool; __mdqReady?: Promise<void> };

function pool(): Pool {
  if (!globalAny.__mdqPool) {
    // On serverless (Vercel) each concurrent function instance gets its own
    // pool, so keep it small — a handful of instances × max:10 could otherwise
    // exhaust the database's connection limit. The long-running Docker
    // container only ever has one pool, so it can afford to be larger.
    const max = process.env.VERCEL ? 3 : 10;
    globalAny.__mdqPool = new Pool({ connectionString: process.env.DATABASE_URL, max });
  }
  return globalAny.__mdqPool;
}

const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','lead','curator','admin')),
  department TEXT NOT NULL DEFAULT 'Support',
  password_hash TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

-- Categories (§2.8-style organization): private categories belong to one
-- user, public categories are a shared taxonomy — same public/private split
-- as queries/workflows themselves. A query's category must live in the same
-- scope: a private query may use its owner's own private categories or any
-- public category; a public query may only use a public category.
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  owner_id INT REFERENCES users(id),
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_category_name_public ON categories (lower(name)) WHERE is_public;
CREATE UNIQUE INDEX IF NOT EXISTS uq_category_name_private ON categories (owner_id, lower(name)) WHERE NOT is_public;

CREATE TABLE IF NOT EXISTS queries (
  id SERIAL PRIMARY KEY,
  owner_id INT REFERENCES users(id),
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  source_query_id INT REFERENCES queries(id) ON DELETE SET NULL,
  source_body_snapshot TEXT,
  shared_from JSONB,
  tag TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  department TEXT,
  client_label TEXT,
  category_id INT REFERENCES categories(id) ON DELETE SET NULL,
  risk_level TEXT NOT NULL DEFAULT 'safe' CHECK (risk_level IN ('safe','scoped_write','high_risk')),
  flagged_stale BOOLEAN NOT NULL DEFAULT FALSE,
  stale_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INT REFERENCES users(id)
);
ALTER TABLE queries ADD COLUMN IF NOT EXISTS category_id INT REFERENCES categories(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_query_tag_public ON queries (lower(tag)) WHERE is_public;
CREATE UNIQUE INDEX IF NOT EXISTS uq_query_tag_private ON queries (owner_id, lower(tag)) WHERE NOT is_public;

CREATE TABLE IF NOT EXISTS query_params (
  id SERIAL PRIMARY KEY,
  query_id INT NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  data_type TEXT NOT NULL DEFAULT 'text',
  default_value TEXT,
  enum_options JSONB,
  label TEXT,
  is_list BOOLEAN NOT NULL DEFAULT FALSE,
  sort INT NOT NULL DEFAULT 0,
  UNIQUE (query_id, name)
);
ALTER TABLE query_params ADD COLUMN IF NOT EXISTS is_list BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS query_versions (
  id SERIAL PRIMARY KEY,
  query_id INT NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  body_snapshot TEXT NOT NULL,
  tag_snapshot TEXT NOT NULL,
  title_snapshot TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  changed_by INT REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_source TEXT NOT NULL DEFAULT 'manual' CHECK (change_source IN ('manual','ai','restore','review'))
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id INT NOT NULL REFERENCES users(id),
  item_type TEXT NOT NULL CHECK (item_type IN ('query','workflow')),
  item_id INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_type, item_id)
);

CREATE TABLE IF NOT EXISTS share_events (
  id SERIAL PRIMARY KEY,
  item_type TEXT NOT NULL CHECK (item_type IN ('query','workflow')),
  source_item_id INT NOT NULL,
  snapshot JSONB NOT NULL,
  from_user_id INT NOT NULL REFERENCES users(id),
  to_user_id INT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','dismissed')),
  created_item_id INT,
  shared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS review_requests (
  id SERIAL PRIMARY KEY,
  item_type TEXT NOT NULL CHECK (item_type IN ('query','workflow')),
  item_id INT NOT NULL,
  target_public_id INT,
  request_type TEXT NOT NULL CHECK (request_type IN ('new_promotion','update')),
  proposed JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by INT NOT NULL REFERENCES users(id),
  reviewed_by INT REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  parent_request_id INT REFERENCES review_requests(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS validation_log (
  id SERIAL PRIMARY KEY,
  query_id INT NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  result TEXT NOT NULL CHECK (result IN ('pass','warn','fail')),
  details JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS workflows (
  id SERIAL PRIMARY KEY,
  owner_id INT REFERENCES users(id),
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  tag TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  client_label TEXT,
  category_id INT REFERENCES categories(id) ON DELETE SET NULL,
  shared_from JSONB,
  flagged_stale BOOLEAN NOT NULL DEFAULT FALSE,
  stale_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS category_id INT REFERENCES categories(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wf_tag_public ON workflows (lower(tag)) WHERE is_public;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wf_tag_private ON workflows (owner_id, lower(tag)) WHERE NOT is_public;

CREATE TABLE IF NOT EXISTS workflow_steps (
  id SERIAL PRIMARY KEY,
  workflow_id INT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  query_id INT NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  step_order INT NOT NULL,
  param_bindings JSONB NOT NULL DEFAULT '{}',
  note TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  payload JSONB NOT NULL,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Performance indexes (§3 "Fast"). Scope filters, sort keys, and hot lookups:
CREATE INDEX IF NOT EXISTS ix_queries_private_scope ON queries (owner_id, updated_at DESC) WHERE NOT is_public;
CREATE INDEX IF NOT EXISTS ix_queries_public_scope  ON queries (updated_at DESC) WHERE is_public;
CREATE INDEX IF NOT EXISTS ix_queries_department    ON queries (department);
CREATE INDEX IF NOT EXISTS ix_queries_client        ON queries (client_label) WHERE client_label IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_queries_category       ON queries (category_id) WHERE category_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_workflows_category      ON workflows (category_id) WHERE category_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_categories_owner        ON categories (owner_id) WHERE NOT is_public;
CREATE INDEX IF NOT EXISTS ix_favorites_item        ON favorites (item_type, item_id);
CREATE INDEX IF NOT EXISTS ix_versions_query        ON query_versions (query_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS ix_wf_steps_wf           ON workflow_steps (workflow_id, step_order);
CREATE INDEX IF NOT EXISTS ix_wf_steps_query        ON workflow_steps (query_id);
CREATE INDEX IF NOT EXISTS ix_shares_inbox          ON share_events (to_user_id, shared_at DESC);
CREATE INDEX IF NOT EXISTS ix_notif_user            ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_reviews_pending       ON review_requests (created_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ix_reviews_mine          ON review_requests (requested_by, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_validation_query      ON validation_log (query_id, run_at DESC);
CREATE INDEX IF NOT EXISTS ix_params_query          ON query_params (query_id, sort);

-- Trigram indexes so ILIKE '%term%' search/typeahead stays fast as dictionaries grow:
CREATE INDEX IF NOT EXISTS trgm_queries_tag   ON queries   USING gin (tag gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_queries_title ON queries   USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_queries_desc  ON queries   USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_queries_body  ON queries   USING gin (body gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_wf_tag        ON workflows USING gin (tag gin_trgm_ops);
CREATE INDEX IF NOT EXISTS trgm_wf_title      ON workflows USING gin (title gin_trgm_ops);
`;

async function seed(): Promise<void> {
  const p = pool();
  const { rows } = await p.query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n > 0) return;

  const users = [
    ['musa.haruna@mdesignsolutions.be', 'Musa Haruna', 'admin', 'Support'],
    ['ada.verstraete@mdesignsolutions.be', 'Ada Verstraete', 'curator', 'Support'],
    ['lena.vos@mdesignsolutions.be', 'Lena Vos', 'user', 'Support'],
    ['jonas.peeters@mdesignsolutions.be', 'Jonas Peeters', 'user', 'Support'],
    ['mira.claes@mdesignsolutions.be', 'Mira Claes', 'lead', 'GIS'],
  ];
  for (const u of users) {
    await p.query('INSERT INTO users (email, name, role, department) VALUES ($1,$2,$3,$4)', u);
  }

  // Curated templates derived from real Support-engineering queries against
  // Marlin-style fiber design schemas (COMMON / NETWORK / INFRA), with the
  // engagement-specific literal IDs replaced by bind variables.
  const publicQueries: Array<[string, string, string, string, string, string]> = [
    [
      'check-feature-association',
      'Check feature associations for a child feature',
      'Verify the active association rows for a child feature (e.g. a sheath, duct or cable) before fixing or removing anything. Feature codes: 1001 route, 1002 duct, 1003 structure, 3001 sheath, 3002 bundle, 3004 splice closure.',
      `SELECT *\nFROM COMMON.FEATURE_ASSOCIATION_TB\nWHERE child_id            = :child_id\nAND   child_feature_code  = :child_feature_code\nAND   parent_feature_code = :parent_feature_code\nAND   editstatus          = 1`,
      'Support', 'safe',
    ],
    [
      'add-feature-association',
      'Add a missing feature association',
      'Insert a single association row (e.g. structure → sheath) inside an edit session. Confirm parent/child feature codes and the ES_ID against the ticket first.',
      `INSERT INTO COMMON.FEATURE_ASSOCIATION_TB (\n    PARENT_FEATURE_CODE, PARENT_ID,\n    CHILD_FEATURE_CODE,  CHILD_ID,\n    ADDITIONAL_INFO_LKP_ID, REMARKS, BATCH_NUMBER,\n    ES_ID, ET_ID, UNDOROW_ID, EDITSTATUS\n)\nVALUES (\n    :parent_feature_code, :parent_id,\n    :child_feature_code,  :child_id,\n    2, NULL, NULL,\n    :es_id, 0, 0, 1\n)`,
      'Support', 'scoped_write',
    ],
    [
      'soft-delete-sheath',
      'Soft-delete a sheath (EDITSTATUS = 3)',
      'Marks a sheath as deleted inside an edit session. Run the bundle/fiber cleanup queries first — see the delete-sheath-cleanup workflow.',
      `UPDATE NETWORK.SHEATH_TB\nSET editstatus = 3\nWHERE id = :sheath_id\n  AND editstatus = 1\n  AND es_id = :es_id`,
      'Support', 'scoped_write',
    ],
    [
      'soft-delete-sheath-bundles',
      'Soft-delete the bundles of a sheath',
      'Marks all bundles associated to a sheath as deleted, resolving them through FEATURE_ASSOCIATION_TB.',
      `UPDATE NETWORK.SHEATH_BUNDLE_TB\nSET editstatus = 3\nWHERE id IN (\n        SELECT child_id\n        FROM COMMON.FEATURE_ASSOCIATION_TB\n        WHERE parent_id = :sheath_id\n          AND editstatus = 1\n)\nAND editstatus = 1\nAND es_id = :es_id`,
      'Support', 'scoped_write',
    ],
    [
      'soft-delete-sheath-fibers',
      'Soft-delete the fibers of a sheath',
      'Marks all fiber conductors as deleted for every bundle of the given sheath (two-level association lookup).',
      `UPDATE NETWORK.FIBER_CONDUCTOR_TB\nSET editstatus = 3\nWHERE id IN (\n    SELECT child_id\n    FROM COMMON.FEATURE_ASSOCIATION_TB\n    WHERE parent_id IN (\n        SELECT child_id\n        FROM COMMON.FEATURE_ASSOCIATION_TB\n        WHERE parent_id = :sheath_id\n          AND editstatus = 1\n    )\n    AND editstatus = 1\n)\nAND editstatus = 1\nAND es_id = :es_id`,
      'Support', 'scoped_write',
    ],
    [
      'cleanup-feature-associations',
      'Soft-delete associations of a removed feature',
      'After soft-deleting a feature, mark its association rows (as parent and as child) deleted within the edit session.',
      `UPDATE COMMON.FEATURE_ASSOCIATION_TB\nSET editstatus = 3\nWHERE child_id = :feature_id\n  AND editstatus = 1\n  AND es_id IN (:es_id, 0);\n\nUPDATE COMMON.FEATURE_ASSOCIATION_TB\nSET editstatus = 3\nWHERE parent_id = :feature_id\n  AND editstatus = 1\n  AND es_id IN (:es_id, 0)`,
      'Support', 'scoped_write',
    ],
    [
      'splice-closure-set-construction-status',
      'Set construction status of a splice closure',
      'Flips CONSTRUCTION_STATUS_LKP_ID for one named splice closure in a session (1 = planned, 2 = as-built). For bulk NAME IN (...) batches, clone and extend the list.',
      `UPDATE NETWORK.SPLICE_CLOSURE_TB\nSET construction_status_lkp_id = :status_lkp_id\nWHERE session_id = :session_id\n  AND editstatus = 1\n  AND name = :closure_name`,
      'Support', 'scoped_write',
    ],
    [
      'duct-structure-passthrough-fix',
      'Recreate duct→structure pass-through associations',
      'Rebuilds missing structure associations for a duct by walking its routes through FEATURE_CONNECTIVITY_TB and picking nodes shared by more than one route. Advanced — review the ticket and run the check query first.',
      `INSERT INTO COMMON.FEATURE_ASSOCIATION_TB (\n    PARENT_FEATURE_CODE, PARENT_ID,\n    CHILD_FEATURE_CODE,  CHILD_ID,\n    ADDITIONAL_INFO_LKP_ID, REMARKS, BATCH_NUMBER,\n    ES_ID, ET_ID, UNDOROW_ID, EDITSTATUS\n)\nWITH duct_routes AS (\n    SELECT parent_id AS route_id\n    FROM COMMON.FEATURE_ASSOCIATION_TB\n    WHERE child_id            = :duct_id\n    AND   child_feature_code  = 1002\n    AND   parent_feature_code = 1001\n    AND   editstatus          = 1\n),\nroute_nodes AS (\n    SELECT c.feature_id AS route_id, c.node1_id AS node_id\n    FROM COMMON.FEATURE_CONNECTIVITY_TB c\n    JOIN duct_routes dr ON c.feature_id = dr.route_id\n    UNION ALL\n    SELECT c.feature_id, c.node2_id\n    FROM COMMON.FEATURE_CONNECTIVITY_TB c\n    JOIN duct_routes dr ON c.feature_id = dr.route_id\n),\nnode_route_count AS (\n    SELECT node_id, COUNT(DISTINCT route_id) AS route_count\n    FROM route_nodes\n    GROUP BY node_id\n),\npassthrough_structures AS (\n    SELECT node_id FROM node_route_count WHERE route_count > 1\n)\nSELECT\n    1003, node_id,\n    1002, :duct_id,\n    2, NULL, NULL,\n    :es_id, 0, 0, 1\nFROM passthrough_structures\nWHERE NOT EXISTS (\n    SELECT 1 FROM COMMON.FEATURE_ASSOCIATION_TB ex\n    WHERE ex.child_id            = :duct_id\n    AND   ex.child_feature_code  = 1002\n    AND   ex.parent_id           = passthrough_structures.node_id\n    AND   ex.parent_feature_code = 1003\n    AND   ex.editstatus          = 1\n)`,
      'Support', 'scoped_write',
    ],
    [
      'merge-editsession-entities',
      'Re-point entities from one edit session to another',
      'Core statements of a session merge: re-points session-status, connectivity, sheath/fiber and association rows from a source ES_ID to a target ES_ID. The full engagement script covers ~35 tables — clone and extend per the runbook.',
      `UPDATE COMMON.ENTITY_SESSIONSTATUS_TB SET es_id = :target_es_id WHERE es_id = :source_es_id;\nUPDATE COMMON.FEATURE_CONNECTIVITY_TB  SET es_id = :target_es_id WHERE es_id = :source_es_id;\nUPDATE NETWORK.SHEATH_TB               SET es_id = :target_es_id WHERE es_id = :source_es_id;\nUPDATE NETWORK.SHEATH_BUNDLE_TB        SET es_id = :target_es_id WHERE es_id = :source_es_id;\nUPDATE NETWORK.FIBER_CONDUCTOR_TB      SET es_id = :target_es_id WHERE es_id = :source_es_id;\nUPDATE NETWORK.SPLICE_CLOSURE_TB       SET es_id = :target_es_id WHERE es_id = :source_es_id;\nUPDATE INFRA.STRUCTURE_TB              SET es_id = :target_es_id WHERE es_id = :source_es_id;\nUPDATE COMMON.FEATURE_ASSOCIATION_TB   SET es_id = :target_es_id WHERE es_id = :source_es_id`,
      'Support', 'scoped_write',
    ],
    [
      'audit-last-modified',
      'Audit recently modified rows',
      'Generic template: rows modified in the last N days, newest first. Swap in the table for the client schema at hand.',
      `SELECT t.*\nFROM target_table t\nWHERE t.last_modified >= SYSDATE - :days_back\nORDER BY t.last_modified DESC`,
      'Support', 'safe',
    ],
  ];

  const curator = 2; // Ada
  const idByTag: Record<string, number> = {};
  for (const [tag, title, desc, body, dept, risk] of publicQueries) {
    const res = await p.query(
      `INSERT INTO queries (owner_id, is_public, tag, title, description, body, department, risk_level, updated_by)
       VALUES (NULL, TRUE, $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [tag, title, desc, body, dept, risk, curator],
    );
    const qid = res.rows[0].id;
    idByTag[tag] = qid;
    await p.query(
      `INSERT INTO query_versions (query_id, body_snapshot, tag_snapshot, title_snapshot, risk_level, changed_by, change_source)
       VALUES ($1,$2,$3,$4,$5,$6,'manual')`,
      [qid, body, tag, title, risk, curator],
    );
    // param defs for detected binds
    const binds = body.match(/:(\w+)/g) ?? [];
    let sort = 0;
    for (const b of [...new Set(binds.map((x) => x.slice(1).toLowerCase()))]) {
      const dataType = /(id|code|days|status)$|days_back/.test(b) ? 'number' : 'text';
      await p.query(
        `INSERT INTO query_params (query_id, name, data_type, sort) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [qid, b, dataType, sort++],
      );
    }
  }

  // Seed public workflow mirroring the real "deleting a sheath" runbook:
  // check associations → soft-delete bundles → fibers → the sheath → cleanup.
  const wf = await p.query(
    `INSERT INTO workflows (owner_id, is_public, tag, title, description)
     VALUES (NULL, TRUE, 'delete-sheath-cleanup', 'Delete a sheath (full cleanup)',
             'Ordered runbook for removing a sheath inside an edit session: verify its associations, soft-delete bundles and fibers first, then the sheath itself, then its association rows. Run each step externally; the sheath id and ES id carry through every step.')
     RETURNING id`,
  );
  const steps: Array<[string, Record<string, { source: string }>, string]> = [
    ['check-feature-association', {}, 'Verify the sheath’s active associations first (child_feature_code 3001, parent 1003).'],
    ['soft-delete-sheath-bundles', { sheath_id: { source: 'step_1.child_id' } }, 'Bundles resolved via FEATURE_ASSOCIATION_TB.'],
    ['soft-delete-sheath-fibers', { sheath_id: { source: 'step_1.child_id' }, es_id: { source: 'step_2.es_id' } }, 'Two-level lookup: sheath → bundles → fibers.'],
    ['soft-delete-sheath', { sheath_id: { source: 'step_1.child_id' }, es_id: { source: 'step_2.es_id' } }, 'The sheath itself, only after bundles and fibers.'],
    ['cleanup-feature-associations', { feature_id: { source: 'step_1.child_id' }, es_id: { source: 'step_2.es_id' } }, 'Finally mark its association rows deleted.'],
  ];
  let order = 1;
  for (const [tag, bindings, note] of steps) {
    await p.query(
      `INSERT INTO workflow_steps (workflow_id, query_id, step_order, param_bindings, note) VALUES ($1,$2,$3,$4,$5)`,
      [wf.rows[0].id, idByTag[tag], order++, JSON.stringify(bindings), note],
    );
  }
}

/** Backfill: users created before password auth get the documented default password. */
async function backfillPasswords(): Promise<void> {
  const p = pool();
  const { rows } = await p.query('SELECT id FROM users WHERE password_hash IS NULL');
  if (rows.length === 0) return;
  const { hashPassword } = await import('./auth');
  const hash = hashPassword(DEFAULT_PASSWORD);
  await p.query('UPDATE users SET password_hash = $1 WHERE password_hash IS NULL', [hash]);
}

/** Default password for seeded/backfilled users — documented in the README; users should change it. */
export const DEFAULT_PASSWORD = 'ChangeMe123!';

/** Ensure schema + seed exactly once per process. */
export function ready(): Promise<void> {
  if (!globalAny.__mdqReady) {
    globalAny.__mdqReady = (async () => {
      await pool().query(SCHEMA);
      await seed();
      await backfillPasswords();
    })().catch((e) => {
      globalAny.__mdqReady = undefined;
      throw e;
    });
  }
  return globalAny.__mdqReady;
}

export async function query<T = any>(text: string, values?: unknown[]): Promise<{ rows: T[] }> {
  await ready();
  return pool().query(text, values as any[]) as unknown as Promise<{ rows: T[] }>;
}

export async function withTx<T>(fn: (q: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>) => Promise<T>): Promise<T> {
  await ready();
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn((text, values) => client.query(text, values as any[]));
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
