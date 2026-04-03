export function createReportsModule(ctx) {
  const {
    state,
    api,
    buildViewModel,
    buildTrendSeries,
    buildModuleStats,
    buildFailedRows,
    renderSelectControl,
    rowsOrAllOption,
    renderStatCard,
    renderLineChart,
    renderDonutChart,
    renderBarChart,
    formatNumber,
    formatDuration,
    calcRate,
    formatDateTime,
    escapeHtml,
    svgDoc,
    svgCheck,
    svgCross,
    svgClock,
    svgTrend,
    svgAlert,
    renderApp,
    renderPage,
    showToast
  } = ctx;

  function buildReportInsightsPath() {
    const params = new URLSearchParams({
      range: state.filters.reports.range,
      moduleId: state.filters.reports.moduleId
    });
    return `/api/reports/insights?${params.toString()}`;
  }

  function buildReportSummaryPath() {
    const params = new URLSearchParams({
      range: state.filters.reports.range,
      moduleId: state.filters.reports.moduleId
    });
    if (state.selectedRunId) {
      params.set("runId", state.selectedRunId);
    }
    return `/api/reports/summary?${params.toString()}`;
  }

  async function refreshReportSummary() {
    state.reportSummary = await api(buildReportSummaryPath());
  }

  async function refreshReportInsights() {
    state.reportInsights = await api(buildReportInsightsPath());
  }

  function hasDetailedRunData(run) {
    return Boolean(run?.steps?.some((step) => step?.request || step?.response || step?.assertions));
  }

  async function ensureRunDetail(runId) {
    if (!runId) {
      return null;
    }
    const cached = state.runDetails?.[runId];
    if (hasDetailedRunData(cached)) {
      return cached;
    }
    const detail = await api(`/api/runs/${runId}`);
    state.runDetails[runId] = detail;
    return detail;
  }

  async function ensureCompareRunDetails() {
    if (!state.data?.runs?.length) {
      return;
    }

    const model = buildViewModel();
    const selectedRun = resolvePrimaryRun(model, state.reportSummary);
    const compareRun = resolveCompareRun(model, selectedRun);
    const ids = [selectedRun?.id, compareRun?.id].filter(Boolean);

    await Promise.all(
      ids.map(async (id) => {
        try {
          await ensureRunDetail(id);
        } catch {
          // Keep report rendering available even if detailed diff data is temporarily unavailable.
        }
      })
    );
  }

  async function refreshReportData() {
    await Promise.all([refreshReportSummary(), refreshReportInsights()]);
    await ensureCompareRunDetails();
    if (state.activeTab === "reports") {
      renderPage();
    }
  }

  function resolvePrimaryRun(model, summary) {
    const primaryRunId = state.filters.reports.primaryRunId || state.selectedRunId || summary?.selectedRunId || "";
    if (primaryRunId && primaryRunId !== "latest") {
      return model.runs.find((run) => run.id === primaryRunId) || model.runs[0] || null;
    }
    return model.runs.find((run) => run.id === state.selectedRunId || run.id === summary?.selectedRunId) || model.runs[0] || null;
  }

  function resolveCompareRun(model, selectedRun) {
    const compareRunId = state.filters.reports.compareRunId || "";
    if (compareRunId && compareRunId !== "none") {
      return model.runs.find((run) => run.id === compareRunId) || null;
    }
    return model.runs.find((run) => run.id !== selectedRun?.id) || null;
  }

  function buildRunCompare(selectedRun, compareRun) {
    if (!selectedRun || !compareRun) {
      return null;
    }

    const selectedDetail = state.runDetails?.[selectedRun.id] || selectedRun;
    const compareDetail = state.runDetails?.[compareRun.id] || compareRun;
    const selectedSteps = new Map((selectedDetail.steps || []).map((step) => [step.caseId, step]));
    const compareSteps = new Map((compareDetail.steps || []).map((step) => [step.caseId, step]));
    const changedSteps = [];

    function stringifyComparableValue(value) {
      if (value === undefined || value === null) {
        return "";
      }
      return typeof value === "string" ? value : JSON.stringify(value);
    }

    function collectHeaderDiff(currentHeaders = {}, baselineHeaders = {}) {
      const currentKeys = new Set(Object.keys(currentHeaders || {}).map((key) => key.toLowerCase()));
      const baselineKeys = new Set(Object.keys(baselineHeaders || {}).map((key) => key.toLowerCase()));
      const added = [...currentKeys].filter((key) => !baselineKeys.has(key));
      const removed = [...baselineKeys].filter((key) => !currentKeys.has(key));
      const changed = [...currentKeys].filter(
        (key) =>
          baselineKeys.has(key) &&
          stringifyComparableValue((currentHeaders || {})[Object.keys(currentHeaders || {}).find((item) => item.toLowerCase() === key)]) !==
            stringifyComparableValue((baselineHeaders || {})[Object.keys(baselineHeaders || {}).find((item) => item.toLowerCase() === key)])
      );
      return { added, removed, changed };
    }

    function buildStepDiffNotes(currentStep, baselineStep) {
      const notes = [];
      if (!currentStep || !baselineStep) {
        return notes;
      }

      if (currentStep.status !== baselineStep.status) {
        notes.push(`步骤状态从 ${baselineStep.status} 变成 ${currentStep.status}`);
      }

      if (currentStep.request || baselineStep.request) {
        const currentRequest = currentStep.request || {};
        const baselineRequest = baselineStep.request || {};
        if ((currentRequest.method || "GET") !== (baselineRequest.method || "GET")) {
          notes.push(`请求方法从 ${baselineRequest.method || "GET"} 变成 ${currentRequest.method || "GET"}`);
        }
        if ((currentRequest.url || "") !== (baselineRequest.url || "")) {
          notes.push("请求地址或 Query 参数发生变化");
        }
        const headerDiff = collectHeaderDiff(currentRequest.headers, baselineRequest.headers);
        if (headerDiff.added.length || headerDiff.removed.length || headerDiff.changed.length) {
          notes.push(`请求头有变化：新增 ${headerDiff.added.length}，移除 ${headerDiff.removed.length}，改动 ${headerDiff.changed.length}`);
        }
        if (stringifyComparableValue(currentRequest.body) !== stringifyComparableValue(baselineRequest.body)) {
          notes.push("请求体内容发生变化");
        }
      }

      if (currentStep.response || baselineStep.response) {
        const currentResponse = currentStep.response || {};
        const baselineResponse = baselineStep.response || {};
        if (Number(currentResponse.status ?? -1) !== Number(baselineResponse.status ?? -1)) {
          notes.push(`响应状态码从 ${baselineResponse.status ?? "空"} 变成 ${currentResponse.status ?? "空"}`);
        }
        if (typeof currentResponse.body !== typeof baselineResponse.body) {
          notes.push("响应体类型发生变化");
        } else if (stringifyComparableValue(currentResponse.body ?? currentResponse.bodyText) !== stringifyComparableValue(baselineResponse.body ?? baselineResponse.bodyText)) {
          notes.push("响应体内容发生变化");
        }
      }

      const currentFailedAssertions = (currentStep.assertions || []).filter((assertion) => assertion && assertion.passed === false);
      const baselineFailedAssertions = (baselineStep.assertions || []).filter((assertion) => assertion && assertion.passed === false);
      if (currentFailedAssertions.length !== baselineFailedAssertions.length) {
        notes.push(`失败断言数量从 ${baselineFailedAssertions.length} 变成 ${currentFailedAssertions.length}`);
      }
      const currentAssertionMessage = currentFailedAssertions[0]?.message || "";
      const baselineAssertionMessage = baselineFailedAssertions[0]?.message || "";
      if (currentAssertionMessage && currentAssertionMessage !== baselineAssertionMessage) {
        notes.push(`本次主要失败断言变成“${currentAssertionMessage}”`);
      }

      if (!notes.length && Number(currentStep.duration || 0) !== Number(baselineStep.duration || 0)) {
        notes.push("请求结果一致，但耗时有明显变化");
      }

      return notes.slice(0, 4);
    }

    for (const [caseId, step] of selectedSteps.entries()) {
      const baseline = compareSteps.get(caseId);
      if (!baseline) {
        changedSteps.push({
          caseId,
          caseName: step.caseName,
          currentStatus: step.status,
          compareStatus: "missing",
          currentDuration: step.duration || 0,
          compareDuration: 0,
          message: step.message || "仅当前运行存在",
          diffNotes: ["当前运行存在该步骤，但对比运行里没有对应步骤。"],
          detailReady: hasDetailedRunData(selectedDetail) || hasDetailedRunData(compareDetail)
        });
        continue;
      }
      if (baseline.status !== step.status || Number(baseline.duration || 0) !== Number(step.duration || 0)) {
        changedSteps.push({
          caseId,
          caseName: step.caseName,
          currentStatus: step.status,
          compareStatus: baseline.status,
          currentDuration: step.duration || 0,
          compareDuration: baseline.duration || 0,
          message: step.message || baseline.message || "-",
          diffNotes: buildStepDiffNotes(step, baseline),
          detailReady: hasDetailedRunData(selectedDetail) && hasDetailedRunData(compareDetail)
        });
      }
    }

    return {
      selectedRun,
      compareRun,
      deltaPassed: Number(selectedRun.summary.passed || 0) - Number(compareRun.summary.passed || 0),
      deltaFailed: Number(selectedRun.summary.failed || 0) - Number(compareRun.summary.failed || 0),
      deltaDuration: Number(selectedRun.duration || 0) - Number(compareRun.duration || 0),
      changedSteps: changedSteps.slice(0, 12)
    };
  }

  function renderCompareDelta(label, value) {
    const positive = value > 0;
    const negative = value < 0;
    return `<span class="${positive ? "text-danger" : negative ? "text-success" : "subdued-text"}">${label} ${value > 0 ? "+" : ""}${escapeHtml(String(value))}</span>`;
  }

  function renderCompareStepDiff(item) {
    const notes = item?.diffNotes || [];
    if (!notes.length && item?.detailReady) {
      return "";
    }
    return `
      <div class="compare-diff-box">
        ${
          notes.length
            ? `
              <div class="compare-diff-list">
                ${notes.map((note) => `<span class="compare-diff-chip">${escapeHtml(note)}</span>`).join("")}
              </div>
            `
            : `<div class="subdued-text">正在等待步骤明细加载，加载后会显示请求、响应和断言的差异。</div>`
        }
      </div>
    `;
  }

  function renderRunStatus(status) {
    return `status-${status === "failed" ? "failed" : status === "passed" ? "success" : "queued"}`;
  }

  function buildCaseHistory(model, caseId) {
    if (!caseId) {
      return null;
    }

    const steps = model.runs
      .flatMap((run) =>
        (run.steps || [])
          .filter((step) => step.caseId === caseId)
          .map((step) => ({
            runId: run.id,
            suiteName: run.suiteName,
            environmentName: run.environmentName,
            trigger: run.trigger,
            finishedAt: step.finishedAt || run.finishedAt || run.startedAt || run.createdAt,
            stepId: step.id,
            caseId: step.caseId,
            caseName: step.caseName,
            status: step.status,
            duration: Number(step.duration || 0),
            message: step.message || ""
          }))
      )
      .sort((left, right) => String(right.finishedAt || "").localeCompare(String(left.finishedAt || "")));

    if (!steps.length) {
      return null;
    }

    const passed = steps.filter((item) => item.status === "passed").length;
    const failed = steps.filter((item) => item.status === "failed").length;
    const averageDuration = steps.length ? Math.round(steps.reduce((sum, item) => sum + item.duration, 0) / steps.length) : 0;
    const successRate = steps.length ? passed / steps.length : 0;
    const environmentMap = new Map();
    const environmentStatsMap = new Map();
    const failureReasonMap = new Map();

    for (const step of steps) {
      const envKey = step.environmentName || "未命名环境";
      environmentMap.set(envKey, (environmentMap.get(envKey) || 0) + 1);
      const envStat = environmentStatsMap.get(envKey) || {
        name: envKey,
        total: 0,
        passed: 0,
        failed: 0,
        durationTotal: 0
      };
      envStat.total += 1;
      envStat.durationTotal += step.duration;
      if (step.status === "passed") {
        envStat.passed += 1;
      }
      if (step.status === "failed") {
        envStat.failed += 1;
      }
      environmentStatsMap.set(envKey, envStat);
      if (step.status === "failed") {
        const reasonKey = step.message || "断言失败";
        const current = failureReasonMap.get(reasonKey) || { reason: reasonKey, count: 0, lastSeenAt: step.finishedAt };
        current.count += 1;
        if (String(step.finishedAt || "").localeCompare(String(current.lastSeenAt || "")) > 0) {
          current.lastSeenAt = step.finishedAt;
        }
        failureReasonMap.set(reasonKey, current);
      }
    }

    return {
      caseId,
      caseName: steps[0].caseName,
      totalRuns: steps.length,
      passed,
      failed,
      averageDuration,
      successRate,
      environmentDistribution: [...environmentMap.entries()]
        .map(([name, count]) => ({ name, count, ratio: steps.length ? count / steps.length : 0 }))
        .sort((left, right) => right.count - left.count),
      environmentCompare: [...environmentStatsMap.values()]
        .map((item) => ({
          name: item.name,
          total: item.total,
          passed: item.passed,
          failed: item.failed,
          successRate: item.total ? item.passed / item.total : 0,
          averageDuration: item.total ? Math.round(item.durationTotal / item.total) : 0
        }))
        .sort((left, right) => right.total - left.total),
      failureReasons: [...failureReasonMap.values()].sort((left, right) => right.count - left.count).slice(0, 5),
      recentSteps: steps.slice(0, 12)
    };
  }

  function buildRegressionRisks(model) {
    const caseMap = new Map(model.cases.map((item) => [item.id, item]));
    const apiMap = new Map(model.apis.map((item) => [item.id, item]));
    const moduleMap = new Map(model.modules.map((item) => [item.id, item]));
    const stepsByCase = new Map();

    model.runs.forEach((run) => {
      (run.steps || []).forEach((step) => {
        if (!step.caseId) {
          return;
        }
        const history = stepsByCase.get(step.caseId) || [];
        history.push({
          runId: run.id,
          suiteName: run.suiteName,
          environmentName: run.environmentName,
          finishedAt: step.finishedAt || run.finishedAt || run.startedAt || run.createdAt,
          stepId: step.id,
          caseId: step.caseId,
          caseName: step.caseName,
          status: step.status,
          duration: Number(step.duration || 0),
          message: step.message || ""
        });
        stepsByCase.set(step.caseId, history);
      });
    });

    const regressions = [];
    const durationSpikes = [];
    const now = Date.now();
    const recentWindow = 24 * 60 * 60 * 1000;

    for (const [caseId, history] of stepsByCase.entries()) {
      const steps = history.sort((left, right) => String(right.finishedAt || "").localeCompare(String(left.finishedAt || "")));
      if (steps.length < 2) {
        continue;
      }

      const caseEntity = caseMap.get(caseId);
      const apiEntity = apiMap.get(caseEntity?.apiId);
      const moduleEntity = moduleMap.get(apiEntity?.moduleId);
      const latest = steps[0];
      const previous = steps[1];

      if (latest.status === "failed" && previous.status === "passed") {
        const failedAtValue = Date.parse(latest.finishedAt || "");
        regressions.push({
          caseId,
          caseName: latest.caseName,
          moduleName: moduleEntity?.name || "未分组",
          runId: latest.runId,
          stepId: latest.stepId,
          suiteName: latest.suiteName,
          environmentName: latest.environmentName || "未命名环境",
          failedAt: latest.finishedAt,
          previousPassedAt: previous.finishedAt,
          message: latest.message || "最近一次执行失败",
          isRecent: Number.isFinite(failedAtValue) ? now - failedAtValue <= recentWindow : false
        });
      }

      const baseline = steps
        .slice(1, 6)
        .map((item) => Number(item.duration || 0))
        .filter((value) => value > 0);
      if (!baseline.length || latest.duration <= 0) {
        continue;
      }

      const baselineAverage = Math.round(baseline.reduce((sum, value) => sum + value, 0) / baseline.length);
      const ratio = baselineAverage ? latest.duration / baselineAverage : 0;
      const delta = latest.duration - baselineAverage;
      if (ratio >= 1.8 && delta >= 800) {
        const finishedAtValue = Date.parse(latest.finishedAt || "");
        durationSpikes.push({
          caseId,
          caseName: latest.caseName,
          moduleName: moduleEntity?.name || "未分组",
          runId: latest.runId,
          stepId: latest.stepId,
          suiteName: latest.suiteName,
          environmentName: latest.environmentName || "未命名环境",
          finishedAt: latest.finishedAt,
          latestDuration: latest.duration,
          baselineAverage,
          ratio,
          delta,
          isRecent: Number.isFinite(finishedAtValue) ? now - finishedAtValue <= recentWindow : false
        });
      }
    }

    regressions.sort((left, right) => String(right.failedAt || "").localeCompare(String(left.failedAt || "")));
    durationSpikes.sort((left, right) => right.ratio - left.ratio || String(right.finishedAt || "").localeCompare(String(left.finishedAt || "")));
    const recentRegressionCount = regressions.filter((item) => item.isRecent).length;
    const recentDurationSpikeCount = durationSpikes.filter((item) => item.isRecent).length;

    return {
      regressions,
      durationSpikes,
      summary: {
        regressionCount: regressions.length,
        durationSpikeCount: durationSpikes.length,
        recentRegressionCount,
        recentDurationSpikeCount,
        recentRiskCount: recentRegressionCount + recentDurationSpikeCount
      }
    };
  }

  function renderCaseHistoryStatusTrack(steps) {
    return `
      <div class="history-status-track">
        ${steps
          .slice(0, 10)
          .reverse()
          .map(
            (item) => `
              <button
                class="history-status-dot ${item.status === "failed" ? "is-failed" : item.status === "passed" ? "is-passed" : "is-other"}"
                data-action="view-step-log"
                data-run-id="${item.runId}"
                data-step-id="${item.stepId}"
                title="${escapeHtml(`${formatDateTime(item.finishedAt)} · ${item.status} · ${formatDuration(item.duration)}`)}"
              >
                <span>${escapeHtml(item.status === "failed" ? "失" : item.status === "passed" ? "过" : "其")}</span>
              </button>
            `
          )
          .join("")}
      </div>
    `;
  }

  function renderCaseHistoryDurationChart(steps) {
    const recent = steps.slice(0, 10).reverse();
    if (!recent.length) {
      return "";
    }

    const width = 360;
    const height = 120;
    const padding = { top: 16, right: 12, bottom: 26, left: 18 };
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;
    const maxValue = Math.max(1, ...recent.map((item) => Number(item.duration || 0)));
    const points = recent.map((item, index) => {
      const x = padding.left + (innerWidth / Math.max(1, recent.length - 1)) * index;
      const y = padding.top + innerHeight - (Number(item.duration || 0) / maxValue) * innerHeight;
      return { x, y, item };
    });
    const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

    return `
      <div class="history-chart-shell">
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="case duration trend">
          <line x1="${padding.left}" y1="${padding.top + innerHeight}" x2="${width - padding.right}" y2="${padding.top + innerHeight}" stroke="#d7dce5" />
          <path d="${path}" fill="none" stroke="#2f6df6" stroke-width="3" stroke-linecap="round" />
          ${points
            .map(
              (point) => `
                <circle cx="${point.x}" cy="${point.y}" r="4.5" fill="#fff" stroke="${point.item.status === "failed" ? "#e25546" : "#2f6df6"}" stroke-width="3" />
              `
            )
            .join("")}
          ${recent
            .map((item, index) => {
              const x = padding.left + (innerWidth / Math.max(1, recent.length - 1)) * index;
              return `<text x="${x}" y="${height - 8}" text-anchor="middle" fill="#70798c" font-size="11">${escapeHtml(String(index + 1))}</text>`;
            })
            .join("")}
        </svg>
      </div>
    `;
  }

  function renderRiskSummaryCard(title, value, meta, tone, icon, riskView, activeView) {
    return `
      <article class="stat-card report-risk-filter-card ${riskView === activeView ? "is-active" : ""}" data-action="set-report-risk-view" data-risk-view="${riskView}">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p class="stat-value">${escapeHtml(String(value))}</p>
          <div class="stat-meta ${meta.startsWith("-") ? "" : "trend-up"}">${escapeHtml(meta)}</div>
        </div>
        <div class="icon-box icon-${tone}">${icon}</div>
      </article>
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
        suggestion: "先看本次耗时和上下游依赖，再确认是否需要放宽超时或排查性能问题。",
        raw
      };
    }

    if (includesAny("401", "403", "unauthorized", "forbidden", "token", "authorization", "auth", "鉴权", "无权限")) {
      return {
        title: "鉴权或权限失败",
        summary: "请求已经到达服务，但身份校验没有通过，常见于 Token 失效、权限不足或环境配置错误。",
        suggestion: "先检查环境里的鉴权配置、登录态变量和请求头里的授权信息。",
        raw
      };
    }

    if (includesAny("500", "502", "503", "504", "internal server error", "bad gateway", "service unavailable", "服务异常")) {
      return {
        title: "服务端异常",
        summary: "服务端返回了异常状态，说明问题更可能在接口实现、依赖服务或网关层。",
        suggestion: "优先看步骤日志里的响应体和后端日志，确认是业务报错还是基础设施问题。",
        raw
      };
    }

    if (includesAny("econnrefused", "enotfound", "network", "fetch failed", "socket hang up", "连接失败", "dns")) {
      return {
        title: "网络或环境不可达",
        summary: "当前环境没有成功连到目标服务，可能是地址错误、服务未启动或网络链路有问题。",
        suggestion: "检查 Base URL、服务健康状态和当前测试环境是否可访问。",
        raw
      };
    }

    if (includesAny("jsonpath", "xpath", "not found", "missing", "不存在", "字段缺失", "字段不存在", "exists")) {
      return {
        title: "返回字段不符合预期",
        summary: "接口虽然返回了结果，但返回体里缺少预期字段，或者字段路径和实际结构不一致。",
        suggestion: "对照响应体确认字段路径是否变更，再决定是更新断言还是排查接口返回结构。",
        raw
      };
    }

    if (includesAny("schema", "type", "expected", "actual", "类型", "equals", "contains", "header")) {
      return {
        title: "断言不匹配",
        summary: "接口返回了结果，但值、类型、响应头或结构和用例预期不一致。",
        suggestion: "对比本次响应和断言规则，确认是接口行为变更还是断言配置过旧。",
        raw
      };
    }

    return {
      title: "结果与预期不一致",
      summary: "本次执行没有通过校验，通常是返回值、流程状态或运行环境与预期存在差异。",
      suggestion: "先看步骤日志里的请求和响应，再结合这条原始报错定位具体原因。",
      raw
    };
  }

  function renderFailureInsight(message = "", options = {}) {
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

  function resolveEnvironmentIdForRun(runId = "") {
    if (!runId) {
      return "";
    }
    return state.data?.runs?.find((run) => run.id === runId)?.environmentId || "";
  }

  function renderFailureRepairAction(message = "", { runId = "", stepId = "", caseId = "", envId = "", returnAnchor = "", returnGuideFocus = "", returnRiskView = "" } = {}) {
    const explanation = explainFailureMessage(message);
    const safeCaseId = String(caseId || "").trim();
    const safeEnvId = String(envId || resolveEnvironmentIdForRun(runId) || "").trim();
    const safeRunId = String(runId || "").trim();
    const safeStepId = String(stepId || "").trim();
    const safeAnchor = String(returnAnchor || "").trim();
    const safeGuideFocus = String(returnGuideFocus || "").trim();
    const safeRiskView = String(returnRiskView || "").trim();
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
          data-return-tab="reports"
          data-return-run-id="${escapeHtml(safeRunId)}"
          data-return-step-id="${escapeHtml(safeStepId)}"
          data-return-case-id="${escapeHtml(safeCaseId)}"
          data-return-guide-focus="${escapeHtml(safeGuideFocus)}"
          data-return-risk-view="${escapeHtml(safeRiskView)}"
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
          data-return-tab="reports"
          data-return-run-id="${escapeHtml(safeRunId)}"
          data-return-step-id="${escapeHtml(safeStepId)}"
          data-return-case-id="${escapeHtml(safeCaseId)}"
          data-return-guide-focus="${escapeHtml(safeGuideFocus)}"
          data-return-risk-view="${escapeHtml(safeRiskView)}"
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
          data-return-tab="reports"
          data-return-run-id="${escapeHtml(safeRunId)}"
          data-return-step-id="${escapeHtml(safeStepId)}"
          data-return-case-id="${escapeHtml(safeCaseId)}"
          data-return-guide-focus="${escapeHtml(safeGuideFocus)}"
          data-return-risk-view="${escapeHtml(safeRiskView)}"
          data-return-anchor="${escapeHtml(safeAnchor)}"
        >
          改用例断言
        </button>
      `;
    }

    if (safeRunId) {
      return `<button class="plain-button" data-action="select-report-run" data-run-id="${escapeHtml(safeRunId)}">看这次运行</button>`;
    }

    return "";
  }

  function getGuideTargetId(guideFocus) {
    return (
      {
        overview: "report-guide-overview",
        failures: "report-guide-failures",
        risks: "report-guide-risks",
        history: "report-guide-history"
      }[guideFocus] || "report-guide-overview"
    );
  }

  function resolveGuideFocus(selectedRun) {
    const explicitGuide = state.filters.reports.guideFocus || "auto";
    if (explicitGuide !== "auto") {
      return explicitGuide;
    }
    if (state.filters.reports.caseFocusId) {
      return "history";
    }
    if ((state.filters.reports.riskView || "all") !== "all") {
      return "risks";
    }
    if (Number(selectedRun?.summary?.failed || 0) > 0) {
      return "failures";
    }
    return "overview";
  }

  function renderGuideChip(label, guideFocus, activeGuide) {
    return `
      <button type="button" class="report-guide-chip ${guideFocus === activeGuide ? "is-active" : ""}" data-action="focus-report-guide" data-guide-focus="${guideFocus}">
        ${escapeHtml(label)}
      </button>
    `;
  }

  function renderReportGuideCard(selectedRun, guideFocus, totalPassed, totalFailed, caseHistory) {
    const configs = {
      overview: {
        title: "推荐先看概览和趋势",
        description: selectedRun ? `本次运行整体通过 ${selectedRun.summary?.passed || 0}，失败 ${selectedRun.summary?.failed || 0}。先确认整体趋势和通过率。` : "当前没有选中的运行记录，先看概览统计。",
        hint: `总通过 ${formatNumber(totalPassed)}，总失败 ${formatNumber(totalFailed)}。`
      },
      failures: {
        title: "推荐先看失败聚类和失败详情",
        description: "这次运行存在失败，优先定位失败聚类、失败用例详情，再决定是否查看回归风险。",
        hint: `当前运行失败 ${formatNumber(selectedRun?.summary?.failed || 0)} 个步骤。`
      },
      risks: {
        title: "推荐先看风险提示",
        description: "你正在查看风险过滤结果，优先看回归失败和耗时抬升，再回头看具体失败步骤。",
        hint: `风险视图：${escapeHtml(state.filters.reports.riskView || "all")}。`
      },
      history: {
        title: "推荐先看这条用例的历史追踪",
        description: caseHistory ? `已聚焦到 ${caseHistory.caseName}，先看它最近几次的失败原因和环境差异。` : "你已聚焦到单条用例，优先看历史追踪。",
        hint: caseHistory ? `最近 ${formatNumber(caseHistory.totalRuns)} 次记录。` : "可继续切换到整份报告。"
      }
    };
    const config = configs[guideFocus] || configs.overview;

    return `
      <section class="report-guide-card">
        <div class="report-guide-head">
          <div>
            <strong>${escapeHtml(config.title)}</strong>
            <p>${escapeHtml(config.description)}</p>
          </div>
          <span class="small-pill status-queued">${escapeHtml(config.hint)}</span>
        </div>
        <div class="report-guide-chips">
          ${renderGuideChip("概览趋势", "overview", guideFocus)}
          ${renderGuideChip("失败重点", "failures", guideFocus)}
          ${renderGuideChip("风险提示", "risks", guideFocus)}
          ${renderGuideChip("用例历史", "history", guideFocus)}
        </div>
      </section>
    `;
  }

  function focusReportGuide(guideFocus = "auto") {
    state.filters.reports.guideFocus = guideFocus || "auto";
    renderPage();
    const targetId = getGuideTargetId(resolveGuideFocus(resolvePrimaryRun(buildViewModel(), state.reportSummary)));
    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function renderReportsPage() {
    const model = buildViewModel();
    const summary = state.reportSummary;
    const insights = state.reportInsights;
    const selectedRun = resolvePrimaryRun(model, summary);
    const compareRun = resolveCompareRun(model, selectedRun);
    const compareData = buildRunCompare(selectedRun, compareRun);
    const trend = summary
      ? {
          labels: summary.trend.map((item) => item.label),
          passed: summary.trend.map((item) => item.passed),
          failed: summary.trend.map((item) => item.failed)
        }
      : buildTrendSeries(model.runs, 7);
    const moduleStats = summary?.moduleStats ?? buildModuleStats(model);
    const failedRows = summary?.failedRows ?? buildFailedRows(model, selectedRun);
    const totalSteps = summary?.summary?.totalSteps ?? model.runs.reduce((sum, run) => sum + run.summary.total, 0);
    const totalPassed = summary?.summary?.totalPassed ?? model.runs.reduce((sum, run) => sum + run.summary.passed, 0);
    const totalFailed = summary?.summary?.totalFailed ?? model.runs.reduce((sum, run) => sum + run.summary.failed, 0);
    const avgDuration =
      summary?.summary?.averageDuration ??
      (model.runs.length ? Math.round(model.runs.reduce((sum, run) => sum + run.duration, 0) / model.runs.length) : 0);
    const totalDuration = summary?.summary?.totalDuration ?? model.runs.reduce((sum, run) => sum + run.duration, 0);
    const caseFocusId = state.filters.reports.caseFocusId || "";
    const caseHistory = buildCaseHistory(model, caseFocusId);
    const regressionRisks = buildRegressionRisks(model);
    const activeRiskView = state.filters.reports.riskView || "all";
    const guideFocus = resolveGuideFocus(selectedRun);
    const visibleRegressionRisks =
      activeRiskView === "spike"
        ? []
        : activeRiskView === "recent"
          ? regressionRisks.regressions.filter((item) => item.isRecent).slice(0, 6)
          : regressionRisks.regressions.slice(0, 6);
    const visibleDurationSpikes =
      activeRiskView === "regression"
        ? []
        : activeRiskView === "recent"
          ? regressionRisks.durationSpikes.filter((item) => item.isRecent).slice(0, 6)
          : regressionRisks.durationSpikes.slice(0, 6);
    const riskFilterLabel =
      activeRiskView === "regression" ? "仅看回归失败" : activeRiskView === "spike" ? "仅看耗时抬升" : activeRiskView === "recent" ? "仅看近24h新增" : "全部风险";
    const primaryRunOptions = [
      { value: "latest", label: "当前选中/最新运行" },
      ...model.runs.slice(0, 20).map((run) => ({
        value: run.id,
        label: `${run.suiteName} · ${formatDateTime(run.finishedAt || run.startedAt || run.createdAt)}`
      }))
    ];
    const compareOptions = [
      { value: "none", label: "不对比" },
      ...model.runs
        .filter((run) => run.id !== selectedRun?.id)
        .slice(0, 20)
        .map((run) => ({
          value: run.id,
          label: `${run.suiteName} · ${formatDateTime(run.finishedAt || run.startedAt || run.createdAt)}`
        }))
    ];
    const clusterQuery = String(state.filters.reports.clusterQuery || "").trim().toLowerCase();
    const visibleClusters = (insights?.failureClusters || []).filter((item) => {
      if (!clusterQuery) {
        return true;
      }
      const haystack = `${item.caseName || ""} ${item.moduleName || ""} ${item.error || ""}`.toLowerCase();
      return haystack.includes(clusterQuery);
    });

    return `
      <div class="page-stack">
        <section class="toolbar report-filter-toolbar">
          <div class="toolbar-left report-filter-grid">
            <div class="report-filter-card">
              <div class="report-filter-label">时间范围</div>
              ${renderSelectControl(
                [
                  { value: "today", label: "今天" },
                  { value: "7d", label: "最近7天" },
                  { value: "30d", label: "最近30天" }
                ],
                state.filters.reports.range,
                "reports",
                "range"
              )}
            </div>
            <div class="report-filter-card">
              <div class="report-filter-label">统计模块</div>
              ${renderSelectControl(
                rowsOrAllOption(model.modules.map((item) => ({ value: item.id, label: item.name })), "全部模块"),
                state.filters.reports.moduleId,
                "reports",
                "moduleId"
              )}
            </div>
            <div class="report-filter-card report-filter-card-wide">
              <div class="report-filter-label">主运行</div>
              ${renderSelectControl(primaryRunOptions, state.filters.reports.primaryRunId || "latest", "reports", "primaryRunId")}
            </div>
            <div class="report-filter-card report-filter-card-wide">
              <div class="report-filter-label">对比运行</div>
              ${renderSelectControl(compareOptions, state.filters.reports.compareRunId || (compareRun ? compareRun.id : "none"), "reports", "compareRunId")}
            </div>
          </div>
          <div class="toolbar-right export-actions">
            <button class="secondary-button" data-action="export-report" data-format="pdf">导出PDF</button>
          </div>
        </section>

        ${renderReportGuideCard(selectedRun, guideFocus, totalPassed, totalFailed, caseHistory)}

        <section class="summary-grid">
          ${renderStatCard("总用例数", formatNumber(totalSteps), avgDuration ? `平均耗时: ${formatDuration(avgDuration)}` : "暂无执行", "primary", svgDoc())}
          ${renderStatCard("通过用例", formatNumber(totalPassed), `通过率: ${calcRate(totalPassed, totalSteps)}`, "success", svgCheck())}
          ${renderStatCard("失败用例", formatNumber(totalFailed), `失败率: ${calcRate(totalFailed, totalSteps)}`, "danger", svgCross())}
          ${renderStatCard("总执行时长", formatDuration(totalDuration), `环境: ${escapeHtml(selectedRun?.environmentName || "未执行")}`, "warning", svgClock())}
        </section>

        <section class="summary-grid">
          ${renderRiskSummaryCard(
            "回归风险",
            formatNumber(regressionRisks.summary.regressionCount),
            `近24h 新增: ${formatNumber(regressionRisks.summary.recentRegressionCount)}`,
            "danger",
            svgAlert(),
            "regression",
            activeRiskView
          )}
          ${renderRiskSummaryCard(
            "耗时抬升",
            formatNumber(regressionRisks.summary.durationSpikeCount),
            `近24h 新增: ${formatNumber(regressionRisks.summary.recentDurationSpikeCount)}`,
            "warning",
            svgClock(),
            "spike",
            activeRiskView
          )}
          ${renderRiskSummaryCard(
            "新增风险",
            formatNumber(regressionRisks.summary.recentRiskCount),
            "近24小时识别到的风险总数",
            "primary",
            svgTrend(),
            "recent",
            activeRiskView
          )}
        </section>

        <section class="report-grid" id="report-guide-overview">
          <section class="panel panel-compact ${guideFocus === "overview" ? "report-focus-panel" : ""}">
            <div class="panel-title-row">
              <div class="panel-title">${svgTrend()}测试趋势（最近7天）</div>
            </div>
            <div class="chart-shell">
              <div class="line-chart">${renderLineChart(trend.labels, trend.passed, trend.failed, 600, 250)}</div>
              <div class="chart-legend">
                <span class="legend-line legend-success">通过</span>
                <span class="legend-line legend-danger">失败</span>
              </div>
            </div>
          </section>

          <section class="panel panel-compact ${guideFocus === "overview" ? "report-focus-panel" : ""}">
            <div class="panel-title-row">
              <div class="panel-title">通过率分布</div>
            </div>
            <div class="donut-chart">
              ${renderDonutChart(totalPassed, totalFailed)}
              <div class="donut-meta">
                <span class="text-success">通过 ${calcRate(totalPassed, totalSteps)}</span>
                <span class="text-danger">失败 ${calcRate(totalFailed, totalSteps)}</span>
              </div>
            </div>
          </section>
        </section>

        ${
          caseHistory
            ? `
              <section class="panel panel-compact ${guideFocus === "history" ? "report-focus-panel" : ""}" id="report-guide-history">
                <div class="panel-title-row">
                  <div>
                    <div class="panel-title">用例历史追踪</div>
                    <div class="panel-subtitle">${escapeHtml(`${caseHistory.caseName} · 最近 ${caseHistory.totalRuns} 次记录`)}</div>
                  </div>
                  <div class="toolbar-right">
                    <button class="secondary-button" data-action="clear-report-case-focus">清除追踪</button>
                  </div>
                </div>
                <div class="task-meta-line">
                  <span>通过 ${escapeHtml(String(caseHistory.passed))}</span>
                  <span>失败 ${escapeHtml(String(caseHistory.failed))}</span>
                  <span>成功率 ${escapeHtml(`${(caseHistory.successRate * 100).toFixed(0)}%`)}</span>
                  <span>平均耗时 ${escapeHtml(formatDuration(caseHistory.averageDuration))}</span>
                </div>
                <div class="history-profile-grid">
                  <article class="history-profile-card">
                    <div class="panel-subtitle">失败原因聚合</div>
                    ${
                      caseHistory.failureReasons.length
                        ? `
                          <div class="cluster-list">
                            ${caseHistory.failureReasons
                              .map(
                                (item) => `
                                  <div class="history-inline-card">
                                    <div class="cluster-head">
                                      <strong>${escapeHtml(`${item.count} 次`)}</strong>
                                      <span class="subdued-text">${escapeHtml(formatDateTime(item.lastSeenAt))}</span>
                                    </div>
                                    ${renderFailureInsight(item.reason, { compact: true })}
                                  </div>
                                `
                              )
                              .join("")}
                          </div>
                        `
                        : `<div class="empty-card">最近没有失败记录。</div>`
                    }
                  </article>
                  <article class="history-profile-card">
                    <div class="panel-subtitle">环境分布</div>
                    <div class="cluster-list">
                      ${caseHistory.environmentDistribution
                        .map(
                          (item) => `
                            <div class="history-inline-card">
                              <div class="cluster-head">
                                <strong>${escapeHtml(item.name)}</strong>
                                <span class="small-pill status-queued">${escapeHtml(`${(item.ratio * 100).toFixed(0)}%`)}</span>
                              </div>
                              <div class="task-meta-line">
                                <span>执行 ${escapeHtml(String(item.count))} 次</span>
                              </div>
                            </div>
                          `
                        )
                        .join("")}
                    </div>
                  </article>
                </div>
                <article class="history-profile-card history-env-compare-card">
                  <div class="panel-subtitle">环境对比画像</div>
                  <div class="history-env-compare-grid">
                    ${caseHistory.environmentCompare
                      .map(
                        (item) => `
                          <div class="history-inline-card">
                            <div class="cluster-head">
                              <strong>${escapeHtml(item.name)}</strong>
                              <span class="small-pill ${item.failed ? "small-failed" : "status-success"}">${escapeHtml(`${(item.successRate * 100).toFixed(0)}%`)}</span>
                            </div>
                            <div class="task-meta-line">
                              <span>执行 ${escapeHtml(String(item.total))} 次</span>
                              <span>失败 ${escapeHtml(String(item.failed))} 次</span>
                            </div>
                            <div class="task-meta-line">
                              <span>平均耗时 ${escapeHtml(formatDuration(item.averageDuration))}</span>
                              <span>通过 ${escapeHtml(String(item.passed))} 次</span>
                            </div>
                          </div>
                        `
                      )
                      .join("")}
                  </div>
                </article>
                <div class="history-trend-grid">
                  <article class="history-trend-card">
                    <div class="panel-subtitle">最近 10 次状态序列</div>
                    ${renderCaseHistoryStatusTrack(caseHistory.recentSteps)}
                  </article>
                  <article class="history-trend-card">
                    <div class="panel-subtitle">最近 10 次耗时走势</div>
                    ${renderCaseHistoryDurationChart(caseHistory.recentSteps)}
                  </article>
                </div>
                <div class="compare-step-table">
                  <div class="compare-step-head">
                    <div>运行</div>
                    <div>状态</div>
                    <div>环境</div>
                    <div>耗时</div>
                    <div>时间</div>
                  </div>
                  ${caseHistory.recentSteps
                    .map(
                      (item) => `
                        <div class="compare-step-row">
                          <div class="action-row-compact">
                            <button class="plain-button" data-action="select-report-run" data-run-id="${item.runId}">${escapeHtml(item.suiteName)}</button>
                            <button class="plain-button" data-action="view-step-log" data-run-id="${item.runId}" data-step-id="${item.stepId}">日志</button>
                          </div>
                          <div><span class="status-pill ${renderRunStatus(item.status)}">${escapeHtml(item.status)}</span></div>
                          <div>${escapeHtml(item.environmentName || "-")}</div>
                          <div>${escapeHtml(formatDuration(item.duration))}</div>
                          <div>${escapeHtml(formatDateTime(item.finishedAt))}</div>
                        </div>
                      `
                    )
                    .join("")}
                </div>
              </section>
            `
            : ""
        }

        <section class="report-grid" id="report-guide-failures">
          <section class="panel panel-compact">
            <div class="panel-title-row">
              <div class="panel-title">运行对比</div>
            </div>
            ${
              compareData
                ? `
                  <div class="compare-run-grid">
                    <article class="compare-run-card">
                      <strong>${escapeHtml(compareData.selectedRun.suiteName)}</strong>
                      <div class="task-meta-line">
                        <span>${escapeHtml(formatDateTime(compareData.selectedRun.finishedAt || compareData.selectedRun.startedAt || compareData.selectedRun.createdAt))}</span>
                        <span class="status-pill ${renderRunStatus(compareData.selectedRun.status)}">${escapeHtml(compareData.selectedRun.status)}</span>
                      </div>
                      <div class="task-meta-line">
                        <span>通过 ${escapeHtml(String(compareData.selectedRun.summary.passed || 0))}</span>
                        <span>失败 ${escapeHtml(String(compareData.selectedRun.summary.failed || 0))}</span>
                        <span>耗时 ${escapeHtml(formatDuration(compareData.selectedRun.duration || 0))}</span>
                      </div>
                    </article>
                    <article class="compare-run-card">
                      <strong>${escapeHtml(compareData.compareRun.suiteName)}</strong>
                      <div class="task-meta-line">
                        <span>${escapeHtml(formatDateTime(compareData.compareRun.finishedAt || compareData.compareRun.startedAt || compareData.compareRun.createdAt))}</span>
                        <span class="status-pill ${renderRunStatus(compareData.compareRun.status)}">${escapeHtml(compareData.compareRun.status)}</span>
                      </div>
                      <div class="task-meta-line">
                        <span>通过 ${escapeHtml(String(compareData.compareRun.summary.passed || 0))}</span>
                        <span>失败 ${escapeHtml(String(compareData.compareRun.summary.failed || 0))}</span>
                        <span>耗时 ${escapeHtml(formatDuration(compareData.compareRun.duration || 0))}</span>
                      </div>
                    </article>
                  </div>
                  <div class="task-meta-line compare-delta-line">
                    ${renderCompareDelta("通过差值", compareData.deltaPassed)}
                    ${renderCompareDelta("失败差值", compareData.deltaFailed)}
                    ${renderCompareDelta("耗时差值(ms)", compareData.deltaDuration)}
                  </div>
                  ${
                    compareData.changedSteps.length
                      ? `
                        <div class="compare-step-table">
                          <div class="compare-step-head">
                            <div>用例</div>
                            <div>当前</div>
                            <div>对比</div>
                            <div>耗时变化</div>
                            <div>备注</div>
                          </div>
                          ${compareData.changedSteps
                            .map(
                              (item) => `
                                <div class="compare-step-row">
                                  <div><strong>${escapeHtml(item.caseName)}</strong></div>
                                  <div><span class="status-pill status-${item.currentStatus === "failed" ? "failed" : item.currentStatus === "passed" ? "success" : "queued"}">${escapeHtml(item.currentStatus)}</span></div>
                                  <div><span class="status-pill status-${item.compareStatus === "failed" ? "failed" : item.compareStatus === "passed" ? "success" : "queued"}">${escapeHtml(item.compareStatus)}</span></div>
                                  <div>${escapeHtml(formatDuration(Math.max(0, item.currentDuration)))} / ${escapeHtml(formatDuration(Math.max(0, item.compareDuration)))}</div>
                                  <div>
                                    ${renderFailureInsight(item.message, { compact: true })}
                                    ${renderCompareStepDiff(item)}
                                  </div>
                                </div>
                              `
                            )
                            .join("")}
                        </div>
                      `
                      : `<div class="empty-card">两次运行的步骤状态和耗时没有明显差异。</div>`
                  }
                `
                : `<div class="empty-card">至少需要两次运行记录才能做对比。</div>`
            }
          </section>

          <section class="panel panel-compact ${guideFocus === "failures" ? "report-focus-panel" : ""}">
            <div class="panel-title-row">
              <div class="panel-title">失败聚类</div>
            </div>
            <section class="toolbar report-cluster-toolbar">
              <div class="toolbar-left">
                <label class="search-box">
                  <input value="${escapeHtml(state.filters.reports.clusterQuery || "")}" placeholder="搜索失败用例、模块或错误信息..." data-filter-page="reports" data-filter-key="clusterQuery" />
                </label>
              </div>
              <div class="toolbar-right">
                <span class="small-pill status-queued">${escapeHtml(`命中 ${visibleClusters.length}/${(insights?.failureClusters || []).length}`)}</span>
              </div>
            </section>
            ${
              visibleClusters.length
                ? `
                  <div class="cluster-list">
                    ${visibleClusters
                      .map(
                        (item) => `
                          <article class="cluster-card" data-return-anchor="${escapeHtml(`report-cluster:${item.caseId}`)}">
                            <div class="cluster-head">
                              <strong>${escapeHtml(item.caseName)}</strong>
                              <span class="small-pill small-failed">${escapeHtml(`${item.count} 次`)}</span>
                            </div>
                            <div class="task-meta-line">
                              <span>${escapeHtml(item.moduleName)}</span>
                              <span>${escapeHtml(formatDateTime(item.lastSeenAt))}</span>
                            </div>
                            ${renderFailureInsight(item.error)}
                            <div class="action-row-compact">
                              ${renderFailureRepairAction(item.error, {
                                runId: item.latestRunId || "",
                                stepId: item.latestStepId || "",
                                caseId: item.caseId,
                                returnAnchor: `report-cluster:${item.caseId}`,
                                returnGuideFocus: "failures"
                              })}
                              <button class="plain-button" data-action="focus-report-case" data-case-id="${item.caseId}">历史追踪</button>
                              <button class="plain-button" data-action="select-report-run" data-run-id="${item.latestRunId || ""}" ${!item.latestRunId ? "disabled" : ""}>查看最近失败运行</button>
                              <button class="plain-button" data-action="view-step-log" data-run-id="${item.latestRunId || ""}" data-step-id="${item.latestStepId || ""}" ${!item.latestRunId || !item.latestStepId ? "disabled" : ""}>定位步骤</button>
                            </div>
                          </article>
                        `
                      )
                      .join("")}
                  </div>
                `
                : `<div class="empty-card">当前筛选范围内没有失败聚类。</div>`
            }
          </section>
        </section>

        <section class="report-bottom report-bottom-grid">
          <section class="panel panel-compact ${guideFocus === "risks" ? "report-focus-panel" : ""}" id="report-guide-risks">
            <div class="panel-title-row">
              <div>
                <div class="panel-title">回归风险提示</div>
                <div class="panel-subtitle">${escapeHtml(riskFilterLabel)}</div>
              </div>
              <div class="toolbar-right">
                <button class="secondary-button" data-action="set-report-risk-view" data-risk-view="all" ${activeRiskView === "all" ? "disabled" : ""}>查看全部</button>
              </div>
            </div>
            ${
              visibleRegressionRisks.length || visibleDurationSpikes.length
                ? `
                  <div class="risk-grid">
                    <article class="risk-column">
                      <div class="panel-subtitle">最近由通过转失败</div>
                      ${
                        visibleRegressionRisks.length
                          ? `
                            <div class="cluster-list">
                              ${visibleRegressionRisks
                                .map(
                                  (item) => `
                                    <article class="risk-card" data-return-anchor="${escapeHtml(`report-risk:${item.caseId}`)}">
                                      <div class="cluster-head">
                                        <strong>${escapeHtml(item.caseName)}</strong>
                                        <span class="small-pill small-failed">回归</span>
                                      </div>
                                      <div class="task-meta-line">
                                        <span>${escapeHtml(item.moduleName)}</span>
                                        <span>${escapeHtml(item.environmentName)}</span>
                                      </div>
                                      <div class="task-meta-line">
                                        <span>失败时间 ${escapeHtml(formatDateTime(item.failedAt))}</span>
                                        <span>上次通过 ${escapeHtml(formatDateTime(item.previousPassedAt))}</span>
                                      </div>
                                      ${renderFailureInsight(item.message)}
                                      <div class="action-row-compact">
                                        ${renderFailureRepairAction(item.message, {
                                          runId: item.runId,
                                          stepId: item.stepId,
                                          caseId: item.caseId,
                                          returnAnchor: `report-risk:${item.caseId}`,
                                          returnGuideFocus: "risks",
                                          returnRiskView: activeRiskView
                                        })}
                                        <button class="plain-button" data-action="focus-report-case" data-case-id="${item.caseId}">历史追踪</button>
                                        <button class="plain-button" data-action="select-report-run" data-run-id="${item.runId}">查看运行</button>
                                        <button class="plain-button" data-action="view-step-log" data-run-id="${item.runId}" data-step-id="${item.stepId}">定位步骤</button>
                                      </div>
                                    </article>
                                  `
                                )
                                .join("")}
                            </div>
                          `
                          : `<div class="empty-card">当前没有新出现的通过转失败用例。</div>`
                      }
                    </article>
                    <article class="risk-column">
                      <div class="panel-subtitle">最近耗时明显抬升</div>
                      ${
                        visibleDurationSpikes.length
                          ? `
                            <div class="cluster-list">
                              ${visibleDurationSpikes
                                .map(
                                  (item) => `
                                    <article class="risk-card">
                                      <div class="cluster-head">
                                        <strong>${escapeHtml(item.caseName)}</strong>
                                        <span class="small-pill small-warning">${escapeHtml(`${item.ratio.toFixed(1)}x`)}</span>
                                      </div>
                                      <div class="task-meta-line">
                                        <span>${escapeHtml(item.moduleName)}</span>
                                        <span>${escapeHtml(item.environmentName)}</span>
                                      </div>
                                      <div class="task-meta-line">
                                        <span>当前 ${escapeHtml(formatDuration(item.latestDuration))}</span>
                                        <span>基线 ${escapeHtml(formatDuration(item.baselineAverage))}</span>
                                        <span>抬升 ${escapeHtml(formatDuration(item.delta))}</span>
                                      </div>
                                      <div class="action-row-compact">
                                        <button class="plain-button" data-action="focus-report-case" data-case-id="${item.caseId}">历史追踪</button>
                                        <button class="plain-button" data-action="select-report-run" data-run-id="${item.runId}">查看运行</button>
                                        <button class="plain-button" data-action="view-step-log" data-run-id="${item.runId}" data-step-id="${item.stepId}">定位步骤</button>
                                      </div>
                                    </article>
                                  `
                                )
                                .join("")}
                            </div>
                          `
                          : `<div class="empty-card">当前没有显著的耗时抬升用例。</div>`
                      }
                    </article>
                  </div>
                `
                : `<div class="empty-card">当前还没有足够的运行波动可识别回归风险。</div>`
            }
          </section>

          <section class="panel panel-compact">
            <div class="panel-title-row">
              <div class="panel-title">模块测试统计</div>
            </div>
            <div class="bar-chart">${renderBarChart(moduleStats, 860, 280)}</div>
            <div class="chart-legend">
              <span class="legend-item"><span class="legend-dot legend-dot-success"></span>通过</span>
              <span class="legend-item"><span class="legend-dot legend-dot-danger"></span>失败</span>
            </div>
          </section>

          <section class="panel panel-compact">
            <div class="panel-title-row">
              <div class="panel-title">${svgAlert()}失败用例详情</div>
            </div>
            ${
              failedRows.length
                ? `
                  <div class="report-table">
                    <div class="report-table-head">
                      <div>用例ID</div>
                      <div>用例名称</div>
                      <div>所属模块</div>
                      <div>错误信息</div>
                      <div>失败次数</div>
                      <div>最后失败时间</div>
                      <div>操作</div>
                    </div>
                    ${failedRows
                      .map(
                        (row) => `
                          <div class="report-table-row" data-return-anchor="${escapeHtml(`report-failed-row:${row.caseId}`)}">
                            <div><span class="link-text">${escapeHtml(row.displayId)}</span></div>
                            <div><strong>${escapeHtml(row.caseName)}</strong></div>
                            <div><span class="small-pill status-queued">${escapeHtml(row.moduleName)}</span></div>
                            <div>${renderFailureInsight(row.error, { compact: true })}</div>
                            <div><span class="small-pill small-failed">${escapeHtml(`${row.count}次`)}</span></div>
                            <div>${escapeHtml(formatDateTime(row.lastFailedAt))}</div>
                            <div class="action-row-compact">
                              ${renderFailureRepairAction(row.error, {
                                runId: row.runId,
                                stepId: row.stepId,
                                caseId: row.caseId,
                                returnAnchor: `report-failed-row:${row.caseId}`,
                                returnGuideFocus: "failures"
                              })}
                              <button class="plain-button" data-action="view-step-log" data-run-id="${row.runId}" data-step-id="${row.stepId}">查看日志</button>
                              <button class="plain-button" data-action="retry-failed-run" data-run-id="${row.runId}">重跑失败步骤</button>
                            </div>
                          </div>
                        `
                      )
                      .join("")}
                  </div>
                `
                : `<div class="empty-card">当前没有失败用例。</div>`
            }
          </section>

          <section class="panel panel-compact">
            <div class="panel-title-row">
              <div class="panel-title">执行洞察</div>
            </div>
            ${
              insights
                ? `
                  <div class="cluster-list">
                    ${(insights.slowCases || [])
                      .slice(0, 5)
                      .map(
                        (item) => `
                          <article class="cluster-card">
                            <div class="cluster-head">
                              <strong>${escapeHtml(item.caseName)}</strong>
                              <span class="small-pill small-warning">${escapeHtml(formatDuration(item.averageDuration || 0))}</span>
                            </div>
                            <div class="task-meta-line">
                              <span>${escapeHtml(item.moduleName)}</span>
                              <span>最大耗时 ${escapeHtml(formatDuration(item.maxDuration || 0))}</span>
                            </div>
                            <div class="action-row-compact">
                              <button class="plain-button" data-action="focus-report-case" data-case-id="${item.caseId}">查看历史</button>
                            </div>
                          </article>
                        `
                      )
                      .join("")}
                    ${(insights.flakyCases || [])
                      .slice(0, 5)
                      .map(
                        (item) => `
                          <article class="cluster-card">
                            <div class="cluster-head">
                              <strong>${escapeHtml(item.caseName)}</strong>
                              <span class="small-pill status-queued">${escapeHtml(`稳定性 ${(Number(item.stability || 0) * 100).toFixed(0)}%`)}</span>
                            </div>
                            <div class="task-meta-line">
                              <span>${escapeHtml(item.moduleName)}</span>
                              <span>通过 ${escapeHtml(String(item.passed))} / 失败 ${escapeHtml(String(item.failed))}</span>
                            </div>
                            <div class="action-row-compact">
                              <button class="plain-button" data-action="focus-report-case" data-case-id="${item.caseId}">查看历史</button>
                            </div>
                          </article>
                        `
                      )
                      .join("")}
                  </div>
                `
                : `<div class="empty-card">暂无可展示的执行洞察。</div>`
            }
          </section>
        </section>
      </div>
    `;
  }

  function openRunReport(runId, options = {}) {
    const run = state.data.runs.find((item) => item.id === runId);
    if (!run) {
      showToast("执行记录不存在");
      return;
    }

    state.selectedRunId = run.id;
    state.filters.reports.primaryRunId = run.id;
    state.filters.reports.caseFocusId = options.caseId || "";
    state.filters.reports.riskView = options.riskView || "all";
    state.filters.reports.guideFocus = options.guideFocus || "auto";
    if (state.filters.reports.compareRunId === run.id) {
      state.filters.reports.compareRunId = "none";
    }
    state.activeTab = "reports";
    renderApp();
    refreshReportData()
      .then(() => renderPage())
      .catch((error) => showToast(error.message));
  }

  function selectReportRun(runId) {
    const run = state.data.runs.find((item) => item.id === runId);
    if (!run) {
      showToast("执行记录不存在");
      return;
    }
    state.selectedRunId = run.id;
    state.filters.reports.primaryRunId = run.id;
    if (state.filters.reports.compareRunId === run.id) {
      state.filters.reports.compareRunId = "none";
    }
    state.activeTab = "reports";
    state.filters.reports.guideFocus = "auto";
    renderApp();
    refreshReportData()
      .then(() => renderPage())
      .catch((error) => showToast(error.message));
  }

  function focusReportCase(caseId) {
    if (!caseId) {
      return;
    }
    state.filters.reports.caseFocusId = caseId;
    state.filters.reports.guideFocus = "history";
    renderPage();
  }

  function clearReportCaseFocus() {
    state.filters.reports.caseFocusId = "";
    state.filters.reports.guideFocus = "auto";
    renderPage();
  }

  function reportStatusText(status) {
    return (
      {
        passed: "通过",
        failed: "失败",
        running: "执行中",
        queued: "排队中",
        canceled: "已取消",
        skipped: "已跳过"
      }[status] || status || "未知"
    );
  }

  function stringifyPrintableValue(value) {
    if (value === undefined || value === null || value === "") {
      return "—";
    }
    if (typeof value === "string") {
      return value;
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  function buildPrintableReportBody() {
    const pageStack = document.querySelector("#pageBody .page-stack");
    if (!pageStack) {
      return "";
    }

    const cloned = pageStack.cloneNode(true);
    cloned.querySelector(".report-filter-toolbar")?.remove();
    cloned.querySelectorAll(".export-actions, .action-row-compact").forEach((node) => node.remove());
    cloned.querySelectorAll("button.plain-button, button.secondary-button").forEach((node) => node.remove());
    cloned.querySelectorAll("input, select").forEach((node) => {
      const replacement = document.createElement("span");
      replacement.className = "print-filter-value";
      replacement.textContent =
        node.tagName === "SELECT"
          ? node.options?.[node.selectedIndex]?.textContent || node.value || ""
          : node.value || node.getAttribute("placeholder") || "";
      node.replaceWith(replacement);
    });
    return cloned.innerHTML;
  }

  function renderPrintableAssertions(assertions = []) {
    if (!assertions.length) {
      return `<div class="print-empty">无断言明细</div>`;
    }

    return `
      <ul class="print-assertion-list">
        ${assertions
          .map(
            (assertion) => `
              <li class="print-assertion-item ${assertion.passed ? "is-passed" : "is-failed"}">
                <strong>${escapeHtml(assertion.passed ? "通过" : "失败")}</strong>
                <span>${escapeHtml(assertion.type || "assertion")}</span>
                <span>${escapeHtml(assertion.message || "")}</span>
              </li>
            `
          )
          .join("")}
      </ul>
    `;
  }

  function renderPrintableRunDetails(selectedRun) {
    const steps = selectedRun?.steps || [];
    if (!steps.length) {
      return `
        <section class="print-section" id="section-details">
          <div class="print-section-eyebrow">03 / 详细记录</div>
          <div class="print-section-title">测试步骤详情</div>
          <div class="print-empty">当前运行没有可导出的步骤明细。</div>
        </section>
      `;
    }

    return `
      <section class="print-section" id="section-details">
        <div class="print-section-eyebrow">03 / 详细记录</div>
        <div class="print-section-title">测试步骤详情</div>
        <div class="print-step-list">
          ${steps
            .map((step, index) => {
              const requestText = [
                `${step.request?.method || "—"} ${step.request?.url || ""}`.trim(),
                "",
                "Headers",
                stringifyPrintableValue(step.request?.headers),
                "",
                "Body",
                stringifyPrintableValue(step.request?.body)
              ].join("\n");
              const responseText = [
                `Status: ${step.response?.status ?? "—"}`,
                "",
                "Headers",
                stringifyPrintableValue(step.response?.headers),
                "",
                "Body",
                stringifyPrintableValue(step.response?.body ?? step.response?.bodyText)
              ].join("\n");

              return `
                <article class="print-step-card">
                  <div class="print-step-header">
                    <div>
                      <div class="print-step-index">步骤 ${escapeHtml(String(index + 1))}</div>
                      <h3>${escapeHtml(step.caseName || "未命名步骤")}</h3>
                    </div>
                    <span class="print-status-badge ${step.status === "passed" ? "is-passed" : step.status === "failed" ? "is-failed" : "is-other"}">
                      ${escapeHtml(reportStatusText(step.status))}
                    </span>
                  </div>
                  <div class="print-step-meta">
                    <span>接口：${escapeHtml(step.apiName || "—")}</span>
                    <span>耗时：${escapeHtml(formatDuration(step.duration || 0))}</span>
                    <span>开始：${escapeHtml(formatDateTime(step.startedAt || selectedRun.startedAt || selectedRun.createdAt))}</span>
                    <span>结束：${escapeHtml(formatDateTime(step.finishedAt || selectedRun.finishedAt || selectedRun.startedAt || selectedRun.createdAt))}</span>
                  </div>
                  <div class="print-step-message">${escapeHtml(step.message || "—")}</div>
                  <div class="print-step-grid">
                    <section class="print-step-panel">
                      <div class="print-step-panel-title">请求内容</div>
                      <pre>${escapeHtml(requestText)}</pre>
                    </section>
                    <section class="print-step-panel">
                      <div class="print-step-panel-title">响应内容</div>
                      <pre>${escapeHtml(responseText)}</pre>
                    </section>
                  </div>
                  <section class="print-step-panel">
                    <div class="print-step-panel-title">断言结果</div>
                    ${renderPrintableAssertions(step.assertions || [])}
                  </section>
                </article>
              `;
            })
            .join("")}
        </div>
      </section>
    `;
  }

  function buildPrintableReportHtml(selectedRun, compareRun) {
    const styleHref = new URL("/styles.css", window.location.href).href;
    const exportTime = new Date().toISOString();
    const exportTimeText = formatDateTime(exportTime);
    const rangeLabel =
      state.filters.reports.range === "30d" ? "最近30天" : state.filters.reports.range === "7d" ? "最近7天" : "今天";
    const moduleLabel =
      document.querySelector('[data-filter-page="reports"][data-filter-key="moduleId"] option:checked')?.textContent || "全部模块";
    const compareLabel = compareRun
      ? `${compareRun.suiteName} · ${formatDateTime(compareRun.finishedAt || compareRun.startedAt || compareRun.createdAt)}`
      : "不对比";
    const tocItems = [
      { index: "01", title: "报告概览与图示", target: "section-dashboard", hint: "当前测试报告页的统计卡片、趋势图、风险与洞察" },
      { index: "02", title: "导出说明", target: "section-appendix", hint: "导出范围、筛选条件和阅读说明" },
      { index: "03", title: "测试步骤详情", target: "section-details", hint: `${selectedRun.steps?.length || 0} 个步骤的请求、响应、断言和结果` }
    ];

    return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>测试报告 ${escapeHtml(selectedRun.id)}</title>
    <link rel="stylesheet" href="${styleHref}" />
    <style>
      body { margin: 0; background: #f4f7fb; color: #172033; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .print-shell { max-width: 1280px; margin: 0 auto; padding: 32px 28px 56px; }
      .print-cover { position: relative; overflow: hidden; background: linear-gradient(135deg, #172033 0%, #2444a6 55%, #4c7cff 100%); color: #fff; border-radius: 24px; padding: 40px; margin-bottom: 24px; box-shadow: 0 18px 50px rgba(23, 32, 51, 0.18); }
      .print-cover::after { content: ""; position: absolute; inset: auto -80px -90px auto; width: 240px; height: 240px; border-radius: 50%; background: rgba(255,255,255,0.08); }
      .print-cover h1 { margin: 10px 0 12px; font-size: 34px; }
      .print-cover p { margin: 0; color: rgba(255,255,255,0.82); }
      .print-cover-kicker { display: inline-flex; padding: 6px 12px; border-radius: 999px; background: rgba(255,255,255,0.12); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; }
      .print-cover-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 18px; margin-top: 26px; align-items: end; }
      .print-cover-meta { display: grid; gap: 12px; }
      .print-cover-meta-card { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.16); border-radius: 16px; padding: 16px 18px; }
      .print-cover-meta-card strong { display: block; font-size: 12px; color: rgba(255,255,255,0.72); margin-bottom: 6px; }
      .print-cover-highlight { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .print-cover-highlight .print-highlight-card { background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.18); border-radius: 18px; padding: 18px; }
      .print-cover-highlight .print-highlight-card strong { display: block; font-size: 12px; margin-bottom: 8px; color: rgba(255,255,255,0.72); }
      .print-cover-highlight .print-highlight-card span { font-size: 24px; font-weight: 700; }
      .print-header, .print-footer { display: none; }
      .print-toc { background: #fff; border: 1px solid #dbe3f0; border-radius: 20px; padding: 28px; margin-bottom: 24px; box-shadow: 0 16px 40px rgba(23, 32, 51, 0.08); }
      .print-toc-list { display: grid; gap: 12px; margin-top: 18px; }
      .print-toc-item { display: grid; grid-template-columns: 56px 1fr auto; gap: 14px; align-items: center; text-decoration: none; color: inherit; border: 1px solid #e3e8f2; border-radius: 16px; padding: 14px 16px; }
      .print-toc-item-index { display: inline-flex; align-items: center; justify-content: center; height: 40px; width: 40px; border-radius: 12px; background: #eef3ff; color: #315edb; font-weight: 700; }
      .print-toc-item strong { display: block; margin-bottom: 4px; }
      .print-toc-item span { color: #667085; font-size: 13px; }
      .print-toc-item-page { color: #315edb; font-weight: 700; }
      .print-meta-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 20px; }
      .print-meta-card { background: #f7f9fc; border-radius: 14px; padding: 14px 16px; border: 1px solid #e3e8f2; }
      .print-meta-card strong, .print-section-title, .print-step-panel-title, .print-step-index { display: block; margin-bottom: 6px; }
      .print-section { background: #fff; border: 1px solid #dbe3f0; border-radius: 20px; padding: 24px; margin-top: 24px; }
      .print-section-eyebrow { color: #5572c8; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 8px; }
      .print-filter-value { display: inline-flex; min-height: 40px; align-items: center; color: #172033; }
      .print-step-list { display: grid; gap: 18px; }
      .print-step-card { border: 1px solid #e3e8f2; border-radius: 16px; padding: 18px; background: #fbfcff; break-inside: avoid; }
      .print-step-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
      .print-step-header h3 { margin: 0; font-size: 18px; }
      .print-step-meta { display: flex; flex-wrap: wrap; gap: 12px 18px; margin-top: 10px; color: #5b6475; font-size: 13px; }
      .print-step-message { margin-top: 10px; font-weight: 600; }
      .print-step-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 16px; }
      .print-step-panel { background: #fff; border: 1px solid #e3e8f2; border-radius: 12px; padding: 14px; }
      .print-step-panel pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.6; color: #24314f; }
      .print-status-badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 6px 12px; font-size: 12px; font-weight: 700; }
      .print-status-badge.is-passed { background: #e7f8ef; color: #0e8f4d; }
      .print-status-badge.is-failed { background: #fdecea; color: #ca3f32; }
      .print-status-badge.is-other { background: #eef2ff; color: #4664d9; }
      .print-assertion-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
      .print-assertion-item { display: grid; gap: 4px; border-radius: 10px; padding: 10px 12px; }
      .print-assertion-item.is-passed { background: #eefaf3; }
      .print-assertion-item.is-failed { background: #fff2f1; }
      .print-empty { padding: 18px; border: 1px dashed #dbe3f0; border-radius: 12px; color: #6b7383; background: #fbfcff; }
      .print-note-list { display: grid; gap: 12px; }
      .print-note-item { border: 1px solid #e3e8f2; border-radius: 14px; padding: 14px 16px; background: #fbfcff; }
      .print-note-item strong { display: block; margin-bottom: 6px; }
      @page { size: A4 portrait; margin: 12mm; }
      @media print {
        body { background: #fff; }
        .print-shell { max-width: none; padding: 18mm 0 14mm; }
        .print-header, .print-footer { display: flex; position: fixed; left: 0; right: 0; color: #6b7383; font-size: 11px; }
        .print-header { top: 0; justify-content: space-between; border-bottom: 1px solid #dbe3f0; padding: 0 0 6mm; background: #fff; }
        .print-footer { bottom: 0; justify-content: space-between; border-top: 1px solid #dbe3f0; padding: 5mm 0 0; background: #fff; }
        .print-footer-page::after { content: "第 " counter(page) " 页 / 共 " counter(pages) " 页"; }
        .print-cover { min-height: 230mm; page-break-after: always; box-shadow: none !important; }
        .print-toc { page-break-after: always; box-shadow: none !important; }
        .print-cover, .print-section, .print-step-card, .panel, .stat-card { box-shadow: none !important; }
        .print-section { break-inside: auto; }
        .print-step-card { break-inside: avoid-page; }
        .page-stack { gap: 18px; }
      }
    </style>
  </head>
  <body>
    <div class="print-header">
      <span>${escapeHtml(selectedRun.suiteName || selectedRun.id)}</span>
      <span>${escapeHtml(selectedRun.environmentName || "未命名环境")} · ${escapeHtml(reportStatusText(selectedRun.status))}</span>
    </div>
    <div class="print-footer">
      <span>FlowForge 测试报告</span>
      <span>${escapeHtml(exportTimeText)}</span>
      <span class="print-footer-page"></span>
    </div>
    <main class="print-shell">
      <section class="print-cover">
        <span class="print-cover-kicker">AUTOMATION REPORT</span>
        <h1>接口自动化测试报告</h1>
        <p>本导出基于当前测试报告页生成，保留图示摘要，并补充完整步骤级请求、响应、断言与失败定位信息，适合作为归档或对外汇报材料。</p>
        <div class="print-cover-grid">
          <div class="print-cover-meta">
            <div class="print-cover-meta-card"><strong>主运行</strong><span>${escapeHtml(selectedRun.suiteName || selectedRun.id)}</span></div>
            <div class="print-cover-meta-card"><strong>执行环境</strong><span>${escapeHtml(selectedRun.environmentName || "—")}</span></div>
            <div class="print-cover-meta-card"><strong>导出时间</strong><span>${escapeHtml(exportTimeText)}</span></div>
            <div class="print-cover-meta-card"><strong>筛选条件</strong><span>${escapeHtml(`${rangeLabel} · ${moduleLabel} · ${compareLabel}`)}</span></div>
          </div>
          <div class="print-cover-highlight">
            <div class="print-highlight-card"><strong>执行状态</strong><span>${escapeHtml(reportStatusText(selectedRun.status))}</span></div>
            <div class="print-highlight-card"><strong>总耗时</strong><span>${escapeHtml(formatDuration(selectedRun.duration || 0))}</span></div>
            <div class="print-highlight-card"><strong>通过</strong><span>${escapeHtml(String(selectedRun.summary?.passed || 0))}</span></div>
            <div class="print-highlight-card"><strong>失败</strong><span>${escapeHtml(String(selectedRun.summary?.failed || 0))}</span></div>
          </div>
        </div>
      </section>
      <section class="print-toc">
        <div class="print-section-eyebrow">目录 / Contents</div>
        <div class="print-section-title">报告目录</div>
        <div class="print-toc-list">
          ${tocItems
            .map(
              (item) => `
                <a class="print-toc-item" href="#${item.target}">
                  <span class="print-toc-item-index">${escapeHtml(item.index)}</span>
                  <span>
                    <strong>${escapeHtml(item.title)}</strong>
                    <span>${escapeHtml(item.hint)}</span>
                  </span>
                  <span class="print-toc-item-page">→</span>
                </a>
              `
            )
            .join("")}
        </div>
      </section>
      <section class="print-section" id="section-dashboard">
        <div class="print-section-eyebrow">01 / 图示总览</div>
        <div class="print-section-title">报告概览与图示</div>
        ${buildPrintableReportBody()}
      </section>
      <section class="print-section" id="section-appendix">
        <div class="print-section-eyebrow">02 / 导出说明</div>
        <div class="print-section-title">导出说明</div>
        <div class="print-note-list">
          <div class="print-note-item"><strong>导出范围</strong><span>图示总览部分保持与当前测试报告页面一致，包含统计卡片、趋势图、风险提示、失败聚类和洞察模块。</span></div>
          <div class="print-note-item"><strong>详细内容</strong><span>步骤详情部分会逐条列出请求信息、响应内容、断言结果、耗时和状态，便于复盘失败原因。</span></div>
          <div class="print-note-item"><strong>筛选条件</strong><span>${escapeHtml(`时间范围：${rangeLabel}；统计模块：${moduleLabel}；对比运行：${compareLabel}`)}</span></div>
        </div>
      </section>
      ${renderPrintableRunDetails(selectedRun)}
    </main>
    <script>
      window.addEventListener("load", function () {
        setTimeout(function () {
          window.print();
        }, 300);
      });
      window.addEventListener("afterprint", function () {
        window.close();
      });
    </script>
  </body>
</html>`;
  }

  function exportReport(format) {
    if (format !== "pdf") {
      showToast("测试报告仅保留 PDF 导出");
      return;
    }

    const model = buildViewModel();
    const selectedRun = model.runs.find((run) => run.id === state.selectedRunId) || model.runs[0];
    if (!selectedRun) {
      showToast("没有可导出的报告");
      return;
    }

    const compareRun = resolveCompareRun(model, selectedRun);
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      showToast("请允许浏览器弹出新窗口后再导出 PDF");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(buildPrintableReportHtml(selectedRun, compareRun));
    printWindow.document.close();
  }

  return {
    buildReportSummaryPath,
    buildReportInsightsPath,
    clearReportCaseFocus,
    exportReport,
    focusReportCase,
    focusReportGuide,
    openRunReport,
    selectReportRun,
    refreshReportData,
    refreshReportInsights,
    refreshReportSummary,
    renderReportsPage
  };
}
