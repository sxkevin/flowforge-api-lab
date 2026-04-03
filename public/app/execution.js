const progressPalette = [65, 32, 78, 46];

export function createExecutionModule(ctx) {
  const {
    state,
    api,
    buildViewModel,
    formatNumber,
    formatClock,
    formatDateTime,
    formatDuration,
    relativeTime,
    statusText,
    statusClassName,
    dateKey,
    renderStatCard,
    escapeHtml,
    svgPlay,
    svgClock,
    svgCheck,
    svgCross,
    showToast,
    upsertRunState,
    renderApp,
    ensurePolling,
    scheduleRunRefresh,
    openModal
  } = ctx;

  function selectedRun(model) {
    return model.runs.find((run) => run.id === state.selectedRunId) || model.runs[0] || null;
  }

  function buildExecutionTasks(model) {
    const today = dateKey(new Date().toISOString());
    const todayRuns = model.runs.filter((run) => dateKey(run.finishedAt || run.startedAt) === today);
    const todayPassed = todayRuns.reduce((sum, run) => sum + run.summary.passed, 0);
    const todayFailed = todayRuns.reduce((sum, run) => sum + run.summary.failed, 0);
    const completedDurations = model.runs
      .filter((run) => ["passed", "failed", "canceled"].includes(run.status) && Number(run.duration) > 0)
      .slice(0, 12)
      .map((run) => Number(run.duration));
    const estimatedTaskDuration = completedDurations.length
      ? Math.round(completedDurations.reduce((sum, value) => sum + value, 0) / completedDurations.length)
      : 90 * 1000;

    const running = model.runs
      .filter((run) => run.status === "running")
      .slice(0, 6)
      .map((run, index) => {
        const total = Math.max(run.summary.total || 0, run.steps?.length || 0, 1);
        const completed = (run.summary.passed || 0) + (run.summary.failed || 0) + (run.summary.skipped || 0);
        const progress = Math.max(8, Math.min(92, completed > 0 ? Math.round((completed / total) * 100) : progressPalette[index % progressPalette.length]));
        return {
          name: run.suiteName,
          kind: "场景",
          status: "running",
          runId: run.id,
          isSelected: run.id === state.selectedRunId,
          progress,
          priority: run.queueMeta?.priority || run.executionOverrides?.executionConfig?.priority || "normal",
          trigger: run.trigger || "manual",
          attempt: Number(run.attempt || 1),
          maxAttempts: Number(run.maxAttempts || 1),
          metaLine: `开始时间: ${formatClock(run.startedAt || run.createdAt)}  已运行: ${formatDuration(Math.max(0, Date.now() - Date.parse(run.startedAt || run.createdAt)))}  步骤 ${Math.min(completed, total)}/${total}`,
          passText: run.summary.passed ? `通过 ${run.summary.passed}` : "",
          failText: run.summary.failed ? `失败 ${run.summary.failed}` : ""
        };
      });

    const queued = model.runs
      .filter((run) => run.status === "queued")
      .slice(0, 6)
      .map((run, index) => {
        const queuePosition = Number(run.queueMeta?.position || index + 1);
        const waitingAhead = Math.max(0, queuePosition - 1);
        const estimatedStartMs = waitingAhead * estimatedTaskDuration;
        return {
          name: run.suiteName,
          kind: "场景",
          status: "queued",
          runId: run.id,
          isSelected: run.id === state.selectedRunId,
          progress: 0,
          priority: run.queueMeta?.priority || run.executionOverrides?.executionConfig?.priority || "normal",
          trigger: run.trigger || "manual",
          attempt: Number(run.attempt || 1),
          maxAttempts: Number(run.maxAttempts || 1),
          metaLine: `排队时间 ${relativeTime(run.queuedAt || run.createdAt)} · 环境 ${run.environmentName || model.environments[0]?.displayName || "默认环境"} · 队列 ${queuePosition}/${(model.queue?.queued || 0) + (model.queue?.running || 0) || queuePosition} · 前方 ${waitingAhead} 个任务 · 预计 ${waitingAhead ? formatDuration(estimatedStartMs) : "立即开始"}`,
          passText: "",
          failText: ""
        };
      });

    const history = model.runs
      .filter((run) => run.status === "passed" || run.status === "failed" || run.status === "canceled")
      .slice(0, 6)
      .map((run) => ({
        name: run.suiteName,
        kind: "历史",
        status: "history",
        runId: run.id,
        isSelected: run.id === state.selectedRunId,
        progress: 100,
        priority: run.queueMeta?.priority || run.executionOverrides?.executionConfig?.priority || "normal",
        trigger: run.trigger || "manual",
        attempt: Number(run.attempt || 1),
        maxAttempts: Number(run.maxAttempts || 1),
        metaLine: `${relativeTime(run.finishedAt || run.startedAt)} · 耗时 ${formatDuration(run.duration)} · 环境 ${run.environmentName}`,
        passText: `通过 ${run.summary.passed}`,
        failText: run.summary.failed ? `失败 ${run.summary.failed}` : "",
        failedCount: Number(run.summary.failed || 0),
        sourceType: run.sourceType || "suite"
      }));

    return {
      running,
      queued,
      history,
      todayPassed,
      todayFailed
    };
  }

  function renderExecutionTaskCard(item) {
    const priorityLabel = { high: "高优先级", normal: "普通优先级", low: "低优先级" }[item.priority] || "普通优先级";
    const triggerLabel =
      item.trigger === "auto-retry"
        ? "自动重试"
        : item.trigger === "retry"
          ? "手动重试"
          : item.trigger === "retry-failed"
            ? "失败步骤重跑"
            : item.trigger === "pipeline"
              ? "流水线"
              : "手动";
    return `
      <article class="task-card ${item.status === "running" ? "running" : ""} ${item.isSelected ? "is-selected" : ""}">
        <div class="task-head">
          <div class="task-head-left">
            <div class="task-title">${escapeHtml(item.name)}</div>
            <span class="status-pill status-${statusClassName(item.status)}">${escapeHtml(statusText(item.status))}</span>
            <span class="small-pill status-queued">${escapeHtml(item.kind)}</span>
            <span class="small-pill ${item.priority === "high" ? "small-warning" : item.priority === "low" ? "small-success" : "status-queued"}">${escapeHtml(priorityLabel)}</span>
            <span class="small-pill status-queued">${escapeHtml(triggerLabel)}</span>
            ${item.maxAttempts > 1 ? `<span class="small-pill status-queued">${escapeHtml(`第 ${item.attempt}/${item.maxAttempts} 次`)}</span>` : ""}
          </div>
          ${
            item.status === "history"
              ? `
                <div class="task-actions">
                  <button class="plain-button" data-action="select-execution-run" data-run-id="${item.runId}">执行详情</button>
                  <button class="plain-button" data-action="view-run-report" data-run-id="${item.runId}">查看报告</button>
                  ${item.failedCount ? `<button class="plain-button" data-action="retry-failed-run" data-run-id="${item.runId}">重跑失败步骤</button>` : ""}
                  <button class="secondary-button" data-action="retry-run" data-run-id="${item.runId}">重试</button>
                </div>
              `
              : `
                <div class="task-actions">
                  <button class="plain-button" data-action="select-execution-run" data-run-id="${item.runId}">执行详情</button>
                  <button class="ghost-button" data-action="cancel-run" data-run-id="${item.runId}">${item.status === "queued" ? "取消排队" : "停止执行"}</button>
                </div>
              `
          }
        </div>
        <div class="task-meta-line">
          <span>${escapeHtml(item.metaLine)}</span>
          ${item.passText ? `<span class="text-success">${escapeHtml(item.passText)}</span>` : ""}
          ${item.failText ? `<span class="text-danger">${escapeHtml(item.failText)}</span>` : ""}
        </div>
        ${
          item.status === "history"
            ? ""
            : `
              <div class="task-footer">
                <div class="progress-inline">
                  <div class="progress-track"><div class="progress-value" style="width:${item.progress}%;"></div></div>
                  <strong>${item.progress}%</strong>
                </div>
              </div>
            `
        }
      </article>
    `;
  }

  function renderStepStatusOptions(selectedValue) {
    return `
      <label class="control">
        <select data-filter-page="execution" data-filter-key="status">
          <option value="all" ${selectedValue === "all" ? "selected" : ""}>全部状态</option>
          <option value="failed" ${selectedValue === "failed" ? "selected" : ""}>失败</option>
          <option value="passed" ${selectedValue === "passed" ? "selected" : ""}>通过</option>
          <option value="skipped" ${selectedValue === "skipped" ? "selected" : ""}>跳过</option>
          <option value="running" ${selectedValue === "running" ? "selected" : ""}>执行中</option>
        </select>
      </label>
    `;
  }

  function renderDatasetOptions(datasetResults, selectedValue) {
    const options = [
      `<option value="all" ${selectedValue === "all" ? "selected" : ""}>全部数据行</option>`,
      ...datasetResults.map(
        (item) =>
          `<option value="${escapeHtml(item.rowId)}" ${item.rowId === selectedValue ? "selected" : ""}>${escapeHtml(item.rowName || item.rowId)}</option>`
      )
    ];
    return `
      <label class="control">
        <select data-filter-page="execution" data-filter-key="datasetRowId">
          ${options.join("")}
        </select>
      </label>
    `;
  }

  function filterRunSteps(run, datasetFilterValue = state.filters.execution.datasetRowId) {
    const steps = run?.steps || [];
    const filters = state.filters.execution;
    return steps.filter((step) => {
      const matchesStatus = filters.status === "all" || step.status === filters.status;
      const datasetRowId = step.datasetRowId || "default";
      const matchesDataset = datasetFilterValue === "all" || datasetRowId === datasetFilterValue;
      const q = String(filters.q || "").trim();
      const haystack = `${step.caseName || ""} ${step.apiName || ""} ${step.message || ""}`.toLowerCase();
      const matchesQ = !q || haystack.includes(q.toLowerCase());
      return matchesStatus && matchesDataset && matchesQ;
    });
  }

  function renderDatasetResultCards(run) {
    const rows = run?.datasetResults || [];
    if (!rows.length) {
      return "";
    }

    return `
      <div class="execution-dataset-grid">
        ${rows
          .map((item) => {
            const failed = Number(item.summary?.failed || 0);
            const passed = Number(item.summary?.passed || 0);
            const skipped = Number(item.summary?.skipped || 0);
            const toneClass = failed ? "status-failed" : "status-success";
            return `
              <article class="execution-dataset-card">
                <div class="execution-dataset-head">
                  <strong>${escapeHtml(item.rowName || item.rowId)}</strong>
                  <span class="status-pill ${toneClass}">${failed ? "失败" : "通过"}</span>
                </div>
                <div class="task-meta-line">
                  <span>通过 ${escapeHtml(String(passed))}</span>
                  <span>失败 ${escapeHtml(String(failed))}</span>
                  ${skipped ? `<span>跳过 ${escapeHtml(String(skipped))}</span>` : ""}
                </div>
              </article>
            `;
          })
          .join("")}
      </div>
    `;
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

  function renderInlineFailureInsight(message = "", options = {}) {
    const { compact = false } = options;
    const explanation = explainFailureMessage(message);
    return `
      <div class="failure-insight ${compact ? "is-compact" : ""}">
        <strong>${escapeHtml(explanation.title)}</strong>
        <p>${escapeHtml(explanation.summary)}</p>
        ${compact ? "" : `<div class="failure-insight-tip">${escapeHtml(explanation.suggestion)}</div>`}
        <div class="failure-insight-raw">${escapeHtml(explanation.raw)}</div>
      </div>
    `;
  }

  function renderFailureRepairAction(message = "", { runId = "", stepId = "", caseId = "", envId = "", returnAnchor = "" } = {}) {
    const explanation = explainFailureMessage(message);
    const safeCaseId = String(caseId || "").trim();
    const safeEnvId = String(envId || "").trim();
    const safeRunId = String(runId || "").trim();
    const safeStepId = String(stepId || "").trim();
    const safeAnchor = String(returnAnchor || "").trim();
    const canEditCase = safeCaseId && safeCaseId !== "scenario" && safeCaseId !== "suite";

    if (explanation.title === "鉴权或权限失败" && safeEnvId) {
      return `
        <button
          class="plain-button"
          data-action="open-modal"
          data-modal-type="environment"
          data-env-id="${escapeHtml(safeEnvId)}"
          data-repair-key="auth"
          data-repair-message="失败原因更像鉴权配置或登录态问题，建议先修当前环境的鉴权配置。"
          data-focus-field="authValue"
          data-return-tab="execution"
          data-return-run-id="${escapeHtml(safeRunId)}"
          data-return-step-id="${escapeHtml(safeStepId)}"
          data-return-anchor="${escapeHtml(safeAnchor)}"
        >
          修鉴权
        </button>
      `;
    }

    if (explanation.title === "网络或环境不可达" && safeEnvId) {
      return `
        <button
          class="plain-button"
          data-action="open-modal"
          data-modal-type="environment"
          data-env-id="${escapeHtml(safeEnvId)}"
          data-repair-key="baseUrl"
          data-repair-message="失败原因更像地址或连通性问题，建议先检查 Base URL 和基础探测。"
          data-focus-field="baseUrl"
          data-return-tab="execution"
          data-return-run-id="${escapeHtml(safeRunId)}"
          data-return-step-id="${escapeHtml(safeStepId)}"
          data-return-anchor="${escapeHtml(safeAnchor)}"
        >
          修环境地址
        </button>
      `;
    }

    if (["返回字段不符合预期", "断言不匹配", "结果与预期不一致"].includes(explanation.title) && canEditCase) {
      return `
        <button
          class="plain-button"
          data-action="open-modal"
          data-modal-type="case"
          data-record-id="${escapeHtml(safeCaseId)}"
          data-return-tab="execution"
          data-return-run-id="${escapeHtml(safeRunId)}"
          data-return-step-id="${escapeHtml(safeStepId)}"
          data-return-anchor="${escapeHtml(safeAnchor)}"
        >
          改用例断言
        </button>
      `;
    }

    if (!safeStepId && safeRunId) {
      return `<button class="plain-button" data-action="view-run-report" data-run-id="${escapeHtml(safeRunId)}">看运行报告</button>`;
    }

    return "";
  }

  function formatAssertionType(type = "") {
    return (
      {
        status: "状态码",
        fieldEquals: "字段值",
        jsonPath: "字段值",
        fieldType: "字段类型",
        exists: "字段存在",
        responseTime: "响应时间",
        headerEquals: "响应头",
        bodyContains: "响应包含文本",
        jsonSchema: "JSON Schema",
        xpath: "XPath",
        customScript: "自定义脚本",
        scenarioCustom: "场景脚本",
        suiteCustom: "场景校验"
      }[type] || type || "断言"
    );
  }

  function formatAssertionDescription(assertion = {}) {
    if (assertion.message) {
      return assertion.message;
    }
    const expected =
      assertion.expected === undefined || assertion.expected === null || assertion.expected === ""
        ? "未配置"
        : JSON.stringify(assertion.expected);
    const actual =
      assertion.actual === undefined || assertion.actual === null || assertion.actual === ""
        ? "空"
        : JSON.stringify(assertion.actual);
    return `期望 ${expected}，实际 ${actual}`;
  }

  function stringifyAssertionValue(value) {
    if (value === undefined || value === null || value === "") {
      return "-";
    }
    if (typeof value === "string") {
      return value;
    }
    return JSON.stringify(value);
  }

  function formatAssertionOperator(operator = "") {
    return (
      {
        equals: "等于",
        notEquals: "不等于",
        contains: "包含",
        gt: "大于",
        gte: "大于等于",
        lt: "小于",
        lte: "小于等于",
        exists: "存在"
      }[operator] || operator || "-"
    );
  }

  function buildAssertionDetailItems(assertions = []) {
    return (assertions || []).map((assertion) => ({
      title: formatAssertionType(assertion.type),
      passed: assertion.passed !== false,
      meta: [
        { label: "校验对象", value: assertion.path || assertion.name || (assertion.type === "status" ? "响应状态码" : assertion.type === "responseTime" ? "响应耗时" : "响应结果") },
        { label: "比较方式", value: formatAssertionOperator(assertion.operator || (assertion.type === "exists" ? "exists" : "equals")) },
        { label: "期望值", value: stringifyAssertionValue(assertion.expected) },
        { label: "实际值", value: stringifyAssertionValue(assertion.actual) }
      ],
      message: formatAssertionDescription(assertion)
    }));
  }

  function stringifyPreviewValue(value, maxLength = 2000) {
    if (value === undefined || value === null || value === "") {
      return "";
    }
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, maxLength)}\n... [已截断 ${text.length - maxLength} 个字符]`;
  }

  function toHeaderItems(headers = {}) {
    return Object.entries(headers || {}).map(([key, value]) => ({
      label: key,
      value: value === undefined || value === null || value === "" ? "-" : String(value)
    }));
  }

  function buildStepLogSections(step) {
    const failureExplanation = step.status === "failed" ? explainFailureMessage(step.message) : null;
    const responseSummary = step.response || {};
    const requestSummary = step.request || {};
    const extractedVariables = step.extractedVariables || {};
    const sections = [];

    sections.push({
      label: "步骤概览",
      format: "grid",
      items: [
        { label: "执行结果", value: statusText(step.status) },
        { label: "问题类型", value: failureExplanation?.title || "无异常" },
        { label: "状态码", value: String(responseSummary.status ?? "-") },
        { label: "耗时", value: formatDuration(Number(step.duration || 0)) }
      ]
    });

    if (failureExplanation) {
      sections.push({
        label: "失败解读",
        format: "rule-list",
        items: [
          { title: failureExplanation.title, description: failureExplanation.summary },
          { title: "建议先看", description: failureExplanation.suggestion },
          { title: "原始报错", description: failureExplanation.raw }
        ]
      });
    }

    sections.push({
      label: "断言结果",
      format: "assertion-list",
      items: buildAssertionDetailItems(step.assertions || [])
    });

    sections.push({
      label: "请求摘要",
      format: "kv-list",
      items: [
        { label: "方法", value: requestSummary.method || "-" },
        { label: "地址", value: requestSummary.url || "-" },
        { label: "请求头数量", value: String(Object.keys(requestSummary.headers || {}).length) },
        { label: "请求体", value: requestSummary.body ? "已携带" : "无" }
      ]
    });

    const requestHeaderItems = toHeaderItems(requestSummary.headers);
    if (requestHeaderItems.length) {
      sections.push({
        label: "请求头",
        format: "kv-list",
        items: requestHeaderItems
      });
    }

    const requestBodyPreview = stringifyPreviewValue(requestSummary.body);
    if (requestBodyPreview) {
      sections.push({
        label: "请求体预览",
        content: requestBodyPreview
      });
    }

    sections.push({
      label: "响应摘要",
      format: "kv-list",
      items: [
        { label: "状态码", value: String(responseSummary.status ?? "-") },
        { label: "响应头数量", value: String(Object.keys(responseSummary.headers || {}).length) },
        { label: "响应体类型", value: typeof responseSummary.body === "string" ? "文本" : responseSummary.body ? "JSON" : responseSummary.bodyText ? "文本" : "空" },
        { label: "变量提取数", value: String(Object.keys(extractedVariables).length) }
      ]
    });

    const responseHeaderItems = toHeaderItems(responseSummary.headers);
    if (responseHeaderItems.length) {
      sections.push({
        label: "响应头",
        format: "kv-list",
        items: responseHeaderItems
      });
    }

    const responseBodyPreview = stringifyPreviewValue(responseSummary.body ?? responseSummary.bodyText);
    if (responseBodyPreview) {
      sections.push({
        label: "响应体预览",
        content: responseBodyPreview
      });
    }

    if (Object.keys(extractedVariables).length) {
      sections.push({
        label: "提取变量",
        format: "kv-list",
        items: Object.entries(extractedVariables).map(([key, value]) => ({
          label: key,
          value: value === undefined || value === null || value === "" ? "-" : typeof value === "string" ? value : JSON.stringify(value)
        }))
      });
    }

    sections.push({ label: "原始请求 JSON", content: JSON.stringify(requestSummary, null, 2) });
    sections.push({ label: "原始响应 JSON", content: JSON.stringify(responseSummary, null, 2) });

    return sections;
  }

  function summarizeFailureReasons(steps = []) {
    const reasonMap = new Map();
    steps
      .filter((step) => step.status === "failed")
      .forEach((step) => {
        const key = String(step.message || "断言失败").trim() || "断言失败";
        const explanation = explainFailureMessage(key);
        const current =
          reasonMap.get(key) || {
            message: key,
            count: 0,
            caseName: step.caseName || step.apiName || "未知步骤",
            caseId: step.caseId || "",
            stepId: step.id || "",
            title: explanation.title,
            summary: explanation.summary
          };
        current.count += 1;
        reasonMap.set(key, current);
      });
    return [...reasonMap.values()].sort((left, right) => right.count - left.count).slice(0, 3);
  }

  function renderRunOutcomeGuide(run, detailRun) {
    if (!run) {
      return "";
    }

    const steps = detailRun?.steps || [];
    const failedSteps = steps.filter((step) => step.status === "failed");
    const passedSteps = steps.filter((step) => step.status === "passed");
    const topReasons = summarizeFailureReasons(steps);
    const headline =
      run.status === "queued"
        ? "任务已经进入执行队列"
        : run.status === "running"
          ? "任务正在执行，结果会自动刷新"
          : run.status === "passed"
            ? "本次执行已通过"
            : run.status === "failed"
              ? "本次执行有失败步骤"
              : "任务状态已更新";
    const description =
      run.status === "queued"
        ? `当前环境为 ${run.environmentName || "默认环境"}，等待调度开始。`
        : run.status === "running"
          ? `目前已通过 ${passedSteps.length} 个步骤${failedSteps.length ? `，失败 ${failedSteps.length} 个步骤` : ""}。`
          : run.status === "passed"
            ? `共通过 ${run.summary.passed || passedSteps.length} 个步骤，耗时 ${formatDuration(run.duration || 0)}。`
            : run.status === "failed"
              ? `共失败 ${run.summary.failed || failedSteps.length} 个步骤，建议优先查看下面的失败摘要。`
              : `当前状态：${statusText(run.status)}。`;

    return `
      <section class="execution-guide-card status-${statusClassName(run.status)}">
        <div class="execution-guide-head">
          <div>
            <strong>${escapeHtml(headline)}</strong>
            <p>${escapeHtml(description)}</p>
          </div>
          <div class="execution-guide-actions">
            <button class="secondary-button" data-action="view-run-report" data-run-id="${run.id}">查看测试报告</button>
            <button class="ghost-button" data-action="view-run-variables" data-run-id="${run.id}">变量快照</button>
          </div>
        </div>
        ${
          topReasons.length
            ? `
              <div class="execution-guide-body">
                <div class="execution-guide-label">失败原因摘要</div>
                <div class="execution-guide-list">
                  ${topReasons
                    .map(
                      (item) => `
                        <article class="execution-guide-item" data-return-anchor="${escapeHtml(`execution-reason:${item.stepId || item.caseId || item.caseName}`)}">
                          <strong>${escapeHtml(item.caseName)}</strong>
                          <p>${escapeHtml(item.title)}</p>
                          <span>${escapeHtml(item.summary)}</span>
                          <div class="failure-insight-raw">${escapeHtml(item.message)}</div>
                          <span>出现 ${escapeHtml(String(item.count))} 次</span>
                          <div class="execution-guide-item-actions">
                            ${renderFailureRepairAction(item.message, {
                              runId: run.id,
                              stepId: item.stepId || "",
                              caseId: item.caseId || "",
                              envId: run.environmentId || "",
                              returnAnchor: `execution-reason:${item.stepId || item.caseId || item.caseName}`
                            })}
                            <button class="plain-button" data-action="open-report-case" data-run-id="${run.id}" data-case-id="${escapeHtml(item.caseId || "")}">查看该用例报告</button>
                            <button class="plain-button" data-action="view-step-log" data-run-id="${run.id}" data-step-id="${escapeHtml(item.stepId || "")}" ${!item.stepId ? "disabled" : ""}>查看步骤日志</button>
                          </div>
                        </article>
                      `
                    )
                    .join("")}
                </div>
              </div>
            `
            : `
              <div class="execution-guide-body">
                <div class="execution-guide-label">下一步建议</div>
                <div class="execution-guide-tips">
                  <span class="small-pill status-queued">看报告中的断言结果</span>
                  <span class="small-pill status-queued">对比最近一次运行</span>
                  <span class="small-pill status-queued">导出结果给团队</span>
                </div>
              </div>
            `
        }
      </section>
    `;
  }

  function renderExecutionDetail(model) {
    const run = selectedRun(model);
    if (!run) {
      return `<section class="panel"><div class="empty-card">当前没有可查看的执行详情。</div></section>`;
    }

    const detailRun = state.runDetails[run.id] || run;
    const liveRunDuration =
      run.status === "running" && (detailRun.startedAt || detailRun.createdAt)
        ? Math.max(0, Date.now() - Date.parse(detailRun.startedAt || detailRun.createdAt))
        : Number(detailRun.duration || 0);
    const failedSteps = (detailRun.steps || []).filter((step) => step.status === "failed").length;
    const datasetResults = detailRun.datasetResults || [];
    const effectiveDatasetFilter =
      state.filters.execution.datasetRowId === "all" ||
      datasetResults.some((item) => item.rowId === state.filters.execution.datasetRowId)
        ? state.filters.execution.datasetRowId
        : "all";
    const filteredSteps = filterRunSteps(detailRun, effectiveDatasetFilter);
    const datasetSummary = datasetResults.length ? `${datasetResults.length} 个数据行` : "未使用数据集";

    return `
      <section class="panel execution-detail-panel">
        <div class="panel-title-row">
          <div>
            <div class="panel-title">执行详情</div>
            <div class="panel-subtitle">${escapeHtml(`${run.suiteName} · ${statusText(run.status)} · ${formatDateTime(run.finishedAt || run.startedAt || run.createdAt)}`)}</div>
          </div>
          <div class="toolbar-right">
            <button class="secondary-button" data-action="view-run-report" data-run-id="${run.id}">查看报告</button>
            <button class="secondary-button" data-action="view-run-variables" data-run-id="${run.id}">变量快照</button>
          </div>
        </div>

        ${renderRunOutcomeGuide(run, detailRun)}

        <div class="summary-grid execution-summary-grid">
          ${renderStatCard("总步骤", formatNumber(run.summary.total || 0), datasetSummary, "primary", svgPlay())}
          ${renderStatCard("通过", formatNumber(run.summary.passed || 0), `环境: ${run.environmentName || "未指定"}`, "success", svgCheck())}
          ${renderStatCard("失败", formatNumber(run.summary.failed || 0), failedSteps ? "建议优先定位失败日志" : "无失败步骤", "danger", svgCross())}
          ${renderStatCard("耗时", formatDuration(liveRunDuration), `触发: ${run.trigger || "manual"}`, "warning", svgClock())}
        </div>

        ${renderDatasetResultCards(detailRun)}

        <section class="toolbar execution-step-toolbar">
          <div class="toolbar-left">
            <label class="search-box">
              <input value="${escapeHtml(state.filters.execution.q)}" placeholder="搜索步骤名称、接口或错误信息..." data-filter-page="execution" data-filter-key="q" />
            </label>
            ${renderStepStatusOptions(state.filters.execution.status)}
            ${renderDatasetOptions(datasetResults, effectiveDatasetFilter)}
          </div>
          <div class="toolbar-right">
            <span class="small-pill status-queued">${escapeHtml(`已筛选 ${filteredSteps.length}/${detailRun.steps?.length || 0} 个步骤`)}</span>
          </div>
        </section>

        ${
          filteredSteps.length
            ? `
              <div class="execution-step-table">
                <div class="execution-step-head">
                  <div>步骤</div>
                  <div>状态</div>
                  <div>数据行</div>
                  <div>耗时</div>
                  <div>时间</div>
                  <div>摘要</div>
                  <div>操作</div>
                </div>
                ${filteredSteps
                  .map(
                    (step) => `
                      <div class="execution-step-row ${step.status === "failed" ? "is-failed" : ""}" data-step-row-id="${escapeHtml(step.id)}" data-return-anchor="${escapeHtml(`execution-step:${step.id}`)}">
                        <div>
                          <strong>${escapeHtml(step.caseName || step.apiName || step.caseId || "未知步骤")}</strong>
                          <div class="subdued-text">${escapeHtml(step.apiName || "")}</div>
                        </div>
                        <div><span class="status-pill status-${statusClassName(step.status)}">${escapeHtml(statusText(step.status))}</span></div>
                        <div>${step.datasetRowName ? `<span class="small-pill status-queued">${escapeHtml(step.datasetRowName)}</span>` : '<span class="subdued-text">默认</span>'}</div>
                        <div>${escapeHtml(
                          formatDuration(
                            step.status === "running" && (step.startedAt || detailRun.startedAt)
                              ? Math.max(0, Date.now() - Date.parse(step.startedAt || detailRun.startedAt))
                              : Number(step.duration || 0)
                          )
                        )}</div>
                        <div>${escapeHtml(formatDateTime(step.finishedAt || step.startedAt))}</div>
                        <div>
                          ${
                            step.status === "failed"
                              ? renderInlineFailureInsight(step.message || "断言失败", { compact: true })
                              : `<span class="subdued-text">${escapeHtml(step.message || "-")}</span>`
                          }
                        </div>
                        <div class="action-row-compact">
                          ${renderFailureRepairAction(step.message || "", {
                            runId: run.id,
                            stepId: step.id,
                            caseId: step.caseId || "",
                            envId: run.environmentId || "",
                            returnAnchor: `execution-step:${step.id}`
                          })}
                          <button class="plain-button" data-action="view-step-log" data-run-id="${run.id}" data-step-id="${step.id}">日志</button>
                        </div>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            `
            : `<div class="empty-card">当前筛选条件下没有匹配的步骤。</div>`
        }
      </section>
    `;
  }

  function renderExecutionPage() {
    const model = buildViewModel();
    const taskData = buildExecutionTasks(model);
    const activeList =
      state.executionView === "running"
        ? taskData.running
        : state.executionView === "queued"
          ? taskData.queued
          : taskData.history;

    return `
      <div class="page-stack">
        <section class="summary-grid">
          ${renderStatCard("执行中", formatNumber(taskData.running.length), "活跃执行任务", "primary", svgPlay())}
          ${renderStatCard("排队中", formatNumber(taskData.queued.length), "等待调度", "warning", svgClock())}
          ${renderStatCard("今日成功", formatNumber(taskData.todayPassed), "通过步骤累计", "success", svgCheck())}
          ${renderStatCard("今日失败", formatNumber(taskData.todayFailed), "失败步骤累计", "danger", svgCross())}
        </section>

        <section class="page-stack">
          <div class="execution-tabs">
            <button class="${state.executionView === "running" ? "active" : ""}" data-action="switch-execution-view" data-value="running">执行中 (${taskData.running.length})</button>
            <button class="${state.executionView === "queued" ? "active" : ""}" data-action="switch-execution-view" data-value="queued">排队中 (${taskData.queued.length})</button>
            <button class="${state.executionView === "history" ? "active" : ""}" data-action="switch-execution-view" data-value="history">历史记录</button>
          </div>

          <section class="panel">
            <div class="panel-title-row">
              <div class="panel-title">${state.executionView === "history" ? "历史执行记录" : state.executionView === "queued" ? "等待中的任务" : "正在执行的任务"}</div>
            </div>
            ${
              activeList.length
                ? activeList.map((item) => renderExecutionTaskCard(item)).join("")
                : `<div class="empty-card">当前没有${state.executionView === "history" ? "历史记录" : "待展示任务"}。</div>`
            }
          </section>

          ${renderExecutionDetail(model)}
        </section>
      </div>
    `;
  }

  async function batchRunCases() {
    const caseIds = [...state.selections.cases];
    if (!caseIds.length) {
      showToast("请先勾选要执行的用例");
      return;
    }

    const suite = state.data.suites.find((item) => item.id === state.selectedSuiteId) || state.data.suites[0] || null;
    const projectId = suite?.projectId || state.data.projects[0]?.id || null;
    const environmentId = suite?.defaultEnvironmentId || state.data.environments[0]?.id || null;

    if (!projectId || !environmentId) {
      showToast("请先创建项目和环境");
      return;
    }

    try {
      const run = await api("/api/runs/batch-cases", {
        method: "POST",
        body: JSON.stringify({
          caseIds,
          projectId,
          environmentId,
          trigger: "manual"
        })
      });
      state.selections.cases = [];
      activateRun(run, run.status === "queued" ? `已提交 ${caseIds.length} 条用例到执行队列` : "批量执行任务已创建");
    } catch (error) {
      showToast(error.message);
    }
  }

  function activateRun(run, successMessage = "") {
    state.selectedRunId = run.id;
    state.activeTab = "execution";
    state.executionView = run.status === "queued" ? "queued" : "running";
    upsertRunState(run);
    renderApp();
    ensurePolling();
    scheduleRunRefresh();
    if (successMessage) {
      showToast(successMessage);
    }
  }

  async function runSuite(suiteId) {
    const suite = state.data.suites.find((item) => item.id === suiteId);
    const envId = suite?.defaultEnvironmentId || state.data.environments[0]?.id;
    if (!suite || !envId) {
      showToast("请先创建场景和环境");
      return;
    }

    try {
      const run = await api("/api/runs", {
        method: "POST",
        body: JSON.stringify({ suiteId: suite.id, environmentId: envId, trigger: "manual" })
      });
      activateRun(run, run.status === "queued" ? "任务已加入执行队列" : "任务已创建");
    } catch (error) {
      showToast(error.message);
    }
  }

  async function cancelRun(runId) {
    if (!runId) {
      return;
    }

    try {
      const run = await api(`/api/runs/${runId}/cancel`, { method: "POST" });
      state.selectedRunId = run.id;
      upsertRunState(run);
      renderApp();
      ensurePolling();
      scheduleRunRefresh();
      showToast(run.status === "canceled" ? "任务已取消" : "取消请求已提交");
    } catch (error) {
      showToast(error.message);
    }
  }

  async function retryRun(runId) {
    if (!runId) {
      return;
    }

    try {
      const run = await api(`/api/runs/${runId}/retry`, { method: "POST" });
      state.selectedRunId = run.id;
      state.activeTab = "execution";
      state.executionView = "queued";
      upsertRunState(run);
      renderApp();
      ensurePolling();
      scheduleRunRefresh();
      showToast("已重新加入执行队列");
    } catch (error) {
      showToast(error.message);
    }
  }

  async function retryFailedRun(runId) {
    if (!runId) {
      return;
    }

    try {
      const run = await api(`/api/runs/${runId}/retry-failed`, { method: "POST" });
      state.selectedRunId = run.id;
      state.activeTab = "execution";
      state.executionView = "queued";
      upsertRunState(run);
      renderApp();
      ensurePolling();
      scheduleRunRefresh();
      showToast("失败步骤已重新加入执行队列");
    } catch (error) {
      showToast(error.message);
    }
  }

  async function ensureRunDetail(runId) {
    if (!runId) {
      return null;
    }

    const cached = state.runDetails[runId];
    if (cached?.steps?.some((step) => step.request || step.response)) {
      return cached;
    }

    const run = await api(`/api/runs/${runId}`);
    state.runDetails[runId] = run;
    return run;
  }

  async function refreshSelectedRunDetail(runId = state.selectedRunId) {
    if (!runId) {
      return null;
    }
    const detail = await ensureRunDetail(runId);
    renderApp();
    return detail;
  }

  async function selectExecutionRun(runId) {
    if (!runId) {
      return;
    }

    const run = state.data?.runs?.find((item) => item.id === runId) || null;
    state.selectedRunId = runId;
    state.activeTab = "execution";
    state.executionView = run?.status === "queued" ? "queued" : run?.status === "running" ? "running" : "history";
    renderApp();
    requestAnimationFrame(() => {
      document.querySelector(".execution-detail-panel")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });
    try {
      await refreshSelectedRunDetail(runId);
    } catch (error) {
      showToast(error.message);
    }
  }

  async function openStepLog(runId, stepId) {
    const summaryRun = state.data.runs.find((item) => item.id === runId);
    let run = state.runDetails[runId] || summaryRun;
    let step = run?.steps?.find((item) => item.id === stepId);

    if (!step || (!step.request && !step.response)) {
      run = await ensureRunDetail(runId);
      step = run?.steps?.find((item) => item.id === stepId);
    }

    if (!run || !step) {
      showToast("没有可查看的步骤日志");
      return;
    }

    openModal("detail", {
      title: step.caseName,
      subtitle: `${run.suiteName} · ${statusText(step.status)}`,
      sections: buildStepLogSections(step)
    });
  }

  async function openRunVariables(runId) {
    const run = (await ensureRunDetail(runId)) || state.data.runs.find((item) => item.id === runId);
    if (!run) {
      showToast("没有可查看的运行快照");
      return;
    }
    openModal("detail", {
      title: `${run.suiteName} · 变量快照`,
      subtitle: run.environmentName || "",
      sections: [
        { label: "运行变量", content: JSON.stringify(run.variablesSnapshot || {}, null, 2) },
        { label: "数据行结果", content: JSON.stringify(run.datasetResults || [], null, 2) }
      ]
    });
  }

  return {
    activateRun,
    batchRunCases,
    buildExecutionTasks,
    cancelRun,
    ensureRunDetail,
    openRunVariables,
    openStepLog,
    refreshSelectedRunDetail,
    renderExecutionPage,
    retryRun,
    retryFailedRun,
    selectExecutionRun,
    runSuite
  };
}
