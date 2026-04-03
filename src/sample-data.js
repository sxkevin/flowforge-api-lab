import { nowIso } from "./utils.js";

const projectId = "project_platform";
const serviceId = "service_backend";
const moduleId = "module_core_api";
const assetsModuleId = "module_assets_api";
const runtimeModuleId = "module_runtime_api";
const environmentId = "env_platform_self";
const datasetSeedId = "dataset_platform_seed";

const collectionTemplates = [
  {
    key: "users",
    label: "用户",
    idTemplate: "{{env.variables.platformUserId}}",
    createBody: {
      id: "user_{{random}}",
      name: "平台模板用户{{random}}",
      username: "tpl_{{random}}",
      password: "temp1234",
      role: "viewer",
      status: "active"
    },
    updateBody: {
      name: "平台管理员",
      username: "admin",
      password: "admin123",
      role: "admin",
      status: "active"
    }
  },
  {
    key: "projects",
    label: "项目",
    idTemplate: "{{env.variables.platformProjectId}}",
    createBody: {
      id: "project_{{random}}",
      name: "平台模板项目{{random}}",
      description: "系统内置项目创建模板。"
    },
    updateBody: {
      name: "自动化测试平台",
      description: "平台自身后端接口管理与接口测试资产。"
    }
  },
  {
    key: "services",
    label: "服务",
    idTemplate: "{{env.variables.platformServiceId}}",
    createBody: {
      id: "service_{{random}}",
      projectId: "{{env.variables.platformProjectId}}",
      name: "platform-service-{{random}}",
      description: "系统内置服务创建模板。"
    },
    updateBody: {
      projectId: "{{env.variables.platformProjectId}}",
      name: "platform-backend",
      description: "自动化测试平台后端服务。"
    }
  },
  {
    key: "modules",
    label: "模块",
    idTemplate: "{{env.variables.platformModuleId}}",
    createBody: {
      id: "module_{{random}}",
      serviceId: "{{env.variables.platformServiceId}}",
      name: "platform-module-{{random}}",
      description: "系统内置模块创建模板。"
    },
    updateBody: {
      serviceId: "{{env.variables.platformServiceId}}",
      name: "core-api",
      description: "登录、概览、调度、报告、执行等核心接口。"
    }
  },
  {
    key: "apis",
    label: "接口",
    idTemplate: "{{env.variables.platformApiId}}",
    createBody: {
      id: "api_{{random}}",
      moduleId: "{{env.variables.platformAssetsModuleId}}",
      name: "平台模板接口{{random}}",
      method: "GET",
      path: "/api/bootstrap",
      headers: [],
      query: [],
      bodyMode: "none",
      bodyTemplate: "",
      tags: ["platform", "template"]
    },
    updateBody: {
      moduleId: "{{env.variables.platformModuleId}}",
      name: "账号登录",
      method: "POST",
      path: "/api/auth/login",
      headers: [{ key: "content-type", value: "application/json" }],
      query: [],
      bodyMode: "json",
      bodyTemplate: {
        username: "admin",
        password: "admin123"
      },
      tags: ["platform", "auth", "core"]
    }
  },
  {
    key: "cases",
    label: "用例",
    idTemplate: "{{env.variables.platformCaseId}}",
    createBody: {
      id: "case_{{random}}",
      apiId: "{{env.variables.platformApiId}}",
      name: "平台模板用例{{random}}",
      description: "系统内置用例创建模板。",
      priority: "medium",
      tags: ["platform", "template"],
      assertions: [{ type: "status", expected: 200 }],
      extracts: [],
      preScript: "",
      postScript: "",
      overrides: {}
    },
    updateBody: {
      apiId: "{{env.variables.platformApiId}}",
      name: "管理员账号登录成功",
      description: "使用默认管理员账号登录平台。",
      priority: "high",
      tags: ["platform", "auth", "smoke"],
      assertions: [
        { type: "status", expected: 200 },
        { type: "fieldType", path: "$.token", expected: "string" }
      ],
      extracts: [{ name: "sessionToken", source: "jsonPath", path: "$.token" }],
      preScript: "",
      postScript: "",
      overrides: {}
    }
  },
  {
    key: "datasets",
    label: "数据集",
    idTemplate: "{{env.variables.platformDatasetId}}",
    createBody: {
      id: "dataset_{{random}}",
      name: "平台模板数据集{{random}}",
      description: "系统内置数据集创建模板。",
      scope: "suite",
      tags: ["platform", "template"],
      rows: [{ id: "row_1", name: "默认数据行", variables: { sample: "value" } }]
    },
    updateBody: {
      name: "平台内置样例数据集",
      description: "用于平台自身接口模板测试。",
      scope: "suite",
      tags: ["platform", "template"],
      rows: [{ id: "row_1", name: "默认数据行", variables: { sample: "value" } }]
    }
  },
  {
    key: "environments",
    label: "环境",
    idTemplate: "{{env.variables.platformEnvironmentId}}",
    createBody: {
      id: "env_{{random}}",
      name: "平台模板环境{{random}}",
      description: "系统内置环境创建模板。",
      baseUrl: "{{env.variables.platformBaseUrl}}",
      headers: {},
      variables: {},
      auth: {
        type: "apikey",
        header: "x-session-token",
        value: "token_admin_flowforge"
      }
    },
    updateBody: {
      name: "平台本地环境",
      description: "指向当前自动化测试平台后端服务。",
      baseUrl: "{{env.variables.platformBaseUrl}}",
      headers: {},
      variables: {},
      auth: {
        type: "apikey",
        header: "x-session-token",
        value: "token_admin_flowforge"
      }
    }
  },
  {
    key: "suites",
    label: "场景",
    idTemplate: "{{env.variables.platformSuiteId}}",
    createBody: {
      id: "suite_{{random}}",
      projectId: "{{env.variables.platformProjectId}}",
      name: "平台模板场景{{random}}",
      description: "系统内置场景创建模板。",
      defaultEnvironmentId: "{{env.variables.platformEnvironmentId}}",
      failureStrategy: "stop",
      timeoutSeconds: 300,
      continueOnFailure: false,
      variables: {},
      executionConfig: {
        priority: "normal",
        maxRetries: 0,
        stopOnDatasetFailure: true
      },
      items: [{ id: "suite_item_1", caseId: "{{env.variables.platformCaseId}}", order: 1, continueOnFailure: false }],
      scenarioAssertions: [],
      schedule: {
        enabled: false,
        intervalMinutes: 30
      },
      tags: ["platform", "template"]
    },
    updateBody: {
      projectId: "{{env.variables.platformProjectId}}",
      name: "平台核心接口冒烟",
      description: "串联登录、身份校验、引导、总览、变量、调度与报告接口。",
      defaultEnvironmentId: "{{env.variables.platformEnvironmentId}}",
      failureStrategy: "stop",
      timeoutSeconds: 300,
      continueOnFailure: false,
      variables: {},
      executionConfig: {
        priority: "normal",
        maxRetries: 0,
        stopOnDatasetFailure: true
      },
      items: [{ id: "suite_item_template", caseId: "{{env.variables.platformCaseId}}", order: 1, continueOnFailure: false }],
      scenarioAssertions: [],
      schedule: {
        enabled: false,
        intervalMinutes: 30
      },
      tags: ["platform", "smoke", "core"]
    }
  }
];

function buildTemplateApi(id, moduleIdValue, name, method, path, tags = [], bodyMode = "none", bodyTemplate = "", query = [], headers = [], createdAt) {
  return {
    id,
    moduleId: moduleIdValue,
    creator: "系统",
    status: "active",
    name,
    method,
    path,
    headers,
    query,
    bodyMode,
    bodyTemplate,
    preSteps: [],
    postSteps: [],
    tags,
    createdAt,
    updatedAt: createdAt
  };
}

function buildTemplateCase(id, apiId, name, description, priority, tags = [], assertions = [{ type: "status", expected: 200 }], createdAt) {
  return {
    id,
    apiId,
    creator: "系统",
    priority,
    name,
    description,
    tags,
    assertions,
    extracts: [],
    preScript: "",
    postScript: "",
    overrides: {},
    createdAt,
    updatedAt: createdAt
  };
}

function buildManagedCollectionApis(at) {
  return collectionTemplates.flatMap((item, index) => {
    const offset = 200 + index * 8;
    return [
      buildTemplateApi(`api_${item.key}_list`, assetsModuleId, `${item.label}列表`, "GET", `/api/${item.key}`, ["platform", "assets", item.key], "none", "", [], [], at(offset)),
      buildTemplateApi(`api_${item.key}_detail`, assetsModuleId, `${item.label}详情`, "GET", `/api/${item.key}/${item.idTemplate}`, ["platform", "assets", item.key, "template"], "none", "", [], [], at(offset + 1)),
      buildTemplateApi(
        `api_${item.key}_create`,
        assetsModuleId,
        `创建${item.label}`,
        "POST",
        `/api/${item.key}`,
        ["platform", "assets", item.key, "template", "write"],
        "json",
        item.createBody,
        [],
        [{ key: "content-type", value: "application/json" }],
        at(offset + 2)
      ),
      buildTemplateApi(
        `api_${item.key}_update`,
        assetsModuleId,
        `更新${item.label}`,
        "PUT",
        `/api/${item.key}/${item.idTemplate}`,
        ["platform", "assets", item.key, "template", "write"],
        "json",
        item.updateBody,
        [],
        [{ key: "content-type", value: "application/json" }],
        at(offset + 3)
      )
    ];
  });
}

function buildManagedCollectionCases(at) {
  return collectionTemplates.flatMap((item, index) => {
    const offset = 320 + index * 8;
    return [
      buildTemplateCase(`case_${item.key}_list`, `api_${item.key}_list`, `读取${item.label}列表`, `校验平台${item.label}列表接口可访问。`, "medium", ["platform", "assets", item.key], [{ type: "status", expected: 200 }, { type: "fieldType", path: "$", expected: "array" }], at(offset)),
      buildTemplateCase(`case_${item.key}_detail`, `api_${item.key}_detail`, `读取${item.label}详情`, `校验平台${item.label}详情接口模板。`, "medium", ["platform", "assets", item.key, "template"], [{ type: "status", expected: 200 }, { type: "fieldType", path: "$.id", expected: "string" }], at(offset + 1)),
      buildTemplateCase(`case_${item.key}_create`, `api_${item.key}_create`, `创建${item.label}模板`, `创建${item.label}模板数据，运行后会写入新记录。`, "low", ["platform", "assets", item.key, "template", "write"], [{ type: "status", expected: 201 }, { type: "fieldType", path: "$.id", expected: "string" }], at(offset + 2)),
      buildTemplateCase(`case_${item.key}_update`, `api_${item.key}_update`, `更新${item.label}模板`, `回写平台内置${item.label}样例数据。`, "low", ["platform", "assets", item.key, "template", "write"], [{ type: "status", expected: 200 }, { type: "fieldType", path: "$.id", expected: "string" }], at(offset + 3))
    ];
  });
}

function buildRuntimeApis(at) {
  return [
    buildTemplateApi("api_auth_logout", runtimeModuleId, "账号登出", "POST", "/api/auth/logout", ["platform", "auth", "session"], "none", "", [], [], at(500)),
    buildTemplateApi(
      "api_auth_change_password",
      runtimeModuleId,
      "修改当前密码",
      "POST",
      "/api/auth/change-password",
      ["platform", "auth", "template"],
      "json",
      { currentPassword: "wrong-password", nextPassword: "newpass123" },
      [],
      [{ key: "content-type", value: "application/json" }],
      at(501)
    ),
    buildTemplateApi("api_admin_seed", runtimeModuleId, "补充平台样例数据", "POST", "/api/admin/seed", ["platform", "admin", "seed"], "json", {}, [], [{ key: "content-type", value: "application/json" }], at(502)),
    buildTemplateApi("api_versions_list", runtimeModuleId, "版本列表", "GET", "/api/versions", ["platform", "governance", "versions"], "none", "", [], [], at(503)),
    buildTemplateApi("api_version_impact", runtimeModuleId, "版本影响分析", "GET", "/api/versions/{{env.variables.platformVersionId}}/impact", ["platform", "governance", "versions", "template"], "none", "", [], [], at(504)),
    buildTemplateApi("api_version_restore", runtimeModuleId, "恢复指定版本", "POST", "/api/versions/{{env.variables.platformVersionId}}/restore", ["platform", "governance", "versions", "template", "write"], "none", "", [], [], at(505)),
    buildTemplateApi("api_audit_logs", runtimeModuleId, "审计日志列表", "GET", "/api/audit-logs", ["platform", "governance", "audit"], "none", "", [], [], at(506)),
    buildTemplateApi("api_audit_logs_export", runtimeModuleId, "导出审计日志", "GET", "/api/audit-logs/export", ["platform", "governance", "audit"], "none", "", [], [], at(507)),
    buildTemplateApi("api_scheduler_refresh", runtimeModuleId, "刷新调度中心", "POST", "/api/scheduler/refresh", ["platform", "scheduler", "write"], "none", "", [], [], at(508)),
    buildTemplateApi(
      "api_runs_trigger",
      runtimeModuleId,
      "触发场景执行",
      "POST",
      "/api/runs",
      ["platform", "execution", "write"],
      "json",
      {
        suiteId: "{{env.variables.platformSuiteId}}",
        environmentId: "{{env.variables.platformEnvironmentId}}"
      },
      [],
      [{ key: "content-type", value: "application/json" }],
      at(509)
    ),
    buildTemplateApi(
      "api_runs_batch_cases",
      runtimeModuleId,
      "批量执行用例",
      "POST",
      "/api/runs/batch-cases",
      ["platform", "execution", "write"],
      "json",
      {
        caseIds: ["case_auth_login", "case_auth_me"],
        projectId: "{{env.variables.platformProjectId}}",
        environmentId: "{{env.variables.platformEnvironmentId}}"
      },
      [],
      [{ key: "content-type", value: "application/json" }],
      at(510)
    ),
    buildTemplateApi("api_run_detail", runtimeModuleId, "执行详情", "GET", "/api/runs/{{env.variables.platformRunId}}", ["platform", "execution", "template"], "none", "", [], [], at(511)),
    buildTemplateApi("api_run_share", runtimeModuleId, "执行分享信息", "GET", "/api/runs/{{env.variables.platformRunId}}/share", ["platform", "execution", "template"], "none", "", [], [], at(512)),
    buildTemplateApi("api_run_cancel", runtimeModuleId, "取消执行", "POST", "/api/runs/{{env.variables.platformRunId}}/cancel", ["platform", "execution", "template", "write"], "none", "", [], [], at(513)),
    buildTemplateApi("api_run_retry", runtimeModuleId, "重试执行", "POST", "/api/runs/{{env.variables.platformRunId}}/retry", ["platform", "execution", "template", "write"], "none", "", [], [], at(514)),
    buildTemplateApi("api_run_retry_failed", runtimeModuleId, "重跑失败步骤", "POST", "/api/runs/{{env.variables.platformRunId}}/retry-failed", ["platform", "execution", "template", "write"], "none", "", [], [], at(515)),
    buildTemplateApi(
      "api_ci_trigger",
      runtimeModuleId,
      "CI 触发执行",
      "POST",
      "/api/ci/trigger",
      ["platform", "ci", "write"],
      "json",
      {
        suiteId: "{{env.variables.platformSuiteId}}",
        environmentId: "{{env.variables.platformEnvironmentId}}"
      },
      [],
      [
        { key: "content-type", value: "application/json" },
        { key: "x-ci-token", value: "local-ci-token" }
      ],
      at(516)
    ),
    buildTemplateApi(
      "api_import_openapi",
      assetsModuleId,
      "导入 OpenAPI",
      "POST",
      "/api/import/openapi",
      ["platform", "assets", "openapi", "write"],
      "json",
      {
        moduleId: "{{env.variables.platformAssetsModuleId}}",
        spec: {
          openapi: "3.0.0",
          info: { title: "Platform Import Template", version: "1.0.0" },
          paths: {
            "/platform/template": {
              get: {
                responses: {
                  "200": {
                    description: "ok",
                    content: {
                      "application/json": {
                        schema: {
                          type: "object",
                          properties: {
                            status: { type: "string" }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      [],
      [{ key: "content-type", value: "application/json" }],
      at(517)
    ),
    buildTemplateApi("api_user_revoke_sessions", runtimeModuleId, "回收用户登录会话", "POST", "/api/users/{{env.variables.platformTemplateUserId}}/revoke-sessions", ["platform", "users", "template", "write"], "none", "", [], [], at(518)),
    buildTemplateApi("api_user_reset_password", runtimeModuleId, "重置用户密码", "POST", "/api/users/{{env.variables.platformTemplateUserId}}/reset-password", ["platform", "users", "template", "write"], "none", "", [], [], at(519))
  ];
}

function buildRuntimeCases(at) {
  return [
    buildTemplateCase("case_auth_logout", "api_auth_logout", "执行账号登出", "校验当前登录态可正常登出。", "medium", ["platform", "auth", "session"], [{ type: "status", expected: 200 }, { type: "jsonPath", path: "$.success", expected: true }], at(620)),
    buildTemplateCase("case_auth_change_password_template", "api_auth_change_password", "修改密码模板", "使用错误旧密码验证接口校验逻辑，默认返回 400。", "low", ["platform", "auth", "template"], [{ type: "status", expected: 400 }], at(621)),
    buildTemplateCase("case_admin_seed", "api_admin_seed", "补充平台样例数据", "补充平台内置样例资产。", "medium", ["platform", "admin", "seed"], [{ type: "status", expected: 201 }], at(622)),
    buildTemplateCase("case_versions_list", "api_versions_list", "读取版本列表", "校验平台版本列表接口。", "medium", ["platform", "governance", "versions"], [{ type: "status", expected: 200 }, { type: "fieldType", path: "$", expected: "array" }], at(623)),
    buildTemplateCase("case_version_impact_template", "api_version_impact", "版本影响分析模板", "默认使用占位版本 ID，校验错误返回。", "low", ["platform", "governance", "versions", "template"], [{ type: "status", expected: 400 }], at(624)),
    buildTemplateCase("case_version_restore_template", "api_version_restore", "恢复版本模板", "默认使用占位版本 ID，校验错误返回。", "low", ["platform", "governance", "versions", "template"], [{ type: "status", expected: 400 }], at(625)),
    buildTemplateCase("case_audit_logs", "api_audit_logs", "读取审计日志", "校验审计日志列表返回数组。", "medium", ["platform", "governance", "audit"], [{ type: "status", expected: 200 }, { type: "fieldType", path: "$", expected: "array" }], at(626)),
    buildTemplateCase("case_audit_logs_export", "api_audit_logs_export", "导出审计日志", "校验审计日志导出内容。", "medium", ["platform", "governance", "audit"], [{ type: "status", expected: 200 }, { type: "bodyContains", expected: "Time,Actor" }], at(627)),
    buildTemplateCase("case_scheduler_refresh", "api_scheduler_refresh", "刷新调度中心", "校验调度刷新接口返回结构。", "medium", ["platform", "scheduler"], [{ type: "status", expected: 200 }, { type: "fieldType", path: "$.summary", expected: "object" }], at(628)),
    buildTemplateCase("case_runs_trigger", "api_runs_trigger", "触发平台场景执行", "触发平台内置冒烟场景执行。", "medium", ["platform", "execution", "write"], [{ type: "status", expected: 201 }, { type: "fieldType", path: "$.id", expected: "string" }], at(629)),
    buildTemplateCase("case_runs_batch_cases", "api_runs_batch_cases", "批量执行平台用例", "批量执行平台内置登录与登录态用例。", "medium", ["platform", "execution", "write"], [{ type: "status", expected: 201 }, { type: "fieldType", path: "$.id", expected: "string" }], at(630)),
    buildTemplateCase("case_run_detail_template", "api_run_detail", "读取执行详情模板", "默认使用占位执行 ID，校验 404。", "low", ["platform", "execution", "template"], [{ type: "status", expected: 404 }], at(631)),
    buildTemplateCase("case_run_share_template", "api_run_share", "读取执行分享模板", "默认使用占位执行 ID，校验 404。", "low", ["platform", "execution", "template"], [{ type: "status", expected: 404 }], at(632)),
    buildTemplateCase("case_run_cancel_template", "api_run_cancel", "取消执行模板", "默认使用占位执行 ID，校验 404。", "low", ["platform", "execution", "template"], [{ type: "status", expected: 404 }], at(633)),
    buildTemplateCase("case_run_retry_template", "api_run_retry", "重试执行模板", "默认使用占位执行 ID，校验 404。", "low", ["platform", "execution", "template"], [{ type: "status", expected: 404 }], at(634)),
    buildTemplateCase("case_run_retry_failed_template", "api_run_retry_failed", "重跑失败步骤模板", "默认使用占位执行 ID，校验 404。", "low", ["platform", "execution", "template"], [{ type: "status", expected: 404 }], at(635)),
    buildTemplateCase("case_ci_trigger", "api_ci_trigger", "通过 CI 触发执行", "使用平台内置 CI Token 触发场景执行。", "medium", ["platform", "ci"], [{ type: "status", expected: 201 }, { type: "fieldType", path: "$.id", expected: "string" }], at(636)),
    buildTemplateCase("case_import_openapi", "api_import_openapi", "导入 OpenAPI 模板", "导入最小 OpenAPI 模板以验证导入链路。", "low", ["platform", "assets", "openapi", "template"], [{ type: "status", expected: 201 }, { type: "fieldType", path: "$.apis", expected: "array" }], at(637)),
    buildTemplateCase("case_user_revoke_sessions_template", "api_user_revoke_sessions", "回收用户会话模板", "默认使用占位用户 ID，校验 400。", "low", ["platform", "users", "template"], [{ type: "status", expected: 400 }], at(638)),
    buildTemplateCase("case_user_reset_password_template", "api_user_reset_password", "重置用户密码模板", "默认使用占位用户 ID，校验 400。", "low", ["platform", "users", "template"], [{ type: "status", expected: 400 }], at(639))
  ];
}

function buildFullInspectionSuite(snapshot, at) {
  const preferredCaseOrder = [
    "case_auth_login",
    "case_auth_me",
    "case_bootstrap",
    "case_overview",
    "case_globals",
    "case_scheduler_center",
    "case_report_summary",
    "case_report_insights",
    "case_runs_list",
    "case_governance_summary"
  ];

  const caseMap = new Map((snapshot.cases ?? []).map((item) => [item.id, item]));
  const orderedIds = [
    ...preferredCaseOrder.filter((id) => caseMap.has(id)),
    ...(snapshot.cases ?? [])
      .map((item) => item.id)
      .filter((id) => !preferredCaseOrder.includes(id))
  ];

  return {
    id: "suite_platform_full_regression",
    projectId,
    name: "平台全量巡检",
    description: "覆盖平台内置接口与测试用例的全量巡检场景，默认跳过会使共享鉴权失效的登出步骤。",
    creator: "系统",
    tags: ["platform", "full", "regression"],
    variables: {},
    items: orderedIds.map((caseId, index) => ({
      id: `suite_item_full_${String(index + 1).padStart(3, "0")}`,
      caseId,
      order: index + 1,
      continueOnFailure: false,
      enabled: caseId !== "case_auth_logout"
    })),
    scenarioAssertions: [
      {
        type: "custom",
        script: "assert(vars.sessionToken || true, 'sessionToken should be available after login');"
      }
    ],
    schedule: {
      enabled: false,
      intervalMinutes: 60
    },
    defaultEnvironmentId: environmentId,
    timeoutSeconds: 600,
    failureStrategy: "stop",
    continueOnFailure: false,
    executionConfig: {
      priority: "high",
      maxRetries: 0,
      stopOnDatasetFailure: true
    },
    createdAt: at(43),
    updatedAt: at(43)
  };
}

export function createSampleData(port = 3000) {
  const baseTime = Date.parse(nowIso());
  const at = (offsetSeconds) => new Date(baseTime + offsetSeconds * 1000).toISOString();

  const platformBaseUrl = `http://localhost:${port}`;

  const snapshot = {
    settings: {
      appName: "FlowForge API Lab",
      ciToken: "local-ci-token",
      currentUser: "系统"
    },
    users: [
      {
        id: "user_admin",
        name: "平台管理员",
        username: "admin",
        password: "admin123",
        authToken: "token_admin_flowforge",
        role: "admin",
        status: "active",
        creator: "系统",
        createdAt: at(-3)
      },
      {
        id: "user_editor",
        name: "测试开发",
        username: "editor",
        password: "editor123",
        authToken: "token_editor_flowforge",
        role: "editor",
        status: "active",
        creator: "系统",
        createdAt: at(-2)
      },
      {
        id: "user_viewer",
        name: "业务只读",
        username: "viewer",
        password: "viewer123",
        authToken: "token_viewer_flowforge",
        role: "viewer",
        status: "active",
        creator: "系统",
        createdAt: at(-1)
      }
    ],
    projects: [
      {
        id: projectId,
        name: "自动化测试平台",
        description: "平台自身后端接口管理与接口测试资产。",
        createdAt: at(1),
        updatedAt: at(1)
      }
    ],
    services: [
      {
        id: serviceId,
        projectId,
        name: "platform-backend",
        description: "自动化测试平台后端服务。",
        createdAt: at(2),
        updatedAt: at(2)
      }
    ],
    modules: [
      {
        id: moduleId,
        serviceId,
        name: "core-api",
        description: "登录、概览、调度、报告、执行等核心接口。",
        createdAt: at(3),
        updatedAt: at(3)
      },
      {
        id: assetsModuleId,
        serviceId,
        name: "assets-api",
        description: "平台资产管理、集合读写和 OpenAPI 导入接口。",
        createdAt: at(4),
        updatedAt: at(4)
      },
      {
        id: runtimeModuleId,
        serviceId,
        name: "runtime-api",
        description: "平台运行、治理、调度、执行与系统操作接口。",
        createdAt: at(5),
        updatedAt: at(5)
      }
    ],
    apis: [
      {
        id: "api_auth_login",
        moduleId,
        creator: "系统",
        status: "active",
        name: "账号登录",
        method: "POST",
        path: "/api/auth/login",
        headers: [{ key: "content-type", value: "application/json" }],
        query: [],
        bodyMode: "json",
        bodyTemplate: {
          username: "admin",
          password: "admin123"
        },
        preSteps: [],
        postSteps: [],
        tags: ["platform", "auth", "core"],
        createdAt: at(10),
        updatedAt: at(10)
      },
      {
        id: "api_auth_me",
        moduleId,
        creator: "系统",
        status: "active",
        name: "当前登录用户",
        method: "GET",
        path: "/api/auth/me",
        headers: [{ key: "x-session-token", value: "{{vars.sessionToken}}" }],
        query: [],
        bodyMode: "none",
        bodyTemplate: "",
        preSteps: [],
        postSteps: [],
        tags: ["platform", "auth", "core"],
        createdAt: at(11),
        updatedAt: at(11)
      },
      {
        id: "api_bootstrap",
        moduleId,
        creator: "系统",
        status: "active",
        name: "平台引导数据",
        method: "GET",
        path: "/api/bootstrap",
        headers: [],
        query: [],
        bodyMode: "none",
        bodyTemplate: "",
        preSteps: [],
        postSteps: [],
        tags: ["platform", "bootstrap", "core"],
        createdAt: at(12),
        updatedAt: at(12)
      },
      {
        id: "api_overview",
        moduleId,
        creator: "系统",
        status: "active",
        name: "工作台总览",
        method: "GET",
        path: "/api/overview",
        headers: [],
        query: [],
        bodyMode: "none",
        bodyTemplate: "",
        preSteps: [],
        postSteps: [],
        tags: ["platform", "overview", "core"],
        createdAt: at(13),
        updatedAt: at(13)
      },
      {
        id: "api_globals",
        moduleId,
        creator: "系统",
        status: "active",
        name: "全局变量列表",
        method: "GET",
        path: "/api/globals",
        headers: [],
        query: [],
        bodyMode: "none",
        bodyTemplate: "",
        preSteps: [],
        postSteps: [],
        tags: ["platform", "variables"],
        createdAt: at(14),
        updatedAt: at(14)
      },
      {
        id: "api_scheduler_center",
        moduleId,
        creator: "系统",
        status: "active",
        name: "定时调度中心",
        method: "GET",
        path: "/api/scheduler",
        headers: [],
        query: [],
        bodyMode: "none",
        bodyTemplate: "",
        preSteps: [],
        postSteps: [],
        tags: ["platform", "scheduler", "core"],
        createdAt: at(15),
        updatedAt: at(15)
      },
      {
        id: "api_report_summary",
        moduleId,
        creator: "系统",
        status: "active",
        name: "报告汇总",
        method: "GET",
        path: "/api/reports/summary",
        headers: [],
        query: [
          { key: "range", value: "7d" },
          { key: "moduleId", value: "all" }
        ],
        bodyMode: "none",
        bodyTemplate: "",
        preSteps: [],
        postSteps: [],
        tags: ["platform", "reports", "core"],
        createdAt: at(16),
        updatedAt: at(16)
      },
      {
        id: "api_report_insights",
        moduleId,
        creator: "系统",
        status: "active",
        name: "报告洞察",
        method: "GET",
        path: "/api/reports/insights",
        headers: [],
        query: [
          { key: "range", value: "7d" },
          { key: "moduleId", value: "all" }
        ],
        bodyMode: "none",
        bodyTemplate: "",
        preSteps: [],
        postSteps: [],
        tags: ["platform", "reports"],
        createdAt: at(17),
        updatedAt: at(17)
      },
      {
        id: "api_runs_list",
        moduleId,
        creator: "系统",
        status: "active",
        name: "执行记录列表",
        method: "GET",
        path: "/api/runs",
        headers: [],
        query: [],
        bodyMode: "none",
        bodyTemplate: "",
        preSteps: [],
        postSteps: [],
        tags: ["platform", "execution"],
        createdAt: at(18),
        updatedAt: at(18)
      },
      {
        id: "api_governance_summary",
        moduleId,
        creator: "系统",
        status: "active",
        name: "治理概览",
        method: "GET",
        path: "/api/governance/summary",
        headers: [],
        query: [],
        bodyMode: "none",
        bodyTemplate: "",
        preSteps: [],
        postSteps: [],
        tags: ["platform", "governance"],
        createdAt: at(19),
        updatedAt: at(19)
      }
    ].concat(buildManagedCollectionApis(at), buildRuntimeApis(at)),
    cases: [
      {
        id: "case_auth_login",
        apiId: "api_auth_login",
        creator: "系统",
        priority: "high",
        name: "管理员账号登录成功",
        description: "使用默认管理员账号登录平台。",
        tags: ["platform", "auth", "smoke"],
        assertions: [
          { type: "status", expected: 200 },
          { type: "fieldType", path: "$.token", expected: "string" },
          { type: "jsonPath", path: "$.user.username", expected: "admin" }
        ],
        extracts: [{ name: "sessionToken", source: "jsonPath", path: "$.token" }],
        preScript: "",
        postScript: "",
        overrides: {},
        createdAt: at(30),
        updatedAt: at(30)
      },
      {
        id: "case_auth_me",
        apiId: "api_auth_me",
        creator: "系统",
        priority: "high",
        name: "读取当前登录用户",
        description: "校验登录态和当前用户结构。",
        tags: ["platform", "auth", "smoke"],
        assertions: [
          { type: "status", expected: 200 },
          { type: "jsonPath", path: "$.user.username", expected: "admin" },
          { type: "jsonPath", path: "$.user.role", expected: "admin" }
        ],
        extracts: [],
        preScript: "",
        postScript: "",
        overrides: {},
        createdAt: at(31),
        updatedAt: at(31)
      },
      {
        id: "case_bootstrap",
        apiId: "api_bootstrap",
        creator: "系统",
        priority: "high",
        name: "读取平台引导数据",
        description: "校验 bootstrap 结构和运行时元信息。",
        tags: ["platform", "bootstrap", "smoke"],
        assertions: [
          { type: "status", expected: 200 },
          { type: "jsonPath", path: "$.settings.appName", expected: "FlowForge API Lab" },
          { type: "fieldType", path: "$.projects", expected: "array" },
          { type: "fieldType", path: "$.queue", expected: "object" }
        ],
        extracts: [],
        preScript: "",
        postScript: "",
        overrides: {},
        createdAt: at(32),
        updatedAt: at(32)
      },
      {
        id: "case_overview",
        apiId: "api_overview",
        creator: "系统",
        priority: "medium",
        name: "读取工作台总览",
        description: "校验趋势、最近运行和统计结构。",
        tags: ["platform", "overview"],
        assertions: [
          { type: "status", expected: 200 },
          { type: "fieldType", path: "$.trend", expected: "array" },
          { type: "fieldType", path: "$.recentRuns", expected: "array" },
          { type: "fieldType", path: "$.runningCount", expected: "number" }
        ],
        extracts: [],
        preScript: "",
        postScript: "",
        overrides: {},
        createdAt: at(33),
        updatedAt: at(33)
      },
      {
        id: "case_globals",
        apiId: "api_globals",
        creator: "系统",
        priority: "medium",
        name: "读取全局变量列表",
        description: "校验变量接口返回数组。",
        tags: ["platform", "variables"],
        assertions: [
          { type: "status", expected: 200 },
          { type: "fieldType", path: "$", expected: "array" }
        ],
        extracts: [],
        preScript: "",
        postScript: "",
        overrides: {},
        createdAt: at(34),
        updatedAt: at(34)
      },
      {
        id: "case_scheduler_center",
        apiId: "api_scheduler_center",
        creator: "系统",
        priority: "medium",
        name: "读取定时调度中心",
        description: "校验调度中心摘要和计划数组。",
        tags: ["platform", "scheduler"],
        assertions: [
          { type: "status", expected: 200 },
          { type: "fieldType", path: "$.summary", expected: "object" },
          { type: "fieldType", path: "$.schedules", expected: "array" }
        ],
        extracts: [],
        preScript: "",
        postScript: "",
        overrides: {},
        createdAt: at(35),
        updatedAt: at(35)
      },
      {
        id: "case_report_summary",
        apiId: "api_report_summary",
        creator: "系统",
        priority: "medium",
        name: "读取报告汇总",
        description: "校验报告摘要和模块统计结构。",
        tags: ["platform", "reports"],
        assertions: [
          { type: "status", expected: 200 },
          { type: "fieldType", path: "$.summary", expected: "object" },
          { type: "fieldType", path: "$.moduleStats", expected: "array" }
        ],
        extracts: [],
        preScript: "",
        postScript: "",
        overrides: {},
        createdAt: at(36),
        updatedAt: at(36)
      },
      {
        id: "case_report_insights",
        apiId: "api_report_insights",
        creator: "系统",
        priority: "medium",
        name: "读取报告洞察",
        description: "校验慢用例和失败聚类结构。",
        tags: ["platform", "reports"],
        assertions: [
          { type: "status", expected: 200 },
          { type: "fieldType", path: "$.slowCases", expected: "array" },
          { type: "fieldType", path: "$.failureClusters", expected: "array" }
        ],
        extracts: [],
        preScript: "",
        postScript: "",
        overrides: {},
        createdAt: at(37),
        updatedAt: at(37)
      },
      {
        id: "case_runs_list",
        apiId: "api_runs_list",
        creator: "系统",
        priority: "low",
        name: "读取执行记录列表",
        description: "校验执行中心列表返回数组。",
        tags: ["platform", "execution"],
        assertions: [
          { type: "status", expected: 200 },
          { type: "fieldType", path: "$", expected: "array" }
        ],
        extracts: [],
        preScript: "",
        postScript: "",
        overrides: {},
        createdAt: at(38),
        updatedAt: at(38)
      },
      {
        id: "case_governance_summary",
        apiId: "api_governance_summary",
        creator: "系统",
        priority: "low",
        name: "读取治理概览",
        description: "校验治理中心摘要结构。",
        tags: ["platform", "governance"],
        assertions: [
          { type: "status", expected: 200 },
          { type: "fieldType", path: "$.users", expected: "array" },
          { type: "fieldType", path: "$.security", expected: "object" }
        ],
        extracts: [],
        preScript: "",
        postScript: "",
        overrides: {},
        createdAt: at(39),
        updatedAt: at(39)
      }
    ].concat(buildManagedCollectionCases(at), buildRuntimeCases(at)),
    datasets: [
      {
        id: datasetSeedId,
        name: "平台内置样例数据集",
        description: "用于平台自身接口模板测试。",
        scope: "suite",
        tags: ["platform", "template"],
        rows: [{ id: "row_1", name: "默认数据行", variables: { sample: "value" } }],
        creator: "系统",
        createdAt: at(39.5),
        updatedAt: at(39.5)
      }
    ],
    environments: [
      {
        id: environmentId,
        name: "平台本地环境",
        description: "指向当前自动化测试平台后端服务。",
        baseUrl: platformBaseUrl,
        headers: {},
        variables: {
          platformBaseUrl,
          platformUserId: "user_admin",
          platformProjectId: projectId,
          platformServiceId: serviceId,
          platformModuleId: moduleId,
          platformAssetsModuleId: assetsModuleId,
          platformRuntimeModuleId: runtimeModuleId,
          platformApiId: "api_auth_login",
          platformCaseId: "case_auth_login",
          platformDatasetId: datasetSeedId,
          platformEnvironmentId: environmentId,
          platformSuiteId: "suite_platform_core_smoke",
          platformRunId: "run_placeholder",
          platformVersionId: "version_placeholder",
          platformTemplateUserId: "user_template_placeholder"
        },
        auth: {
          type: "apikey",
          header: "x-session-token",
          value: "token_admin_flowforge"
        },
        creator: "系统",
        createdAt: at(40),
        updatedAt: at(40)
      }
    ],
    suites: [
      {
        id: "suite_platform_core_smoke",
        projectId,
        name: "平台核心接口冒烟",
        description: "串联登录、身份校验、引导、总览、变量、调度与报告接口。",
        creator: "系统",
        tags: ["platform", "smoke", "core"],
        variables: {},
        items: [
          {
            id: "suite_item_login",
            caseId: "case_auth_login",
            order: 1,
            continueOnFailure: false
          },
          {
            id: "suite_item_auth_me",
            caseId: "case_auth_me",
            order: 2,
            continueOnFailure: false
          },
          {
            id: "suite_item_bootstrap",
            caseId: "case_bootstrap",
            order: 3,
            continueOnFailure: false
          },
          {
            id: "suite_item_overview",
            caseId: "case_overview",
            order: 4,
            continueOnFailure: false
          },
          {
            id: "suite_item_globals",
            caseId: "case_globals",
            order: 5,
            continueOnFailure: false
          },
          {
            id: "suite_item_scheduler",
            caseId: "case_scheduler_center",
            order: 6,
            continueOnFailure: false
          },
          {
            id: "suite_item_report_summary",
            caseId: "case_report_summary",
            order: 7,
            continueOnFailure: false
          }
        ],
        scenarioAssertions: [
          {
            type: "status",
            expected: "passed"
          }
        ],
        schedule: {
          enabled: false,
          intervalMinutes: 30
        },
        defaultEnvironmentId: environmentId,
        timeoutSeconds: 120,
        failureStrategy: "stop",
        continueOnFailure: false,
        executionConfig: {
          priority: "normal",
          maxRetries: 0,
          stopOnDatasetFailure: true
        },
        createdAt: at(41),
        updatedAt: at(41)
      },
      {
        id: "suite_platform_report_governance",
        projectId,
        name: "平台报告与治理巡检",
        description: "串联报告洞察、执行记录和治理概览等后台能力。",
        creator: "系统",
        tags: ["platform", "reports", "governance"],
        variables: {},
        items: [
          {
            id: "suite_item_bootstrap_b",
            caseId: "case_bootstrap",
            order: 1,
            continueOnFailure: false
          },
          {
            id: "suite_item_report_insights",
            caseId: "case_report_insights",
            order: 2,
            continueOnFailure: false
          },
          {
            id: "suite_item_runs",
            caseId: "case_runs_list",
            order: 3,
            continueOnFailure: false
          },
          {
            id: "suite_item_governance",
            caseId: "case_governance_summary",
            order: 4,
            continueOnFailure: false
          }
        ],
        scenarioAssertions: [
          {
            type: "status",
            expected: "passed"
          }
        ],
        schedule: {
          enabled: false,
          intervalMinutes: 30
        },
        defaultEnvironmentId: environmentId,
        timeoutSeconds: 120,
        failureStrategy: "stop",
        continueOnFailure: false,
        executionConfig: {
          priority: "normal",
          maxRetries: 0,
          stopOnDatasetFailure: true
        },
        createdAt: at(42),
        updatedAt: at(42)
      }
    ],
    versions: [],
    auditLogs: [],
    runs: []
  };

  snapshot.suites.push(buildFullInspectionSuite(snapshot, at));
  return snapshot;
}
