import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createSampleData } from "./sample-data.js";
import { clone, nowIso } from "./utils.js";

const dataDir = path.join(process.cwd(), "data");
const legacyDataFile = path.join(dataDir, "db.json");
const sqliteDataFile = path.join(dataDir, "app.db");
const collections = [
  "users",
  "projects",
  "services",
  "modules",
  "apis",
  "cases",
  "datasets",
  "environments",
  "suites",
  "versions",
  "auditLogs",
  "runs"
];
const executionCollections = ["apis", "cases", "datasets", "environments", "suites"];
const sqliteBusyTimeoutMs = 5000;

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}

function sqlValue(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }
  return `'${escapeSqlString(value)}'`;
}

function parseRowDocument(row) {
  return JSON.parse(row.document_json);
}

function parseHexEncodedJson(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return JSON.parse(Buffer.from(value.trim(), "hex").toString("utf8"));
}

function splitSqliteOutputLines(output) {
  return typeof output === "string" && output.trim() ? output.trim().split("\n").filter(Boolean) : [];
}

function sortEntities(collection, items) {
  const sorted = [...items];
  sorted.sort((left, right) => {
    const leftSortAt = left.startedAt || left.createdAt || "";
    const rightSortAt = right.startedAt || right.createdAt || "";
    if (collection === "runs" || collection === "versions" || collection === "auditLogs") {
      return rightSortAt.localeCompare(leftSortAt);
    }
    return leftSortAt.localeCompare(rightSortAt);
  });
  return sorted;
}

class SqliteDatabase {
  constructor(filePath) {
    this.filePath = filePath;
  }

  run(sql) {
    const result = spawnSync("sqlite3", ["-cmd", `.timeout ${sqliteBusyTimeoutMs}`, this.filePath, sql], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024
    });
    if (result.status !== 0) {
      throw new Error((result.stderr || result.stdout || "sqlite command failed").trim());
    }
    return result.stdout.trim();
  }

  query(sql) {
    const result = spawnSync("sqlite3", ["-cmd", `.timeout ${sqliteBusyTimeoutMs}`, "-json", this.filePath, sql], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024
    });
    if (result.status !== 0) {
      throw new Error((result.stderr || result.stdout || "sqlite query failed").trim());
    }
    const output = result.stdout.trim();
    return output ? JSON.parse(output) : [];
  }
}

function writeLegacySnapshot(snapshot) {
  fs.writeFileSync(legacyDataFile, JSON.stringify(snapshot, null, 2));
}

function readLegacySnapshot(port) {
  if (fs.existsSync(legacyDataFile)) {
    return JSON.parse(fs.readFileSync(legacyDataFile, "utf8"));
  }
  const sample = createSampleData(port);
  writeLegacySnapshot(sample);
  return sample;
}

function seedDatabase(db, snapshot) {
  db.run(`
    BEGIN;
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS records (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      sort_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      document_json TEXT NOT NULL,
      PRIMARY KEY (collection, id)
    );
    CREATE INDEX IF NOT EXISTS idx_records_collection_sort ON records(collection, sort_at);
    COMMIT;
  `);

  const settings = snapshot.settings ?? {};
  db.run(`
    INSERT OR REPLACE INTO app_meta (key, value_json, updated_at)
    VALUES ('settings', ${sqlValue(JSON.stringify(settings))}, ${sqlValue(nowIso())});
  `);

  for (const collection of collections) {
    for (const item of snapshot[collection] ?? []) {
      const sortAt = item.startedAt || item.createdAt || nowIso();
      const updatedAt = item.updatedAt || item.createdAt || nowIso();
      db.run(`
        INSERT OR REPLACE INTO records (collection, id, sort_at, updated_at, document_json)
        VALUES (
          ${sqlValue(collection)},
          ${sqlValue(item.id)},
          ${sqlValue(sortAt)},
          ${sqlValue(updatedAt)},
          ${sqlValue(JSON.stringify(item))}
        );
      `);
    }
  }
}

function ensureDatabase(port) {
  ensureDataDir();
  const db = new SqliteDatabase(sqliteDataFile);
  db.run(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS records (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      sort_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      document_json TEXT NOT NULL,
      PRIMARY KEY (collection, id)
    );
    CREATE INDEX IF NOT EXISTS idx_records_collection_sort ON records(collection, sort_at);
  `);

  const existing = db.query("SELECT COUNT(*) AS count FROM records;")[0]?.count ?? 0;
  const settingsExists = db.query("SELECT COUNT(*) AS count FROM app_meta WHERE key = 'settings';")[0]?.count ?? 0;
  if (existing > 0 || settingsExists > 0) {
    return db;
  }

  const snapshot = readLegacySnapshot(port);
  seedDatabase(db, snapshot);
  return db;
}

function isPositiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeObjectRecord(value) {
  return isPlainObject(value) ? value : {};
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => item !== undefined && item !== null).map((item) => String(item)) : [];
}

function normalizeKeyValueArray(entries) {
  if (Array.isArray(entries)) {
    return entries
      .filter((entry) => isPlainObject(entry) && entry.key !== undefined && entry.key !== null && String(entry.key))
      .map((entry) => ({
        key: String(entry.key),
        value: entry.value ?? ""
      }));
  }

  if (isPlainObject(entries)) {
    return Object.entries(entries).map(([key, value]) => ({
      key,
      value: value ?? ""
    }));
  }

  return [];
}

function normalizeAssertionArray(assertions) {
  return Array.isArray(assertions)
    ? assertions.filter((assertion) => isPlainObject(assertion) && assertion.type).map((assertion) => ({ ...assertion }))
    : [];
}

function normalizeExtractArray(extracts) {
  return Array.isArray(extracts)
    ? extracts.filter((extract) => isPlainObject(extract) && extract.name && extract.source).map((extract) => ({ ...extract }))
    : [];
}

function normalizeStepArray(steps) {
  return Array.isArray(steps)
    ? steps.filter((step) => isPlainObject(step) && step.type).map((step) => ({ ...step }))
    : [];
}

function normalizeEnvironmentAuth(auth) {
  const normalized = isPlainObject(auth) ? { ...auth } : {};
  const type = ["none", "bearer", "apikey"].includes(normalized.type) ? normalized.type : "none";

  return {
    type,
    value: normalized.value ?? "",
    ...(type === "apikey" && normalized.header ? { header: String(normalized.header) } : {})
  };
}

function normalizeCreator(value, fallback = "系统") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeUsername(value, fallback = "user") {
  const normalized = typeof value === "string" && value.trim() ? value.trim().toLowerCase() : fallback;
  return normalized.replace(/\s+/g, "_");
}

function defaultPasswordByRole(role) {
  if (role === "admin") {
    return "admin123";
  }
  if (role === "editor") {
    return "editor123";
  }
  return "viewer123";
}

function defaultAuthToken(username) {
  return `token_${normalizeUsername(username)}_flowforge`;
}

function sessionExpiryFromNow(days = 30) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function isFutureIso(value) {
  return typeof value === "string" && value && !Number.isNaN(Date.parse(value)) && Date.parse(value) > Date.now();
}

function inferCasePriority(tags = []) {
  if (tags.includes("critical") || tags.includes("p0") || tags.includes("high")) {
    return "high";
  }
  if (tags.includes("smoke") || tags.includes("core") || tags.includes("regression")) {
    return "medium";
  }
  return "low";
}

function inferApiBodyMode(api) {
  if (api.bodyMode === "none" || api.bodyMode === "json" || api.bodyMode === "raw") {
    return api.bodyMode;
  }
  return String(api.method || "GET").toUpperCase() === "GET" ? "none" : "json";
}

function normalizeDatasetRows(rows) {
  return Array.isArray(rows)
    ? rows
        .filter((row) => isPlainObject(row))
        .map((row, index) => ({
          id: typeof row.id === "string" && row.id.trim() ? row.id.trim() : `row_${index + 1}`,
          name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : `数据行 ${index + 1}`,
          variables: normalizeObjectRecord(row.variables)
        }))
    : [];
}

function normalizeExecutionConfig(config) {
  const normalized = isPlainObject(config) ? { ...config } : {};
  const priority = ["high", "normal", "low"].includes(normalized.priority) ? normalized.priority : "normal";
  const maxRetries = Number.isInteger(Number(normalized.maxRetries)) && Number(normalized.maxRetries) >= 0 ? Number(normalized.maxRetries) : 0;

  return {
    priority,
    maxRetries,
    stopOnDatasetFailure: normalized.stopOnDatasetFailure !== false
  };
}

function normalizeSuiteItems(items = []) {
  return Array.isArray(items)
    ? items
        .filter((item) => {
          if (!isPlainObject(item)) {
            return false;
          }
          const itemType = item.itemType === "suite" ? "suite" : "case";
          return itemType === "suite" ? Boolean(item.suiteId) : Boolean(item.caseId);
        })
        .map((item, index) => ({
          ...item,
          itemType: item.itemType === "suite" ? "suite" : "case",
          order: Number(item.order) || index + 1,
          continueOnFailure: Boolean(item.continueOnFailure),
          enabled: item.enabled !== false,
          condition: typeof item.condition === "string" ? item.condition : "",
          timeoutMs: isPositiveNumber(item.timeoutMs) ? Number(item.timeoutMs) : null,
          parallelGroup: typeof item.parallelGroup === "string" ? item.parallelGroup.trim() : "",
          role: ["setup", "test", "teardown"].includes(item.role) ? item.role : "test",
          suiteId: item.itemType === "suite" && typeof item.suiteId === "string" ? item.suiteId : undefined,
          caseId: item.itemType === "suite" ? undefined : item.caseId
        }))
    : [];
}

function summarizeBootstrapResponse(body) {
  const safeBody = isPlainObject(body) ? body : {};
  return {
    settings: safeBody.settings ?? {},
    counts: {
      users: Array.isArray(safeBody.users) ? safeBody.users.length : 0,
      projects: Array.isArray(safeBody.projects) ? safeBody.projects.length : 0,
      services: Array.isArray(safeBody.services) ? safeBody.services.length : 0,
      modules: Array.isArray(safeBody.modules) ? safeBody.modules.length : 0,
      apis: Array.isArray(safeBody.apis) ? safeBody.apis.length : 0,
      cases: Array.isArray(safeBody.cases) ? safeBody.cases.length : 0,
      datasets: Array.isArray(safeBody.datasets) ? safeBody.datasets.length : 0,
      environments: Array.isArray(safeBody.environments) ? safeBody.environments.length : 0,
      suites: Array.isArray(safeBody.suites) ? safeBody.suites.length : 0,
      versions: Array.isArray(safeBody.versions) ? safeBody.versions.length : 0,
      auditLogs: Array.isArray(safeBody.auditLogs) ? safeBody.auditLogs.length : 0,
      runs: Array.isArray(safeBody.runs) ? safeBody.runs.length : 0
    }
  };
}

function jsonEquals(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class Storage {
  constructor(port) {
    this.port = port;
    this.db = ensureDatabase(port);
    this.migrateRuntimeData();
  }

  getSettings() {
    const output = this.db.run("SELECT hex(value_json) FROM app_meta WHERE key = 'settings' LIMIT 1;");
    return output ? parseHexEncodedJson(output) ?? {} : {};
  }

  setSettings(settings) {
    const updatedAt = nowIso();
    this.db.run(`
      INSERT OR REPLACE INTO app_meta (key, value_json, updated_at)
      VALUES ('settings', ${sqlValue(JSON.stringify(settings))}, ${sqlValue(updatedAt)});
    `);
  }

  getMeta(key) {
    const output = this.db.run(`
      SELECT hex(value_json)
      FROM app_meta
      WHERE key = ${sqlValue(key)}
      LIMIT 1;
    `);
    return output ? parseHexEncodedJson(output) : null;
  }

  setMeta(key, value) {
    const updatedAt = nowIso();
    this.db.run(`
      INSERT OR REPLACE INTO app_meta (key, value_json, updated_at)
      VALUES (${sqlValue(key)}, ${sqlValue(JSON.stringify(value))}, ${sqlValue(updatedAt)});
    `);
  }

  getCollection(name) {
    const output = this.db.run(`
      SELECT hex(document_json)
      FROM records
      WHERE collection = ${sqlValue(name)};
    `);
    const items = splitSqliteOutputLines(output)
      .map((row) => parseHexEncodedJson(row))
      .filter(Boolean);
    return sortEntities(name, items);
  }

  getCollectionByIds(name, ids) {
    const uniqueIds = [...new Set((ids ?? []).filter(Boolean))];
    if (!uniqueIds.length) {
      return [];
    }

    const output = this.db.run(`
      SELECT hex(document_json)
      FROM records
      WHERE collection = ${sqlValue(name)} AND id IN (${uniqueIds.map(sqlValue).join(", ")});
    `);
    const items = splitSqliteOutputLines(output)
      .map((row) => parseHexEncodedJson(row))
      .filter(Boolean);
    return clone(sortEntities(name, items));
  }

  getCollections(names) {
    const uniqueNames = [...new Set((names ?? []).filter(Boolean))];
    if (!uniqueNames.length) {
      return {};
    }

    return Object.fromEntries(uniqueNames.map((name) => [name, this.getCollection(name)]));
  }

  getAll() {
    const snapshot = this.getCollections(collections);
    return {
      settings: this.getSettings(),
      ...Object.fromEntries(collections.map((collection) => [collection, snapshot[collection] ?? []]))
    };
  }

  getExecutionSnapshot() {
    const snapshot = this.getCollections(executionCollections);
    return Object.fromEntries(executionCollections.map((collection) => [collection, snapshot[collection] ?? []]));
  }

  getExecutionSnapshotForSuite(suiteId, environmentId = null, executionOverrides = null) {
    const suite = suiteId ? this.find("suites", suiteId) : null;
    if (!suite) {
      return this.getExecutionSnapshot();
    }

    const normalizedOverrides = isPlainObject(executionOverrides) ? executionOverrides : {};
    const effectiveSuite = {
      ...suite,
      timeoutSeconds: isPositiveNumber(normalizedOverrides.timeoutSeconds) ? Number(normalizedOverrides.timeoutSeconds) : suite.timeoutSeconds,
      failureStrategy: ["stop", "continue"].includes(normalizedOverrides.failureStrategy) ? normalizedOverrides.failureStrategy : suite.failureStrategy,
      continueOnFailure:
        normalizedOverrides.failureStrategy === "continue"
          ? true
          : normalizedOverrides.failureStrategy === "stop"
            ? false
            : suite.continueOnFailure,
      executionConfig: {
        ...normalizeExecutionConfig(suite.executionConfig),
        ...(normalizedOverrides.executionConfig ? normalizeExecutionConfig(normalizedOverrides.executionConfig) : {})
      }
    };

    const suiteIds = new Set();
    const caseIds = new Set();
    const datasetIds = new Set();
    const visitedSuiteIds = new Set();
    const visitSuite = (currentSuite, replaceRoot = false) => {
      if (!currentSuite || visitedSuiteIds.has(currentSuite.id)) {
        return;
      }
      visitedSuiteIds.add(currentSuite.id);
      suiteIds.add(currentSuite.id);
      if (currentSuite.datasetId) {
        datasetIds.add(currentSuite.datasetId);
      }
      const currentItems = replaceRoot ? effectiveSuite.items ?? [] : currentSuite.items ?? [];
      currentItems.forEach((item) => {
        if (item?.itemType === "suite" && item?.suiteId) {
          const referencedSuite = this.find("suites", item.suiteId);
          if (referencedSuite) {
            visitSuite(referencedSuite);
          }
          return;
        }
        if (item?.caseId) {
          caseIds.add(item.caseId);
        }
      });
    };

    visitSuite(effectiveSuite, true);
    const cases = this.getCollectionByIds("cases", [...caseIds]);
    const apiIds = [...new Set(cases.map((item) => item.apiId).filter(Boolean))];
    const apis = this.getCollectionByIds("apis", apiIds);
    const environmentIds = [environmentId || effectiveSuite.defaultEnvironmentId].filter(Boolean);
    const environments = this.getCollectionByIds("environments", environmentIds);
    const datasets = datasetIds.size ? this.getCollectionByIds("datasets", [...datasetIds]) : [];
    const suites = this.getCollectionByIds("suites", [...suiteIds]).map((item) => (item.id === effectiveSuite.id ? effectiveSuite : item));

    return {
      apis,
      cases,
      datasets,
      environments,
      suites
    };
  }

  list(name) {
    return clone(this.getCollection(name));
  }

  find(name, id) {
    const output = this.db.run(`
      SELECT hex(document_json)
      FROM records
      WHERE collection = ${sqlValue(name)} AND id = ${sqlValue(id)}
      LIMIT 1;
    `);
    const item = output ? parseHexEncodedJson(output) : null;
    return item ? clone(item) : null;
  }

  create(name, item) {
    const sortAt = item.startedAt || item.createdAt || nowIso();
    const updatedAt = item.updatedAt || item.createdAt || nowIso();
    this.db.run(`
      INSERT INTO records (collection, id, sort_at, updated_at, document_json)
      VALUES (
        ${sqlValue(name)},
        ${sqlValue(item.id)},
        ${sqlValue(sortAt)},
        ${sqlValue(updatedAt)},
        ${sqlValue(JSON.stringify(item))}
      );
    `);
    return clone(item);
  }

  update(name, id, patch) {
    const existing = this.find(name, id);
    if (!existing) {
      return null;
    }

    const next = {
      ...existing,
      ...patch,
      updatedAt: nowIso()
    };
    const sortAt = next.startedAt || next.createdAt || existing.startedAt || existing.createdAt || nowIso();
    this.db.run(`
      INSERT OR REPLACE INTO records (collection, id, sort_at, updated_at, document_json)
      VALUES (
        ${sqlValue(name)},
        ${sqlValue(id)},
        ${sqlValue(sortAt)},
        ${sqlValue(next.updatedAt)},
        ${sqlValue(JSON.stringify(next))}
      );
    `);
    return clone(next);
  }

  remove(name, id) {
    const existing = this.find(name, id);
    if (!existing) {
      return false;
    }

    this.db.run(`
      DELETE FROM records
      WHERE collection = ${sqlValue(name)} AND id = ${sqlValue(id)};
    `);
    return true;
  }

  replaceRuns(runs) {
    this.db.run(`DELETE FROM records WHERE collection = 'runs';`);
    for (const run of runs) {
      this.create("runs", run);
    }
  }

  addRun(run) {
    const runs = [run, ...this.list("runs")].slice(0, 100);
    this.replaceRuns(runs);
  }

  normalizeEnvironmentEntity(environment, fallbackBaseUrl) {
    const nextAuth =
      environment.id === "env_platform_self" && (!environment.auth || environment.auth.type === "none")
        ? {
            type: "apikey",
            header: "x-session-token",
            value: "token_admin_flowforge"
          }
        : normalizeEnvironmentAuth(environment.auth);

    const normalized = {
      ...environment,
      creator: normalizeCreator(environment.creator),
      baseUrl:
        typeof environment.baseUrl === "string" && environment.baseUrl.trim()
          ? environment.baseUrl.trim()
          : fallbackBaseUrl,
      headers: normalizeObjectRecord(environment.headers),
      variables: normalizeObjectRecord(environment.variables),
      auth: nextAuth
    };

    return jsonEquals(normalized, environment) ? null : normalized;
  }

  normalizeApiEntity(api) {
    const bodyMode = inferApiBodyMode(api);
    const normalized = {
      ...api,
      creator: normalizeCreator(api.creator),
      method: String(api.method || "GET").toUpperCase(),
      status: ["active", "deprecated"].includes(api.status) ? api.status : api.tags?.includes("deprecated") ? "deprecated" : "active",
      path: typeof api.path === "string" ? api.path : "",
      headers: normalizeKeyValueArray(api.headers),
      query: normalizeKeyValueArray(api.query),
      bodyMode,
      bodyTemplate:
        bodyMode === "none"
          ? ""
          : api.bodyTemplate !== undefined && api.bodyTemplate !== null
            ? api.bodyTemplate
            : bodyMode === "json"
              ? {}
              : "",
      preSteps: normalizeStepArray(api.preSteps),
      postSteps: normalizeStepArray(api.postSteps),
      tags: normalizeStringArray(api.tags)
    };

    return jsonEquals(normalized, api) ? null : normalized;
  }

  normalizeCaseEntity(testCase) {
    const normalized = {
      ...testCase,
      creator: normalizeCreator(testCase.creator),
      priority: ["high", "medium", "low"].includes(testCase.priority) ? testCase.priority : inferCasePriority(normalizeStringArray(testCase.tags)),
      description: typeof testCase.description === "string" ? testCase.description : "",
      tags: normalizeStringArray(testCase.tags),
      assertions: normalizeAssertionArray(testCase.assertions),
      extracts: normalizeExtractArray(testCase.extracts),
      preScript: typeof testCase.preScript === "string" ? testCase.preScript : "",
      postScript: typeof testCase.postScript === "string" ? testCase.postScript : "",
      overrides: normalizeObjectRecord(testCase.overrides)
    };

    return jsonEquals(normalized, testCase) ? null : normalized;
  }

  normalizeUserEntity(user) {
    const role = ["admin", "editor", "viewer"].includes(user.role) ? user.role : "viewer";
    const username = user.username || (user.id === "user_admin" ? "admin" : user.id === "user_editor" ? "editor" : user.id === "user_viewer" ? "viewer" : String(user.id || user.name || "user"));
    const normalized = {
      ...user,
      name: typeof user.name === "string" && user.name.trim() ? user.name.trim() : "未命名用户",
      username: normalizeUsername(username),
      password: typeof user.password === "string" && user.password.trim() ? user.password : defaultPasswordByRole(role),
      authToken: typeof user.authToken === "string" && user.authToken.trim() ? user.authToken : defaultAuthToken(username),
      role,
      status: ["active", "disabled"].includes(user.status) ? user.status : "active",
      mustChangePassword: user.mustChangePassword === true,
      lastLoginAt: typeof user.lastLoginAt === "string" && user.lastLoginAt.trim() ? user.lastLoginAt : null,
      passwordUpdatedAt:
        typeof user.passwordUpdatedAt === "string" && user.passwordUpdatedAt.trim()
          ? user.passwordUpdatedAt
          : user.updatedAt || user.createdAt || nowIso(),
      creator: normalizeCreator(user.creator)
    };

    return jsonEquals(normalized, user) ? null : normalized;
  }

  normalizeDatasetEntity(dataset) {
    const normalized = {
      ...dataset,
      creator: normalizeCreator(dataset.creator),
      description: typeof dataset.description === "string" ? dataset.description : "",
      scope: ["suite", "global"].includes(dataset.scope) ? dataset.scope : "suite",
      tags: normalizeStringArray(dataset.tags),
      rows: normalizeDatasetRows(dataset.rows)
    };

    return jsonEquals(normalized, dataset) ? null : normalized;
  }

  normalizeSessionEntity(session, usersById) {
    const user = usersById.get(session.userId);
    if (!user) {
      return { remove: true };
    }

    const token =
      typeof session.token === "string" && session.token.trim()
        ? session.token.trim()
        : typeof session.authToken === "string" && session.authToken.trim()
          ? session.authToken.trim()
          : null;

    if (!token) {
      return { remove: true };
    }

    const sessionType = ["login", "service"].includes(session.sessionType) ? session.sessionType : "login";
    const normalized = {
      ...session,
      token,
      userId: user.id,
      remember: session.remember !== false,
      sessionType,
      createdAt:
        typeof session.createdAt === "string" && session.createdAt.trim()
          ? session.createdAt
          : nowIso(),
      expiresAt: isFutureIso(session.expiresAt)
        ? session.expiresAt
        : sessionType === "service"
          ? sessionExpiryFromNow(3650)
          : sessionExpiryFromNow(session.remember === false ? 1 : 30)
    };

    return jsonEquals(normalized, session) ? null : { update: normalized };
  }

  normalizeSuiteEntity(suite, defaultEnvironmentId) {
    const nextFailureStrategy =
      suite.failureStrategy === "continue" || suite.failureStrategy === "stop"
        ? suite.failureStrategy
        : suite.continueOnFailure
          ? "continue"
          : "stop";
    const nextContinueOnFailure = nextFailureStrategy === "continue";
    const nextTimeoutSeconds = isPositiveNumber(suite.timeoutSeconds) ? Number(suite.timeoutSeconds) : 300;
    const nextSchedule = {
      enabled: Boolean(suite.schedule?.enabled),
      intervalMinutes: isPositiveNumber(suite.schedule?.intervalMinutes)
        ? Number(suite.schedule.intervalMinutes)
        : 30
    };
    const nextItems = normalizeSuiteItems(suite.items);
    const nextScenarioAssertions = Array.isArray(suite.scenarioAssertions) ? suite.scenarioAssertions : [];
    const nextVariables = suite.variables && typeof suite.variables === "object" ? suite.variables : {};
    const nextTags = Array.isArray(suite.tags) ? suite.tags : [];
    const nextDatasetId = suite.datasetId && this.find("datasets", suite.datasetId) ? suite.datasetId : null;
    const resolvedEnvironmentId =
      suite.defaultEnvironmentId && this.find("environments", suite.defaultEnvironmentId)
        ? suite.defaultEnvironmentId
        : defaultEnvironmentId;

    const normalized = {
      ...suite,
      creator: normalizeCreator(suite.creator),
      defaultEnvironmentId: resolvedEnvironmentId ?? null,
      failureStrategy: nextFailureStrategy,
      continueOnFailure: nextContinueOnFailure,
      timeoutSeconds: nextTimeoutSeconds,
      schedule: nextSchedule,
      items: nextItems,
      scenarioAssertions: nextScenarioAssertions,
      variables: nextVariables,
      tags: nextTags,
      datasetId: nextDatasetId,
      executionConfig: normalizeExecutionConfig(suite.executionConfig)
    };

    return jsonEquals(normalized, suite) ? null : normalized;
  }

  compactRunEntity(run) {
    if (!Array.isArray(run.steps)) {
      return null;
    }

    let changed = false;
    const nextSteps = run.steps.map((step) => {
      if (!isPlainObject(step) || !isPlainObject(step.response)) {
        return step;
      }

      const requestUrl = typeof step.request?.url === "string" ? step.request.url : "";
      const nextResponse = { ...step.response };

      if (requestUrl.includes("/api/bootstrap")) {
        const summarizedBody = summarizeBootstrapResponse(step.response.body);
        nextResponse.body = summarizedBody;
        nextResponse.bodyText = JSON.stringify(summarizedBody, null, 2);
        changed = true;
      } else if (typeof step.response.bodyText === "string" && step.response.bodyText.length > 8000) {
        nextResponse.bodyText = `${step.response.bodyText.slice(0, 8000)}\n... [truncated]`;
        changed = true;
      }

      return changed ? { ...step, response: nextResponse } : step;
    });

    if (!changed) {
      return null;
    }

    return {
      ...run,
      steps: nextSteps
    };
  }

  migrateRuntimeData() {
    const currentSettings = this.getSettings();
    const currentMigration = this.getMeta("runtimeDataMigration");
    let userMigrationCount = 0;

    if (!this.list("users").length) {
      this.create("users", {
        id: "user_admin",
        name: normalizeCreator(currentSettings.currentUser),
        username: "admin",
        password: "admin123",
        authToken: "token_admin_flowforge",
        role: "admin",
        status: "active",
        creator: normalizeCreator(currentSettings.currentUser),
        createdAt: nowIso()
      });
      userMigrationCount += 1;
    }

    for (const user of this.list("users")) {
      const normalized = this.normalizeUserEntity(user);
      if (!normalized) {
        continue;
      }
      this.update("users", user.id, normalized);
      userMigrationCount += 1;
    }

    const normalizedUsers = this.list("users");
    const usersById = new Map(normalizedUsers.map((user) => [user.id, user]));
    let sessionMigrationCount = 0;

    for (const session of this.list("sessions")) {
      const normalized = this.normalizeSessionEntity(session, usersById);
      if (!normalized) {
        continue;
      }
      if (normalized.remove) {
        this.remove("sessions", session.id);
        sessionMigrationCount += 1;
        continue;
      }
      this.update("sessions", session.id, normalized.update);
      sessionMigrationCount += 1;
    }

    for (const user of normalizedUsers) {
      if (user.status !== "active" || !user.authToken) {
        continue;
      }
      const existingServiceSession = this
        .list("sessions")
        .find((session) => session.token === user.authToken || (session.userId === user.id && session.sessionType === "service"));
      if (existingServiceSession) {
        continue;
      }
      this.create("sessions", {
        id: `session_seed_${user.id}`,
        userId: user.id,
        token: user.authToken,
        remember: true,
        sessionType: "service",
        createdAt: nowIso(),
        expiresAt: sessionExpiryFromNow(3650)
      });
      sessionMigrationCount += 1;
    }

    const environments = this.list("environments");
    const fallbackBaseUrl =
      environments.find((environment) => typeof environment.baseUrl === "string" && environment.baseUrl.trim())?.baseUrl ||
      `http://localhost:${this.port}/demo-api`;
    let environmentMigrationCount = 0;

    for (const environment of environments) {
      const normalized = this.normalizeEnvironmentEntity(environment, fallbackBaseUrl);
      if (!normalized) {
        continue;
      }
      this.update("environments", environment.id, normalized);
      environmentMigrationCount += 1;
    }

    const normalizedEnvironments = this.list("environments");
    const defaultEnvironmentId = normalizedEnvironments[0]?.id ?? null;
    const shouldSyncPlatformCatalog = !currentMigration || currentMigration.version < 10;
    let catalogSyncCount = 0;

    if (shouldSyncPlatformCatalog) {
      const sampleSnapshot = createSampleData(this.port);
      for (const collection of ["projects", "services", "modules", "apis", "cases", "datasets", "suites"]) {
        for (const item of sampleSnapshot[collection] ?? []) {
          if (this.find(collection, item.id)) {
            continue;
          }
          this.create(collection, item);
          catalogSyncCount += 1;
        }
      }

      for (const environment of sampleSnapshot.environments ?? []) {
        const existing = this.find("environments", environment.id);
        if (!existing) {
          this.create("environments", environment);
          catalogSyncCount += 1;
          continue;
        }

        const mergedVariables = {
          ...(existing.variables ?? {}),
          ...(environment.variables ?? {})
        };
        const nextAuth =
          existing.auth && existing.auth.type && existing.auth.type !== "none"
            ? existing.auth
            : environment.auth;
        const patch = {};

        if (!jsonEquals(mergedVariables, existing.variables ?? {})) {
          patch.variables = mergedVariables;
        }
        if ((!existing.baseUrl || !String(existing.baseUrl).trim()) && environment.baseUrl) {
          patch.baseUrl = environment.baseUrl;
        }
        if ((!existing.description || !String(existing.description).trim()) && environment.description) {
          patch.description = environment.description;
        }
        if (!jsonEquals(nextAuth, existing.auth ?? {})) {
          patch.auth = nextAuth;
        }

        if (Object.keys(patch).length) {
          this.update("environments", environment.id, patch);
          catalogSyncCount += 1;
        }
      }
    }

    const apis = this.list("apis");
    let apiMigrationCount = 0;

    for (const api of apis) {
      const normalized = this.normalizeApiEntity(api);
      if (!normalized) {
        continue;
      }
      this.update("apis", api.id, normalized);
      apiMigrationCount += 1;
    }

    const cases = this.list("cases");
    let caseMigrationCount = 0;

    for (const testCase of cases) {
      const normalized = this.normalizeCaseEntity(testCase);
      if (!normalized) {
        continue;
      }
      this.update("cases", testCase.id, normalized);
      caseMigrationCount += 1;
    }

    const datasets = this.list("datasets");
    let datasetMigrationCount = 0;

    for (const dataset of datasets) {
      const normalized = this.normalizeDatasetEntity(dataset);
      if (!normalized) {
        continue;
      }
      this.update("datasets", dataset.id, normalized);
      datasetMigrationCount += 1;
    }

    const suites = this.list("suites");
    const shouldCompactRuns = !currentMigration || currentMigration.version < 8;
    const runs = shouldCompactRuns ? this.list("runs") : [];
    let suiteMigrationCount = 0;
    let runMigrationCount = 0;

    for (const suite of suites) {
      const normalized = this.normalizeSuiteEntity(suite, defaultEnvironmentId);
      if (!normalized) {
        continue;
      }
      this.update("suites", suite.id, normalized);
      suiteMigrationCount += 1;
    }

    for (const run of runs) {
      const normalized = this.compactRunEntity(run);
      if (!normalized) {
        continue;
      }
      this.update("runs", run.id, normalized);
      runMigrationCount += 1;
    }

    if (
      userMigrationCount > 0 ||
      environmentMigrationCount > 0 ||
      apiMigrationCount > 0 ||
      caseMigrationCount > 0 ||
      datasetMigrationCount > 0 ||
      suiteMigrationCount > 0 ||
      sessionMigrationCount > 0 ||
      runMigrationCount > 0 ||
      catalogSyncCount > 0 ||
      !currentMigration ||
      currentMigration.version !== 10
    ) {
      this.setMeta("runtimeDataMigration", {
        version: 10,
        migratedAt: nowIso(),
        userMigrationCount,
        sessionMigrationCount,
        environmentMigrationCount,
        apiMigrationCount,
        caseMigrationCount,
        datasetMigrationCount,
        suiteMigrationCount,
        runMigrationCount,
        catalogSyncCount
      });
    }
  }
}
