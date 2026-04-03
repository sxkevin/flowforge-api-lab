import { performance } from "node:perf_hooks";
import { runAssertions } from "./assertions.js";
import { resolveJsonPath, resolveXPath } from "./jsonpath.js";
import { renderTemplate } from "./template.js";
import { clone, createId, entriesToObject, nowIso } from "./utils.js";

function buildQueryString(queryEntries, context) {
  const params = new URLSearchParams();
  for (const entry of queryEntries ?? []) {
    if (!entry?.key) {
      continue;
    }
    const rendered = renderTemplate(entry.value, context);
    if (rendered !== undefined && rendered !== null && rendered !== "") {
      params.append(entry.key, String(rendered));
    }
  }
  const stringified = params.toString();
  return stringified ? `?${stringified}` : "";
}

function normalizeHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])
  );
}

function mergeHeaders(environment, api, caseOverrides, context) {
  const environmentHeaders = renderTemplate(environment.headers ?? {}, context);
  const apiHeaders = renderTemplate(entriesToObject(api.headers ?? []), context);
  const overrideHeaders = renderTemplate(caseOverrides?.headers ?? {}, context);

  let merged = {
    ...environmentHeaders,
    ...apiHeaders,
    ...overrideHeaders
  };

  if (environment.auth?.type === "bearer" && environment.auth.value) {
    merged.authorization ??= `Bearer ${renderTemplate(environment.auth.value, context)}`;
  }

  if (environment.auth?.type === "apikey" && environment.auth.header && environment.auth.value) {
    merged[environment.auth.header] ??= renderTemplate(environment.auth.value, context);
  }

  return merged;
}

function normalizeBody(api, caseItem, context) {
  const body = caseItem?.overrides?.body ?? api.bodyTemplate;
  if (api.bodyMode === "none" || body === "" || body === undefined || body === null) {
    return undefined;
  }

  const rendered = renderTemplate(body, context);
  return api.bodyMode === "json" ? JSON.stringify(rendered) : String(rendered);
}

function resolveTimeoutMs(suite, item, caseEntity) {
  if (item?.timeoutMs !== undefined && item.timeoutMs !== null && item.timeoutMs !== "") {
    return Number(item.timeoutMs);
  }
  if (caseEntity?.timeoutMs !== undefined && caseEntity.timeoutMs !== null && caseEntity.timeoutMs !== "") {
    return Number(caseEntity.timeoutMs);
  }
  if (suite?.timeoutSeconds !== undefined && suite.timeoutSeconds !== null && suite.timeoutSeconds !== "") {
    return Number(suite.timeoutSeconds) * 1000;
  }
  return 300000;
}

function evaluateCondition(condition, context) {
  if (!condition) {
    return true;
  }

  try {
    return Boolean(
      Function("vars", "env", "suite", `return (${condition});`)(
        context.vars,
        context.env.variables ?? {},
        context.suite.variables ?? {}
      )
    );
  } catch {
    return false;
  }
}

function extractVariables(extracts, response) {
  const variables = {};

  for (const rule of extracts ?? []) {
    if (!rule?.name) {
      continue;
    }

    switch (rule.source) {
      case "jsonPath":
        variables[rule.name] = resolveJsonPath(response.body, rule.path);
        break;
      case "xpath":
        variables[rule.name] = resolveXPath(response.bodyText, rule.path);
        break;
      case "header":
        variables[rule.name] = response.headers[String(rule.header || rule.name || "").toLowerCase()];
        break;
      case "status":
        variables[rule.name] = response.status;
        break;
      default:
        break;
    }
  }

  return variables;
}

function runScript(script, context) {
  if (!script || !String(script).trim()) {
    return { passed: true, errors: [] };
  }

  const errors = [];
  const api = {
    vars: context.vars,
    response: context.response,
    request: context.request,
    set(name, value) {
      context.vars[name] = value;
    },
    get(name) {
      return context.vars[name];
    },
    assert(condition, message) {
      if (!condition) {
        throw new Error(message || "custom assertion failed");
      }
    }
  };

  try {
    Function("context", "vars", "response", "request", "set", "get", "assert", script)(
      api,
      api.vars,
      api.response,
      api.request,
      api.set,
      api.get,
      api.assert
    );
    return { passed: true, errors };
  } catch (error) {
    errors.push(error.message);
    return { passed: false, errors };
  }
}

function renderAssertions(assertions, context) {
  return (assertions ?? []).map((assertion) => ({
    ...assertion,
    expected:
      assertion.expected !== undefined ? renderTemplate(assertion.expected, context) : assertion.expected,
    schema: assertion.schema ? renderTemplate(assertion.schema, context) : assertion.schema
  }));
}

async function executeCase({ suite, item, caseEntity, api, environment, sharedVars, trigger }) {
  const vars = sharedVars;
  const context = {
    vars,
    env: environment,
    suite,
    trigger
  };

  if (!evaluateCondition(item.condition, context)) {
    return {
      id: createId("step"),
      caseId: caseEntity.id,
      caseName: caseEntity.name,
      apiName: api.name,
      status: "skipped",
      message: "condition evaluated to false",
      assertions: [],
      request: null,
      response: null,
      startedAt: nowIso(),
      finishedAt: nowIso(),
      duration: 0,
      extractedVariables: {}
    };
  }

  for (const step of api.preSteps ?? []) {
    if (step.type === "setVar" && step.name) {
      vars[step.name] = renderTemplate(step.value, context);
    }
    if (step.type === "script") {
      runScript(step.script, { vars, request: null, response: null });
    }
  }

  const requestContext = {
    vars,
    env: environment,
    suite,
    item
  };

  const method = api.method.toUpperCase();
  const path = renderTemplate(api.path, requestContext);
  const queryString = buildQueryString(caseEntity.overrides?.query ?? api.query, requestContext);
  const url = `${environment.baseUrl}${path}${queryString}`;
  const headers = mergeHeaders(environment, api, caseEntity.overrides, requestContext);
  const body = normalizeBody(api, caseEntity, requestContext);

  const request = {
    method,
    url,
    headers,
    body: body ? JSON.parse(body) : undefined
  };

  const preScript = runScript(caseEntity.preScript, { vars, request, response: null });
  if (!preScript.passed) {
    return {
      id: createId("step"),
      caseId: caseEntity.id,
      caseName: caseEntity.name,
      apiName: api.name,
      status: "failed",
      message: `preScript failed: ${preScript.errors.join("; ")}`,
      assertions: [],
      request,
      response: null,
      startedAt: nowIso(),
      finishedAt: nowIso(),
      duration: 0,
      extractedVariables: {}
    };
  }

  const controller = new AbortController();
  const timeoutMs = resolveTimeoutMs(suite, item, caseEntity);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const started = performance.now();
  const startedAt = nowIso();
  let fetchResponse;
  let responsePayload;
  let responseText = "";
  try {
    fetchResponse = await fetch(url, {
      method,
      headers,
      body: body,
      signal: controller.signal
    });

    responseText = await fetchResponse.text();
    const contentType = fetchResponse.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      responsePayload = responseText ? JSON.parse(responseText) : {};
    } else {
      responsePayload = responseText;
    }
  } catch (error) {
    clearTimeout(timeout);
    return {
      id: createId("step"),
      caseId: caseEntity.id,
      caseName: caseEntity.name,
      apiName: api.name,
      status: "failed",
      message: error.name === "AbortError" ? `request timeout after ${timeoutMs}ms` : error.message,
      assertions: [],
      request,
      response: null,
      startedAt,
      finishedAt: nowIso(),
      duration: Math.round(performance.now() - started),
      extractedVariables: {}
    };
  } finally {
    clearTimeout(timeout);
  }

  const duration = Math.round(performance.now() - started);
  const response = {
    status: fetchResponse.status,
    headers: normalizeHeaders(Object.fromEntries(fetchResponse.headers.entries())),
    body: responsePayload,
    bodyText: responseText,
    duration
  };

  const assertionResults = runAssertions(
    renderAssertions(caseEntity.assertions, requestContext),
    response
  );
  const extractedVariables = extractVariables(caseEntity.extracts, response);
  Object.assign(vars, extractedVariables);

  const postScript = runScript(caseEntity.postScript, { vars, request, response });
  if (!postScript.passed) {
    assertionResults.push({
      type: "customScript",
      passed: false,
      actual: null,
      expected: null,
      message: postScript.errors.join("; ")
    });
  }

  const scenarioScriptResults = [];
  for (const assertion of item.assertions ?? []) {
    if (assertion.type === "custom") {
      const result = runScript(assertion.script, { vars, request, response });
      scenarioScriptResults.push({
        type: "scenarioCustom",
        passed: result.passed,
        actual: null,
        expected: null,
        message: result.passed ? "scenario custom assertion passed" : result.errors.join("; ")
      });
    }
  }

  const combinedAssertions = [...assertionResults, ...scenarioScriptResults];
  const passed = combinedAssertions.every((assertion) => assertion.passed);

  return {
    id: createId("step"),
    caseId: caseEntity.id,
    caseName: caseEntity.name,
    apiName: api.name,
    status: passed ? "passed" : "failed",
    message: passed ? "ok" : "assertions failed",
    assertions: combinedAssertions,
    request,
    response: {
      status: response.status,
      headers: response.headers,
      body: response.body,
      bodyText: response.bodyText,
      duration
    },
    startedAt,
    finishedAt: nowIso(),
    duration,
    extractedVariables
  };
}

export async function executeSuite(storage, suiteId, environmentId, trigger = "manual") {
  const suite = clone(storage.find("suites", suiteId));
  const environment = clone(storage.find("environments", environmentId));

  if (!suite) {
    throw new Error(`suite ${suiteId} not found`);
  }
  if (!environment) {
    throw new Error(`environment ${environmentId} not found`);
  }

  const run = {
    id: createId("run"),
    suiteId,
    suiteName: suite.name,
    environmentId,
    environmentName: environment.name,
    trigger,
    status: "running",
    startedAt: nowIso(),
    finishedAt: null,
    duration: 0,
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0
    },
    shareToken: createId("share"),
    variablesSnapshot: {},
    steps: []
  };

  const sharedVars = {
    ...(environment.variables ?? {}),
    ...(suite.variables ?? {})
  };

  for (const item of [...(suite.items ?? [])].sort((left, right) => left.order - right.order)) {
    const caseEntity = clone(storage.find("cases", item.caseId));
    if (!caseEntity) {
      run.steps.push({
        id: createId("step"),
        caseId: item.caseId,
        caseName: "Unknown case",
        apiName: "Unknown API",
        status: "failed",
        message: "case not found",
        assertions: [],
        request: null,
        response: null,
        startedAt: nowIso(),
        finishedAt: nowIso(),
        duration: 0,
        extractedVariables: {}
      });
      run.summary.total += 1;
      run.summary.failed += 1;
      if (!suite.continueOnFailure && !item.continueOnFailure) {
        break;
      }
      continue;
    }

    const api = clone(storage.find("apis", caseEntity.apiId));
    if (!api) {
      run.steps.push({
        id: createId("step"),
        caseId: caseEntity.id,
        caseName: caseEntity.name,
        apiName: "Unknown API",
        status: "failed",
        message: "api definition not found",
        assertions: [],
        request: null,
        response: null,
        startedAt: nowIso(),
        finishedAt: nowIso(),
        duration: 0,
        extractedVariables: {}
      });
      run.summary.total += 1;
      run.summary.failed += 1;
      if (!suite.continueOnFailure && !item.continueOnFailure) {
        break;
      }
      continue;
    }

    const result = await executeCase({
      suite,
      item,
      caseEntity,
      api,
      environment,
      sharedVars,
      trigger
    });

    run.steps.push(result);
    run.summary.total += 1;
    if (result.status === "passed") {
      run.summary.passed += 1;
    } else if (result.status === "skipped") {
      run.summary.skipped += 1;
    } else {
      run.summary.failed += 1;
    }

    if (result.status === "failed" && !suite.continueOnFailure && !item.continueOnFailure) {
      break;
    }
  }

  for (const assertion of suite.scenarioAssertions ?? []) {
    if (assertion.type === "custom") {
      const scenarioResult = runScript(assertion.script, {
        vars: sharedVars,
        request: null,
        response: null
      });
      run.steps.push({
        id: createId("step"),
        caseId: "scenario",
        caseName: "场景级断言",
        apiName: "suite",
        status: scenarioResult.passed ? "passed" : "failed",
        message: scenarioResult.passed ? "scenario assertion passed" : scenarioResult.errors.join("; "),
        assertions: [
          {
            type: "suiteCustom",
            passed: scenarioResult.passed,
            actual: null,
            expected: null,
            message: scenarioResult.passed ? "suite assertion passed" : scenarioResult.errors.join("; ")
          }
        ],
        request: null,
        response: null,
        startedAt: nowIso(),
        finishedAt: nowIso(),
        duration: 0,
        extractedVariables: {}
      });
      run.summary.total += 1;
      if (scenarioResult.passed) {
        run.summary.passed += 1;
      } else {
        run.summary.failed += 1;
      }
    }
  }

  run.variablesSnapshot = sharedVars;
  run.finishedAt = nowIso();
  run.duration = run.steps.reduce((total, step) => total + (step.duration ?? 0), 0);
  run.status = run.summary.failed > 0 ? "failed" : "passed";

  storage.addRun(run);
  return run;
}
