import express from 'express';
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '../..');
const staticDir = process.env.MERMAID_EDITOR_STATIC_DIR
  ? resolve(process.env.MERMAID_EDITOR_STATIC_DIR)
  : resolve(rootDir, 'packages/mermaid/dist/mermaid-local-editor');
const dataDir = process.env.MERMAID_EDITOR_DATA_DIR
  ? resolve(process.env.MERMAID_EDITOR_DATA_DIR)
  : resolve(__dirname, 'data');
const dbPath = process.env.MERMAID_EDITOR_DB
  ? resolve(process.env.MERMAID_EDITOR_DB)
  : join(dataDir, 'mermaid-local-editor.sqlite');
const port = Number(process.env.PORT || process.env.MERMAID_EDITOR_PORT || 8081);
const host = process.env.HOST || process.env.MERMAID_EDITOR_HOST || '0.0.0.0';
const adminPassword = process.env.MERMAID_EDITOR_ADMIN_PASSWORD || '123qwe123';
const passwordIterations = 120000;

const DEFAULT_DIAGRAM = {
  name: 'main',
  src: 'flowchart LR\n  UI --> RuntimeBus --> Orchestrator --> Agents',
  view: { scale: 1, panX: 0, panY: 0 },
  annotations: [],
};

mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS diagrams (
    name TEXT PRIMARY KEY,
    src TEXT NOT NULL,
    view_json TEXT NOT NULL,
    annotations_json TEXT NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const diagramColumns = new Set(db.prepare('PRAGMA table_info(diagrams)').all().map((column) => column.name));
if (!diagramColumns.has('hidden')) {
  db.exec('ALTER TABLE diagrams ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
}

const selectDiagram = db.prepare(
  'SELECT name, src, view_json, annotations_json, hidden FROM diagrams WHERE name = ?',
);
const selectAllDiagrams = db.prepare(
  'SELECT name, src, view_json, annotations_json, hidden FROM diagrams ORDER BY name COLLATE NOCASE',
);
const upsertDiagram = db.prepare(`
  INSERT INTO diagrams (name, src, view_json, annotations_json, hidden, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  ON CONFLICT(name) DO UPDATE SET
    src = excluded.src,
    view_json = excluded.view_json,
    annotations_json = excluded.annotations_json,
    hidden = excluded.hidden,
    updated_at = CURRENT_TIMESTAMP
`);
const deleteDiagram = db.prepare('DELETE FROM diagrams WHERE name = ?');
const selectState = db.prepare('SELECT value FROM app_state WHERE key = ?');
const selectStateRow = db.prepare('SELECT value, updated_at FROM app_state WHERE key = ?');
const upsertState = db.prepare(`
  INSERT INTO app_state (key, value, updated_at)
  VALUES (?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    updated_at = CURRENT_TIMESTAMP
`);
const deleteState = db.prepare('DELETE FROM app_state WHERE key = ?');

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, salt, passwordIterations, 32, 'sha256').toString('hex');
  return {
    algorithm: 'pbkdf2-sha256',
    iterations: passwordIterations,
    salt,
    hash,
  };
}

function verifyPassword(password, record) {
  if (!record?.salt || !record?.hash || !record?.iterations) {
    return false;
  }

  const inputHash = pbkdf2Sync(
    password,
    record.salt,
    Number(record.iterations),
    32,
    'sha256',
  );
  const expectedHash = Buffer.from(record.hash, 'hex');
  return inputHash.length === expectedHash.length && timingSafeEqual(inputHash, expectedHash);
}

function getViewerPasswordRow() {
  return selectStateRow.get('viewer_password') || null;
}

function getViewerPasswordRecord() {
  const row = getViewerPasswordRow();
  if (!row?.value) {
    return null;
  }

  return parseJson(row.value, null);
}

function getAccessPayload() {
  const row = getViewerPasswordRow();
  return {
    passwordRequired: Boolean(row?.value),
    passwordUpdatedAt: row?.updated_at || null,
  };
}

function normalizeDiagram(name, data = {}) {
  const cleanName = String(name || '').trim();
  if (!cleanName) {
    const error = new Error('diagram name is required');
    error.status = 400;
    throw error;
  }

  return {
    name: cleanName,
    src: typeof data.src === 'string' ? data.src : DEFAULT_DIAGRAM.src,
    view: data.view && typeof data.view === 'object' ? data.view : DEFAULT_DIAGRAM.view,
    annotations: Array.isArray(data.annotations) ? data.annotations : [],
    hidden: Boolean(data.hidden),
  };
}

function rowToDiagram(row) {
  return {
    src: row.src,
    view: parseJson(row.view_json, DEFAULT_DIAGRAM.view),
    annotations: parseJson(row.annotations_json, []),
    hidden: Boolean(row.hidden),
  };
}

function writeDiagram(name, data) {
  const diagram = normalizeDiagram(name, data);
  upsertDiagram.run(
    diagram.name,
    diagram.src,
    JSON.stringify(diagram.view),
    JSON.stringify(diagram.annotations),
    diagram.hidden ? 1 : 0,
  );
  return diagram;
}

function getCurrent() {
  const current = selectState.get('current')?.value;
  if (current && selectDiagram.get(current)) {
    return current;
  }

  const first = selectAllDiagrams.all()[0]?.name || DEFAULT_DIAGRAM.name;
  upsertState.run('current', first);
  return first;
}

function ensureDefaultDiagram() {
  if (selectAllDiagrams.all().length > 0) {
    return;
  }

  writeDiagram(DEFAULT_DIAGRAM.name, DEFAULT_DIAGRAM);
  upsertState.run('current', DEFAULT_DIAGRAM.name);
}

function getPayload() {
  ensureDefaultDiagram();
  const diagrams = {};
  for (const row of selectAllDiagrams.all()) {
    diagrams[row.name] = rowToDiagram(row);
  }

  return {
    current: getCurrent(),
    diagrams,
    dbPath,
  };
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

ensureDefaultDiagram();

const app = express();
app.use(express.json({ limit: '8mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, dbPath });
});

app.get('/api/diagrams', (_req, res) => {
  res.json(getPayload());
});

app.get('/api/access', (_req, res) => {
  res.json(getAccessPayload());
});

app.post(
  '/api/access/verify',
  asyncHandler(async (req, res) => {
    const record = getViewerPasswordRecord();
    if (!record) {
      res.json({ ok: true, ...getAccessPayload() });
      return;
    }

    const password = String(req.body?.password || '');
    if (!verifyPassword(password, record)) {
      res.status(401).json({ error: 'invalid password' });
      return;
    }

    res.json({ ok: true, ...getAccessPayload() });
  }),
);

app.put(
  '/api/access/password',
  asyncHandler(async (req, res) => {
    if (String(req.body?.adminPassword || '') !== adminPassword) {
      res.status(403).json({ error: 'invalid admin password' });
      return;
    }

    const password = String(req.body?.password || '');
    if (!password) {
      deleteState.run('viewer_password');
      res.json(getAccessPayload());
      return;
    }

    if (password.length < 4) {
      res.status(400).json({ error: 'password must be at least 4 characters' });
      return;
    }

    upsertState.run('viewer_password', JSON.stringify(hashPassword(password)));
    res.json(getAccessPayload());
  }),
);

app.put(
  '/api/current',
  asyncHandler(async (req, res) => {
    const current = String(req.body?.current || '').trim();
    if (!current || !selectDiagram.get(current)) {
      res.status(400).json({ error: 'unknown current diagram' });
      return;
    }

    upsertState.run('current', current);
    res.json(getPayload());
  }),
);

app.post(
  '/api/diagrams',
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) {
      res.status(400).json({ error: 'diagram name is required' });
      return;
    }

    if (selectDiagram.get(name)) {
      res.status(409).json({ error: 'diagram already exists' });
      return;
    }

    writeDiagram(name, req.body);
    upsertState.run('current', name);
    res.status(201).json(getPayload());
  }),
);

app.put(
  '/api/diagrams/:name',
  asyncHandler(async (req, res) => {
    const diagram = writeDiagram(req.params.name, req.body);
    if (req.body?.makeCurrent !== false) {
      upsertState.run('current', diagram.name);
    }
    res.json(getPayload());
  }),
);

app.delete(
  '/api/diagrams/:name',
  asyncHandler(async (req, res) => {
    const name = String(req.params.name || '').trim();
    deleteDiagram.run(name);
    ensureDefaultDiagram();

    if (getCurrent() === name || !selectDiagram.get(getCurrent())) {
      upsertState.run('current', selectAllDiagrams.all()[0]?.name || DEFAULT_DIAGRAM.name);
    }

    res.json(getPayload());
  }),
);

app.post(
  '/api/import',
  asyncHandler(async (req, res) => {
    const diagrams = req.body?.diagrams;
    const current = String(req.body?.current || '').trim();
    if (!diagrams || typeof diagrams !== 'object' || Array.isArray(diagrams)) {
      res.status(400).json({ error: 'diagrams object is required' });
      return;
    }

    const entries = Object.entries(diagrams);

    db.exec('BEGIN IMMEDIATE');
    try {
      for (const [name, diagram] of entries) {
        writeDiagram(name, diagram);
      }
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Ignore rollback errors so the original import error is reported.
      }
      throw error;
    }

    if (current && selectDiagram.get(current)) {
      upsertState.run('current', current);
    }

    res.json(getPayload());
  }),
);

app.use(express.static(staticDir, { extensions: ['html'] }));

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  console.error(error);
  res.status(status).json({ error: error.message || 'server error' });
});

app.listen(port, host, () => {
  console.log(`Mermaid local editor: http://${host}:${port}`);
  console.log(`Static files: ${staticDir}`);
  console.log(`SQLite database: ${dbPath}`);
});
