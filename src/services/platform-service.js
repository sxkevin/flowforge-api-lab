import { createId, nowIso } from "../utils.js";
import { importOpenApiSpec } from "../openapi.js";
import { renderTemplate } from "../template.js";

const collectionPrefixes = {
  users: "user",
  projects: "project",
  services: "service",
  modules: "module",
  apis: "api",
  cases: "case",
  datasets: "dataset",
  environments: "env",
  suites: "suite",
  versions: "version",
  auditLogs: "audit"
};

const parentReferences = {
  services: { field: "projectId", collection: "projects" },
  modules: { field: "serviceId", collection: "services" },
  apis: { field: "moduleId", collection: "modules" },
  cases: { field: "apiId", collection: "apis" },
  suites: { field: "projectId", collection: "projects" }
};

const childReferences = {
  projects: [{ field: "projectId", collection: "services" }, { field: "projectId", collection: "suites" }],
  services: [{ field: "serviceId", collection: "modules" }],
  modules: [{ field: "moduleId", collection: "apis" }],
  apis: [{ field: "apiId", collection: "cases" }],
  cases: [{ field: "caseId", collection: "suites", arrayField: "items" }],
  suites: [{ field: "suiteId", collection: "suites", arrayField: "items" }],
  datasets: [{ field: "datasetId", collection: "suites" }],
  environments: [{ field: "defaultEnvironmentId", collection: "suites" }]
};

const versionedCollections = new Set(["projects", "services", "modules", "apis", "cases", "datasets", "environments", "suites"]);
const immutableCollections = new Set(["runs", "versions", "auditLogs"]);

function assertEntityExists(storage, collection, id, fieldName) {
  if (!id) {
    throw new Error(`${fieldName} is required`);
  }
  if (!storage.find(collection, id)) {
    throw new Error(`${fieldName} references missing ${collection.slice(0, -1)} ${id}`);
  }
}

function assertSuiteItems(storage, items = []) {
  for (const item of items) {
    const itemType = item?.itemType === "suite" ? "suite" : "case";
    if (itemType === "suite") {
      assertEntityExists(storage, "suites", item?.suiteId, "suiteId");
    } else if (item?.caseId) {
      assertEntityExists(storage, "cases", item.caseId, "caseId");
    }
    if (item?.timeoutMs !== undefined && item?.timeoutMs !== null && item?.timeoutMs !== "") {
      assertPositiveNumber(item.timeoutMs, "item.timeoutMs");
    }
  }
}

function assertNoSuiteCycles(storage, suiteId, items = [], trail = []) {
  for (const item of items) {
    if (item?.itemType !== "suite" || !item?.suiteId) {
      continue;
    }
    if (item.suiteId === suiteId) {
      throw new Error(`suite ${suiteId} cannot reference itself`);
    }
    if (trail.includes(item.suiteId)) {
      throw new Error(`suite reference cycle detected: ${[...trail, item.suiteId].join(" -> ")}`);
    }
    const referenced = storage.find("suites", item.suiteId);
    if (!referenced) {
      continue;
    }
    assertNoSuiteCycles(storage, suiteId, referenced.items ?? [], [...trail, item.suiteId]);
  }
}

function assertPositiveNumber(value, fieldName) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`${fieldName} must be a positive number`);
  }
}

function assertNonNegativeInteger(value, fieldName) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
}

function assertDeleteAllowed(storage, collection, id) {
  for (const reference of childReferences[collection] ?? []) {
    const entities = storage.list(reference.collection);
    const conflict = entities.find((entity) => {
      if (reference.arrayField) {
        return Array.isArray(entity[reference.arrayField]) && entity[reference.arrayField].some((item) => item?.[reference.field] === id);
      }
      return entity[reference.field] === id;
    });

    if (conflict) {
      throw new Error(`${collection.slice(0, -1)} ${id} is still referenced by ${reference.collection.slice(0, -1)} ${conflict.id}`);
    }
  }
}

function dateKey(isoString) {
  return String(isoString || "").slice(0, 10);
}

function rangeToDays(range) {
  if (range === "30d") {
    return 30;
  }
  if (range === "7d") {
    return 7;
  }
  return 1;
}

function formatDuration(duration = 0) {
  if (duration < 1000) {
    return `${duration}ms`;
  }
  const seconds = Math.round(duration / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  return remainSeconds ? `${minutes}m ${remainSeconds}s` : `${minutes}m`;
}

function statusText(status) {
  return {
    passed: "通过",
    failed: "失败",
    running: "执行中",
    queued: "排队中",
    canceled: "已取消",
    skipped: "已跳过"
  }[status] || status;
}

function normalizeCreator(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeUsername(value) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : "";
}

function normalizeRole(value) {
  return ["admin", "editor", "viewer"].includes(value) ? value : "viewer";
}

function normalizeStatus(value) {
  return ["active", "disabled"].includes(value) ? value : "active";
}

function normalizeDatasetRows(rows = []) {
  return Array.isArray(rows)
    ? rows
        .filter((row) => row && typeof row === "object")
        .map((row, index) => ({
          id: typeof row.id === "string" && row.id.trim() ? row.id.trim() : `row_${index + 1}`,
          name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : `数据行 ${index + 1}`,
          variables: row.variables && typeof row.variables === "object" && !Array.isArray(row.variables) ? row.variables : {}
        }))
    : [];
}

function normalizeExecutionConfig(config = {}) {
  return {
    priority: ["high", "normal", "low"].includes(config.priority) ? config.priority : "normal",
    maxRetries: Number.isInteger(Number(config.maxRetries)) && Number(config.maxRetries) >= 0 ? Number(config.maxRetries) : 0,
    stopOnDatasetFailure: config.stopOnDatasetFailure !== false
  };
}

function normalizeRunOptions(options = {}) {
  const normalized = options && typeof options === "object" ? { ...options } : {};
  const executionConfig = {};
  if (normalized.priority !== undefined && normalized.priority !== null && normalized.priority !== "") {
    if (!["high", "normal", "low"].includes(normalized.priority)) {
      throw new Error("priority must be high, normal or low");
    }
    executionConfig.priority = normalized.priority;
  }
  if (normalized.maxRetries !== undefined && normalized.maxRetries !== null && normalized.maxRetries !== "") {
    assertNonNegativeInteger(normalized.maxRetries, "maxRetries");
    executionConfig.maxRetries = Number(normalized.maxRetries);
  }
  if (normalized.stopOnDatasetFailure !== undefined) {
    executionConfig.stopOnDatasetFailure = normalized.stopOnDatasetFailure !== false && normalized.stopOnDatasetFailure !== "false";
  }
  return {
    environmentId: typeof normalized.environmentId === "string" && normalized.environmentId.trim() ? normalized.environmentId.trim() : null,
    timeoutSeconds:
      normalized.timeoutSeconds !== undefined && normalized.timeoutSeconds !== null && normalized.timeoutSeconds !== ""
        ? Number(normalized.timeoutSeconds)
        : null,
    failureStrategy: ["stop", "continue"].includes(normalized.failureStrategy) ? normalized.failureStrategy : null,
    executionConfig
  };
}

function isSessionExpired(session) {
  return !session?.expiresAt || Number.isNaN(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now();
}

function sessionExpiryForRemember(remember) {
  const durationMs = remember ? 30 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
  return new Date(Date.now() + durationMs).toISOString();
}

function passwordPolicy() {
  return {
    minLength: 8,
    requireUppercase: false,
    requireLowercase: true,
    requireDigit: true
  };
}

function assertPasswordComplexity(password) {
  const value = String(password || "");
  const policy = passwordPolicy();
  if (value.length < policy.minLength) {
    throw new Error(`password must be at least ${policy.minLength} characters`);
  }
  if (policy.requireUppercase && !/[A-Z]/.test(value)) {
    throw new Error("password must include an uppercase letter");
  }
  if (policy.requireLowercase && !/[a-z]/.test(value)) {
    throw new Error("password must include a lowercase letter");
  }
  if (policy.requireDigit && !/\d/.test(value)) {
    throw new Error("password must include a digit");
  }
}

function generateTemporaryPassword() {
  return `Temp#${createId("pw").slice(-8)}Aa1`;
}

function sanitizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    status: user.status,
    mustChangePassword: Boolean(user.mustChangePassword),
    lastLoginAt: user.lastLoginAt ?? null,
    passwordUpdatedAt: user.passwordUpdatedAt ?? null,
    creator: user.creator,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
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

function summarizeRunStep(step) {
  return {
    id: step.id,
    caseId: step.caseId,
    caseName: step.caseName,
    apiName: step.apiName,
    status: step.status,
    message: step.message,
    startedAt: step.startedAt,
    finishedAt: step.finishedAt,
    duration: step.duration
  };
}

function summarizeRun(run) {
  return {
    ...run,
    steps: (run.steps ?? []).map(summarizeRunStep),
    variablesSnapshot: undefined
  };
}

function collectTemplateExpressions(value, output = []) {
  if (typeof value === "string") {
    const matches = value.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g);
    for (const match of matches) {
      output.push(String(match[1] || "").trim());
    }
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectTemplateExpressions(item, output));
    return output;
  }

  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectTemplateExpressions(item, output));
  }

  return output;
}

function parseScopedExpression(expression) {
  const match = String(expression || "").match(/^(vars|env|suite|dataset|builtin)\.([A-Za-z_][\w.]*)$/);
  if (!match) {
    return null;
  }
  return { scope: match[1], name: match[2] };
}

function uniqueValues(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function buildEnvironmentTemplateContext(environment) {
  return {
    env: environment,
    vars: {},
    suite: { variables: {} }
  };
}

function buildEnvironmentRequestHeaders(environment) {
  const context = buildEnvironmentTemplateContext(environment);
  const renderedHeaders = renderTemplate(environment.headers ?? {}, context) ?? {};
  const merged = Object.fromEntries(
    Object.entries(renderedHeaders).flatMap(([key, value]) =>
      key ? [[String(key), value === undefined || value === null ? "" : String(value)]] : []
    )
  );

  if (environment.auth?.type === "bearer" && environment.auth.value) {
    merged.authorization ??= `Bearer ${String(renderTemplate(environment.auth.value, context) ?? "")}`;
  }

  if (environment.auth?.type === "apikey" && environment.auth.header && environment.auth.value) {
    merged[environment.auth.header] ??= String(renderTemplate(environment.auth.value, context) ?? "");
  }

  return merged;
}

function buildEnvironmentProbeTargets(baseUrl) {
  const parsed = new URL(baseUrl);
  const candidates = [];
  const healthUrl = new URL(parsed.toString());
  const path = healthUrl.pathname.endsWith("/health")
    ? healthUrl.pathname
    : `${healthUrl.pathname.replace(/\/$/, "") || ""}/health`;
  healthUrl.pathname = path || "/health";
  healthUrl.search = "";
  healthUrl.hash = "";
  candidates.push(healthUrl.toString());

  const originUrl = new URL(parsed.toString());
  originUrl.hash = "";
  candidates.push(originUrl.toString());
  return uniqueValues(candidates);
}

function buildEnvironmentCheck(key, label, status, message, detail = "") {
  return {
    key,
    label,
    status,
    message,
    detail
  };
}

function summarizeEnvironmentChecks(checks = []) {
  const summary = checks.reduce(
    (acc, check) => {
      acc.total += 1;
      if (check.status === "passed") {
        acc.passed += 1;
      } else if (check.status === "warning") {
        acc.warning += 1;
      } else {
        acc.failed += 1;
      }
      return acc;
    },
    { total: 0, passed: 0, warning: 0, failed: 0 }
  );

  const status = summary.failed ? "failed" : summary.warning ? "warning" : "passed";
  return {
    ...summary,
    status,
    ready: summary.failed === 0
  };
}

function classifyProbeStatus(statusCode) {
  if (statusCode >= 200 && statusCode < 300) {
    return {
      status: "passed",
      category: "reachable",
      message: `服务可达，返回 ${statusCode}`
    };
  }

  if (statusCode === 401 || statusCode === 403) {
    return {
      status: "failed",
      category: "auth",
      message: `服务可达，但鉴权被拒绝（${statusCode}）`
    };
  }

  if (statusCode === 404) {
    return {
      status: "warning",
      category: "missingEndpoint",
      message: `服务可达，但探测地址返回 ${statusCode}`
    };
  }

  return {
    status: "failed",
    category: "server",
    message: `服务返回异常状态 ${statusCode}`
  };
}

function copyRetrySuiteItem(item, index) {
  return {
    id: createId("suite_item"),
    caseId: item.caseId,
    order: index + 1,
    continueOnFailure: Boolean(item.continueOnFailure),
    enabled: item.enabled !== false,
    condition: typeof item.condition === "string" ? item.condition : "",
    timeoutMs:
      item.timeoutMs !== undefined && item.timeoutMs !== null && item.timeoutMs !== "" ? Number(item.timeoutMs) : null
  };
}

function filterVisibleEntities(collection, items = []) {
  if (collection === "suites") {
    return items.filter((item) => !item?.ephemeral);
  }
  return items;
}

function resolveCaseProjectId(storage, caseId) {
  const testCase = storage.find("cases", caseId);
  const api = storage.find("apis", testCase?.apiId);
  const module = storage.find("modules", api?.moduleId);
  const service = storage.find("services", module?.serviceId);
  return service?.projectId || null;
}

export class PlatformService {
  constructor({ storage, runnerClient, scheduler, runQueue }) {
    this.storage = storage;
    this.runnerClient = runnerClient;
    this.scheduler = scheduler;
    this.runQueue = runQueue;
  }

  findActorByContext(context = {}) {
    const requestedToken = normalizeCreator(context.authToken);
    const requestedUserId = normalizeCreator(context.userId);
    const requestedUserName = normalizeCreator(context.userName);
    const users = this.storage.list("users");
    const session = requestedToken ? this.findSessionByToken(requestedToken) : null;

    return (
      (session && users.find((item) => item.id === session.userId)) ||
      (requestedUserId && users.find((item) => item.id === requestedUserId)) ||
      (requestedUserName && users.find((item) => item.name === requestedUserName || item.username === normalizeUsername(requestedUserName))) ||
      null
    );
  }

  findSessionByToken(authToken) {
    const requestedToken = normalizeCreator(authToken);
    if (!requestedToken) {
      return null;
    }

    const session = this.storage.list("sessions").find((item) => item.token === requestedToken) || null;
    if (!session) {
      return null;
    }

    if (isSessionExpired(session)) {
      this.storage.remove("sessions", session.id);
      return null;
    }

    return session;
  }

  findActorByToken(authToken) {
    const session = this.findSessionByToken(authToken);
    if (!session) {
      return null;
    }
    return this.storage.find("users", session.userId);
  }

  createSession(user, { remember = false, sessionType = "login" } = {}) {
    const session = this.storage.create("sessions", {
      id: createId("session"),
      userId: user.id,
      token: createId("token"),
      remember: Boolean(remember),
      sessionType,
      createdAt: nowIso(),
      expiresAt: sessionExpiryForRemember(remember)
    });
    return session;
  }

  resolveActor(context = {}) {
    const settingsName = normalizeCreator(this.storage.getSettings().currentUser) || "系统";
    const requestedUserName = normalizeCreator(context.userName);
    const users = this.storage.list("users");

    const actor =
      this.findActorByContext(context) ||
      users.find((item) => item.name === settingsName) ||
      users.find((item) => item.role === "admin" && item.status === "active");

    if (actor) {
      if (actor.status === "disabled") {
        throw new Error(`user ${actor.name} is disabled`);
      }
      return actor;
    }

    return {
      id: "user_system",
      name: requestedUserName || settingsName,
      role: "admin",
      status: "active"
    };
  }

  requireAuthenticatedActor(context = {}) {
    const actor = this.findActorByToken(context.authToken);
    if (!actor) {
      throw new Error("authentication required");
    }
    if (actor.status === "disabled") {
      throw new Error(`user ${actor.name} is disabled`);
    }
    return actor;
  }

  isAuthenticated(context = {}) {
    return Boolean(this.findActorByToken(context.authToken));
  }

  assertPermission(actor, action, collection = null) {
    if (actor.status === "disabled") {
      throw new Error(`user ${actor.name} is disabled`);
    }

    const role = normalizeRole(actor.role);
    if (role === "admin") {
      return;
    }

    if (collection === "users" || collection === "sessions" || action === "restoreVersion") {
      throw new Error("admin permission required");
    }

    if (action === "read") {
      return;
    }

    if (role === "viewer") {
      throw new Error("viewer cannot modify platform assets");
    }
  }

  assertUserLifecycleAllowed(actor, existingUser, nextUser = existingUser) {
    if (!existingUser) {
      return;
    }
    if (actor?.id === existingUser.id) {
      const roleChanged = existingUser.role === "admin" && nextUser.role !== "admin";
      const disabled = existingUser.status === "active" && nextUser.status !== "active";
      if (roleChanged || disabled) {
        throw new Error("cannot disable or demote the current logged-in admin");
      }
    }

    const removingActiveAdmin =
      existingUser.role === "admin" &&
      existingUser.status === "active" &&
      (nextUser.role !== "admin" || nextUser.status !== "active");

    if (!removingActiveAdmin) {
      return;
    }

    const remainingActiveAdminCount = this.storage
      .list("users")
      .filter((item) => item.id !== existingUser.id && item.role === "admin" && item.status === "active").length;

    if (!remainingActiveAdminCount) {
      throw new Error("at least one active admin must remain");
    }
  }

  createAuditLog({ actor, action, collection = null, entityId = null, entityName = null, detail = null }) {
    const entry = {
      id: createId("audit"),
      action,
      collection,
      entityId,
      entityName,
      actorId: actor?.id ?? "user_system",
      actorName: actor?.name ?? "系统",
      actorRole: actor?.role ?? "admin",
      detail,
      createdAt: nowIso()
    };
    return this.storage.create("auditLogs", entry);
  }

  createVersionEntry({ actor, collection, entityId, action, snapshot, beforeSnapshot = null }) {
    if (!versionedCollections.has(collection) || !snapshot) {
      return null;
    }

    const revision =
      this.storage
        .list("versions")
        .filter((item) => item.collection === collection && item.entityId === entityId)
        .reduce((max, item) => Math.max(max, Number(item.revision || 0)), 0) + 1;

    return this.storage.create("versions", {
      id: createId("version"),
      collection,
      entityId,
      action,
      revision,
      actorId: actor?.id ?? "user_system",
      actorName: actor?.name ?? "系统",
      createdAt: nowIso(),
      snapshot,
      beforeSnapshot
    });
  }

  recordMutation({ actor, action, collection, entityId, entityName, snapshot = null, beforeSnapshot = null, detail = null }) {
    this.createAuditLog({ actor, action, collection, entityId, entityName, detail });
    this.createVersionEntry({ actor, collection, entityId, action, snapshot, beforeSnapshot });
  }

  syncLocalDemoEnvironment(port) {
    const environments = [
      { id: "env_local_demo", baseUrl: `http://localhost:${port}/demo-api` },
      { id: "env_platform_self", baseUrl: `http://localhost:${port}` }
    ];

    for (const target of environments) {
      const environment = this.storage.find("environments", target.id);
      if (!environment || environment.baseUrl === target.baseUrl) {
        continue;
      }
      this.storage.update("environments", environment.id, { baseUrl: target.baseUrl });
    }
  }

  getBootstrap(baseUrl, context = {}) {
    const snapshot = this.storage.getAll();
    const currentUser = this.resolveActor(context);
    const canReadUsers = normalizeRole(currentUser.role) === "admin";
    return {
      ...snapshot,
      users: canReadUsers ? snapshot.users.map(sanitizeUser) : [],
      suites: filterVisibleEntities("suites", snapshot.suites),
      runs: snapshot.runs.map(summarizeRun),
      queue: this.runQueue.snapshotQueue(),
      ciTriggerUrl: `${baseUrl}/api/ci/trigger`,
      reportBaseUrl: `${baseUrl}/report`,
      runner: {
        url: this.runnerClient.baseUrl,
        runtime: "python"
      },
      currentUser: sanitizeUser(currentUser)
    };
  }

  async probeEnvironment(environment, { timeoutMs = 4000 } = {}) {
    const headers = buildEnvironmentRequestHeaders(environment);
    const targets = buildEnvironmentProbeTargets(environment.baseUrl);
    const attempts = [];

    for (const targetUrl of targets) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(targetUrl, {
          method: "GET",
          headers,
          signal: controller.signal
        });
        const snippet = (await response.text().catch(() => "")).trim().slice(0, 180);
        const classified = classifyProbeStatus(response.status);
        const attempt = {
          url: targetUrl,
          status: classified.status,
          category: classified.category,
          statusCode: response.status,
          message: classified.message,
          responseSnippet: snippet
        };
        attempts.push(attempt);
        clearTimeout(timer);

        if (response.status === 404 && targetUrl !== targets[targets.length - 1]) {
          continue;
        }

        return {
          ...attempt,
          attempts,
          usedHeaders: Object.keys(headers)
        };
      } catch (error) {
        clearTimeout(timer);
        const isTimeout = error?.name === "AbortError";
        attempts.push({
          url: targetUrl,
          status: "failed",
          category: isTimeout ? "timeout" : "network",
          statusCode: null,
          message: isTimeout ? "连通性检查超时，请确认服务地址和网络链路" : `请求失败：${error.message}`,
          responseSnippet: ""
        });
      }
    }

    const latest = attempts[attempts.length - 1] || {
      url: environment.baseUrl,
      status: "failed",
      category: "network",
      statusCode: null,
      message: "连通性检查失败",
      responseSnippet: ""
    };

    return {
      ...latest,
      attempts,
      usedHeaders: Object.keys(headers)
    };
  }

  async getEnvironmentDiagnostics(environmentId, context = {}) {
    const actor = this.resolveActor(context);
    this.assertPermission(actor, "read", "environments");
    const environment = this.storage.find("environments", environmentId);
    if (!environment) {
      throw new Error(`environment ${environmentId} not found`);
    }

    const checks = [];
    let parsedBaseUrl = null;

    try {
      parsedBaseUrl = new URL(environment.baseUrl);
      checks.push(buildEnvironmentCheck("baseUrl", "Base URL", "passed", "环境地址格式有效", parsedBaseUrl.toString()));
    } catch {
      checks.push(buildEnvironmentCheck("baseUrl", "Base URL", "failed", "环境地址不是合法 URL", String(environment.baseUrl || "")));
    }

    const headerCount = Object.keys(environment.headers ?? {}).length;
    checks.push(
      buildEnvironmentCheck(
        "headers",
        "公共 Header",
        headerCount ? "passed" : "warning",
        headerCount ? `已配置 ${headerCount} 个公共 Header` : "还没有公共 Header，只有在接口本身带鉴权时才不需要",
        headerCount ? Object.keys(environment.headers ?? {}).join(", ") : ""
      )
    );

    const authType = environment.auth?.type || "none";
    const authValue = String(environment.auth?.value || "");
    const authReady =
      authType === "none" || (authType === "bearer" && authValue.trim()) || (authType === "apikey" && authValue.trim() && environment.auth?.header);
    checks.push(
      buildEnvironmentCheck(
        "auth",
        "鉴权配置",
        authReady ? (authType === "none" ? "warning" : "passed") : "failed",
        authReady
          ? authType === "none"
            ? "当前环境未配置公共鉴权，请确认目标接口是否真的无需认证"
            : `已配置 ${authType === "bearer" ? "Bearer Token" : "API Key"}`
          : "鉴权已开启，但必要字段没有填完整",
        authType === "apikey" ? environment.auth?.header || "" : authType
      )
    );

    const envVariableNames = Object.keys(environment.variables ?? {});
    const environmentExpressions = uniqueValues([
      ...collectTemplateExpressions(environment.headers),
      ...collectTemplateExpressions(environment.auth?.value)
    ]);
    const missingEnvVariables = uniqueValues(
      environmentExpressions
        .map(parseScopedExpression)
        .filter((entry) => entry?.scope === "env" && entry.name.startsWith("variables."))
        .map((entry) => entry.name.replace(/^variables\./, ""))
        .filter((name) => !envVariableNames.includes(name))
    );
    checks.push(
      buildEnvironmentCheck(
        "variables",
        "环境变量",
        missingEnvVariables.length ? "failed" : envVariableNames.length ? "passed" : "warning",
        missingEnvVariables.length
          ? `检测到 ${missingEnvVariables.length} 个变量已被引用，但当前环境未提供`
          : envVariableNames.length
            ? `已配置 ${envVariableNames.length} 个环境变量`
            : "当前环境没有变量；如果接口模板里引用了 env.variables.xxx，执行时会直接缺值",
        missingEnvVariables.join(", ")
      )
    );

    try {
      await this.runnerClient.health();
      checks.push(buildEnvironmentCheck("runner", "执行器", "passed", "执行器可用，可以直接发起自动化运行", this.runnerClient.baseUrl));
    } catch (error) {
      checks.push(buildEnvironmentCheck("runner", "执行器", "failed", "执行器不可用，环境配置正确也无法真正执行", error.message));
    }

    const probe =
      parsedBaseUrl
        ? await this.probeEnvironment(environment)
        : {
            url: environment.baseUrl,
            status: "failed",
            category: "invalidUrl",
            statusCode: null,
            message: "Base URL 非法，无法做连通性检查",
            responseSnippet: "",
            attempts: [],
            usedHeaders: Object.keys(buildEnvironmentRequestHeaders(environment))
          };

    checks.push(
      buildEnvironmentCheck(
        "probe",
        "连通性体检",
        probe.status,
        probe.message,
        probe.url
      )
    );

    return {
      environmentId: environment.id,
      checkedAt: nowIso(),
      summary: summarizeEnvironmentChecks(checks),
      checks,
      renderedHeaders: buildEnvironmentRequestHeaders(environment),
      missingEnvVariables,
      probe
    };
  }

  async runEnvironmentAuthSmoke(environmentId, context = {}) {
    const actor = this.resolveActor(context);
    this.assertPermission(actor, "read", "environments");
    const environment = this.storage.find("environments", environmentId);
    if (!environment) {
      throw new Error(`environment ${environmentId} not found`);
    }

    let probe;
    try {
      new URL(environment.baseUrl);
      probe = await this.probeEnvironment(environment);
    } catch {
      probe = {
        url: environment.baseUrl,
        status: "failed",
        category: "invalidUrl",
        statusCode: null,
        message: "Base URL 非法，无法做鉴权试跑",
        responseSnippet: "",
        attempts: [],
        usedHeaders: Object.keys(buildEnvironmentRequestHeaders(environment))
      };
    }

    const suggestion =
      probe.status === "passed"
        ? "鉴权头已经随请求带出，环境至少具备基础可连通性。下一步建议直接跑一条真实用例。"
        : probe.category === "auth"
          ? "服务本身可达，但当前 Token 或 API Key 很可能不对。优先检查环境鉴权值是否过期。"
          : probe.category === "missingEndpoint"
            ? "鉴权头已发出，但默认探测地址不存在。可以继续执行真实接口，或为该服务补一个健康检查地址。"
            : "当前环境还没有通过最基础的探测。先修地址、网络或鉴权，再做自动化执行。";

    return {
      environmentId: environment.id,
      checkedAt: nowIso(),
      authType: environment.auth?.type || "none",
      status: probe.status,
      message: probe.message,
      suggestion,
      targetUrl: probe.url,
      statusCode: probe.statusCode,
      usedHeaders: probe.usedHeaders,
      attempts: probe.attempts,
      responseSnippet: probe.responseSnippet
    };
  }

  listCollection(collection, context = {}) {
    this.assertPermission(this.resolveActor(context), "read", collection);
    const items = filterVisibleEntities(collection, this.storage.list(collection));
    return collection === "users" ? items.map(sanitizeUser) : items;
  }

  getCollectionEntity(collection, id, context = {}) {
    this.assertPermission(this.resolveActor(context), "read", collection);
    const entity = this.storage.find(collection, id);
    return collection === "users" ? sanitizeUser(entity) : entity;
  }

  validateCollectionPayload(collection, entity) {
    if (immutableCollections.has(collection)) {
      throw new Error(`${collection} is managed by the platform runtime`);
    }

    const reference = parentReferences[collection];
    if (reference && entity[reference.field]) {
      assertEntityExists(this.storage, reference.collection, entity[reference.field], reference.field);
    }

    if (collection === "users") {
      if (!entity.name) {
        throw new Error("user.name is required");
      }
      if (!entity.username) {
        throw new Error("user.username is required");
      }
      if (!entity.password) {
        throw new Error("user.password is required");
      }
      if (!["admin", "editor", "viewer"].includes(entity.role)) {
        throw new Error("user.role must be admin, editor or viewer");
      }
      if (!["active", "disabled"].includes(entity.status)) {
        throw new Error("user.status must be active or disabled");
      }
      const existing = entity.id ? this.storage.find("users", entity.id) : null;
      if (!existing || existing.password !== entity.password) {
        assertPasswordComplexity(entity.password);
      }
      const conflict = this.storage
        .list("users")
        .find((item) => item.id !== entity.id && normalizeUsername(item.username) === normalizeUsername(entity.username));
      if (conflict) {
        throw new Error(`user.username ${entity.username} already exists`);
      }
    }

    if (collection === "datasets") {
      if (!entity.name) {
        throw new Error("dataset.name is required");
      }
      if (entity.scope && !["suite", "global"].includes(entity.scope)) {
        throw new Error("dataset.scope must be suite or global");
      }
    }

    if (collection === "environments" && !entity.baseUrl) {
      throw new Error("baseUrl is required");
    }

    if (collection === "apis" && entity.status && !["active", "deprecated"].includes(entity.status)) {
      throw new Error("api.status must be active or deprecated");
    }

    if (collection === "cases" && entity.priority && !["high", "medium", "low"].includes(entity.priority)) {
      throw new Error("case.priority must be high, medium or low");
    }

    if (collection === "suites") {
      assertSuiteItems(this.storage, entity.items);
      assertNoSuiteCycles(this.storage, entity.id, entity.items ?? []);
      for (const item of entity.items ?? []) {
        if (item?.condition !== undefined && item?.condition !== null && typeof item.condition !== "string") {
          throw new Error("suite item condition must be a string");
        }
        if (item?.parallelGroup !== undefined && item?.parallelGroup !== null && typeof item.parallelGroup !== "string") {
          throw new Error("suite item parallelGroup must be a string");
        }
        if (item?.role !== undefined && item?.role !== null && !["setup", "test", "teardown"].includes(item.role)) {
          throw new Error("suite item role must be setup, test or teardown");
        }
      }

      if (entity.defaultEnvironmentId) {
        assertEntityExists(this.storage, "environments", entity.defaultEnvironmentId, "defaultEnvironmentId");
      }

      if (entity.datasetId) {
        assertEntityExists(this.storage, "datasets", entity.datasetId, "datasetId");
      }

      if (entity.timeoutSeconds !== undefined && entity.timeoutSeconds !== null && entity.timeoutSeconds !== "") {
        assertPositiveNumber(entity.timeoutSeconds, "timeoutSeconds");
      }

      if (entity.failureStrategy && !["stop", "continue"].includes(entity.failureStrategy)) {
        throw new Error("failureStrategy must be stop or continue");
      }

      if (entity.schedule?.enabled) {
        assertPositiveNumber(entity.schedule.intervalMinutes, "schedule.intervalMinutes");
      }

      if (entity.executionConfig) {
        if (entity.executionConfig.priority && !["high", "normal", "low"].includes(entity.executionConfig.priority)) {
          throw new Error("executionConfig.priority must be high, normal or low");
        }
        if (entity.executionConfig.maxRetries !== undefined) {
          assertNonNegativeInteger(entity.executionConfig.maxRetries, "executionConfig.maxRetries");
        }
      }
    }
  }

  createCollectionEntity(collection, payload, context = {}) {
    const actor = this.resolveActor(context);
    this.assertPermission(actor, "create", collection);
    const entity = {
      id: payload.id || createId(collectionPrefixes[collection] || collection.slice(0, -1)),
      createdAt: payload.createdAt || nowIso(),
      creator: normalizeCreator(payload.creator) || actor.name,
      ...payload
    };

    if (collection === "users") {
      entity.username = normalizeUsername(entity.username || entity.name || entity.id);
      entity.password ||= generateTemporaryPassword();
      entity.authToken ||= `token_${entity.username}_flowforge`;
      entity.role = normalizeRole(entity.role);
      entity.status = normalizeStatus(entity.status);
      entity.mustChangePassword = payload.mustChangePassword !== false;
      entity.passwordUpdatedAt = nowIso();
      entity.lastLoginAt = null;
    }

    if (collection === "apis") {
      entity.status ||= "active";
    }

    if (collection === "cases") {
      entity.priority ||= inferCasePriority(entity.tags ?? []);
    }

    if (collection === "datasets") {
      entity.scope ||= "suite";
      entity.tags ||= [];
      entity.rows = normalizeDatasetRows(entity.rows);
    }

    if (collection === "suites") {
      entity.executionConfig = normalizeExecutionConfig(entity.executionConfig);
    }

    this.validateCollectionPayload(collection, entity);
    const created = this.storage.create(collection, entity);
    this.recordMutation({
      actor,
      action: "create",
      collection,
      entityId: created.id,
      entityName: created.name ?? created.id,
      snapshot: created
    });
    if (collection === "suites") {
      this.scheduler.refresh();
    }
    return collection === "users" ? sanitizeUser(created) : created;
  }

  updateCollectionEntity(collection, id, patch, context = {}) {
    const actor = this.resolveActor(context);
    this.assertPermission(actor, "update", collection);
    const existing = this.storage.find(collection, id);
    if (!existing) {
      return null;
    }

    const next = {
      ...existing,
      ...patch
    };
    if (collection === "users") {
      this.assertUserLifecycleAllowed(actor, existing, next);
      next.username = normalizeUsername(next.username || next.name || next.id);
      const incomingPassword = typeof patch.password === "string" && patch.password.trim() ? patch.password : null;
      next.password = incomingPassword || existing.password;
      next.authToken ||= existing.authToken || `token_${next.username}_flowforge`;
      next.role = normalizeRole(next.role);
      next.status = normalizeStatus(next.status);
      next.mustChangePassword =
        patch.mustChangePassword !== undefined ? patch.mustChangePassword === true || patch.mustChangePassword === "true" : existing.mustChangePassword === true;
      next.passwordUpdatedAt = incomingPassword && incomingPassword !== existing.password ? nowIso() : existing.passwordUpdatedAt ?? existing.updatedAt ?? existing.createdAt ?? nowIso();
      next.lastLoginAt = existing.lastLoginAt ?? null;
    }
    if (collection === "datasets") {
      next.rows = normalizeDatasetRows(next.rows);
    }
    if (collection === "suites") {
      next.executionConfig = normalizeExecutionConfig(next.executionConfig);
    }
    this.validateCollectionPayload(collection, next);
    const updated = this.storage.update(collection, id, next);
    this.recordMutation({
      actor,
      action: "update",
      collection,
      entityId: updated.id,
      entityName: updated.name ?? updated.id,
      snapshot: updated,
      beforeSnapshot: existing
    });
    if (collection === "users" && updated.status === "disabled") {
      this.storage
        .list("sessions")
        .filter((session) => session.userId === updated.id && session.sessionType === "login")
        .forEach((session) => {
          this.storage.remove("sessions", session.id);
        });
    }
    if (collection === "suites") {
      this.scheduler.refresh();
    }
    return collection === "users" ? sanitizeUser(updated) : updated;
  }

  removeCollectionEntity(collection, id, context = {}) {
    const actor = this.resolveActor(context);
    this.assertPermission(actor, "delete", collection);
    const existing = this.storage.find(collection, id);
    if (!existing) {
      return false;
    }
    if (collection === "users") {
      this.assertUserLifecycleAllowed(actor, existing, { ...existing, status: "disabled", role: "viewer" });
    }
    assertDeleteAllowed(this.storage, collection, id);
    const removed = this.storage.remove(collection, id);
    if (removed) {
      this.recordMutation({
        actor,
        action: "delete",
        collection,
        entityId: existing.id,
        entityName: existing.name ?? existing.id,
        snapshot: existing
      });
    }
    if (removed && collection === "suites") {
      this.scheduler.refresh();
    }
    return removed;
  }

  revokeUserSessions(userId, context = {}) {
    const actor = this.resolveActor(context);
    this.assertPermission(actor, "update", "users");
    const user = this.storage.find("users", userId);
    if (!user) {
      throw new Error(`user ${userId} not found`);
    }

    const revokedSessions = this.storage
      .list("sessions")
      .filter((session) => session.userId === userId && session.sessionType === "login");

    revokedSessions.forEach((session) => {
      this.storage.remove("sessions", session.id);
    });

    this.createAuditLog({
      actor,
      action: "revokeSessions",
      collection: "users",
      entityId: user.id,
      entityName: user.name,
      detail: { revokedCount: revokedSessions.length }
    });

    return {
      success: true,
      revokedCount: revokedSessions.length
    };
  }

  resetUserPassword(userId, context = {}) {
    const actor = this.resolveActor(context);
    this.assertPermission(actor, "update", "users");
    const existing = this.storage.find("users", userId);
    if (!existing) {
      throw new Error(`user ${userId} not found`);
    }

    const temporaryPassword = generateTemporaryPassword();
    const updated = this.storage.update("users", userId, {
      ...existing,
      password: temporaryPassword,
      mustChangePassword: true,
      passwordUpdatedAt: nowIso()
    });

    this.storage
      .list("sessions")
      .filter((session) => session.userId === userId && session.sessionType === "login")
      .forEach((session) => {
        this.storage.remove("sessions", session.id);
      });

    this.createAuditLog({
      actor,
      action: "resetPassword",
      collection: "users",
      entityId: updated.id,
      entityName: updated.name
    });

    return {
      user: sanitizeUser(updated),
      temporaryPassword
    };
  }

  removeCollectionEntities(collection, ids = [], context = {}) {
    const uniqueIds = [...new Set((ids ?? []).filter(Boolean))];
    if (!uniqueIds.length) {
      throw new Error("ids is required");
    }

    const deletedIds = [];
    const failed = [];

    for (const id of uniqueIds) {
      try {
        const removed = this.removeCollectionEntity(collection, id, context);
        if (!removed) {
          failed.push({ id, error: `${collection.slice(0, -1)} ${id} not found` });
          continue;
        }
        deletedIds.push(id);
      } catch (error) {
        failed.push({ id, error: error.message });
      }
    }

    return {
      deletedIds,
      deletedCount: deletedIds.length,
      failed,
      failedCount: failed.length
    };
  }

  importOpenApi(spec, moduleId, context = {}) {
    const actor = this.resolveActor(context);
    this.assertPermission(actor, "import", "apis");
    if (moduleId) {
      assertEntityExists(this.storage, "modules", moduleId, "moduleId");
    }
    const imported = importOpenApiSpec(spec, moduleId);
    imported.apis.forEach((api) => {
      const created = this.storage.create("apis", {
        ...api,
        creator: api.creator || actor.name,
        status: api.status || "active"
      });
      this.recordMutation({
        actor,
        action: "import",
        collection: "apis",
        entityId: created.id,
        entityName: created.name,
        snapshot: created
      });
    });
    imported.cases.forEach((testCase) => {
      const created = this.storage.create("cases", {
        ...testCase,
        creator: testCase.creator || actor.name,
        priority: testCase.priority || inferCasePriority(testCase.tags ?? [])
      });
      this.recordMutation({
        actor,
        action: "import",
        collection: "cases",
        entityId: created.id,
        entityName: created.name,
        snapshot: created
      });
    });
    return imported;
  }

  cloneCollectionEntity(collection, id, context = {}) {
    const actor = this.resolveActor(context);
    this.assertPermission(actor, "clone", collection);
    const existing = this.storage.find(collection, id);
    if (!existing) {
      return null;
    }

    const clone = {
      ...existing,
      id: createId(collectionPrefixes[collection] || collection.slice(0, -1)),
      createdAt: nowIso(),
      updatedAt: undefined,
      creator: actor.name
    };

    if (typeof existing.name === "string" && existing.name.trim()) {
      clone.name = `${existing.name} 副本`;
    }

    if (collection === "suites") {
      clone.items = (existing.items ?? []).map((item) => ({
        ...item,
        id: createId("suite_item")
      }));
    }

    this.validateCollectionPayload(collection, clone);
    const created = this.storage.create(collection, clone);
    this.recordMutation({
      actor,
      action: "clone",
      collection,
      entityId: created.id,
      entityName: created.name ?? created.id,
      snapshot: created,
      detail: { clonedFromId: existing.id }
    });
    if (collection === "suites") {
      this.scheduler.refresh();
    }
    return collection === "users" ? sanitizeUser(created) : created;
  }

  cloneCollectionEntities(collection, ids = [], context = {}) {
    const uniqueIds = [...new Set((ids ?? []).filter(Boolean))];
    if (!uniqueIds.length) {
      throw new Error("ids is required");
    }

    return uniqueIds.map((id) => {
      const created = this.cloneCollectionEntity(collection, id, context);
      if (!created) {
        throw new Error(`${collection.slice(0, -1)} ${id} not found`);
      }
      return created;
    });
  }

  listRuns(context = {}) {
    this.assertPermission(this.resolveActor(context), "read", "runs");
    return this.storage.list("runs").map(summarizeRun);
  }

  getSchedulerCenter(context = {}) {
    const actor = this.resolveActor(context);
    this.assertPermission(actor, "read", "suites");
    this.assertPermission(actor, "read", "runs");

    const scheduleState = this.scheduler.describe();
    const runtimeMap = new Map((scheduleState.schedules ?? []).map((item) => [item.suiteId, item]));
    const projectMap = new Map(this.storage.list("projects").map((item) => [item.id, item]));
    const environmentMap = new Map(this.storage.list("environments").map((item) => [item.id, item]));
    const datasetMap = new Map(this.storage.list("datasets").map((item) => [item.id, item]));
    const latestRunMap = new Map();
    const latestScheduledRunMap = new Map();

    this.storage.list("runs").forEach((run) => {
      if (!latestRunMap.has(run.suiteId)) {
        latestRunMap.set(run.suiteId, summarizeRun(run));
      }
      if (run.trigger === "schedule" && !latestScheduledRunMap.has(run.suiteId)) {
        latestScheduledRunMap.set(run.suiteId, summarizeRun(run));
      }
    });

    const schedules = filterVisibleEntities("suites", this.storage.list("suites"))
      .map((suite) => {
        const runtime = runtimeMap.get(suite.id);
        const environment =
          (suite.defaultEnvironmentId && environmentMap.get(suite.defaultEnvironmentId)) ||
          environmentMap.values().next().value ||
          null;
        const latestRun = latestScheduledRunMap.get(suite.id) || latestRunMap.get(suite.id) || null;
        const status = runtime?.status || (suite.schedule?.enabled ? "invalid" : "paused");

        return {
          suiteId: suite.id,
          suiteName: suite.name,
          projectId: suite.projectId,
          projectName: projectMap.get(suite.projectId)?.name || "未归档项目",
          environmentId: environment?.id || null,
          environmentName: environment?.name || "未配置环境",
          datasetId: suite.datasetId || null,
          datasetName: suite.datasetId ? datasetMap.get(suite.datasetId)?.name || "已删除数据集" : "不使用",
          enabled: Boolean(suite.schedule?.enabled),
          intervalMinutes: Number(suite.schedule?.intervalMinutes || 0) || 0,
          timeoutSeconds: Number(suite.timeoutSeconds || 300),
          failureStrategy: suite.failureStrategy || (suite.continueOnFailure ? "continue" : "stop"),
          status,
          nextTriggerAt: runtime?.nextTriggerAt || null,
          lastTriggeredAt: runtime?.lastTriggeredAt || latestRun?.queuedAt || null,
          lastError: runtime?.lastError || null,
          latestRun
        };
      })
      .sort((left, right) => {
        if (left.enabled !== right.enabled) {
          return left.enabled ? -1 : 1;
        }
        return left.suiteName.localeCompare(right.suiteName, "zh-CN");
      });

    const summary = {
      totalSuites: schedules.length,
      enabledCount: schedules.filter((item) => item.enabled).length,
      pausedCount: schedules.filter((item) => !item.enabled).length,
      invalidCount: schedules.filter((item) => item.status === "invalid").length,
      dueSoonCount: schedules.filter((item) => {
        if (!item.nextTriggerAt) {
          return false;
        }
        const nextAt = Date.parse(item.nextTriggerAt);
        return Number.isFinite(nextAt) && nextAt - Date.now() <= 10 * 60 * 1000;
      }).length,
      queueQueued: this.runQueue.snapshotQueue().queued,
      queueRunning: this.runQueue.snapshotQueue().running
    };

    return {
      refreshedAt: scheduleState.refreshedAt,
      summary,
      schedules
    };
  }

  getRun(id, context = {}) {
    this.assertPermission(this.resolveActor(context), "read", "runs");
    return this.storage.find("runs", id);
  }

  cancelRun(id, context = {}) {
    const actor = this.resolveActor(context);
    this.assertPermission(actor, "cancel", "runs");
    const run = this.runQueue.cancelRun(id);
    if (run) {
      this.createAuditLog({ actor, action: "cancelRun", collection: "runs", entityId: run.id, entityName: run.suiteName });
    }
    return run;
  }

  retryRun(id, context = {}) {
    const actor = this.resolveActor(context);
    this.assertPermission(actor, "retry", "runs");
    const run = this.runQueue.retryRun(id);
    if (run) {
      this.createAuditLog({ actor, action: "retryRun", collection: "runs", entityId: run.id, entityName: run.suiteName, detail: { sourceRunId: id } });
    }
    return run;
  }

  retryFailedRun(id, context = {}) {
    const actor = this.resolveActor(context);
    this.assertPermission(actor, "retry", "runs");
    const sourceRun = this.storage.find("runs", id);
    if (!sourceRun) {
      return null;
    }

    const failedSteps = (sourceRun.steps ?? []).filter((step) => step?.status === "failed" && step.caseId && step.caseId !== "scenario");
    const failedCaseIds = [...new Set(failedSteps.map((step) => step.caseId))];
    if (!failedCaseIds.length) {
      throw new Error(`run ${id} has no failed steps`);
    }

    const sourceSuite = this.storage.find("suites", sourceRun.suiteId);
    const mergedFailureStrategy =
      sourceRun.executionOverrides?.failureStrategy || sourceSuite?.failureStrategy || (sourceSuite?.continueOnFailure ? "continue" : "stop");
    const mergedExecutionConfig = normalizeExecutionConfig({
      ...(sourceSuite?.executionConfig || {}),
      ...(sourceRun.executionOverrides?.executionConfig || {}),
      priority: sourceRun.queueMeta?.priority || sourceSuite?.executionConfig?.priority || "normal"
    });
    const mergedTimeoutSeconds = Number(sourceRun.executionOverrides?.timeoutSeconds || sourceSuite?.timeoutSeconds || 300);
    const projectId =
      sourceSuite?.projectId ||
      failedCaseIds.map((caseId) => resolveCaseProjectId(this.storage, caseId)).find(Boolean) ||
      this.storage.list("projects")[0]?.id ||
      null;

    if (!projectId) {
      throw new Error("no project available for failed-step retry");
    }

    const retryItems = sourceSuite
      ? sourceSuite.items
          .filter((item) => failedCaseIds.includes(item.caseId))
          .map((item, index) => copyRetrySuiteItem(item, index))
      : failedCaseIds.map((caseId, index) =>
          copyRetrySuiteItem(
            {
              caseId,
              continueOnFailure: false,
              enabled: true,
              condition: "",
              timeoutMs: null
            },
            index
          )
        );

    const retrySuite = this.storage.create("suites", {
      id: createId("suite"),
      projectId,
      name: `${sourceRun.suiteName} · 失败步骤重跑`,
      description: `根据运行 ${sourceRun.id} 生成的失败步骤重跑任务`,
      creator: actor.name,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      tags: [...new Set([...(sourceSuite?.tags || []), "retry", "failed-steps", "ephemeral"])],
      variables: sourceSuite?.variables || {},
      items: retryItems,
      scenarioAssertions: sourceSuite?.scenarioAssertions || [],
      schedule: {
        enabled: false,
        intervalMinutes: sourceSuite?.schedule?.intervalMinutes || 30
      },
      defaultEnvironmentId: sourceRun.environmentId,
      timeoutSeconds: mergedTimeoutSeconds,
      failureStrategy: mergedFailureStrategy,
      continueOnFailure: mergedFailureStrategy === "continue",
      datasetId: sourceSuite?.datasetId || null,
      executionConfig: mergedExecutionConfig,
      ephemeral: true
    });

    const retryRun = this.runQueue.enqueueRun({
      suiteId: retrySuite.id,
      environmentId: sourceRun.environmentId,
      trigger: "retry-failed",
      retriedFromRunId: sourceRun.id,
      runFields: {
        priority: mergedExecutionConfig.priority,
        requestedBy: actor.name,
        requestedById: actor.id,
        sourceType: "retry-failed-steps"
      }
    });

    this.createAuditLog({
      actor,
      action: "retryFailedRun",
      collection: "runs",
      entityId: retryRun.id,
      entityName: retryRun.suiteName,
      detail: { sourceRunId: id, failedCaseIds }
    });
    return retryRun;
  }

  async triggerRun(suiteId, environmentId, trigger = "manual", context = {}, options = {}) {
    const actor = this.resolveActor(context);
    this.assertPermission(actor, "trigger", "runs");
    assertEntityExists(this.storage, "suites", suiteId, "suiteId");
    const suite = this.storage.find("suites", suiteId);
    const runOptions = normalizeRunOptions(options);
    if (runOptions.timeoutSeconds !== null) {
      assertPositiveNumber(runOptions.timeoutSeconds, "timeoutSeconds");
    }
    const resolvedEnvironmentId =
      runOptions.environmentId || environmentId || suite?.defaultEnvironmentId || this.storage.list("environments")[0]?.id;

    assertEntityExists(this.storage, "environments", resolvedEnvironmentId, "environmentId");
    const run = this.runQueue.enqueueRun({
      suiteId,
      environmentId: resolvedEnvironmentId,
      trigger,
      runFields: {
        ...(runOptions.executionConfig.priority ? { priority: runOptions.executionConfig.priority } : {}),
        executionOverrides: {
          ...(runOptions.timeoutSeconds !== null ? { timeoutSeconds: runOptions.timeoutSeconds } : {}),
          ...(runOptions.failureStrategy ? { failureStrategy: runOptions.failureStrategy } : {}),
          ...(Object.keys(runOptions.executionConfig).length ? { executionConfig: runOptions.executionConfig } : {})
        },
        requestedBy: actor.name,
        requestedById: actor.id
      }
    });
    this.createAuditLog({ actor, action: "triggerRun", collection: "runs", entityId: run.id, entityName: suite.name });
    return run;
  }

  async triggerBatchCaseRun(caseIds = [], { projectId = null, environmentId = null, trigger = "manual", context = {}, options = {} } = {}) {
    const actor = this.resolveActor(context);
    this.assertPermission(actor, "trigger", "runs");
    const uniqueCaseIds = [...new Set((caseIds ?? []).filter(Boolean))];
    if (!uniqueCaseIds.length) {
      throw new Error("caseIds is required");
    }

    uniqueCaseIds.forEach((caseId) => assertEntityExists(this.storage, "cases", caseId, "caseId"));

    const resolvedProjectId =
      projectId ||
      uniqueCaseIds.map((caseId) => resolveCaseProjectId(this.storage, caseId)).find(Boolean) ||
      this.storage.list("projects")[0]?.id;
    const runOptions = normalizeRunOptions(options);
    if (runOptions.timeoutSeconds !== null) {
      assertPositiveNumber(runOptions.timeoutSeconds, "timeoutSeconds");
    }
    const resolvedEnvironmentId = runOptions.environmentId || environmentId || this.storage.list("environments")[0]?.id;

    assertEntityExists(this.storage, "projects", resolvedProjectId, "projectId");
    assertEntityExists(this.storage, "environments", resolvedEnvironmentId, "environmentId");

    const suite = this.storage.create("suites", {
      id: createId("suite"),
      projectId: resolvedProjectId,
      name: `批量执行 ${uniqueCaseIds.length} 条用例`,
      description: "临时批量执行场景",
      creator: actor.name,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      tags: ["batch", "ephemeral"],
      variables: {},
      items: uniqueCaseIds.map((caseId, index) => ({
        id: createId("suite_item"),
        caseId,
        order: index + 1,
        continueOnFailure: false
      })),
      scenarioAssertions: [],
      schedule: {
        enabled: false,
        intervalMinutes: 30
      },
      defaultEnvironmentId: resolvedEnvironmentId,
      timeoutSeconds: runOptions.timeoutSeconds || 300,
      failureStrategy: runOptions.failureStrategy || "stop",
      continueOnFailure: (runOptions.failureStrategy || "stop") === "continue",
      executionConfig: Object.keys(runOptions.executionConfig).length ? normalizeExecutionConfig(runOptions.executionConfig) : normalizeExecutionConfig({}),
      ephemeral: true
    });

    const run = this.runQueue.enqueueRun({
      suiteId: suite.id,
      environmentId: resolvedEnvironmentId,
      trigger,
      runFields: {
        ...(runOptions.executionConfig.priority ? { priority: runOptions.executionConfig.priority } : {}),
        executionOverrides: {
          ...(runOptions.timeoutSeconds !== null ? { timeoutSeconds: runOptions.timeoutSeconds } : {}),
          ...(runOptions.failureStrategy ? { failureStrategy: runOptions.failureStrategy } : {}),
          ...(Object.keys(runOptions.executionConfig).length ? { executionConfig: runOptions.executionConfig } : {})
        },
        sourceType: "batch-cases",
        batchCaseIds: uniqueCaseIds,
        requestedBy: actor.name,
        requestedById: actor.id
      }
    });
    this.createAuditLog({ actor, action: "triggerBatchRun", collection: "runs", entityId: run.id, entityName: suite.name });
    return run;
  }

  async triggerCi(token, payload) {
    if (token !== this.storage.getAll().settings.ciToken) {
      throw new Error("invalid ci token");
    }
    return this.triggerRun(payload.suiteId, payload.environmentId, "pipeline", {
      userName: "CI Pipeline"
    });
  }

  refreshScheduler(context = {}) {
    const actor = this.resolveActor(context);
    this.assertPermission(actor, "update", "suites");
    this.scheduler.refresh();
    this.createAuditLog({
      actor,
      action: "refreshScheduler",
      collection: "suites",
      entityId: "scheduler",
      entityName: "定时调度中心"
    });
    return this.getSchedulerCenter(context);
  }

  login({ username, password, remember = false }) {
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername || !password) {
      throw new Error("username and password are required");
    }

    const user = this.storage
      .list("users")
      .find((item) => normalizeUsername(item.username) === normalizedUsername || normalizeUsername(item.name) === normalizedUsername);

    if (!user || user.password !== password) {
      throw new Error("invalid username or password");
    }
    if (user.status !== "active") {
      throw new Error(`user ${user.name} is disabled`);
    }

    this.createAuditLog({
      actor: user,
      action: "login",
      collection: "users",
      entityId: user.id,
      entityName: user.name
    });

    const updatedUser = this.storage.update("users", user.id, {
      ...user,
      lastLoginAt: nowIso()
    });
    const session = this.createSession(updatedUser, { remember, sessionType: "login" });

    return {
      token: session.token,
      user: sanitizeUser(updatedUser),
      remember: session.remember,
      expiresAt: session.expiresAt
    };
  }

  getAuthenticatedProfile(context = {}) {
    const actor = this.requireAuthenticatedActor(context);
    const session = this.findSessionByToken(context.authToken);
    return {
      token: session?.token || context.authToken,
      user: sanitizeUser(actor),
      remember: session?.remember ?? true,
      expiresAt: session?.expiresAt ?? null
    };
  }

  logout(context = {}) {
    const actor = this.requireAuthenticatedActor(context);
    const session = this.findSessionByToken(context.authToken);
    if (session) {
      this.storage.remove("sessions", session.id);
    }
    this.createAuditLog({
      actor,
      action: "logout",
      collection: "users",
      entityId: actor.id,
      entityName: actor.name
    });
    return { success: true };
  }

  changePassword({ currentPassword, nextPassword }, context = {}) {
    const actor = this.requireAuthenticatedActor(context);
    const currentSession = this.findSessionByToken(context.authToken);
    const current = String(currentPassword || "");
    const next = String(nextPassword || "");

    if (!current || !next) {
      throw new Error("currentPassword and nextPassword are required");
    }
    if (actor.password !== current) {
      throw new Error("current password is incorrect");
    }
    if (next === current) {
      throw new Error("new password must be different from current password");
    }
    assertPasswordComplexity(next);

    const updated = this.storage.update("users", actor.id, {
      ...actor,
      password: next,
      mustChangePassword: false,
      passwordUpdatedAt: nowIso()
    });

    this.createAuditLog({
      actor: updated,
      action: "changePassword",
      collection: "users",
      entityId: updated.id,
      entityName: updated.name
    });

    this.storage
      .list("sessions")
      .filter(
        (session) =>
          session.userId === updated.id &&
          session.sessionType === "login" &&
          session.token !== currentSession?.token
      )
      .forEach((session) => {
        this.storage.remove("sessions", session.id);
      });

    return {
      success: true,
      user: sanitizeUser(updated)
    };
  }

  seedPlatformSamples(payload = {}, context = {}) {
    const actor = this.resolveActor(context);
    this.assertPermission(actor, "create", "users");

    const wantsUsers = payload.users !== false;
    const wantsDatasets = payload.datasets !== false;
    const wantsSuites = payload.suites !== false;

    const created = [];
    const skipped = [];

    const ensureEntity = (collection, entity) => {
      const exists = this.storage.find(collection, entity.id);
      if (exists) {
        skipped.push({ collection, id: entity.id, reason: "already exists" });
        return exists;
      }
      const item = this.createCollectionEntity(collection, entity, { userId: actor.id });
      created.push({ collection, id: item.id, name: item.name ?? item.id });
      return item;
    };

    if (wantsUsers) {
      ensureEntity("users", {
        id: "user_editor",
        name: "测试开发",
        username: "editor",
        password: "editor123",
        authToken: "token_editor_flowforge",
        role: "editor",
        status: "active"
      });
      ensureEntity("users", {
        id: "user_viewer",
        name: "业务只读",
        username: "viewer",
        password: "viewer123",
        authToken: "token_viewer_flowforge",
        role: "viewer",
        status: "active"
      });
    }

    let dataset = null;
    if (wantsDatasets) {
      dataset = ensureEntity("datasets", {
        id: "dataset_platform_report_ranges",
        name: "报告时间窗数据集",
        description: "用于数据驱动执行示例。",
        scope: "suite",
        tags: ["platform", "dataset", "seed"],
        rows: [
          { id: "row_today", name: "今日视图", variables: { reportRange: "today" } },
          { id: "row_7d", name: "近 7 天", variables: { reportRange: "7d" } }
        ]
      });
    }

    if (wantsSuites) {
      const projectId = this.storage.list("projects")[0]?.id;
      if (!projectId) {
        skipped.push({ collection: "suites", id: "suite_platform_dataset_report", reason: "no project found" });
      } else {
        const environmentId =
          this.storage.find("environments", "env_platform_self")?.id || this.storage.list("environments")[0]?.id || null;

        const bootstrapCase = this.storage.find("cases", "case_platform_bootstrap") || this.storage.list("cases")[0] || null;
        const reportCase =
          this.storage.find("cases", "case_platform_report_summary") || this.storage.list("cases")[1] || this.storage.list("cases")[0] || null;

        if (!environmentId || !bootstrapCase || !reportCase) {
          skipped.push({ collection: "suites", id: "suite_platform_dataset_report", reason: "missing env/cases" });
        } else {
          const datasetId =
            dataset?.id ||
            this.storage.find("datasets", "dataset_platform_report_ranges")?.id ||
            this.storage.list("datasets")[0]?.id ||
            null;

          ensureEntity("suites", {
            id: "suite_platform_dataset_report",
            projectId,
            name: "平台报告数据驱动巡检",
            description: "按数据集行重复执行报告汇总用例。",
            tags: ["platform", "self-test", "dataset", "seed"],
            defaultEnvironmentId: environmentId,
            datasetId,
            failureStrategy: "stop",
            timeoutSeconds: 120,
            continueOnFailure: false,
            variables: {},
            executionConfig: {
              priority: "high",
              maxRetries: 1,
              stopOnDatasetFailure: false
            },
            items: [
              { id: createId("suite_item"), caseId: bootstrapCase.id, order: 1, continueOnFailure: false },
              { id: createId("suite_item"), caseId: reportCase.id, order: 2, continueOnFailure: false }
            ],
            scenarioAssertions: [{ type: "custom", script: "assert(vars.reportRange, 'reportRange should exist');" }],
            schedule: { enabled: false, intervalMinutes: 30 }
          });
        }
      }
    }

    return {
      created,
      skipped
    };
  }

  listVersions({ collection = null, entityId = null, limit = 50, q = null } = {}, context = {}) {
    this.assertPermission(this.resolveActor(context), "read", "versions");
    const keyword = normalizeCreator(q)?.toLowerCase() || null;
    return this.storage
      .list("versions")
      .filter(
        (item) =>
          (!collection || item.collection === collection) &&
          (!entityId || item.entityId === entityId) &&
          (!keyword ||
            [item.collection, item.entityId, item.actorName, item.action, item.snapshot?.name]
              .filter(Boolean)
              .some((value) => String(value).toLowerCase().includes(keyword)))
      )
      .slice(0, Math.max(1, Number(limit) || 50));
  }

  getVersionImpact(versionId, context = {}) {
    const actor = this.resolveActor(context);
    this.assertPermission(actor, "read", "versions");
    const version = this.storage.find("versions", versionId);
    if (!version) {
      throw new Error(`version ${versionId} not found`);
    }

    const existing = this.storage.find(version.collection, version.entityId);
    const references = (childReferences[version.collection] ?? [])
      .map((reference) => {
        const entities = this.storage.list(reference.collection);
        const matched = entities.filter((entity) => {
          if (reference.arrayField) {
            return Array.isArray(entity[reference.arrayField]) && entity[reference.arrayField].some((item) => item?.[reference.field] === version.entityId);
          }
          return entity[reference.field] === version.entityId;
        });

        return matched.map((entity) => ({
          collection: reference.collection,
          id: entity.id,
          name: entity.name ?? entity.id
        }));
      })
      .flat();

    return {
      versionId: version.id,
      collection: version.collection,
      entityId: version.entityId,
      entityName: version.snapshot?.name ?? version.entityId,
      action: version.action,
      currentExists: Boolean(existing),
      currentName: existing?.name ?? null,
      willCreate: !existing,
      schedulerRefreshRequired: version.collection === "suites",
      executionSnapshotAffected: ["apis", "cases", "datasets", "environments", "suites"].includes(version.collection),
      references
    };
  }

  restoreVersion(versionId, context = {}) {
    const actor = this.resolveActor(context);
    this.assertPermission(actor, "restoreVersion", "versions");
    const version = this.storage.find("versions", versionId);
    if (!version) {
      throw new Error(`version ${versionId} not found`);
    }
    if (!versionedCollections.has(version.collection)) {
      throw new Error(`${version.collection} does not support restore`);
    }

    const snapshot = version.snapshot;
    if (!snapshot?.id) {
      throw new Error(`version ${versionId} has invalid snapshot`);
    }

    const existing = this.storage.find(version.collection, snapshot.id);
    const restored = existing
      ? this.storage.update(version.collection, snapshot.id, snapshot)
      : this.storage.create(version.collection, { ...snapshot, restoredAt: nowIso() });

    this.recordMutation({
      actor,
      action: "restore",
      collection: version.collection,
      entityId: restored.id,
      entityName: restored.name ?? restored.id,
      snapshot: restored,
      beforeSnapshot: existing,
      detail: { versionId }
    });

    if (version.collection === "suites") {
      this.scheduler.refresh();
    }

    return restored;
  }

  listAuditLogs({ actorId = null, collection = null, action = null, limit = 100, q = null, dateFrom = null, dateTo = null } = {}, context = {}) {
    this.assertPermission(this.resolveActor(context), "read", "auditLogs");
    const keyword = normalizeCreator(q)?.toLowerCase() || null;
    const startTime = dateFrom ? Date.parse(dateFrom) : null;
    const endTime = dateTo ? Date.parse(dateTo) : null;
    return this.storage
      .list("auditLogs")
      .filter(
        (item) =>
          (!actorId || item.actorId === actorId) &&
          (!collection || item.collection === collection) &&
          (!action || item.action === action) &&
          (!Number.isFinite(startTime) || Date.parse(item.createdAt) >= startTime) &&
          (!Number.isFinite(endTime) || Date.parse(item.createdAt) <= endTime + 24 * 60 * 60 * 1000 - 1) &&
          (!keyword ||
            [
              item.actorName,
              item.actorRole,
              item.action,
              item.collection,
              item.entityName,
              item.entityId,
              item.detail ? JSON.stringify(item.detail) : ""
            ]
              .filter(Boolean)
              .some((value) => String(value).toLowerCase().includes(keyword)))
      )
      .slice(0, Math.max(1, Number(limit) || 100));
  }

  exportAuditLogs(filters = {}, context = {}) {
    const rows = this.listAuditLogs({ ...filters, limit: filters.limit || 500 }, context);
    const lines = [
      ["Time", "Actor", "Role", "Action", "Collection", "Entity", "Detail"].join(","),
      ...rows.map((item) =>
        [
          item.createdAt,
          item.actorName,
          item.actorRole,
          item.action,
          item.collection ?? "",
          item.entityName || item.entityId || "",
          item.detail ? JSON.stringify(item.detail) : ""
        ]
          .map((value) => JSON.stringify(value ?? ""))
          .join(",")
      )
    ];

    return {
      filename: `audit-logs-${Date.now()}.csv`,
      contentType: "text/csv; charset=utf-8",
      body: lines.join("\n")
    };
  }

  getGovernanceSummary(context = {}) {
    const actor = this.resolveActor(context);
    this.assertPermission(actor, "read", "users");
    const users = this.storage.list("users");
    const datasets = this.storage.list("datasets");
    const versions = this.storage.list("versions");
    const auditLogs = this.storage.list("auditLogs");
    const sessions = this.storage.list("sessions").filter((session) => !isSessionExpired(session));
    const activeLoginSessions = sessions.filter((session) => session.sessionType === "login");
    const activeSessionsByUser = Object.fromEntries(
      users.map((user) => [user.id, activeLoginSessions.filter((session) => session.userId === user.id).length])
    );

    return {
      currentUser: sanitizeUser(actor),
      counts: {
        users: users.length,
        datasets: datasets.length,
        versions: versions.length,
        auditLogs: auditLogs.length,
        activeSessions: activeLoginSessions.length
      },
      usersByRole: {
        admin: users.filter((item) => item.role === "admin").length,
        editor: users.filter((item) => item.role === "editor").length,
        viewer: users.filter((item) => item.role === "viewer").length
      },
      activeSessionsByUser,
      passwordPolicy: passwordPolicy(),
      recentAuditLogs: auditLogs.slice(0, 10),
      recentVersions: versions.slice(0, 10)
    };
  }

  getGlobalVariables() {
    const rows = [];

    this.storage.list("environments").forEach((environment) => {
      Object.entries(environment.variables ?? {}).forEach(([key, value]) => {
        rows.push({
          key,
          value,
          sourceType: "environment",
          sourceId: environment.id,
          sourceName: environment.name
        });
      });
    });

    this.storage.list("suites").forEach((suite) => {
      Object.entries(suite.variables ?? {}).forEach(([key, value]) => {
        rows.push({
          key,
          value,
          sourceType: "suite",
          sourceId: suite.id,
          sourceName: suite.name
        });
      });
    });

    this.storage.list("datasets").forEach((dataset) => {
      (dataset.rows ?? []).forEach((row) => {
        Object.entries(row.variables ?? {}).forEach(([key, value]) => {
          rows.push({
            key,
            value,
            sourceType: "dataset",
            sourceId: `${dataset.id}:${row.id}`,
            sourceName: `${dataset.name} / ${row.name}`
          });
        });
      });
    });

    return rows.sort((left, right) => {
      const byKey = left.key.localeCompare(right.key);
      if (byKey !== 0) {
        return byKey;
      }
      return left.sourceName.localeCompare(right.sourceName);
    });
  }

  getOverviewSummary() {
    const runs = this.storage.list("runs");
    const recentRuns = runs.slice(0, 4);
    const runningCount = runs.filter((run) => run.status === "running").length;
    const queuedCount = runs.filter((run) => run.status === "queued").length;
    const totalPassed = runs.reduce((sum, run) => sum + Number(run.summary?.passed || 0), 0);
    const totalFailed = runs.reduce((sum, run) => sum + Number(run.summary?.failed || 0), 0);
    const report = this.getReportSummary({ range: "7d", moduleId: "all" });

    return {
      totalPassed,
      totalFailed,
      runningCount,
      queuedCount,
      trend: report.trend,
      recentRuns
    };
  }

  getRunShare(runId, baseUrl) {
    const run = this.storage.find("runs", runId);
    if (!run) {
      return null;
    }
    return {
      runId: run.id,
      shareToken: run.shareToken,
      shareUrl: `${baseUrl}/report/${run.shareToken}`
    };
  }

  getReportSummary({ range = "today", moduleId = "all", runId = null } = {}) {
    const runs = this.storage.list("runs");
    const modules = this.storage.list("modules");
    const apis = this.storage.list("apis");
    const cases = this.storage.list("cases");
    const caseDisplayMap = new Map(cases.map((item, index) => [item.id, `TC${String(index + 1).padStart(3, "0")}`]));
    const moduleFilter = moduleId && moduleId !== "all" ? moduleId : null;
    const days = rangeToDays(range);
    const apiMap = new Map(apis.map((item) => [item.id, item]));
    const caseMap = new Map(cases.map((item) => [item.id, item]));
    const moduleMap = new Map(modules.map((item) => [item.id, item]));
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));

    const filteredRuns = runs.filter((run) => {
      const anchor = run.finishedAt || run.startedAt || run.createdAt;
      return anchor ? new Date(anchor) >= start : false;
    });

    const stepMatchesModule = (step) => {
      if (!moduleFilter) {
        return true;
      }
      const caseEntity = caseMap.get(step.caseId);
      const apiEntity = apiMap.get(caseEntity?.apiId);
      return apiEntity?.moduleId === moduleFilter;
    };

    let totalSteps = 0;
    let totalPassed = 0;
    let totalFailed = 0;
    let totalDuration = 0;

    filteredRuns.forEach((run) => {
      run.steps
        .filter(stepMatchesModule)
        .forEach((step) => {
          totalSteps += 1;
          totalDuration += Number(step.duration || 0);
          if (step.status === "passed") {
            totalPassed += 1;
          }
          if (step.status === "failed") {
            totalFailed += 1;
          }
        });
    });

    const trend = [];
    for (let index = days - 1; index >= 0; index -= 1) {
      const current = new Date(now);
      current.setHours(0, 0, 0, 0);
      current.setDate(current.getDate() - index);
      const key = dateKey(current.toISOString());
      const point = { label: key.slice(5), date: key, passed: 0, failed: 0 };

      filteredRuns
        .filter((run) => dateKey(run.finishedAt || run.startedAt || run.createdAt) === key)
        .forEach((run) => {
          run.steps
            .filter(stepMatchesModule)
            .forEach((step) => {
              if (step.status === "passed") {
                point.passed += 1;
              }
              if (step.status === "failed") {
                point.failed += 1;
              }
            });
        });

      trend.push(point);
    }

    const moduleStats = modules
      .filter((module) => !moduleFilter || module.id === moduleFilter)
      .map((module) => ({ moduleId: module.id, moduleName: module.name, passed: 0, failed: 0 }));
    const moduleStatsMap = new Map(moduleStats.map((item) => [item.moduleId, item]));

    filteredRuns.forEach((run) => {
      run.steps.forEach((step) => {
        const caseEntity = caseMap.get(step.caseId);
        const apiEntity = apiMap.get(caseEntity?.apiId);
        const target = moduleStatsMap.get(apiEntity?.moduleId);
        if (!target) {
          return;
        }
        if (step.status === "failed") {
          target.failed += 1;
        } else if (step.status === "passed") {
          target.passed += 1;
        }
      });
    });

    const selectedRun = (runId && runs.find((run) => run.id === runId)) || filteredRuns[0] || runs[0] || null;
    const failedRows = [];
    if (selectedRun) {
      const failedMap = new Map();
      selectedRun.steps
        .filter((step) => step.status === "failed")
        .filter(stepMatchesModule)
        .forEach((step) => {
          const caseEntity = caseMap.get(step.caseId);
          const apiEntity = apiMap.get(caseEntity?.apiId);
          const key = step.caseId;
          if (!failedMap.has(key)) {
            failedMap.set(key, {
              runId: selectedRun.id,
              stepId: step.id,
              caseId: step.caseId,
              displayId: caseDisplayMap.get(step.caseId) || step.caseId,
              caseName: step.caseName,
              moduleId: apiEntity?.moduleId ?? null,
              moduleName: moduleMap.get(apiEntity?.moduleId)?.name ?? "未知模块",
              error: step.message || step.assertions?.find((assertion) => !assertion.passed)?.message || "断言失败",
              count: 0,
              lastFailedAt: step.finishedAt
            });
          }
          const current = failedMap.get(key);
          current.count += 1;
          if (step.finishedAt && step.finishedAt > current.lastFailedAt) {
            current.lastFailedAt = step.finishedAt;
            current.stepId = step.id;
            current.error = step.message || step.assertions?.find((assertion) => !assertion.passed)?.message || current.error;
          }
        });
      failedRows.push(
        ...[...failedMap.values()].sort((left, right) => String(right.lastFailedAt).localeCompare(String(left.lastFailedAt)))
      );
    }

    return {
      filters: {
        range,
        moduleId: moduleFilter ?? "all"
      },
      summary: {
        totalSteps,
        totalPassed,
        totalFailed,
        totalDuration,
        averageDuration: totalSteps ? Math.round(totalDuration / totalSteps) : 0,
        passRate: totalSteps ? totalPassed / totalSteps : 0
      },
      trend,
      moduleStats,
      failedRows,
      selectedRunId: selectedRun?.id ?? null
    };
  }

  getReportInsights({ range = "7d", moduleId = "all" } = {}) {
    const runs = this.storage.list("runs");
    const modules = new Map(this.storage.list("modules").map((item) => [item.id, item]));
    const apis = new Map(this.storage.list("apis").map((item) => [item.id, item]));
    const cases = new Map(this.storage.list("cases").map((item) => [item.id, item]));
    const days = rangeToDays(range);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    const moduleFilter = moduleId && moduleId !== "all" ? moduleId : null;

    const caseStats = new Map();
    const failureClusters = new Map();
    const suiteStats = new Map();

    const filteredRuns = runs.filter((run) => {
      const anchor = run.finishedAt || run.startedAt || run.createdAt;
      return anchor ? new Date(anchor) >= start : false;
    });

    for (const run of filteredRuns) {
      const suiteEntry = suiteStats.get(run.suiteId) || {
        suiteId: run.suiteId,
        suiteName: run.suiteName,
        totalRuns: 0,
        passedRuns: 0,
        failedRuns: 0,
        averageDuration: 0,
        durationTotal: 0
      };
      suiteEntry.totalRuns += 1;
      suiteEntry.durationTotal += Number(run.duration || 0);
      if (run.status === "passed") {
        suiteEntry.passedRuns += 1;
      } else if (run.status === "failed") {
        suiteEntry.failedRuns += 1;
      }
      suiteStats.set(run.suiteId, suiteEntry);

      for (const step of run.steps ?? []) {
        const caseEntity = cases.get(step.caseId);
        const apiEntity = apis.get(caseEntity?.apiId);
        if (moduleFilter && apiEntity?.moduleId !== moduleFilter) {
          continue;
        }

        const moduleName = modules.get(apiEntity?.moduleId)?.name ?? "未知模块";
        const stat = caseStats.get(step.caseId) || {
          caseId: step.caseId,
          caseName: step.caseName,
          moduleId: apiEntity?.moduleId ?? null,
          moduleName,
          passed: 0,
          failed: 0,
          totalDuration: 0,
          maxDuration: 0
        };
        stat.totalDuration += Number(step.duration || 0);
        stat.maxDuration = Math.max(stat.maxDuration, Number(step.duration || 0));
        if (step.status === "passed") {
          stat.passed += 1;
        } else if (step.status === "failed") {
          stat.failed += 1;
          const clusterKey = `${step.caseId}:${step.message || "断言失败"}`;
          const cluster = failureClusters.get(clusterKey) || {
            caseId: step.caseId,
            caseName: step.caseName,
            moduleName,
            error: step.message || "断言失败",
            count: 0,
            lastSeenAt: step.finishedAt,
            latestRunId: run.id,
            latestStepId: step.id
          };
          cluster.count += 1;
          if (String(step.finishedAt || "").localeCompare(String(cluster.lastSeenAt || "")) > 0) {
            cluster.lastSeenAt = step.finishedAt;
            cluster.latestRunId = run.id;
            cluster.latestStepId = step.id;
          }
          failureClusters.set(clusterKey, cluster);
        }
        caseStats.set(step.caseId, stat);
      }
    }

    const computedCaseStats = [...caseStats.values()].map((item) => ({
        ...item,
        averageDuration: item.passed + item.failed ? Math.round(item.totalDuration / (item.passed + item.failed)) : 0
      }));

    const slowCases = computedCaseStats
      .sort((left, right) => right.averageDuration - left.averageDuration)
      .slice(0, 10);

    const flakyCases = computedCaseStats
      .filter((item) => item.passed > 0 && item.failed > 0)
      .map((item) => ({
        ...item,
        stability: item.passed / (item.passed + item.failed)
      }))
      .sort((left, right) => left.stability - right.stability)
      .slice(0, 10);

    const suiteQuality = [...suiteStats.values()]
      .map((item) => ({
        suiteId: item.suiteId,
        suiteName: item.suiteName,
        totalRuns: item.totalRuns,
        passRate: item.totalRuns ? item.passedRuns / item.totalRuns : 0,
        averageDuration: item.totalRuns ? Math.round(item.durationTotal / item.totalRuns) : 0
      }))
      .sort((left, right) => left.passRate - right.passRate);

    return {
      filters: {
        range,
        moduleId: moduleFilter ?? "all"
      },
      slowCases,
      flakyCases,
      failureClusters: [...failureClusters.values()].sort((left, right) => right.count - left.count).slice(0, 10),
      suiteQuality
    };
  }

}
