const creators = ["张三", "李四", "王五"];

export function buildViewModel(state, helpers) {
  const { inferPriority, inferExecutionStatus, priorityText, normalizeEnvSlug } = helpers;
  const data = state.data;
  const moduleMap = new Map(data.modules.map((item) => [item.id, item]));
  const apiMap = new Map(data.apis.map((item) => [item.id, item]));
  const caseMap = new Map(data.cases.map((item) => [item.id, item]));
  const suiteMap = new Map(data.suites.map((item) => [item.id, item]));
  const latestStepMap = new Map();
  const latestSuiteRunMap = new Map();

  data.runs.forEach((run) => {
    if (!latestSuiteRunMap.has(run.suiteId)) {
      latestSuiteRunMap.set(run.suiteId, run);
    }
    run.steps.forEach((step) => {
      if (!latestStepMap.has(step.caseId)) {
        latestStepMap.set(step.caseId, { run, step });
      }
    });
  });

  const apis = data.apis.map((api) => {
    const module = moduleMap.get(api.moduleId);
    return {
      ...api,
      groupName: module?.name || "未分组",
      status: api.status || (api.tags?.includes("deprecated") ? "deprecated" : "active"),
      isDeprecated: (api.status || (api.tags?.includes("deprecated") ? "deprecated" : "active")) === "deprecated"
    };
  });

  const cases = data.cases.map((testCase, index) => {
    const latest = latestStepMap.get(testCase.id);
    const priorityKey = testCase.priority || inferPriority(testCase.tags, index);
    return {
      ...testCase,
      apiName: apiMap.get(testCase.apiId)?.name || "未知接口",
      displayId: `TC${String(index + 1).padStart(3, "0")}`,
      creator: testCase.creator || creators[index % creators.length],
      priorityKey,
      priorityText: priorityText(priorityKey),
      lastExecutionAt: latest?.step?.finishedAt || latest?.run?.finishedAt || testCase.updatedAt || testCase.createdAt,
      executionStatus: latest?.step?.status || inferExecutionStatus(index)
    };
  });

  const suites = data.suites.map((suite, index) => {
    const latestRun = data.runs.find((run) => run.suiteId === suite.id);
    return {
      ...suite,
      updatedAt: suite.updatedAt || latestRun?.finishedAt || suite.createdAt,
      defaultEnvironmentId: suite.defaultEnvironmentId || data.environments[0]?.id || null,
      failureStrategy: suite.failureStrategy || (suite.continueOnFailure ? "continue" : "stop"),
      timeoutSeconds: suite.timeoutSeconds || 300,
      sceneStateText: latestRun ? "启用" : index === data.suites.length - 1 ? "草稿" : "启用",
      sceneStateClass: latestRun ? "" : "scene-draft",
      items: suite.items
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((item) => {
          const itemType = item.itemType === "suite" ? "suite" : "case";
          const refSuite = itemType === "suite" ? suiteMap.get(item.suiteId) : null;
          const caseEntity = caseMap.get(item.caseId);
          const apiEntity = apiMap.get(caseEntity?.apiId);
          const latest = latestStepMap.get(item.caseId);
          const latestSuiteRun = itemType === "suite" ? latestSuiteRunMap.get(item.suiteId) : null;
          return {
            ...item,
            itemType,
            caseName: itemType === "suite" ? refSuite?.name || "未知子场景" : caseEntity?.name || "未知用例",
            targetName: itemType === "suite" ? refSuite?.name || "未知子场景" : caseEntity?.name || "未知用例",
            method: itemType === "suite" ? "SUITE" : apiEntity?.method || "GET",
            path: itemType === "suite" ? `${refSuite?.items?.length || 0} 个步骤` : apiEntity?.path || "/",
            latestStatus: item.enabled === false ? "skipped" : itemType === "suite" ? latestSuiteRun?.status || "passed" : latest?.step?.status || "passed",
            latestRunId: itemType === "suite" ? latestSuiteRun?.id || "" : latest?.run?.id || "",
            latestStepId: itemType === "suite" ? "" : latest?.step?.id || "",
            roleText: item.role === "setup" ? "前置工厂" : item.role === "teardown" ? "后置清理" : "业务步骤",
            parallelGroup: item.parallelGroup || "",
            totalSteps: suite.items.length
          };
        })
    };
  });

  const selectedSuite = data.suites.find((suite) => suite.id === state.selectedSuiteId) || data.suites[0] || null;
  const activeEnvironmentId = selectedSuite?.defaultEnvironmentId || data.environments[0]?.id || null;

  const environments = data.environments.map((env, index) => ({
    ...env,
    displayName: env.name,
    slug: normalizeEnvSlug(env.name || `env-${index + 1}`),
    headersObject: env.headers || {},
    variablesObject: env.variables || {},
    authObject: env.auth || { type: "none", value: "" },
    isCurrent: env.id === activeEnvironmentId || (!activeEnvironmentId && index === 0)
  }));

  return {
    ...data,
    apis,
    cases,
    suites,
    environments
  };
}

export function buildGlobalVariables(model) {
  const rows = [];
  model.environments.forEach((env) => {
    Object.entries(env.variablesObject || {}).forEach(([key, value]) => {
      rows.push({ key, value: String(value), source: env.displayName });
    });
  });

  model.suites.forEach((suite) => {
    Object.entries(suite.variables || {}).forEach(([key, value]) => {
      rows.push({ key, value: String(value), source: suite.name });
    });
  });

  return rows;
}
