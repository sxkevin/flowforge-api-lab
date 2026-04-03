export function createCollectionsModule(ctx) {
  const {
    state,
    api,
    buildViewModel,
    buildGlobalVariables,
    buildTrendSeries,
    buildExecutionTasks,
    refreshData,
    renderUserGovernancePage,
    renderStatCard,
    renderQuickAction,
    renderSearchBox,
    renderSelectControl,
    renderFilterButton,
    formatDate,
    formatDateTime,
    formatDuration,
    formatNumber,
    calcTrend,
    escapeHtml,
    rowsOrAllOption,
    statusText,
    showToast,
    svgCheck,
    svgCross,
    svgClock,
    svgWarning,
    svgTrend,
    svgFlow,
    svgGear,
    svgTrash,
    svgArrowDown,
    svgGlobe,
    svgCheckOutline,
    svgWarningOutline,
    renderLineChart
  } = ctx;

  function isSelected(collection, id) {
    return Boolean(collection && id && state.selections[collection]?.includes(id));
  }

  function filterApiRows(model) {
    const filters = state.filters.apis;
    return model.apis.filter((item) => {
      const matchesQ =
        !filters.q ||
        item.name.includes(filters.q) ||
        item.path.includes(filters.q) ||
        item.groupName.includes(filters.q);
      const matchesModule = filters.moduleId === "all" || item.moduleId === filters.moduleId;
      const matchesMethod = filters.method === "all" || item.method === filters.method;
      return matchesQ && matchesModule && matchesMethod;
    });
  }

  function filterCaseRows(model) {
    const filters = state.filters.cases;
    return model.cases.filter((item) => {
      const matchesQ =
        !filters.q ||
        item.displayId.includes(filters.q.toUpperCase()) ||
        item.name.includes(filters.q) ||
        item.apiName.includes(filters.q);
      const matchesPriority = filters.priority === "all" || item.priorityKey === filters.priority;
      const matchesStatus = filters.status === "all" || item.executionStatus === filters.status;
      return matchesQ && matchesPriority && matchesStatus;
    });
  }

  function toggleSelection(collection, id) {
    if (!collection || !id || !state.selections[collection]) {
      return;
    }

    state.selections[collection] = isSelected(collection, id)
      ? state.selections[collection].filter((item) => item !== id)
      : [...state.selections[collection], id];
    ctx.renderPage();
  }

  function toggleAllSelection(collection) {
    if (!collection || !state.selections[collection]) {
      return;
    }

    const model = buildViewModel();
    const rows = collection === "apis" ? filterApiRows(model) : collection === "cases" ? filterCaseRows(model) : [];
    const rowIds = rows.map((item) => item.id);
    const allSelected = rowIds.length > 0 && rowIds.every((id) => isSelected(collection, id));

    state.selections[collection] = allSelected ? [] : rowIds;
    ctx.renderPage();
  }

  function renderSelectionCheckbox({ collection, id = "", checked = false, label = "" }) {
    const action = id ? "toggle-selection" : "toggle-all-selection";
    const checkedClass = checked ? " is-checked" : "";
    const safeLabel = label || (id ? "切换选中" : "切换全选");
    return `
      <button
        type="button"
        class="checkbox-button"
        data-action="${action}"
        data-collection="${escapeHtml(collection)}"
        ${id ? `data-id="${escapeHtml(id)}"` : ""}
        aria-label="${escapeHtml(safeLabel)}"
        aria-pressed="${checked ? "true" : "false"}"
      >
        <span class="checkbox${checkedClass}"></span>
      </button>
    `;
  }

  function selectedCount(collection) {
    return state.selections[collection]?.length || 0;
  }

  function renderCountedButtonText(label, count) {
    const displayCount = count > 99 ? "99+" : String(count || 0);
    return `
      <span class="button-text">${escapeHtml(label)}</span>
      <span class="button-count${count ? "" : " is-empty"}" aria-hidden="true">${escapeHtml(displayCount)}</span>
    `;
  }

  function renderRecentRunCard(run) {
    const progress = Math.max(10, Math.min(100, Math.round((run.summary.total ? run.summary.passed / run.summary.total : 0) * 100)));
    const statusClass = ctx.statusClassName(run.status);
    const progressBar =
      run.status === "passed" || run.status === "failed"
        ? ""
        : `
          <div class="task-footer">
            <div class="progress-inline">
              <div class="progress-track"><div class="progress-value" style="width:${progress}%;"></div></div>
              <strong>${progress}%</strong>
            </div>
          </div>
        `;

    return `
      <article class="task-card">
        <div class="task-head">
          <div class="task-head-left">
            <div class="task-title">${escapeHtml(run.suiteName)}</div>
            <span class="status-pill status-${statusClass}">${escapeHtml(statusText(run.status))}</span>
          </div>
          <button class="plain-button" data-action="view-run-report" data-run-id="${run.id}">查看详情</button>
        </div>
        ${progressBar}
        <div class="task-meta-line">
          <span>${escapeHtml(ctx.relativeTime(run.finishedAt || run.startedAt))}</span>
          <span>耗时: ${escapeHtml(formatDuration(run.duration))}</span>
          <span class="text-success">通过: ${escapeHtml(String(run.summary.passed))}</span>
          ${run.summary.failed ? `<span class="text-danger">失败: ${escapeHtml(String(run.summary.failed))}</span>` : ""}
        </div>
      </article>
    `;
  }

  function buildRunValidation(
    run,
    {
      emptyTitle = "还没有验证结果",
      emptySummary = "先跑一次，才能知道这条链路在当前条件下是否验证通过。",
      targetName = "目标",
      failureMessage = "",
      failureStepLabel = "",
      runId = "",
      stepId = "",
      caseId = "",
      envId = "",
      suiteId = ""
    } = {}
  ) {
    if (!run) {
      return {
        status: "neutral",
        title: emptyTitle,
        summary: emptySummary
      };
    }

    if (run.status === "passed") {
      return {
        status: "passed",
        title: `${targetName} 已验证通过`,
        summary: `${relativeTime(run.finishedAt || run.startedAt || run.createdAt)}完成，最近一次运行没有失败步骤。`
      };
    }

    if (run.status === "failed") {
      return {
        status: "failed",
        title: `${targetName} 仍有失败`,
        summary: `${relativeTime(run.finishedAt || run.startedAt || run.createdAt)}失败，优先看失败步骤和报告。`,
        failureMessage,
        failureStepLabel,
        runId: runId || run.id || "",
        stepId,
        caseId,
        envId: envId || run.environmentId || "",
        suiteId: suiteId || run.suiteId || ""
      };
    }

    if (run.status === "running" || run.status === "queued") {
      return {
        status: "running",
        title: `${targetName} 正在验证中`,
        summary: `当前任务状态：${statusText(run.status)}，可以先看执行中心进度。`
      };
    }

    return {
      status: "neutral",
      title: `${targetName} 暂无明确验证结论`,
      summary: "建议结合执行记录和报告再确认。"
    };
  }

  function explainFailureMessage(message = "") {
    const raw = String(message || "断言失败").trim() || "断言失败";
    const text = raw.toLowerCase();
    const includesAny = (...patterns) => patterns.some((pattern) => text.includes(pattern));

    if (includesAny("timeout", "timed out", "etimedout", "超时")) {
      return {
        title: "接口超时",
        summary: "接口在预期时间内没有返回结果，常见原因是服务处理慢、依赖阻塞或环境不稳定。",
        suggestion: "先看本次耗时、依赖服务状态，以及是否需要放宽超时阈值。",
        raw
      };
    }

    if (includesAny("401", "403", "unauthorized", "forbidden", "token", "authorization", "auth", "鉴权", "无权限")) {
      return {
        title: "鉴权或权限失败",
        summary: "请求已经到达服务，但身份校验没有通过，通常是 Token 失效、权限不足或环境鉴权配置不对。",
        suggestion: "先检查环境鉴权配置、登录态变量和请求头里的授权信息。",
        raw
      };
    }

    if (includesAny("500", "502", "503", "504", "internal server error", "bad gateway", "service unavailable", "服务异常")) {
      return {
        title: "服务端异常",
        summary: "服务端返回了异常状态，更可能是接口实现、依赖服务或网关层出了问题。",
        suggestion: "优先看响应体和后端日志，确认是业务报错还是基础设施异常。",
        raw
      };
    }

    if (includesAny("econnrefused", "enotfound", "network", "fetch failed", "socket hang up", "连接失败", "dns")) {
      return {
        title: "网络或环境不可达",
        summary: "当前环境没有成功连到目标服务，可能是地址错误、服务未启动或网络链路异常。",
        suggestion: "检查 Base URL、服务健康状态和当前测试环境连通性。",
        raw
      };
    }

    if (includesAny("jsonpath", "xpath", "not found", "missing", "不存在", "字段缺失", "字段不存在", "exists")) {
      return {
        title: "返回字段不符合预期",
        summary: "接口虽然返回了结果，但返回体里缺少预期字段，或者字段路径和实际结构不一致。",
        suggestion: "对照响应体确认字段路径是否变更，再判断是断言过旧还是接口结构变了。",
        raw
      };
    }

    if (includesAny("schema", "type", "expected", "actual", "类型", "equals", "contains", "header")) {
      return {
        title: "断言不匹配",
        summary: "接口返回了结果，但值、类型、响应头或结构和用例预期不一致。",
        suggestion: "对比当前响应和断言规则，确认是接口行为变更还是校验配置需要更新。",
        raw
      };
    }

    return {
      title: "结果与预期不一致",
      summary: "本次执行没有通过校验，通常是返回值、流程状态或运行环境与预期存在差异。",
      suggestion: "先看步骤日志里的请求和响应，再结合原始报错定位具体原因。",
      raw
    };
  }

  function renderWritebackFailureInsight(message = "", stepLabel = "") {
    if (!message) {
      return "";
    }

    const explanation = explainFailureMessage(message);
    return `
      <div class="failure-insight is-compact writeback-failure-insight">
        <strong>${escapeHtml(stepLabel ? `${explanation.title} · ${stepLabel}` : explanation.title)}</strong>
        <p>${escapeHtml(explanation.summary)}</p>
        <div class="failure-insight-raw">${escapeHtml(explanation.raw)}</div>
      </div>
    `;
  }

  function renderWritebackFailureActions(validation) {
    if (!validation?.failureMessage) {
      return "";
    }

    const explanation = explainFailureMessage(validation.failureMessage);
    const envId = String(validation.envId || "").trim();
    const runId = String(validation.runId || "").trim();
    const stepId = String(validation.stepId || "").trim();
    const caseId = String(validation.caseId || "").trim();
    const canEditCase = caseId && caseId !== "scenario" && caseId !== "suite";
    const actions = [];
    const pushAction = (config) => {
      if (!config?.label || !config?.action) {
        return;
      }
      if (actions.some((item) => item.label === config.label && item.action === config.action)) {
        return;
      }
      actions.push(config);
    };

    if (explanation.title === "鉴权或权限失败" && envId) {
      pushAction({
        label: "修鉴权",
        action: "open-modal",
        className: "plain-button",
        dataset: {
          modalType: "environment",
          envId,
          repairKey: "auth",
          repairMessage: "失败原因更像鉴权配置或登录态问题，建议先修当前环境的鉴权配置。",
          focusField: "authValue"
        }
      });
    } else if (explanation.title === "网络或环境不可达" && envId) {
      pushAction({
        label: "修环境地址",
        action: "open-modal",
        className: "plain-button",
        dataset: {
          modalType: "environment",
          envId,
          repairKey: "baseUrl",
          repairMessage: "失败原因更像地址或连通性问题，建议先检查 Base URL 和探测连通性。",
          focusField: "baseUrl"
        }
      });
    } else if (["返回字段不符合预期", "断言不匹配", "结果与预期不一致"].includes(explanation.title) && canEditCase) {
      pushAction({
        label: "改用例断言",
        action: "open-modal",
        className: "plain-button",
        dataset: {
          modalType: "case",
          recordId: caseId
        }
      });
    }

    if (runId && stepId) {
      pushAction({
        label: "看步骤日志",
        action: "view-step-log",
        className: "plain-button",
        dataset: {
          runId,
          stepId
        }
      });
    } else if (runId) {
      pushAction({
        label: "看运行报告",
        action: "view-run-report",
        className: "plain-button",
        dataset: {
          runId
        }
      });
    }

    if (!actions.length) {
      return "";
    }

    return `<div class="button-row action-row-compact failure-insight-actions">${actions.slice(0, 2).map(renderActionButton).join("")}</div>`;
  }

  function renderValidationWriteback(validation, className = "validation-strip") {
    if (!validation) {
      return "";
    }

    const toneClass =
      validation.status === "passed"
        ? "is-passed"
        : validation.status === "failed"
          ? "is-failed"
          : validation.status === "running"
            ? "is-running"
            : "";

    return `
      <div class="${escapeHtml(className)} ${escapeHtml(toneClass)}">
        <strong>${escapeHtml(validation.title)}</strong>
        <span>${escapeHtml(validation.summary)}</span>
        ${
          validation.status === "failed"
            ? `${renderWritebackFailureInsight(validation.failureMessage, validation.failureStepLabel)}${renderWritebackFailureActions(validation)}`
            : ""
        }
      </div>
    `;
  }

  function serializeActionDataset(dataset = {}) {
    return Object.entries(dataset)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => `data-${String(key).replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}="${escapeHtml(String(value))}"`)
      .join(" ");
  }

  function renderActionButton({ label, action, className = "secondary-button", dataset = {} }) {
    return `<button class="${escapeHtml(className)}" data-action="${escapeHtml(action)}" ${serializeActionDataset(dataset)}>${escapeHtml(label)}</button>`;
  }

  function renderWorkflowProgressCard(label, count, done, description) {
    return `
      <article class="workflow-progress-card ${done ? "is-done" : "is-pending"}">
        <div class="workflow-progress-head">
          <strong>${escapeHtml(label)}</strong>
          <span class="workflow-progress-badge">${escapeHtml(done ? "已准备" : "待补齐")}</span>
        </div>
        <div class="workflow-progress-value">${escapeHtml(String(count))}</div>
        <p>${escapeHtml(description)}</p>
      </article>
    `;
  }

  function renderOverviewRecommendation(model, latestRuns, executionTasks) {
    const selectedSuite = model.suites.find((item) => item.id === state.selectedSuiteId) || model.suites[0] || null;
    const latestRun = latestRuns[0] || model.runs[0] || null;
    const latestFailedRun = latestRuns.find((item) => item.status === "failed") || model.runs.find((item) => item.status === "failed") || null;
    const pendingRun = executionTasks.running[0] || executionTasks.queued[0] || null;
    const recommendation =
      !model.environments.length
        ? {
            tone: "warning",
            eyebrow: "下一步",
            title: "先补一个执行环境",
            description: "没有环境就无法真正发起请求。先配置 Base URL 和公共鉴权，再继续做用例和场景。",
            primary: { label: "新建环境", action: "open-modal", dataset: { modalType: "environment" }, className: "primary-button" },
            secondary: { label: "业务模板", action: "open-modal", dataset: { modalType: "business-template" }, className: "secondary-button" }
          }
        : !model.apis.length
          ? {
              tone: "primary",
              eyebrow: "继续上一步",
              title: "先把接口资产导进来",
              description: "你已经有可用环境了，下一步建议用 OpenAPI 导入或业务模板生成第一批接口。",
              primary: { label: "OpenAPI 导入", action: "open-modal", dataset: { modalType: "openapi" }, className: "primary-button" },
              secondary: { label: "业务模板", action: "open-modal", dataset: { modalType: "business-template" }, className: "secondary-button" }
            }
          : !model.cases.length
            ? {
                tone: "primary",
                eyebrow: "继续上一步",
                title: "接口已经有了，下一步生成第一条用例",
                description: "建议先用新手引导挑一个接口，补上断言后直接跑起来，尽快看到第一条执行结果。",
                primary: { label: "开始新手引导", action: "start-starter-guide", className: "primary-button" },
                secondary: { label: "手工新建用例", action: "open-modal", dataset: { modalType: "case" }, className: "secondary-button" }
              }
            : !model.suites.length
              ? {
                  tone: "primary",
                  eyebrow: "继续上一步",
                  title: "用例已就绪，下一步生成第一个场景",
                  description: "场景把多个接口顺起来，才能真正解决前后依赖、批量执行和回归复跑。",
                  primary: { label: "打开场景向导", action: "open-modal", dataset: { modalType: "scene-builder" }, className: "primary-button" },
                  secondary: { label: "手工新建场景", action: "open-modal", dataset: { modalType: "suite" }, className: "secondary-button" }
                }
              : pendingRun
                ? {
                    tone: "warning",
                    eyebrow: "当前状态",
                    title: "有任务正在执行，先看执行进度",
                    description: `当前有 ${executionTasks.running.length} 个执行中、${executionTasks.queued.length} 个排队任务。建议先确认这次运行有没有失败步骤。`,
                    primary: { label: "查看执行中心", action: "quick-nav", dataset: { target: "execution" }, className: "primary-button" },
                    secondary: { label: "查看当前运行", action: "select-execution-run", dataset: { runId: pendingRun.id }, className: "secondary-button" }
                  }
                : !model.runs.length
                  ? {
                      tone: "success",
                      eyebrow: "继续上一步",
                      title: "场景已经准备好，执行一次看看结果",
                      description: `当前选中场景是“${selectedSuite?.name || "未命名场景"}”，现在最有价值的是跑出第一份真实结果和报告。`,
                      primary: { label: "执行当前场景", action: "run-selected-suite", dataset: { id: selectedSuite?.id || "" }, className: "primary-button" },
                      secondary: { label: "场景编排", action: "quick-nav", dataset: { target: "suites" }, className: "secondary-button" }
                    }
                  : latestFailedRun
                    ? {
                        tone: "danger",
                        eyebrow: "优先处理",
                        title: "最近一次执行有失败，建议先看失败重点",
                        description: `失败场景：${latestFailedRun.suiteName}。先看报告里的失败聚类和步骤日志，再决定是修用例还是修接口。`,
                        primary: { label: "查看失败报告", action: "view-run-report", dataset: { runId: latestFailedRun.id }, className: "primary-button" },
                        secondary: { label: "查看执行详情", action: "select-execution-run", dataset: { runId: latestFailedRun.id }, className: "secondary-button" }
                      }
                    : {
                        tone: "success",
                        eyebrow: "当前状态",
                        title: "最近一次执行通过，可以继续扩充回归",
                        description: `最近一次运行来自“${latestRun?.suiteName || "当前场景"}”。建议继续补场景，或者去报告页看趋势和风险变化。`,
                        primary: { label: "查看测试报告", action: "view-run-report", dataset: { runId: latestRun?.id || "" }, className: "primary-button" },
                        secondary: { label: "继续生成场景", action: "open-modal", dataset: { modalType: "scene-builder" }, className: "secondary-button" }
                      };

    const progressCards = [
      renderWorkflowProgressCard("环境", model.environments.length, model.environments.length > 0, model.environments.length ? `${model.environments.length} 个可切换环境` : "还没有 Base URL 和鉴权配置"),
      renderWorkflowProgressCard("接口", model.apis.length, model.apis.length > 0, model.apis.length ? `${model.apis.length} 个接口资产` : "建议先从 OpenAPI 或模板生成"),
      renderWorkflowProgressCard("用例", model.cases.length, model.cases.length > 0, model.cases.length ? `${model.cases.length} 条自动化用例` : "至少先补 1 条带断言的用例"),
      renderWorkflowProgressCard("场景", model.suites.length, model.suites.length > 0, model.suites.length ? `${model.suites.length} 个可执行场景` : "需要把用例编排成可执行链路"),
      renderWorkflowProgressCard("执行", model.runs.length, model.runs.length > 0, model.runs.length ? `${model.runs.length} 次历史执行` : "先跑出第一份真实结果")
    ].join("");

    return `
      <section class="workflow-focus workflow-focus-${escapeHtml(recommendation.tone)}">
        <div class="workflow-focus-main">
          <span class="workflow-focus-eyebrow">${escapeHtml(recommendation.eyebrow)}</span>
          <h3>${escapeHtml(recommendation.title)}</h3>
          <p>${escapeHtml(recommendation.description)}</p>
          <div class="button-row">
            ${renderActionButton(recommendation.primary)}
            ${renderActionButton(recommendation.secondary)}
          </div>
        </div>
        <div class="workflow-progress-grid">
          ${progressCards}
        </div>
      </section>
    `;
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

  function uniqueValues(values = []) {
    return [...new Set(values.filter(Boolean))];
  }

  function parseScopedExpression(expression) {
    const match = String(expression || "").match(/^(vars|env|suite|dataset|builtin)\.([A-Za-z_][\w.]*)$/);
    if (!match) {
      return null;
    }
    return { scope: match[1], name: match[2] };
  }

  function buildSuiteVariablePreview(suite, model) {
    if (!suite?.items?.length) {
      return [];
    }

    const caseMap = new Map(model.cases.map((item) => [item.id, item]));
    const apiMap = new Map(model.apis.map((item) => [item.id, item]));
    const suiteMap = new Map(model.suites.map((item) => [item.id, item]));
    const producedBy = new Map(
      Object.keys(suite.variables || {}).map((name) => [
        name,
        {
          label: "场景变量",
          type: "suite"
        }
      ])
    );

    return suite.items
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((item, index) => {
        if (item.itemType === "suite") {
          const childSuite = suiteMap.get(item.suiteId);
          return {
            id: item.id,
            order: index + 1,
            name: item.caseName,
            route: `子场景 · ${childSuite?.items?.length || 0} 个步骤`,
            inputs: [],
            outputs: uniqueValues(Object.keys(childSuite?.variables || {})).map((name) => ({ name })),
            contexts: [],
            note: "复用子场景时，会沿用子场景内部的变量提取和步骤依赖。"
          };
        }

        const caseEntity = caseMap.get(item.caseId);
        const apiEntity = apiMap.get(caseEntity?.apiId);
        const rawExpressions = uniqueValues([
          ...collectTemplateExpressions(apiEntity?.path),
          ...collectTemplateExpressions(apiEntity?.headers),
          ...collectTemplateExpressions(apiEntity?.query),
          ...collectTemplateExpressions(apiEntity?.bodyTemplate),
          ...collectTemplateExpressions(caseEntity?.overrides?.headers),
          ...collectTemplateExpressions(caseEntity?.overrides?.query),
          ...collectTemplateExpressions(caseEntity?.overrides?.body),
          ...collectTemplateExpressions(item.condition)
        ]);
        const scopedExpressions = rawExpressions.map(parseScopedExpression).filter(Boolean);
        const inputs = uniqueValues(scopedExpressions.filter((item) => item.scope === "vars").map((item) => item.name)).map((name) => ({
          name,
          source: producedBy.get(name) || null
        }));
        const contexts = scopedExpressions.filter((entry) => entry.scope !== "vars");
        const outputs = uniqueValues((caseEntity?.extracts || []).map((extract) => extract.name)).map((name) => ({ name }));

        outputs.forEach(({ name }) => {
          producedBy.set(name, {
            label: `步骤 ${index + 1} · ${item.caseName}`,
            type: "step"
          });
        });

        return {
          id: item.id,
          order: index + 1,
          name: item.caseName,
          route: `${apiEntity?.method || "GET"} ${apiEntity?.path || "/"}`,
          inputs,
          outputs,
          contexts,
          note: item.condition ? `执行条件：${item.condition}` : ""
        };
      });
  }

  function renderFlowToken(label, tone = "neutral") {
    return `<span class="flow-token flow-token-${escapeHtml(tone)}">${escapeHtml(label)}</span>`;
  }

  function formatPreviewValue(value, maxLength = 42) {
    if (value === undefined) {
      return "未提供";
    }
    if (value === null) {
      return "null";
    }
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  }

  function resolveEnvironmentReferenceValue(environment, name = "") {
    const ref = String(name || "").trim();
    if (!environment || !ref) {
      return undefined;
    }
    if (ref === "baseUrl") {
      return environment.baseUrl;
    }
    if (ref === "name" || ref === "displayName") {
      return environment.displayName || environment.name;
    }
    if (ref.startsWith("variables.")) {
      return environment.variablesObject?.[ref.replace(/^variables\./, "")];
    }
    if (ref.startsWith("headers.")) {
      return environment.headersObject?.[ref.replace(/^headers\./, "")];
    }
    if (ref === "auth.type") {
      return environment.authObject?.type;
    }
    if (ref === "auth.value") {
      return environment.authObject?.value;
    }
    return undefined;
  }

  function buildPreflightVariablePreview(suite, model, environment) {
    const previewItems = buildSuiteVariablePreview(suite, model);
    const known = [];
    const runtime = [];
    const missing = [];
    const seen = new Set();
    const pushUnique = (bucket, key, entry) => {
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      bucket.push(entry);
    };

    uniqueValues(previewItems.flatMap((item) => item.contexts || []).filter((entry) => entry.scope === "env").map((entry) => entry.name)).forEach((name) => {
      pushUnique(known, `env:${name}`, {
        label: `env.${name}`,
        value: formatPreviewValue(resolveEnvironmentReferenceValue(environment, name))
      });
    });

    previewItems.forEach((item) => {
      (item.inputs || []).forEach((entry) => {
        if (entry.source?.type === "suite" && Object.prototype.hasOwnProperty.call(suite?.variables || {}, entry.name)) {
          pushUnique(known, `vars:${entry.name}`, {
            label: `vars.${entry.name}`,
            value: formatPreviewValue(suite.variables?.[entry.name])
          });
          return;
        }
        if (entry.source?.type === "step") {
          pushUnique(runtime, `runtime:${entry.name}`, {
            label: `vars.${entry.name}`,
            value: entry.source.label
          });
          return;
        }
        pushUnique(missing, `missing:${entry.name}`, {
          label: `vars.${entry.name}`,
          value: "缺少来源"
        });
      });
    });

    return {
      known: known.slice(0, 4),
      runtime: runtime.slice(0, 3),
      missing: missing.slice(0, 3)
    };
  }

  function renderSuiteVariablePanel(suite, model) {
    const previewItems = buildSuiteVariablePreview(suite, model);
    const hasExplicitDependencies = previewItems.some((item) => item.inputs.length || item.outputs.length || item.contexts.length || item.note);
    if (!hasExplicitDependencies) {
      return `
        <section class="variable-flow-panel">
          <div class="panel-title-row">
            <div>
              <div class="panel-title">变量传递预览</div>
              <div class="panel-subtitle">把“前一步提取什么，后一步用了什么”翻成人能直接读懂的依赖关系。</div>
            </div>
          </div>
          <div class="empty-card">当前场景还没有显式的变量依赖。你可以在前置用例里配置“变量提取”，再在后续步骤的 Header、Query、Body 里引用 {{vars.xxx}}。</div>
        </section>
      `;
    }

    return `
      <section class="variable-flow-panel">
        <div class="panel-title-row">
          <div>
            <div class="panel-title">变量传递预览</div>
            <div class="panel-subtitle">从这里直接看清楚：哪一步产出变量，后一步又是怎么接着用的。</div>
          </div>
        </div>
        <div class="variable-flow-grid">
          ${previewItems
            .map(
              (item) => `
                <article class="variable-flow-card">
                  <div class="variable-flow-head">
                    <div>
                      <span class="flow-order">${escapeHtml(String(item.order).padStart(2, "0"))}</span>
                      <strong>${escapeHtml(item.name)}</strong>
                    </div>
                    <span class="route-chip">${escapeHtml(item.route)}</span>
                  </div>
                  <div class="variable-flow-body">
                    <div class="variable-flow-section">
                      <span>读取变量</span>
                      <div class="flow-token-list">
                        ${
                          item.inputs.length
                            ? item.inputs
                                .map((entry) => renderFlowToken(entry.source ? `${entry.name} <- ${entry.source.label}` : `${entry.name} <- 未找到来源`, entry.source ? "input" : "warning"))
                                .join("")
                            : '<span class="subdued-text">当前步骤没有读取前置变量</span>'
                        }
                      </div>
                    </div>
                    <div class="variable-flow-section">
                      <span>产出变量</span>
                      <div class="flow-token-list">
                        ${
                          item.outputs.length
                            ? item.outputs.map((entry) => renderFlowToken(entry.name, "output")).join("")
                            : '<span class="subdued-text">当前步骤没有提取变量</span>'
                        }
                      </div>
                    </div>
                    ${
                      item.contexts.length
                        ? `
                          <div class="variable-flow-section">
                            <span>依赖上下文</span>
                            <div class="flow-token-list">
                              ${uniqueValues(item.contexts.map((entry) => `${entry.scope}.${entry.name}`)).map((entry) => renderFlowToken(entry, "context")).join("")}
                            </div>
                          </div>
                        `
                        : ""
                    }
                    ${item.note ? `<p class="variable-flow-note">${escapeHtml(item.note)}</p>` : ""}
                  </div>
                </article>
              `
            )
            .join("")}
        </div>
      </section>
    `;
  }

  function buildSuiteInsight(suite, model) {
    const latestRun = state.data?.runs?.find((run) => run.suiteId === suite.id) || null;
    const previewItems = buildSuiteVariablePreview(suite, model);
    const selectedEnvironment =
      model.environments.find((item) => item.id === suite.defaultEnvironmentId) ||
      model.environments.find((item) => item.isCurrent) ||
      model.environments[0] ||
      null;
    const preflightVariablePreview = buildPreflightVariablePreview(suite, model, selectedEnvironment);
    const orderedItems = suite.items?.slice().sort((a, b) => a.order - b.order) || [];
    const caseItems = orderedItems.filter((item) => item.itemType !== "suite");
    const childSuites = orderedItems.filter((item) => item.itemType === "suite");
    const distinctApis = new Set(caseItems.map((item) => `${item.method || "GET"} ${item.path || "/"}`));
    const setupCount = orderedItems.filter((item) => item.role === "setup").length;
    const teardownCount = orderedItems.filter((item) => item.role === "teardown").length;
    const hasLoginChain = orderedItems.some((item) => {
      const text = `${item.caseName || ""} ${item.path || ""} ${item.roleText || ""}`.toLowerCase();
      return /login|signin|auth|token|session/.test(text) || item.role === "setup";
    });
    const variableGaps = previewItems
      .flatMap((item) =>
        item.inputs
          .filter((entry) => !entry.source)
          .map((entry) => ({
            stepId: item.id,
            stepName: item.name,
            variable: entry.name,
            route: item.route
          }))
      )
      .slice(0, 4);
    const failedSteps = (latestRun?.steps || [])
      .filter((step) => step.status === "failed")
      .slice(0, 3)
      .map((step) => ({
        id: step.id,
        caseName: step.caseName || step.apiName || step.caseId || "未知步骤",
        caseId: step.caseId || "",
        apiName: step.apiName || "",
        message: step.message || "断言失败",
        duration: step.duration || 0
      }));
    const firstFailedStep = failedSteps[0] || null;
    const impact = {
      totalSteps: orderedItems.length,
      apiSteps: caseItems.length,
      childSuites: childSuites.length,
      apiCount: distinctApis.size,
      setupCount,
      teardownCount,
      hasLoginChain,
      variableReadCount: previewItems.reduce((sum, item) => sum + (item.inputs?.length || 0), 0),
      variableWriteCount: previewItems.reduce((sum, item) => sum + (item.outputs?.length || 0), 0),
      preflightVariablePreview,
      latestFailedStep: firstFailedStep
        ? `${firstFailedStep.caseName}${firstFailedStep.duration ? ` · ${formatDuration(firstFailedStep.duration)}` : ""}`
        : "",
      latestFailedMessage: firstFailedStep?.message || ""
    };

    return {
      latestRun,
      variableGaps,
      failedSteps,
      impact,
      validation: buildRunValidation(latestRun, {
        targetName: `场景“${suite.name}”`,
        emptyTitle: "这个场景还没有验证结果",
        emptySummary: "先跑一次，才能确认这条依赖链在当前配置下是否真的打通。",
        failureMessage: firstFailedStep?.message || "",
        failureStepLabel: firstFailedStep?.caseName || firstFailedStep?.apiName || "",
        runId: latestRun?.id || "",
        stepId: firstFailedStep?.id || "",
        caseId: firstFailedStep?.caseId || "",
        envId: latestRun?.environmentId || suite.defaultEnvironmentId || "",
        suiteId: suite.id
      }),
      recommendation:
        !latestRun
          ? {
              tone: "primary",
              title: "这个场景还没跑过",
              description: "先执行一次，才能看到失败步骤、变量传递是否通畅，以及后续该补哪条断言。",
              primary: { label: "立即执行场景", action: "run-selected-suite", dataset: { id: suite.id }, className: "primary-button" },
              secondary: { label: "去配执行参数", action: "open-execution-config", dataset: { sourceType: "suite", suiteId: suite.id }, className: "secondary-button" }
            }
          : failedSteps.length
            ? {
                tone: "danger",
                title: `最近一次运行失败了 ${failedSteps.length} 个步骤`,
                description: "建议先看失败步骤日志；如果只是临时波动，也可以直接重跑失败步骤验证。",
                primary: { label: "重跑失败步骤", action: "retry-failed-run", dataset: { runId: latestRun.id }, className: "primary-button" },
                secondary: { label: "查看运行报告", action: "view-run-report", dataset: { runId: latestRun.id }, className: "secondary-button" }
              }
            : variableGaps.length
              ? {
                  tone: "warning",
                  title: `发现 ${variableGaps.length} 个变量依赖缺口`,
                  description: "这些步骤在读取 vars 变量，但前面没有明确来源。建议先补变量提取，否则后续联调容易卡住。",
                  primary: { label: "先看依赖缺口", action: "task-control", className: "primary-button" },
                  secondary: { label: "添加步骤", action: "open-modal", dataset: { modalType: "step", suiteId: suite.id }, className: "secondary-button" }
                }
              : {
                  tone: "success",
                  title: "最近一次运行通过，依赖链也比较完整",
                  description: "下一步可以继续扩充场景，或者启用定时调度，把它变成稳定的回归链路。",
                  primary: { label: "查看最近报告", action: "view-run-report", dataset: { runId: latestRun.id }, className: "primary-button" },
                  secondary: { label: "去定时调度", action: "quick-nav", dataset: { target: "scheduler" }, className: "secondary-button" }
                }
    };
  }

  function renderSuiteInsightPanel(suite, model) {
    const insight = buildSuiteInsight(suite, model);
    const latestRun = insight.latestRun;
    const statusClass = latestRun ? ctx.statusClassName(latestRun.status) : "queued";
    const summaryMeta = latestRun
      ? [
          `通过 ${latestRun.summary?.passed || 0}`,
          `失败 ${latestRun.summary?.failed || 0}`,
          `耗时 ${formatDuration(latestRun.duration || 0)}`,
          formatDateTime(latestRun.finishedAt || latestRun.startedAt || latestRun.createdAt)
        ]
      : ["还没有执行记录"];

    return `
      <section class="suite-control-panel suite-control-${escapeHtml(insight.recommendation.tone)}">
        <div class="suite-control-head">
          <div>
            <span class="suite-control-eyebrow">场景导读</span>
            <h3>${escapeHtml(insight.recommendation.title)}</h3>
            <p>${escapeHtml(insight.recommendation.description)}</p>
            ${renderValidationWriteback(insight.validation, "suite-validation-strip")}
          </div>
          <div class="button-row">
            ${renderActionButton(insight.recommendation.primary)}
            ${renderActionButton(insight.recommendation.secondary)}
          </div>
        </div>
        <div class="suite-control-grid">
          <article class="suite-control-card">
            <div class="suite-control-card-head">
              <strong>最近运行</strong>
              ${
                latestRun
                  ? `<span class="status-pill status-${statusClass}">${escapeHtml(statusText(latestRun.status))}</span>`
                  : `<span class="small-pill status-queued">暂无</span>`
              }
            </div>
            <div class="task-meta-line">
              ${summaryMeta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
            </div>
            ${
              latestRun
                ? `
                  <div class="button-row">
                    <button class="secondary-button" data-action="select-execution-run" data-run-id="${escapeHtml(latestRun.id)}">查看执行详情</button>
                    <button class="secondary-button" data-action="view-run-report" data-run-id="${escapeHtml(latestRun.id)}">查看报告</button>
                  </div>
                `
                : ""
            }
          </article>
          <article class="suite-control-card">
            <div class="suite-control-card-head">
              <strong>最近失败步骤</strong>
              <span class="small-pill ${insight.failedSteps.length ? "small-failed" : "status-success"}">${escapeHtml(String(insight.failedSteps.length))}</span>
            </div>
            ${
              insight.failedSteps.length
                ? `
                  <div class="suite-failure-list">
                    ${insight.failedSteps
                      .map(
                        (step) => `
                          <div class="suite-failure-item">
                            <div>
                              <strong>${escapeHtml(step.caseName)}</strong>
                              <p>${escapeHtml(step.message)}</p>
                            </div>
                            <div class="action-row-compact">
                              <button class="plain-button" data-action="view-step-log" data-run-id="${escapeHtml(latestRun?.id || "")}" data-step-id="${escapeHtml(step.id)}">看日志</button>
                            </div>
                          </div>
                        `
                      )
                      .join("")}
                  </div>
                `
                : `<div class="empty-card">最近一次运行没有失败步骤。</div>`
            }
          </article>
          <article class="suite-control-card">
            <div class="suite-control-card-head">
              <strong>依赖补齐建议</strong>
              <span class="small-pill status-queued">${escapeHtml(String(insight.variableGaps.length))}</span>
            </div>
            ${
              insight.variableGaps.length
                ? `
                  <div class="suite-recommend-list">
                    ${insight.variableGaps
                      .map(
                        (gap) => `
                          <div class="suite-recommend-item">
                            <strong>${escapeHtml(gap.stepName)}</strong>
                            <p>${escapeHtml(`当前在读取 vars.${gap.variable}，但前面没有明确来源。建议补变量提取后再串联执行。`)}</p>
                            <div class="action-row-compact">
                              <button class="plain-button" data-action="open-modal" data-modal-type="step" data-suite-id="${escapeHtml(suite.id)}" data-step-id="${escapeHtml(gap.stepId)}">编辑步骤</button>
                            </div>
                          </div>
                        `
                      )
                      .join("")}
                  </div>
                `
                : `<div class="empty-card">当前没有明显的变量依赖缺口。</div>`
            }
          </article>
          <article class="suite-control-card">
            <div class="suite-control-card-head">
              <strong>执行前预估影响</strong>
              <span class="small-pill status-queued">${escapeHtml(`${insight.impact.totalSteps} 步`)}</span>
            </div>
            <div class="suite-impact-chip-list">
              <span class="route-chip">${escapeHtml(`${insight.impact.apiCount} 个接口`)}</span>
              <span class="route-chip">${escapeHtml(`${insight.impact.apiSteps} 个接口步骤`)}</span>
              ${insight.impact.childSuites ? `<span class="route-chip">${escapeHtml(`${insight.impact.childSuites} 个子场景`)}</span>` : ""}
              ${insight.impact.setupCount ? `<span class="route-chip">${escapeHtml(`${insight.impact.setupCount} 个前置步骤`)}</span>` : ""}
              ${insight.impact.teardownCount ? `<span class="route-chip">${escapeHtml(`${insight.impact.teardownCount} 个后置步骤`)}</span>` : ""}
              ${insight.impact.hasLoginChain ? `<span class="route-chip">${escapeHtml("包含登录链路")}</span>` : ""}
            </div>
            <div class="suite-impact-list">
              <div class="suite-impact-item">
                <strong>变量流</strong>
                <p>${escapeHtml(`本次大约会读取 ${insight.impact.variableReadCount} 个前置变量，产出 ${insight.impact.variableWriteCount} 个变量。`)}</p>
                ${
                  insight.impact.preflightVariablePreview.known.length ||
                  insight.impact.preflightVariablePreview.runtime.length ||
                  insight.impact.preflightVariablePreview.missing.length
                    ? `
                      <div class="suite-impact-preview-list">
                        ${insight.impact.preflightVariablePreview.known
                          .map((item) => `<span class="route-chip">${escapeHtml(`${item.label} = ${item.value}`)}</span>`)
                          .join("")}
                        ${insight.impact.preflightVariablePreview.runtime
                          .map((item) => `<span class="route-chip">${escapeHtml(`${item.label} <- ${item.value}`)}</span>`)
                          .join("")}
                        ${insight.impact.preflightVariablePreview.missing
                          .map((item) => `<span class="route-chip route-chip-danger">${escapeHtml(`${item.label} ${item.value}`)}</span>`)
                          .join("")}
                      </div>
                    `
                    : ""
                }
              </div>
              <div class="suite-impact-item">
                <strong>验证范围</strong>
                <p>${escapeHtml(insight.impact.hasLoginChain ? "这条链路包含登录或鉴权前置，更适合做环境可用性确认。" : "这条链路偏业务步骤，适合确认核心接口串联是否稳定。")}</p>
              </div>
              <div class="suite-impact-item">
                <strong>最近风险点</strong>
                <p>${escapeHtml(insight.impact.latestFailedStep ? `最近一次主要卡在 ${insight.impact.latestFailedStep}。${insight.impact.latestFailedMessage}` : "最近没有明显失败热点，适合继续扩充断言或加入定时回归。")}</p>
              </div>
            </div>
          </article>
        </div>
      </section>
    `;
  }

  function renderFlowStep(item, index) {
    const statusIcon =
      item.latestStatus === "failed" ? svgWarningOutline() : item.latestStatus === "skipped" ? svgClock() : svgCheckOutline();
    const metaPills = [
      `<span class="small-pill status-queued">${escapeHtml(item.itemType === "suite" ? "子场景" : "API调用")}</span>`,
      `<span class="small-pill status-queued">${escapeHtml(item.roleText || "业务步骤")}</span>`,
      item.parallelGroup ? `<span class="small-pill status-running">${escapeHtml(`并行组: ${item.parallelGroup}`)}</span>` : "",
      item.enabled === false ? `<span class="small-pill small-warning">已禁用</span>` : "",
      item.continueOnFailure ? `<span class="small-pill status-running">失败继续</span>` : `<span class="small-pill status-queued">失败即停</span>`,
      item.timeoutMs ? `<span class="small-pill status-queued">${escapeHtml(`${Math.round(Number(item.timeoutMs) / 1000)}s 超时`)}</span>` : "",
      item.condition ? `<span class="small-pill status-queued">${escapeHtml(`条件: ${item.condition}`)}</span>` : ""
    ]
      .filter(Boolean)
      .join("");
    return `
      <div class="flow-step-wrap">
        <div class="flow-step${item.enabled === false ? " is-disabled" : ""}">
          <div class="flow-index">${index + 1}</div>
          <div class="flow-main">
            <h4>${escapeHtml(item.caseName)} ${statusIcon}</h4>
            <div class="step-tags">
              <span class="route-chip">${escapeHtml(item.itemType === "suite" ? `SUITE ${item.caseName}` : `${item.method} ${item.path}`)}</span>
              ${metaPills}
            </div>
          </div>
          <div class="step-actions">
            <button class="plain-button" data-action="move-step" data-step-id="${item.id}" data-direction="up" ${index === 0 ? "disabled" : ""}>上移</button>
            <button class="plain-button" data-action="move-step" data-step-id="${item.id}" data-direction="down" ${index >= item.totalSteps - 1 ? "disabled" : ""}>下移</button>
            <button class="plain-button" data-action="open-modal" data-modal-type="step" data-suite-id="${state.selectedSuiteId || ""}" data-step-id="${item.id}">编辑</button>
            <button class="plain-button" data-action="toggle-step-enabled" data-step-id="${item.id}">${item.enabled === false ? "启用" : "禁用"}</button>
            <button class="plain-button" data-action="${item.itemType === "suite" ? "view-run-report" : "view-step-log"}" data-run-id="${item.latestRunId || ""}" data-step-id="${item.latestStepId || ""}" ${!item.latestRunId || (item.itemType !== "suite" && !item.latestStepId) ? "disabled" : ""}>${item.itemType === "suite" ? "查看运行" : "日志"}</button>
            <button class="plain-button text-danger" data-action="delete-step" data-step-id="${item.id}">删除</button>
          </div>
        </div>
        ${index < item.totalSteps - 1 ? `<div class="flow-arrow">${svgArrowDown()}</div>` : ""}
      </div>
    `;
  }

  function renderDependencyGraph(suite) {
    const items = suite.items.slice().sort((a, b) => a.order - b.order);
    const segments = [];
    let index = 0;
    while (index < items.length) {
      const item = items[index];
      if (item.parallelGroup) {
        const groupItems = [item];
        index += 1;
        while (index < items.length && items[index].parallelGroup === item.parallelGroup) {
          groupItems.push(items[index]);
          index += 1;
        }
        segments.push({ type: "parallel", group: item.parallelGroup, items: groupItems });
        continue;
      }
      segments.push({ type: "single", item });
      index += 1;
    }

    if (!segments.length) {
      return `<div class="empty-card">当前场景还没有依赖节点。</div>`;
    }

    return `
      <div class="dependency-graph">
        ${segments
          .map((segment, segmentIndex) => {
            const connector = segmentIndex < segments.length - 1 ? `<div class="dependency-connector">${svgArrowDown()}</div>` : "";
            if (segment.type === "parallel") {
              return `
                <div class="dependency-segment">
                  <div class="parallel-branch-shell">
                    <div class="parallel-branch-head">
                      <strong>${escapeHtml(`并行分支 ${segment.group}`)}</strong>
                      <span class="small-pill status-running">${escapeHtml(`${segment.items.length} 条支线`)}</span>
                    </div>
                    <div class="parallel-branch-grid">
                      ${segment.items
                        .map(
                          (item) => `
                            <article class="dependency-node ${item.enabled === false ? "is-disabled" : ""}">
                              <div class="dependency-node-kind">${escapeHtml(item.itemType === "suite" ? "子场景" : "用例")}</div>
                              <strong>${escapeHtml(item.caseName)}</strong>
                              <div class="dependency-node-meta">
                                <span>${escapeHtml(item.roleText || "业务步骤")}</span>
                                <span>${escapeHtml(item.itemType === "suite" ? `${item.path}` : `${item.method} ${item.path}`)}</span>
                              </div>
                            </article>
                          `
                        )
                        .join("")}
                    </div>
                  </div>
                  ${connector}
                </div>
              `;
            }

            const item = segment.item;
            return `
              <div class="dependency-segment">
                <article class="dependency-node ${item.enabled === false ? "is-disabled" : ""}">
                  <div class="dependency-node-kind">${escapeHtml(item.itemType === "suite" ? "子场景" : "用例")}</div>
                  <strong>${escapeHtml(item.caseName)}</strong>
                  <div class="dependency-node-meta">
                    <span>${escapeHtml(item.roleText || "业务步骤")}</span>
                    <span>${escapeHtml(item.itemType === "suite" ? `${item.path}` : `${item.method} ${item.path}`)}</span>
                  </div>
                </article>
                ${connector}
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function getEnvironmentRuntime(envId) {
    return state.environmentDiagnostics?.[envId] || {};
  }

  function renderEnvironmentStatusPill(status, labelOverride = "") {
    const tone =
      status === "passed"
        ? "success"
        : status === "warning"
          ? "warning"
          : status === "failed"
            ? "danger"
            : "neutral";
    const label =
      labelOverride ||
      {
        passed: "已通过",
        warning: "待确认",
        failed: "异常",
        neutral: "未检查"
      }[status] ||
      "未检查";
    return `<span class="env-status-pill env-status-${escapeHtml(tone)}">${escapeHtml(label)}</span>`;
  }

  function normalizeEnvVariableRefName(name = "") {
    return String(name || "").startsWith("variables.") ? String(name).replace(/^variables\./, "") : null;
  }

  function buildEnvironmentVariablePreview(env, model) {
    const usageMap = new Map();
    const missingMap = new Map();

    function recordDefinedUsage(variableName, kind, label) {
      if (!variableName) {
        return;
      }
      const current = usageMap.get(variableName) || { count: 0, kinds: new Set(), samples: [] };
      current.count += 1;
      current.kinds.add(kind);
      if (label && !current.samples.includes(label)) {
        current.samples.push(label);
      }
      usageMap.set(variableName, current);
    }

    function recordMissingUsage(variableName, label) {
      if (!variableName) {
        return;
      }
      const current = missingMap.get(variableName) || { count: 0, samples: [] };
      current.count += 1;
      if (label && !current.samples.includes(label)) {
        current.samples.push(label);
      }
      missingMap.set(variableName, current);
    }

    function inspectUsage(value, kind, label) {
      uniqueValues(collectTemplateExpressions(value))
        .map(parseScopedExpression)
        .filter((entry) => entry?.scope === "env")
        .map((entry) => normalizeEnvVariableRefName(entry.name))
        .filter(Boolean)
        .forEach((variableName) => {
          if (Object.prototype.hasOwnProperty.call(env.variablesObject || {}, variableName)) {
            recordDefinedUsage(variableName, kind, label);
          } else {
            recordMissingUsage(variableName, label);
          }
        });
    }

    inspectUsage(env.headersObject, "env", "环境公共 Header");
    inspectUsage(env.authObject?.value, "env", "环境鉴权");

    model.apis.forEach((apiItem) => {
      inspectUsage(apiItem.path, "api", `${apiItem.method} ${apiItem.path}`);
      inspectUsage(apiItem.headers, "api", `${apiItem.name} · Header`);
      inspectUsage(apiItem.query, "api", `${apiItem.name} · Query`);
      inspectUsage(apiItem.bodyTemplate, "api", `${apiItem.name} · Body`);
    });

    model.cases.forEach((caseItem) => {
      inspectUsage(caseItem.overrides?.headers, "case", `用例 · ${caseItem.name} · Header`);
      inspectUsage(caseItem.overrides?.query, "case", `用例 · ${caseItem.name} · Query`);
      inspectUsage(caseItem.overrides?.body, "case", `用例 · ${caseItem.name} · Body`);
    });

    const defined = Object.entries(env.variablesObject || {})
      .map(([key, value]) => {
        const usage = usageMap.get(key);
        return {
          key,
          value: String(value),
          count: usage?.count || 0,
          kinds: [...(usage?.kinds || [])],
          samples: usage?.samples || []
        };
      })
      .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));

    const missing = [...missingMap.entries()]
      .map(([key, item]) => ({
        key,
        count: item.count,
        samples: item.samples
      }))
      .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));

    return {
      defined,
      missing,
      connectedCount: defined.filter((item) => item.count > 0).length
    };
  }

  function renderEnvironmentVariablePanel(env, model) {
    const preview = buildEnvironmentVariablePreview(env, model);
    const topVariables = preview.defined.slice(0, 4);

    return `
      <section class="env-detail-panel">
        <div class="env-section-head">
          <div>
            <strong>变量覆盖预览</strong>
            <span>先看这个环境里定义的变量，哪些已经被接口真正接上，哪些还缺。</span>
          </div>
          <div class="env-inline-meta">
            <span>${escapeHtml(String(preview.defined.length))} 个已定义</span>
            <span>${escapeHtml(String(preview.connectedCount))} 个已接线</span>
            ${preview.missing.length ? `<span class="text-danger">${escapeHtml(String(preview.missing.length))} 个待补</span>` : ""}
          </div>
        </div>
        ${
          topVariables.length
            ? `
              <div class="env-variable-list">
                ${topVariables
                  .map(
                    (item) => `
                      <article class="env-variable-row">
                        <div>
                          <strong>${escapeHtml(item.key)}</strong>
                          <div class="env-variable-meta">
                            ${item.count ? renderEnvironmentStatusPill("passed", `已引用 ${item.count} 次`) : renderEnvironmentStatusPill("warning", "还没接到接口里")}
                            ${
                              item.kinds.length
                                ? `<span class="route-chip">${escapeHtml(item.kinds.map((kind) => (kind === "api" ? "接口" : kind === "case" ? "用例" : "环境自身")).join(" / "))}</span>`
                                : ""
                            }
                          </div>
                        </div>
                        <div class="env-variable-value">${escapeHtml(item.value)}</div>
                        ${
                          item.samples.length
                            ? `<p class="subdued-text">例如：${escapeHtml(item.samples.slice(0, 2).join("；"))}</p>`
                            : '<p class="subdued-text">当前没有发现这个变量被任何接口模板或用例覆盖引用。</p>'
                        }
                      </article>
                    `
                  )
                  .join("")}
              </div>
            `
            : `<div class="empty-card compact-empty">这个环境还没有变量。只有在接口完全不依赖 env.variables.xxx 时，才不会受影响。</div>`
        }
        ${
          preview.defined.length > topVariables.length
            ? `<div class="subdued-text">还有 ${escapeHtml(String(preview.defined.length - topVariables.length))} 个变量未展开，编辑环境时可以继续查看和调整。</div>`
            : ""
        }
        ${
          preview.missing.length
            ? `
              <div class="env-warning-box">
                <strong>待补变量</strong>
                <div class="env-warning-list">
                  ${preview.missing
                    .slice(0, 3)
                    .map(
                      (item) => `
                        <div>
                          <span class="route-chip route-chip-danger">${escapeHtml(item.key)}</span>
                          <span>${escapeHtml(`被引用 ${item.count} 次`)}</span>
                          ${item.samples[0] ? `<span class="subdued-text">${escapeHtml(item.samples[0])}</span>` : ""}
                        </div>
                      `
                    )
                    .join("")}
                </div>
              </div>
            `
            : ""
        }
      </section>
    `;
  }

  function buildEnvironmentSuiteRecommendation(env, model) {
    const runs = state.data?.runs || model.runs || [];
    const suites = model.suites || [];
    const latestEnvRunBySuite = new Map();

    runs
      .filter((run) => run.environmentId === env.id)
      .forEach((run) => {
        if (!latestEnvRunBySuite.has(run.suiteId)) {
          latestEnvRunBySuite.set(run.suiteId, run);
        }
      });

    const candidates = suites.map((suite) => {
      const latestEnvRun = latestEnvRunBySuite.get(suite.id) || null;
      const exactEnvMatch = suite.defaultEnvironmentId === env.id;
      const tags = new Set(suite.tags || []);
      const isSmoke = ["smoke", "starter", "core"].some((tag) => tags.has(tag));
      const itemCount = suite.items?.length || 0;
      const caseItems = (suite.items || []).filter((item) => item.itemType !== "suite");
      const apiCount = new Set(caseItems.map((item) => `${item.method || "GET"} ${item.path || "/"}`)).size;
      const hasLoginChain = (suite.items || []).some((item) => {
        const text = `${item.caseName || ""} ${item.path || ""} ${item.roleText || ""}`.toLowerCase();
        return /login|signin|auth|token|session/.test(text) || item.role === "setup";
      });
      const failedStep = (latestEnvRun?.steps || []).find((step) => step.status === "failed") || null;
      const reasons = [];

      if (exactEnvMatch) {
        reasons.push(`默认绑定当前环境`);
      }
      if (isSmoke) {
        reasons.push("带冒烟标签");
      }
      if (itemCount) {
        reasons.push(`${itemCount} 步链路`);
      }
      if (latestEnvRun?.status === "failed") {
        reasons.push(`最近在该环境失败过`);
      } else if (latestEnvRun?.status === "passed") {
        reasons.push(`最近在该环境跑通过`);
      }

      return {
        suite,
        latestEnvRun,
        exactEnvMatch,
        isSmoke,
        itemCount,
        apiCount,
        hasLoginChain,
        failedStep,
        reasons
      };
    });

    const failedCandidate = candidates
      .filter((item) => item.latestEnvRun?.status === "failed")
      .sort((left, right) => {
        const timeDiff = String(right.latestEnvRun?.finishedAt || right.latestEnvRun?.startedAt || "").localeCompare(
          String(left.latestEnvRun?.finishedAt || left.latestEnvRun?.startedAt || "")
        );
        if (timeDiff !== 0) {
          return timeDiff;
        }
        if (left.exactEnvMatch !== right.exactEnvMatch) {
          return left.exactEnvMatch ? -1 : 1;
        }
        return left.itemCount - right.itemCount;
      })[0];

    if (failedCandidate) {
      return {
        suite: failedCandidate.suite,
        mode: "retry-failed",
        description: `优先推荐最近在这个环境下失败过的场景“${failedCandidate.suite.name}”，先确认问题是否已经修复。`,
        reasons: failedCandidate.reasons,
        validation: buildRunValidation(failedCandidate.latestEnvRun, {
          targetName: `推荐目标“${failedCandidate.suite.name}”`,
          failureMessage: failedCandidate.failedStep?.message || "",
          failureStepLabel: failedCandidate.failedStep?.caseName || failedCandidate.failedStep?.apiName || "",
          runId: failedCandidate.latestEnvRun?.id || "",
          stepId: failedCandidate.failedStep?.id || "",
          caseId: failedCandidate.failedStep?.caseId || "",
          envId: env.id,
          suiteId: failedCandidate.suite.id
        }),
        meta: {
          latestRunText: failedCandidate.latestEnvRun
            ? `${relativeTime(failedCandidate.latestEnvRun.finishedAt || failedCandidate.latestEnvRun.startedAt)}失败`
            : "",
          stepCount: failedCandidate.itemCount,
          apiCount: failedCandidate.apiCount,
          hasLoginChain: failedCandidate.hasLoginChain,
          failedStepText: failedCandidate.failedStep
            ? `上次失败在 ${failedCandidate.failedStep.caseName || failedCandidate.failedStep.apiName || "未知步骤"}`
            : ""
        }
      };
    }

    const smokeCandidate = candidates
      .filter((item) => item.exactEnvMatch || item.latestEnvRun || item.isSmoke)
      .sort((left, right) => {
        if (left.isSmoke !== right.isSmoke) {
          return left.isSmoke ? -1 : 1;
        }
        if (left.exactEnvMatch !== right.exactEnvMatch) {
          return left.exactEnvMatch ? -1 : 1;
        }
        if (left.itemCount !== right.itemCount) {
          return left.itemCount - right.itemCount;
        }
        return String(right.suite.updatedAt || "").localeCompare(String(left.suite.updatedAt || ""));
      })[0];

    if (smokeCandidate) {
      return {
        suite: smokeCandidate.suite,
        mode: smokeCandidate.isSmoke ? "smoke" : "quickest",
        description: smokeCandidate.isSmoke
          ? `优先推荐带冒烟标签的场景“${smokeCandidate.suite.name}”，更适合先验证环境是否能跑通。`
          : `优先推荐步骤更短的场景“${smokeCandidate.suite.name}”，先用最短链路验证环境。`,
        reasons: smokeCandidate.reasons,
        validation: buildRunValidation(smokeCandidate.latestEnvRun, {
          targetName: `推荐目标“${smokeCandidate.suite.name}”`,
          emptySummary: "这个推荐场景还没在当前环境下跑过，适合现在先试跑一次。",
          failureMessage: smokeCandidate.failedStep?.message || "",
          failureStepLabel: smokeCandidate.failedStep?.caseName || smokeCandidate.failedStep?.apiName || "",
          runId: smokeCandidate.latestEnvRun?.id || "",
          stepId: smokeCandidate.failedStep?.id || "",
          caseId: smokeCandidate.failedStep?.caseId || "",
          envId: env.id,
          suiteId: smokeCandidate.suite.id
        }),
        meta: {
          latestRunText: smokeCandidate.latestEnvRun
            ? `${relativeTime(smokeCandidate.latestEnvRun.finishedAt || smokeCandidate.latestEnvRun.startedAt)}${smokeCandidate.latestEnvRun.status === "passed" ? "通过" : smokeCandidate.latestEnvRun.status === "failed" ? "失败" : "执行"}`
            : "还没在该环境跑过",
          stepCount: smokeCandidate.itemCount,
          apiCount: smokeCandidate.apiCount,
          hasLoginChain: smokeCandidate.hasLoginChain,
          failedStepText: smokeCandidate.failedStep
            ? `最近失败在 ${smokeCandidate.failedStep.caseName || smokeCandidate.failedStep.apiName || "未知步骤"}`
            : ""
        }
      };
    }

    return {
      suite: null,
      mode: "none",
      description: "",
      reasons: [],
      validation: null,
      meta: null
    };
  }

  function renderEnvironmentRecommendation(env, model, diagnostics, smoke) {
    const suiteRecommendation = buildEnvironmentSuiteRecommendation(env, model);
    const suiteUsingEnv = suiteRecommendation.suite;
    const failedChecks = (diagnostics?.checks || []).filter((item) => item.status === "failed");
    const warningChecks = (diagnostics?.checks || []).filter((item) => item.status === "warning");
    const failedKeys = new Set(failedChecks.map((item) => item.key));

    let tone = "primary";
    let title = "先做一次环境体检";
    let description = "先确认地址、鉴权和变量有没有准备好，再开始执行场景。";
    let primary = `<button class="primary-button" data-action="run-environment-diagnostics" data-env-id="${escapeHtml(env.id)}">环境体检</button>`;
    let secondary = `<button class="secondary-button" data-action="run-environment-auth-smoke" data-env-id="${escapeHtml(env.id)}">鉴权试跑</button>`;

    if (!diagnostics) {
      return `
        <section class="env-guide-card env-guide-primary">
          <div>
            <strong>${escapeHtml(title)}</strong>
            <p>${escapeHtml(description)}</p>
          </div>
          <div class="button-row">${primary}${secondary}</div>
        </section>
      `;
    }

    if (failedKeys.has("baseUrl") || (failedKeys.has("probe") && diagnostics?.probe?.category !== "auth")) {
      tone = "danger";
      title = "地址或连通性还有问题，先别急着跑用例";
      description = "这类问题通常先修 Base URL、端口或服务路径。地址没通之前，执行场景只会反复失败。";
      primary = `<button class="primary-button" data-action="open-modal" data-modal-type="environment" data-env-id="${escapeHtml(env.id)}" data-repair-key="baseUrl" data-repair-message="先修 Base URL 或基础连通性" data-focus-field="baseUrl">先修地址</button>`;
      secondary = `<button class="secondary-button" data-action="run-environment-diagnostics" data-env-id="${escapeHtml(env.id)}">修完后重检</button>`;
    } else if (failedKeys.has("auth") || diagnostics?.probe?.category === "auth" || smoke?.status === "failed") {
      tone = "danger";
      title = "鉴权还没打通，建议先处理 Token 或 Key";
      description = "服务本身大概率可达，但当前环境鉴权值不对，先修 Bearer Token 或 API Key，再做真实执行。";
      primary = `<button class="primary-button" data-action="open-modal" data-modal-type="environment" data-env-id="${escapeHtml(env.id)}" data-repair-key="auth" data-repair-message="先修鉴权配置" data-focus-field="authValue">修鉴权</button>`;
      secondary = `<button class="secondary-button" data-action="run-environment-auth-smoke" data-env-id="${escapeHtml(env.id)}">重新试跑鉴权</button>`;
    } else if (failedKeys.has("variables")) {
      tone = "warning";
      title = "环境变量还没补齐，先把依赖变量补上";
      description = "接口模板里已经引用了环境变量。现在最值得做的是把缺失变量补齐，否则运行时会出现空值。";
      primary = `<button class="primary-button" data-action="open-modal" data-modal-type="environment" data-env-id="${escapeHtml(env.id)}" data-repair-key="variables" data-repair-message="先补环境变量" data-focus-field="envVariables">补环境变量</button>`;
      secondary = `<button class="secondary-button" data-action="run-environment-diagnostics" data-env-id="${escapeHtml(env.id)}">补完后重检</button>`;
    } else if (failedKeys.has("runner")) {
      tone = "danger";
      title = "执行器当前不可用，环境配置好了也跑不起来";
      description = "这不是接口本身的问题。先恢复执行器，再回来运行场景或用例。";
      primary = `<button class="primary-button" data-action="run-environment-diagnostics" data-env-id="${escapeHtml(env.id)}">重新检查执行器</button>`;
      secondary = `<button class="secondary-button" data-action="quick-nav" data-target="execution">去看执行中心</button>`;
    } else if (warningChecks.length || smoke?.status === "warning") {
      tone = "warning";
      title = "环境基本可用，建议先做一次真实试跑";
      description = "当前没有硬性阻塞项，但还有待确认信息。最有效的下一步是用这个环境跑一条真实场景或用例。";
      primary = suiteUsingEnv
        ? `<button class="primary-button" data-action="run-selected-suite" data-id="${escapeHtml(suiteUsingEnv.id)}">${escapeHtml(suiteRecommendation.mode === "retry-failed" ? "重跑失败场景" : "试跑推荐场景")}</button>`
        : `<button class="primary-button" data-action="open-modal" data-modal-type="scene-builder">生成场景</button>`;
      secondary = suiteUsingEnv
        ? `<button class="secondary-button" data-action="quick-nav" data-target="suites">去看场景编排</button>`
        : `<button class="secondary-button" data-action="run-environment-auth-smoke" data-env-id="${escapeHtml(env.id)}">再跑一次鉴权</button>`;
      if (suiteRecommendation.description) {
        description = `${description}${suiteUsingEnv ? ` ${suiteRecommendation.description}` : ""}`;
      }
    } else {
      tone = "success";
      title = "环境已经准备好，可以直接开始自动化执行";
      description = suiteUsingEnv
        ? suiteRecommendation.description || `推荐直接用“${suiteUsingEnv.name}”跑一次，验证这个环境在真实链路里是否稳定。`
        : "环境本身已经通过检查，下一步可以生成场景或用例，开始第一次真实执行。";
      primary = suiteUsingEnv
        ? `<button class="primary-button" data-action="run-selected-suite" data-id="${escapeHtml(suiteUsingEnv.id)}">${escapeHtml(suiteRecommendation.mode === "retry-failed" ? "执行失败场景复跑" : suiteRecommendation.mode === "smoke" ? "执行冒烟场景" : "执行推荐场景")}</button>`
        : `<button class="primary-button" data-action="open-modal" data-modal-type="scene-builder">生成第一个场景</button>`;
      secondary = suiteUsingEnv
        ? `<button class="secondary-button" data-action="quick-nav" data-target="${suiteRecommendation.mode === "retry-failed" ? "reports" : "suites"}">${escapeHtml(suiteRecommendation.mode === "retry-failed" ? "去看失败报告" : "去看场景编排")}</button>`
        : `<button class="secondary-button" data-action="start-starter-guide">开始新手引导</button>`;
    }

    return `
      <section class="env-guide-card env-guide-${escapeHtml(tone)}">
        <div>
          <strong>${escapeHtml(title)}</strong>
          <p>${escapeHtml(description)}</p>
          ${suiteUsingEnv ? renderValidationWriteback(suiteRecommendation.validation, "env-guide-validation") : ""}
          ${
            suiteUsingEnv && (suiteRecommendation.reasons?.length || suiteRecommendation.meta)
              ? `
                <div class="env-guide-explain">
                  <div class="env-guide-chip-list">
                    ${(suiteRecommendation.reasons || []).slice(0, 4).map((item) => `<span class="route-chip">${escapeHtml(item)}</span>`).join("")}
                  </div>
                  ${
                    suiteRecommendation.meta
                      ? `
                        <div class="env-guide-meta">
                          <span>${escapeHtml(`推荐场景：${suiteUsingEnv.name}`)}</span>
                          ${suiteRecommendation.meta.latestRunText ? `<span>${escapeHtml(suiteRecommendation.meta.latestRunText)}</span>` : ""}
                          ${suiteRecommendation.meta.stepCount ? `<span>${escapeHtml(`${suiteRecommendation.meta.stepCount} 步`)}</span>` : ""}
                          ${suiteRecommendation.meta.apiCount ? `<span>${escapeHtml(`${suiteRecommendation.meta.apiCount} 个接口`)}</span>` : ""}
                          ${suiteRecommendation.meta.hasLoginChain ? `<span>${escapeHtml("包含登录链路")}</span>` : ""}
                          ${suiteRecommendation.meta.failedStepText ? `<span>${escapeHtml(suiteRecommendation.meta.failedStepText)}</span>` : ""}
                        </div>
                      `
                      : ""
                  }
                </div>
              `
              : ""
          }
        </div>
        <div class="button-row">${primary}${secondary}</div>
      </section>
    `;
  }

  function renderEnvironmentHealthPanel(env, model) {
    const runtime = getEnvironmentRuntime(env.id);
    const diagnostics = runtime.diagnostics;
    const smoke = runtime.smoke;
    const spotlight = runtime.spotlight || null;

    const buildRepairTarget = (check) => {
      if (!check) {
        return null;
      }

      if (check.key === "baseUrl") {
        return { focusField: "baseUrl" };
      }
      if (check.key === "headers") {
        return { focusField: "headers" };
      }
      if (check.key === "auth") {
        return { focusField: env.authObject?.type === "apikey" && !env.authObject?.header ? "authHeader" : "authValue" };
      }
      if (check.key === "variables") {
        return {
          focusField: "envVariables",
          focusVariable: diagnostics?.missingEnvVariables?.[0] || ""
        };
      }
      if (check.key === "probe") {
        return {
          focusField: diagnostics?.probe?.category === "auth" ? "authValue" : "baseUrl"
        };
      }
      if (check.key === "runner") {
        return null;
      }
      return { focusField: "baseUrl" };
    };

    if (!runtime.loading && !runtime.smokeLoading && !diagnostics && !smoke) {
      return `
        <section class="env-detail-panel">
          <div class="env-section-head">
            <div>
              <strong>环境体检</strong>
              <span>先做一次体检，再做鉴权试跑，能更快判断是地址问题还是 Token 问题。</span>
            </div>
          </div>
          <div class="subdued-text">点击“环境体检”后，这里会展示 Base URL、鉴权、执行器、连通性等检查结果。</div>
        </section>
      `;
    }

    return `
      <section class="env-detail-panel">
        ${renderEnvironmentRecommendation(env, model, diagnostics, smoke)}
        <div class="env-section-head">
          <div>
            <strong>环境体检</strong>
            <span>${
              diagnostics?.checkedAt
                ? `最近体检：${escapeHtml(formatDateTime(diagnostics.checkedAt))}`
                : smoke?.checkedAt
                  ? `最近试跑：${escapeHtml(formatDateTime(smoke.checkedAt))}`
                  : "正在等待结果"
            }</span>
          </div>
          <div class="env-inline-meta">
            ${runtime.loading ? renderEnvironmentStatusPill("warning", "体检中") : ""}
            ${runtime.smokeLoading ? renderEnvironmentStatusPill("warning", "试跑中") : ""}
            ${diagnostics?.summary ? renderEnvironmentStatusPill(diagnostics.summary.status, diagnostics.summary.status === "passed" ? "可执行" : diagnostics.summary.status === "warning" ? "基本可用" : "需修复") : ""}
          </div>
        </div>
        ${
          diagnostics?.checks?.length
            ? `
              <div class="env-check-list">
                ${diagnostics.checks
                  .map(
                    (check) => {
                      const repairTarget = buildRepairTarget(check);
                      return `
                      <article
                        class="env-check-row ${spotlight?.changedCheckKeys?.includes(check.key) ? "is-spotlight" : ""}"
                        data-env-check-key="${escapeHtml(check.key)}"
                      >
                        <div class="env-check-main">
                          <strong>${escapeHtml(check.label)}</strong>
                          ${renderEnvironmentStatusPill(check.status)}
                        </div>
                        <p>${escapeHtml(check.message)}</p>
                        ${check.detail ? `<div class="subdued-text">${escapeHtml(check.detail)}</div>` : ""}
                        ${
                          repairTarget && check.status !== "passed"
                            ? `
                              <div class="env-check-actions">
                                <button
                                  class="secondary-button small-button"
                                  data-action="open-modal"
                                  data-modal-type="environment"
                                  data-env-id="${escapeHtml(env.id)}"
                                  data-repair-key="${escapeHtml(check.key)}"
                                  data-repair-message="${escapeHtml(check.message)}"
                                  data-focus-field="${escapeHtml(repairTarget.focusField || "")}"
                                  ${repairTarget.focusVariable ? `data-focus-variable="${escapeHtml(repairTarget.focusVariable)}"` : ""}
                                >
                                  去修复
                                </button>
                              </div>
                            `
                            : ""
                        }
                      </article>
                    `;
                    }
                  )
                  .join("")}
              </div>
            `
            : runtime.loading
              ? `<div class="empty-card compact-empty">正在做环境体检...</div>`
              : ""
        }
        ${
          smoke
            ? `
              <div class="env-smoke-box ${escapeHtml(smoke.status || "neutral")} ${spotlight?.smokeChanged ? "is-spotlight" : ""}" data-env-smoke-box="true">
                <div class="env-smoke-head">
                  <strong>鉴权试跑</strong>
                  ${renderEnvironmentStatusPill(smoke.status, smoke.status === "passed" ? "已通过" : smoke.status === "warning" ? "可达待确认" : "未通过")}
                </div>
                <p>${escapeHtml(smoke.message || "暂无结果")}</p>
                <div class="env-inline-meta">
                  <span>目标地址：${escapeHtml(smoke.targetUrl || env.baseUrl)}</span>
                  ${smoke.statusCode ? `<span>状态码：${escapeHtml(String(smoke.statusCode))}</span>` : ""}
                </div>
                <div class="subdued-text">${escapeHtml(smoke.suggestion || "")}</div>
              </div>
            `
            : runtime.smokeLoading
              ? `<div class="empty-card compact-empty">正在发起鉴权试跑...</div>`
              : ""
        }
      </section>
    `;
  }

  function renderEnvironmentCard(env, isCurrent, model) {
    const runtime = getEnvironmentRuntime(env.id);
    return `
      <article class="env-card ${isCurrent ? "current" : ""} ${runtime.spotlight ? "is-spotlight" : ""}" data-env-card-id="${escapeHtml(env.id)}">
        <div class="env-head">
          <div class="env-left">
            <div class="env-icon">${svgGlobe()}</div>
            <div>
              <h3 class="env-name">${escapeHtml(env.displayName)}</h3>
              <div class="env-meta-line">
                ${isCurrent ? `<span class="scene-state">当前环境</span>` : ""}
                ${renderEnvironmentStatusPill(env.authObject?.type === "none" ? "warning" : "passed", env.authObject?.type === "none" ? "无公共鉴权" : env.authObject?.type === "bearer" ? "Bearer" : "API Key")}
                <span class="route-chip">${escapeHtml(`${Object.keys(env.variablesObject || {}).length} 个变量`)}</span>
                <span class="route-chip">${escapeHtml(`${Object.keys(env.headersObject || {}).length} 个 Header`)}</span>
              </div>
            </div>
          </div>
          <button class="env-menu" data-action="open-modal" data-modal-type="environment" data-env-id="${env.id}">编辑</button>
        </div>
        <div class="field">
          <label>环境标识</label>
          <div class="env-value">${escapeHtml(env.slug)}</div>
        </div>
        <div class="field">
          <label>Base URL</label>
          <div class="env-value">${escapeHtml(env.baseUrl)}</div>
        </div>
        <div class="env-action-row">
          <button class="secondary-button" data-action="open-modal" data-modal-type="environment" data-env-id="${env.id}">配置环境</button>
          <button class="secondary-button" data-action="run-environment-diagnostics" data-env-id="${env.id}">环境体检</button>
          <button class="secondary-button" data-action="run-environment-auth-smoke" data-env-id="${env.id}">鉴权试跑</button>
        </div>
        ${renderEnvironmentHealthPanel(env, model)}
        ${renderEnvironmentVariablePanel(env, model)}
      </article>
    `;
  }

  function schedulerStatusText(status) {
    return {
      active: "运行中",
      paused: "已暂停",
      invalid: "配置异常"
    }[status] || "未就绪";
  }

  function schedulerStatusClass(status) {
    return {
      active: "running",
      passed: "success",
      failed: "failed",
      canceled: "queued",
      queued: "queued",
      running: "running",
      paused: "queued",
      invalid: "failed"
    }[status] || "queued";
  }

  function renderSchedulerRow(schedule, model) {
    const environmentOptions = model.environments
      .map(
        (env) => `
          <option value="${escapeHtml(env.id)}" ${env.id === schedule.environmentId ? "selected" : ""}>
            ${escapeHtml(env.name)}
          </option>
        `
      )
      .join("");
    const lastRun = schedule.latestRun;
    const lastRunStatus = lastRun ? statusText(lastRun.status) : "暂无";
    const lastRunClass = lastRun ? schedulerStatusClass(lastRun.status) : "queued";
    const lastRunMeta = lastRun
      ? `${formatDateTime(lastRun.finishedAt || lastRun.startedAt || lastRun.queuedAt)} · ${formatDuration(lastRun.duration || 0)}`
      : "还没有调度执行记录";

    return `
      <form class="scheduler-row-form" data-scheduler-form="${escapeHtml(schedule.suiteId)}">
        <div class="scheduler-row-main">
          <div class="scheduler-suite-meta">
            <strong>${escapeHtml(schedule.suiteName)}</strong>
            <div class="scheduler-suite-subtitle">
              <span>${escapeHtml(schedule.projectName)}</span>
              <span>${escapeHtml(`超时 ${schedule.timeoutSeconds}s`)}</span>
              <span>${escapeHtml(schedule.failureStrategy === "continue" ? "失败继续" : "失败即停")}</span>
            </div>
          </div>
          <span class="status-pill status-${schedulerStatusClass(schedule.status)}">${escapeHtml(schedulerStatusText(schedule.status))}</span>
        </div>

        <div class="scheduler-row-config">
          <label class="field field-inline">
            <span>执行环境</span>
            <select name="defaultEnvironmentId">
              ${environmentOptions}
            </select>
          </label>
          <label class="field field-inline">
            <span>周期(分钟)</span>
            <input type="number" name="intervalMinutes" min="1" step="1" value="${escapeHtml(String(schedule.intervalMinutes || 30))}" />
          </label>
          <label class="field field-inline">
            <span>调度状态</span>
            <select name="enabled">
              <option value="true" ${schedule.enabled ? "selected" : ""}>启用</option>
              <option value="false" ${!schedule.enabled ? "selected" : ""}>暂停</option>
            </select>
          </label>
        </div>

        <div class="scheduler-row-timeline">
          <div class="scheduler-time-card">
            <span class="scheduler-time-label">下次触发</span>
            <strong>${escapeHtml(schedule.nextTriggerAt ? formatDateTime(schedule.nextTriggerAt) : "未计划")}</strong>
          </div>
          <div class="scheduler-time-card">
            <span class="scheduler-time-label">最近触发</span>
            <strong>${escapeHtml(schedule.lastTriggeredAt ? formatDateTime(schedule.lastTriggeredAt) : "暂无")}</strong>
          </div>
          <div class="scheduler-time-card">
            <span class="scheduler-time-label">最近结果</span>
            <strong><span class="status-pill status-${lastRunClass}">${escapeHtml(lastRunStatus)}</span></strong>
            <span class="scheduler-inline-meta">${escapeHtml(lastRunMeta)}</span>
          </div>
        </div>

        ${
          schedule.lastError
            ? `<div class="scheduler-row-alert">${escapeHtml(schedule.lastError)}</div>`
            : ""
        }

        <div class="scheduler-row-actions">
          <button type="submit" class="secondary-button">保存计划</button>
          <button
            type="button"
            class="secondary-button"
            data-action="toggle-scheduler-suite"
            data-id="${escapeHtml(schedule.suiteId)}"
          >
            ${schedule.enabled ? "暂停调度" : "启用调度"}
          </button>
          <button type="button" class="ghost-button" data-action="run-suite" data-id="${escapeHtml(schedule.suiteId)}">立即执行</button>
          <button type="button" class="ghost-button" data-action="open-scheduler-suite" data-id="${escapeHtml(schedule.suiteId)}">场景配置</button>
          ${
            lastRun?.id
              ? `<button type="button" class="plain-button" data-action="view-run-report" data-run-id="${escapeHtml(lastRun.id)}">查看最近运行</button>`
              : ""
          }
        </div>
      </form>
    `;
  }

  function renderOverviewPage() {
    const model = buildViewModel();
    const overview = state.overviewSummary;
    const trend = overview
      ? {
          labels: overview.trend.map((item) => item.label),
          passed: overview.trend.map((item) => item.passed),
          failed: overview.trend.map((item) => item.failed)
        }
      : buildTrendSeries(model.runs, 7);
    const latestRuns = overview?.recentRuns ?? model.runs.slice(0, 4);
    const totalPassed = overview?.totalPassed ?? model.runs.reduce((sum, run) => sum + run.summary.passed, 0);
    const totalFailed = overview?.totalFailed ?? model.runs.reduce((sum, run) => sum + run.summary.failed, 0);
    const executionTasks = buildExecutionTasks(model);
    const runningCount = overview?.runningCount ?? executionTasks.running.length;
    const queuedCount = overview?.queuedCount ?? executionTasks.queued.length;

    return `
      <div class="page-stack">
        ${
          state.starterGuideCompleted
            ? ""
            : `
              <section class="starter-banner">
                <div>
                  <strong>第一次使用接口自动化？</strong>
                  <p>跟着 4 步引导走一遍：选环境、选接口、设校验、点执行。</p>
                </div>
                <div class="starter-banner-actions">
                  <button class="secondary-button" data-action="open-modal" data-modal-type="business-template">业务模板</button>
                  <button class="primary-button" data-action="start-starter-guide">开始新手引导</button>
                </div>
              </section>
            `
        }
        ${renderOverviewRecommendation(model, latestRuns, executionTasks)}
        <section class="summary-grid">
          ${renderStatCard("通过用例", formatNumber(totalPassed), calcTrend(totalPassed, 0.125), "success", svgCheck())}
          ${renderStatCard("失败用例", formatNumber(totalFailed), calcTrend(totalFailed, -0.052), "danger", svgCross())}
          ${renderStatCard("执行中", formatNumber(runningCount), "当前活跃任务", "primary", svgClock())}
          ${renderStatCard("待处理", formatNumber(queuedCount), calcTrend(queuedCount, 0.083), "warning", svgWarning())}
        </section>

        <section class="overview-grid">
          <section class="panel panel-compact">
            <div class="panel-title-row">
              <div>
                <div class="panel-title">${svgTrend()}执行趋势（最近7天）</div>
              </div>
            </div>
            <div class="chart-shell">
              <div class="line-chart">${renderLineChart(trend.labels, trend.passed, trend.failed, 620, 250)}</div>
              <div class="chart-legend">
                <span class="legend-line legend-success">通过</span>
                <span class="legend-line legend-danger">失败</span>
              </div>
            </div>
          </section>

          <section class="panel panel-compact">
            <div class="panel-title-row">
              <div class="panel-title">快速操作</div>
            </div>
            <div class="quick-actions">
              ${renderQuickAction("第一次使用", "start-starter-guide")}
              ${renderQuickAction("业务模板", "open-modal", { modalType: "business-template" })}
              ${renderQuickAction("场景向导", "open-modal", { modalType: "scene-builder" })}
              ${renderQuickAction("创建测试用例", "open-modal", { modalType: "case" })}
              ${renderQuickAction("编排测试场景", "quick-nav", { target: "suites" })}
              ${renderQuickAction("执行测试任务", "open-execution-config", { sourceType: "suite" })}
              ${renderQuickAction("查看测试报告", "quick-nav", { target: "reports" })}
              ${renderQuickAction("OpenAPI 导入", "open-modal", { modalType: "openapi" })}
            </div>
          </section>
        </section>

        <section class="panel recent-executions">
          <div class="panel-title-row">
            <div class="panel-title">最近执行</div>
          </div>
          ${
            latestRuns.length
              ? latestRuns.map((run) => renderRecentRunCard(run)).join("")
              : `<div class="empty-card">还没有执行记录，先去场景编排页面运行一个场景。</div>`
          }
        </section>
      </div>
    `;
  }

  function renderApisPage() {
    const model = buildViewModel();
    const filters = state.filters.apis;
    const rows = filterApiRows(model);
    const allSelected = rows.length > 0 && rows.every((item) => isSelected("apis", item.id));

    return `
      <div class="page-stack">
        <section class="toolbar">
          <div class="toolbar-left">
            ${renderSearchBox("搜索接口名称或路径...", filters.q, "apis", "q")}
            ${renderSelectControl(rowsOrAllOption(model.modules.map((item) => ({ value: item.id, label: item.name })), "全部分组"), filters.moduleId, "apis", "moduleId")}
            ${renderSelectControl(rowsOrAllOption(["GET", "POST", "PUT", "PATCH", "DELETE"].map((item) => ({ value: item, label: item })), "全部方法"), filters.method, "apis", "method")}
            ${renderFilterButton()}
          </div>
          <div class="toolbar-right">
            <button class="secondary-button" data-action="open-modal" data-modal-type="openapi">导入规范</button>
            <button class="secondary-button" data-action="open-modal" data-modal-type="business-template">业务模板</button>
            <button class="secondary-button" data-action="open-scene-builder-from-apis">${renderCountedButtonText("生成场景", selectedCount("apis"))}</button>
            <button class="secondary-button" data-action="batch-clone-records" data-collection="apis">${renderCountedButtonText("批量复制", selectedCount("apis"))}</button>
            <button class="secondary-button" data-action="batch-delete-records" data-collection="apis">${renderCountedButtonText("批量删除", selectedCount("apis"))}</button>
            <button class="primary-button" data-action="open-modal" data-modal-type="api">+ 新建接口</button>
          </div>
        </section>

        <section class="table-panel table-api">
          <div class="table">
            <div class="table-header">
              <div class="checkbox-cell">${renderSelectionCheckbox({ collection: "apis", checked: allSelected, label: "全选接口" })}</div>
              <div>接口名称</div>
              <div>请求方法</div>
              <div>接口路径</div>
              <div>分组</div>
              <div>状态</div>
              <div>更新时间</div>
              <div>操作</div>
            </div>
            ${
              rows.length
                ? rows
                    .map(
                      (item) => `
                        <div class="table-row${isSelected("apis", item.id) ? " row-selected" : ""}">
                          <div class="checkbox-cell">${renderSelectionCheckbox({ collection: "apis", id: item.id, checked: isSelected("apis", item.id), label: `选择接口 ${item.name}` })}</div>
                          <div><strong>${escapeHtml(item.name)}</strong></div>
                          <div><span class="method-pill method-${item.method.toLowerCase()}">${escapeHtml(item.method)}</span></div>
                          <div><span class="route-chip">${escapeHtml(item.path)}</span></div>
                          <div>${escapeHtml(item.groupName)}</div>
                          <div><span class="status-pill status-${item.isDeprecated ? "queued" : "success"}">${item.isDeprecated ? "已废弃" : "正常"}</span></div>
                          <div>${escapeHtml(formatDate(item.updatedAt || item.createdAt))}</div>
                          <div class="more-cell action-row-compact">
                            <button class="plain-button" data-action="view-record" data-collection="apis" data-id="${item.id}">详情</button>
                            <button class="plain-button" data-action="create-default-case" data-api-id="${item.id}">生成默认用例</button>
                            <button class="plain-button" data-action="open-scene-builder-from-apis" data-api-id="${item.id}">生成场景</button>
                            <button class="plain-button" data-action="open-modal" data-modal-type="api" data-record-id="${item.id}">编辑</button>
                            <button class="plain-button" data-action="clone-record" data-collection="apis" data-id="${item.id}">复制</button>
                            <button class="plain-button text-danger" data-action="delete-record" data-collection="apis" data-id="${item.id}">删除</button>
                          </div>
                        </div>
                      `
                    )
                    .join("")
                : `<div class="empty-card panel-empty">暂无符合条件的接口。</div>`
            }
          </div>
        </section>
      </div>
    `;
  }

  function renderCasesPage() {
    const model = buildViewModel();
    const filters = state.filters.cases;
    const rows = filterCaseRows(model);
    const allSelected = rows.length > 0 && rows.every((item) => isSelected("cases", item.id));

    return `
      <div class="page-stack">
        <section class="toolbar">
          <div class="toolbar-left">
            ${renderSearchBox("搜索测试用例...", filters.q, "cases", "q")}
            ${renderSelectControl(rowsOrAllOption([{ value: "high", label: "高" }, { value: "medium", label: "中" }, { value: "low", label: "低" }], "全部优先级"), filters.priority, "cases", "priority")}
            ${renderSelectControl(rowsOrAllOption([{ value: "passed", label: "通过" }, { value: "failed", label: "失败" }, { value: "running", label: "执行中" }, { value: "queued", label: "排队中" }], "全部状态"), filters.status, "cases", "status")}
            ${renderFilterButton()}
          </div>
          <div class="toolbar-right">
            <button class="secondary-button" data-action="open-execution-config" data-source-type="batch-cases">${renderCountedButtonText("批量执行", selectedCount("cases"))}</button>
            <button class="secondary-button" data-action="batch-add-cases-to-suite">${renderCountedButtonText("加入当前场景", selectedCount("cases"))}</button>
            <button class="secondary-button" data-action="batch-clone-records" data-collection="cases">${renderCountedButtonText("批量复制", selectedCount("cases"))}</button>
            <button class="secondary-button" data-action="batch-delete-records" data-collection="cases">${renderCountedButtonText("批量删除", selectedCount("cases"))}</button>
            <button class="primary-button" data-action="open-modal" data-modal-type="case">+ 新建用例</button>
          </div>
        </section>

        <section class="table-panel table-case">
          <div class="table">
            <div class="table-header">
              <div class="checkbox-cell">${renderSelectionCheckbox({ collection: "cases", checked: allSelected, label: "全选用例" })}</div>
              <div>用例ID</div>
              <div>用例名称</div>
              <div>优先级</div>
              <div>执行状态</div>
              <div>最后执行</div>
              <div>创建人</div>
              <div>标签</div>
              <div>操作</div>
            </div>
            ${
              rows.length
                ? rows
                    .map(
                      (item) => `
                        <div class="table-row${isSelected("cases", item.id) ? " row-selected" : ""}">
                          <div class="checkbox-cell">${renderSelectionCheckbox({ collection: "cases", id: item.id, checked: isSelected("cases", item.id), label: `选择用例 ${item.name}` })}</div>
                          <div><span class="link-text">${escapeHtml(item.displayId)}</span></div>
                          <div><strong>${escapeHtml(item.name)}</strong></div>
                          <div><span class="priority-pill priority-${item.priorityKey}">${escapeHtml(item.priorityText)}</span></div>
                          <div><span class="status-pill status-${item.executionStatus}">${escapeHtml(statusText(item.executionStatus))}</span></div>
                          <div>${escapeHtml(formatDateTime(item.lastExecutionAt))}</div>
                          <div>${escapeHtml(item.creator)}</div>
                          <div>${item.tags.map((tag) => `<span class="tag-pill">${escapeHtml(tag)}</span>`).join(" ") || '<span class="subdued-text">未标记</span>'}</div>
                          <div class="more-cell action-row-compact">
                            <button class="plain-button" data-action="view-record" data-collection="cases" data-id="${item.id}">详情</button>
                            <button class="plain-button" data-action="add-case-to-suite" data-case-id="${item.id}">加入场景</button>
                            <button class="plain-button" data-action="run-case" data-case-id="${item.id}">执行</button>
                            <button class="plain-button" data-action="open-modal" data-modal-type="case" data-record-id="${item.id}">编辑</button>
                            <button class="plain-button" data-action="clone-record" data-collection="cases" data-id="${item.id}">复制</button>
                            <button class="plain-button text-danger" data-action="delete-record" data-collection="cases" data-id="${item.id}">删除</button>
                          </div>
                        </div>
                      `
                    )
                    .join("")
                : `<div class="empty-card panel-empty">暂无符合条件的用例。</div>`
            }
          </div>
        </section>
      </div>
    `;
  }

  function renderSuitesPage() {
    const model = buildViewModel();
    const suite = model.suites.find((item) => item.id === state.selectedSuiteId) || model.suites[0];

    if (!suite) {
      return `
        <div class="page-stack">
          <section class="empty-card">
            <p>当前没有测试场景，先用向导生成一个能直接执行的场景，或者手工新建一个空场景。</p>
            <div class="button-row">
              <button class="primary-button" data-action="open-modal" data-modal-type="scene-builder">打开场景向导</button>
              <button class="secondary-button" data-action="open-modal" data-modal-type="suite">手工新建场景</button>
            </div>
          </section>
        </div>
      `;
    }

    return `
      <div class="page-stack">
        <section class="split-layout">
          <aside class="split-side">
            <section class="panel">
              <div class="panel-title-row">
                <div class="panel-title">测试场景</div>
              </div>
              <div class="button-row">
                <button class="primary-button button-block" data-action="open-modal" data-modal-type="scene-builder">场景向导</button>
                <button class="secondary-button button-block" data-action="open-modal" data-modal-type="suite">+ 新建场景</button>
              </div>
              <div class="scene-list">
                ${model.suites
                  .map(
                    (item) => `
                      <button class="suite-card ${item.id === suite.id ? "active" : ""}" data-action="select-suite" data-id="${item.id}">
                        <div class="suite-card-head">
                          <h4>${escapeHtml(item.name)}</h4>
                          <span class="scene-state ${item.sceneStateClass}">${escapeHtml(item.sceneStateText)}</span>
                        </div>
                        <div class="meta">
                          ${svgFlow()} ${escapeHtml(`${item.items.length} 个步骤`)}
                        </div>
                      </button>
                    `
                  )
                  .join("")}
              </div>
            </section>
          </aside>

          <main class="split-main">
            <section class="panel">
              <div class="suite-main-header">
                <div>
                  <h2>${escapeHtml(suite.name)}</h2>
                  <p>${escapeHtml(`${suite.items.length} 个步骤 · 最后修改：${formatDateTime(suite.updatedAt || suite.createdAt)}`)}</p>
                </div>
                <div class="suite-actions">
                  <button class="secondary-button" data-action="task-control">场景配置</button>
                  <button class="ghost-button" data-action="open-execution-config" data-source-type="suite" data-suite-id="${suite.id}">执行场景</button>
                  <button class="primary-button" data-action="save-suite-config">保存</button>
                </div>
              </div>

              <div class="flow-header">
                <h3>场景流程</h3>
                <button class="primary-button" data-action="open-modal" data-modal-type="step" data-suite-id="${suite.id}">+ 添加步骤</button>
              </div>

              <section class="dependency-card">
                <div class="panel-title-row">
                  <div>
                    <div class="panel-title">依赖图</div>
                    <div class="panel-subtitle">串行、并行分支、子场景和前后置工厂会在这里统一展示。</div>
                  </div>
                </div>
                ${renderDependencyGraph(suite)}
              </section>

              ${renderSuiteInsightPanel(suite, model)}

              ${renderSuiteVariablePanel(suite, model)}

              <div class="flow-list">
                ${
                  suite.items.length
                    ? suite.items
                        .sort((a, b) => a.order - b.order)
                        .map((item, index) => renderFlowStep(item, index))
                        .join("")
                    : `<div class="empty-card">当前场景还没有步骤，点击右上角“添加步骤”。</div>`
                }
              </div>

              <div class="center-action-row">
                <button class="step-add" data-action="open-modal" data-modal-type="step" data-suite-id="${suite.id}">+ 添加步骤</button>
              </div>

              <div class="config-card">
                <div class="config-title">场景配置</div>
                <form id="suiteConfigForm" class="config-grid">
                  <div class="field">
                    <label>执行环境</label>
                    <select name="defaultEnvironmentId">
                      ${model.environments
                        .map(
                          (env) => `
                            <option value="${env.id}" ${env.id === suite.defaultEnvironmentId ? "selected" : ""}>
                              ${escapeHtml(env.name)}
                            </option>
                          `
                        )
                        .join("")}
                    </select>
                  </div>
                  <div class="field">
                    <label>失败策略</label>
                    <select name="failureStrategy">
                      <option value="stop" ${suite.failureStrategy === "stop" ? "selected" : ""}>立即停止</option>
                      <option value="continue" ${suite.failureStrategy === "continue" ? "selected" : ""}>失败继续</option>
                    </select>
                  </div>
                  <div class="field">
                    <label>默认数据集</label>
                    <select name="datasetId">
                      <option value="">不使用</option>
                      ${model.datasets
                        .map(
                          (dataset) => `
                            <option value="${dataset.id}" ${dataset.id === suite.datasetId ? "selected" : ""}>
                              ${escapeHtml(dataset.name)}
                            </option>
                          `
                        )
                        .join("")}
                    </select>
                  </div>
                  <div class="field">
                    <label>默认优先级</label>
                    <select name="executionPriority">
                      <option value="high" ${suite.executionConfig?.priority === "high" ? "selected" : ""}>高</option>
                      <option value="normal" ${suite.executionConfig?.priority !== "low" && suite.executionConfig?.priority !== "high" ? "selected" : ""}>普通</option>
                      <option value="low" ${suite.executionConfig?.priority === "low" ? "selected" : ""}>低</option>
                    </select>
                  </div>
                  <div class="field">
                    <label>自动重试次数</label>
                    <input type="number" name="maxRetries" min="0" step="1" value="${escapeHtml(String(suite.executionConfig?.maxRetries ?? 0))}" />
                  </div>
                  <div class="field">
                    <label>数据行失败策略</label>
                    <select name="stopOnDatasetFailure">
                      <option value="true" ${suite.executionConfig?.stopOnDatasetFailure !== false ? "selected" : ""}>当前数据行失败即停止</option>
                      <option value="false" ${suite.executionConfig?.stopOnDatasetFailure === false ? "selected" : ""}>继续后续数据行</option>
                    </select>
                  </div>
                  <div class="field">
                    <label>定时调度</label>
                    <select name="scheduleEnabled">
                      <option value="true" ${suite.schedule?.enabled ? "selected" : ""}>启用</option>
                      <option value="false" ${!suite.schedule?.enabled ? "selected" : ""}>暂停</option>
                    </select>
                  </div>
                  <div class="field">
                    <label>调度周期（分钟）</label>
                    <input type="number" name="intervalMinutes" min="1" step="1" value="${escapeHtml(String(suite.schedule?.intervalMinutes || 30))}" />
                  </div>
                  <div class="field full-span">
                    <label>超时时间（秒）</label>
                    <input type="number" name="timeoutSeconds" min="30" step="10" value="${escapeHtml(String(suite.timeoutSeconds || 300))}" />
                  </div>
                </form>
              </div>
            </section>
          </main>
        </section>
      </div>
    `;
  }

  function renderSchedulerPage() {
    const model = buildViewModel();
    const schedulerCenter = state.schedulerCenter;

    if (!schedulerCenter) {
      return `
        <div class="page-stack">
          <section class="empty-card">正在加载调度计划...</section>
        </div>
      `;
    }

    return `
      <div class="page-stack">
        <section class="summary-grid">
          ${renderStatCard("已启用计划", formatNumber(schedulerCenter.summary.enabledCount || 0), `共 ${formatNumber(schedulerCenter.summary.totalSuites || 0)} 个场景`, "primary", svgClock())}
          ${renderStatCard("暂停计划", formatNumber(schedulerCenter.summary.pausedCount || 0), "等待手动启用", "warning", svgWarning())}
          ${renderStatCard("10 分钟内触发", formatNumber(schedulerCenter.summary.dueSoonCount || 0), "近期将自动入队", "success", svgTrend())}
          ${renderStatCard("队列任务", formatNumber((schedulerCenter.summary.queueQueued || 0) + (schedulerCenter.summary.queueRunning || 0)), `运行中 ${formatNumber(schedulerCenter.summary.queueRunning || 0)} / 排队 ${formatNumber(schedulerCenter.summary.queueQueued || 0)}`, "danger", svgFlow())}
        </section>

        <section class="toolbar">
          <div class="toolbar-left">
            <div>
              <div class="panel-title">定时调度中心</div>
              <div class="panel-subtitle">统一查看场景计划、最近触发和执行状态。最近同步：${escapeHtml(schedulerCenter.refreshedAt ? formatDateTime(schedulerCenter.refreshedAt) : "暂无")}</div>
            </div>
          </div>
          <div class="toolbar-right">
            <button class="secondary-button" data-action="refresh-scheduler">刷新状态</button>
            <button class="secondary-button" data-action="refresh-scheduler" data-sync="true">同步计划</button>
            <button class="primary-button" data-action="quick-nav" data-target="suites">去编排场景</button>
          </div>
        </section>

        <section class="scheduler-grid">
          ${
            schedulerCenter.schedules.length
              ? schedulerCenter.schedules.map((schedule) => renderSchedulerRow(schedule, model)).join("")
              : `<div class="empty-card">当前还没有可调度的场景，先去场景编排页面创建一个场景。</div>`
          }
        </section>
      </div>
    `;
  }

  function renderEnvsPage() {
    const model = buildViewModel();
    const isAdmin = state.auth.user?.role === "admin";
    const globalVariables = (state.globalVariables ?? buildGlobalVariables(model)).map((item) => ({
      ...item,
      source: item.source || item.sourceName,
      value: String(item.value)
    }));

    return `
      <div class="page-stack">
        <div class="tab-switcher">
          <button class="${state.envTab === "environments" ? "active" : ""}" data-action="switch-env-tab" data-value="environments">环境配置</button>
          <button class="${state.envTab === "globals" ? "active" : ""}" data-action="switch-env-tab" data-value="globals">全局变量</button>
          ${isAdmin ? `<button class="${state.envTab === "users" ? "active" : ""}" data-action="switch-env-tab" data-value="users">用户治理</button>` : ""}
        </div>

        ${
          state.envTab === "environments"
            ? `
              <section class="toolbar">
                <div class="toolbar-left">
                  <div>
                    <div class="panel-title">测试环境列表</div>
                    <div class="panel-subtitle">这里不只是配 Base URL。现在可以直接做环境体检、鉴权试跑，并查看变量覆盖情况。</div>
                  </div>
                </div>
                <div class="toolbar-right">
                  <button class="primary-button" data-action="open-modal" data-modal-type="environment">+ 新建环境</button>
                </div>
              </section>
              <section class="env-grid">
                ${model.environments.map((env) => renderEnvironmentCard(env, env.isCurrent, model)).join("")}
              </section>
            `
            : state.envTab === "users"
              ? renderUserGovernancePage(model)
            : `
              <section class="panel">
                <div class="panel-title-row">
                  <div class="panel-title">全局变量</div>
                </div>
                ${
                  globalVariables.length
                    ? `
                      <div class="report-table report-table-compact">
                        <div class="report-table-head">
                          <div>变量名</div>
                          <div>当前值</div>
                          <div>来源</div>
                        </div>
                        ${globalVariables
                          .map(
                            (item) => `
                              <div class="report-table-row">
                                <div><strong>${escapeHtml(item.key)}</strong></div>
                                <div><span class="route-chip">${escapeHtml(item.value)}</span></div>
                                <div>${escapeHtml(item.source)}</div>
                              </div>
                            `
                          )
                          .join("")}
                      </div>
                    `
                    : `<div class="empty-card">当前没有可展示的全局变量。</div>`
                }
              </section>
            `
        }
      </div>
    `;
  }

  function syncEnvironmentDiagnosticsFocus() {
    if (state.activeTab !== "envs" || state.envTab !== "environments") {
      return;
    }

    const targetEntry = Object.entries(state.environmentDiagnostics || {}).find(([, runtime]) => runtime?.spotlight?.pending);
    if (!targetEntry) {
      return;
    }

    const [envId, runtime] = targetEntry;
    const card = document.querySelector(`[data-env-card-id="${envId}"]`);
    if (!card) {
      return;
    }

    const anchorCheckKey = runtime.spotlight?.anchorCheckKey || "";
    const anchorNode =
      (anchorCheckKey && card.querySelector(`[data-env-check-key="${anchorCheckKey}"]`)) ||
      (runtime.spotlight?.smokeChanged ? card.querySelector('[data-env-smoke-box="true"]') : null) ||
      card;

    anchorNode.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("is-spotlight-active");
    anchorNode.classList.add("is-spotlight-active");
    runtime.spotlight.pending = false;
  }

  async function batchCloneRecords(collection) {
    const ids = [...(state.selections[collection] || [])];
    if (!ids.length) {
      showToast("请先勾选要复制的记录");
      return;
    }

    const label = collection === "apis" ? "接口" : collection === "cases" ? "用例" : "记录";

    try {
      const cloned = await api(`/api/${collection}/batch-clone`, {
        method: "POST",
        body: JSON.stringify({ ids })
      });
      state.selections[collection] = [];
      showToast(`已复制 ${cloned.length} 个${label}`);
      await refreshData();
    } catch (error) {
      showToast(error.message);
    }
  }

  async function batchDeleteRecords(collection) {
    const ids = [...(state.selections[collection] || [])];
    if (!ids.length) {
      showToast("请先勾选要删除的记录");
      return;
    }

    const label = collection === "apis" ? "接口" : collection === "cases" ? "用例" : "记录";
    if (!window.confirm(`确认批量删除 ${ids.length} 个${label}？`)) {
      return;
    }

    try {
      const result = await api(`/api/${collection}/batch-delete`, {
        method: "POST",
        body: JSON.stringify({ ids })
      });

      state.selections[collection] = [];

      if (result.failedCount && !result.deletedCount) {
        showToast(result.failed[0]?.error || `批量删除${label}失败`);
        return;
      }

      if (result.failedCount) {
        showToast(`已删除 ${result.deletedCount} 个${label}，${result.failedCount} 个删除失败`);
      } else {
        showToast(`已删除 ${result.deletedCount} 个${label}`);
      }

      await refreshData();
    } catch (error) {
      showToast(error.message);
    }
  }

  async function submitSchedulerForm(suiteId, formData) {
    const schedule = state.schedulerCenter?.schedules?.find((item) => item.suiteId === suiteId);
    if (!schedule) {
      throw new Error("未找到调度计划");
    }

    const intervalMinutes = Number(formData.get("intervalMinutes") || 0);
    if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
      throw new Error("调度周期必须大于 0");
    }

    await api(`/api/suites/${suiteId}`, {
      method: "PUT",
      body: JSON.stringify({
        defaultEnvironmentId: formData.get("defaultEnvironmentId") || schedule.environmentId || null,
        schedule: {
          enabled: formData.get("enabled") === "true",
          intervalMinutes
        }
      })
    });
    showToast("调度计划已保存");
    await refreshData();
  }

  async function toggleSchedulerSuite(suiteId) {
    const schedule = state.schedulerCenter?.schedules?.find((item) => item.suiteId === suiteId);
    if (!schedule) {
      throw new Error("未找到调度计划");
    }

    await api(`/api/suites/${suiteId}`, {
      method: "PUT",
      body: JSON.stringify({
        defaultEnvironmentId: schedule.environmentId || null,
        schedule: {
          enabled: !schedule.enabled,
          intervalMinutes: schedule.intervalMinutes || 30
        }
      })
    });
    showToast(schedule.enabled ? "调度已暂停" : "调度已启用");
    await refreshData();
  }

  async function runEnvironmentDiagnostics(envId) {
    if (!envId) {
      throw new Error("未指定环境");
    }

    state.environmentDiagnostics[envId] = {
      ...(state.environmentDiagnostics[envId] || {}),
      loading: true
    };
    renderPage();

    try {
      const diagnostics = await api(`/api/environments/${envId}/diagnostics`);
      state.environmentDiagnostics[envId] = {
        ...(state.environmentDiagnostics[envId] || {}),
        diagnostics,
        loading: false
      };
      renderPage();
      showToast(diagnostics.summary?.status === "passed" ? "环境体检通过" : "环境体检已完成");
    } catch (error) {
      state.environmentDiagnostics[envId] = {
        ...(state.environmentDiagnostics[envId] || {}),
        loading: false
      };
      renderPage();
      throw error;
    }
  }

  async function runEnvironmentAuthSmoke(envId) {
    if (!envId) {
      throw new Error("未指定环境");
    }

    state.environmentDiagnostics[envId] = {
      ...(state.environmentDiagnostics[envId] || {}),
      smokeLoading: true
    };
    renderPage();

    try {
      const smoke = await api(`/api/environments/${envId}/auth-smoke`, {
        method: "POST",
        body: JSON.stringify({})
      });
      state.environmentDiagnostics[envId] = {
        ...(state.environmentDiagnostics[envId] || {}),
        smoke,
        smokeLoading: false
      };
      renderPage();
      showToast(smoke.status === "passed" ? "鉴权试跑通过" : "鉴权试跑已完成");
    } catch (error) {
      state.environmentDiagnostics[envId] = {
        ...(state.environmentDiagnostics[envId] || {}),
        smokeLoading: false
      };
      renderPage();
      throw error;
    }
  }

  return {
    batchCloneRecords,
    batchDeleteRecords,
    buildGlobalVariables,
    filterApiRows,
    filterCaseRows,
    isSelected,
    renderApisPage,
    renderCasesPage,
    renderCountedButtonText,
    renderEnvsPage,
    renderOverviewPage,
    renderSchedulerPage,
    renderSelectionCheckbox,
    syncEnvironmentDiagnosticsFocus,
    renderSuitesPage,
    runEnvironmentAuthSmoke,
    runEnvironmentDiagnostics,
    selectedCount,
    submitSchedulerForm,
    toggleAllSelection,
    toggleSchedulerSuite,
    toggleSelection
  };
}
