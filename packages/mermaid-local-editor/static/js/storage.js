const LOCAL_DIAGRAMS_KEY = 'mermaid-diagrams';
const LOCAL_CURRENT_KEY = 'mermaid-current';
const SQLITE_IMPORT_KEY = 'mermaid-sqlite-imported-v1';
const DEFAULT_DIAGRAM = {
  src: 'flowchart LR\n  UI --> RuntimeBus --> Orchestrator --> Agents',
  view: { scale: 1, panX: 0, panY: 0 },
  annotations: [],
  hidden: false,
};

function readLocalState() {
  const diagrams = JSON.parse(localStorage.getItem(LOCAL_DIAGRAMS_KEY) || '{}');
  const current = localStorage.getItem(LOCAL_CURRENT_KEY) || 'main';

  if (!diagrams[current]) {
    diagrams[current] = { ...DEFAULT_DIAGRAM };
  }

  Object.keys(diagrams).forEach((name) => {
    diagrams[name] = { ...DEFAULT_DIAGRAM, ...diagrams[name], hidden: Boolean(diagrams[name].hidden) };
  });

  return { diagrams, current };
}

function saveLocalState(diagrams, current) {
  localStorage.setItem(LOCAL_DIAGRAMS_KEY, JSON.stringify(diagrams));
  localStorage.setItem(LOCAL_CURRENT_KEY, current);
}

function normalizePayload(payload) {
  const diagrams = payload?.diagrams && typeof payload.diagrams === 'object' ? payload.diagrams : {};
  Object.keys(diagrams).forEach((name) => {
    diagrams[name] = { ...DEFAULT_DIAGRAM, ...diagrams[name], hidden: Boolean(diagrams[name].hidden) };
  });
  const current =
    typeof payload?.current === 'string' && diagrams[payload.current]
      ? payload.current
      : Object.keys(diagrams)[0] || 'main';

  if (!diagrams[current]) {
    diagrams[current] = { ...DEFAULT_DIAGRAM };
  }

  return { diagrams, current, dbPath: payload?.dbPath };
}

async function fetchJson(url, options) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function createStorage() {
  let { diagrams, current } = readLocalState();
  let dbPath = null;
  let serverBacked = false;

  async function syncFromPayload(payload) {
    const normalized = normalizePayload(payload);
    diagrams = normalized.diagrams;
    current = normalized.current;
    dbPath = normalized.dbPath || dbPath;
    saveLocalState(diagrams, current);
  }

  async function persistCurrent({ throwOnError = false } = {}) {
    if (!serverBacked) {
      return false;
    }

    try {
      await syncFromPayload(
        await fetchJson('/api/current', {
          method: 'PUT',
          body: JSON.stringify({ current }),
        }),
      );
      return true;
    } catch (error) {
      console.warn('SQLite current persistence failed, using browser cache only.', error);
      if (throwOnError) {
        throw error;
      }
      return false;
    }
  }

  async function persistDiagram(name, makeCurrent = true, { throwOnError = false } = {}) {
    if (!serverBacked || !diagrams[name]) {
      return false;
    }

    try {
      await syncFromPayload(
        await fetchJson(`/api/diagrams/${encodeURIComponent(name)}`, {
          method: 'PUT',
          body: JSON.stringify({ ...diagrams[name], makeCurrent }),
        }),
      );
      return true;
    } catch (error) {
      console.warn('SQLite diagram persistence failed, using browser cache only.', error);
      if (throwOnError) {
        throw error;
      }
      return false;
    }
  }

  async function createRemoteDiagram(name, { throwOnError = false } = {}) {
    if (!serverBacked) {
      return false;
    }

    try {
      await syncFromPayload(
        await fetchJson('/api/diagrams', {
          method: 'POST',
          body: JSON.stringify({ name, ...diagrams[name] }),
        }),
      );
      return true;
    } catch (error) {
      console.warn('SQLite diagram creation failed, using browser cache only.', error);
      if (throwOnError) {
        throw error;
      }
      return false;
    }
  }

  async function deleteRemoteDiagram(name, { throwOnError = false } = {}) {
    if (!serverBacked) {
      return false;
    }

    try {
      await syncFromPayload(
        await fetchJson(`/api/diagrams/${encodeURIComponent(name)}`, {
          method: 'DELETE',
        }),
      );
      return true;
    } catch (error) {
      console.warn('SQLite diagram deletion failed, using browser cache only.', error);
      if (throwOnError) {
        throw error;
      }
      return false;
    }
  }

  try {
    const local = readLocalState();
    const imported = localStorage.getItem(SQLITE_IMPORT_KEY) === 'true';
    const payload = await fetchJson('/api/diagrams');
    serverBacked = true;
    await syncFromPayload(payload);

    if (!imported && Object.keys(local.diagrams).length > 0) {
      await syncFromPayload(
        await fetchJson('/api/import', {
          method: 'POST',
          body: JSON.stringify(local),
        }),
      );
      localStorage.setItem(SQLITE_IMPORT_KEY, 'true');
    }
  } catch (error) {
    serverBacked = false;
    console.warn('SQLite backend unavailable, using browser localStorage only.', error);
    saveLocalState(diagrams, current);
  }

  return {
    get diagrams() {
      return diagrams;
    },
    get current() {
      return current;
    },
    get serverBacked() {
      return serverBacked;
    },
    get dbPath() {
      return dbPath;
    },

    async setCurrent(name) {
      current = name;
      saveLocalState(diagrams, current);
      return persistCurrent();
    },

    async updateCurrent(data) {
      if (!diagrams[current]) {
        diagrams[current] = { ...DEFAULT_DIAGRAM };
      }

      diagrams[current] = { ...diagrams[current], ...data };
      saveLocalState(diagrams, current);
      return persistDiagram(current);
    },

    async save(name, data) {
      const cleanName = String(name || '').trim();
      if (!cleanName) {
        throw new Error('图表名称不能为空');
      }

      const base = diagrams[current] || DEFAULT_DIAGRAM;
      diagrams[cleanName] = { ...base, ...data };
      current = cleanName;
      saveLocalState(diagrams, current);
      await persistDiagram(cleanName, true, { throwOnError: true });
    },

    async deleteCurrent() {
      const deleted = current;
      delete diagrams[current];
      current = Object.keys(diagrams)[0] || 'main';

      if (!diagrams[current]) {
        diagrams[current] = { ...DEFAULT_DIAGRAM };
      }

      saveLocalState(diagrams, current);
      await deleteRemoteDiagram(deleted, { throwOnError: true });
    },

    async create(name) {
      const cleanName = String(name || '').trim();
      if (!cleanName) {
        throw new Error('图表名称不能为空');
      }

      if (diagrams[cleanName]) {
        throw new Error(`图表 "${cleanName}" 已存在`);
      }

      diagrams[cleanName] = {
        src: 'flowchart LR\n  A --> B',
        view: { scale: 1, panX: 0, panY: 0 },
        annotations: [],
        hidden: false,
      };
      current = cleanName;
      saveLocalState(diagrams, current);
      await createRemoteDiagram(cleanName, { throwOnError: true });
    },

    async setHidden(name, hidden) {
      const cleanName = String(name || '').trim();
      if (!cleanName || !diagrams[cleanName]) {
        throw new Error('图表不存在');
      }

      diagrams[cleanName] = { ...diagrams[cleanName], hidden: Boolean(hidden) };
      saveLocalState(diagrams, current);
      await persistDiagram(cleanName, false, { throwOnError: true });
    },

    visibleNames() {
      return Object.keys(diagrams).filter((name) => !diagrams[name]?.hidden);
    },

    firstVisibleName() {
      return this.visibleNames()[0] || null;
    },

    async getAccessConfig() {
      if (!serverBacked) {
        return { passwordRequired: false, passwordUpdatedAt: null };
      }

      return fetchJson('/api/access');
    },

    async verifyViewerPassword(password) {
      if (!serverBacked) {
        return { ok: true, passwordRequired: false, passwordUpdatedAt: null };
      }

      return fetchJson('/api/access/verify', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
    },

    async setViewerPassword(password, adminPassword) {
      if (!serverBacked) {
        throw new Error('SQLite 服务不可用，无法设置查看密码');
      }

      return fetchJson('/api/access/password', {
        method: 'PUT',
        body: JSON.stringify({ password, adminPassword }),
      });
    },
  };
}
