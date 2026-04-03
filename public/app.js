import { createAuthModule, readPersistedAuthState } from "./app/auth.js";
import { createCollectionsModule } from "./app/collections.js";
import { createExecutionModule } from "./app/execution.js";
import {
  calcRate,
  calcTrend,
  clientId,
  dateKey,
  escapeHtml,
  formatClock,
  formatDate,
  formatDateTime,
  formatDuration,
  formatNumber,
  inferExecutionStatus,
  inferPriority,
  normalizeEnvSlug,
  parseJson,
  parseJsonOrText,
  priorityText,
  relativeTime,
  statusClassName,
  statusText,
  stringifyFormValue
} from "./app/formatters.js";
import { createGovernanceModule } from "./app/governance.js";
import {
  svgAlert,
  svgArrowDown,
  svgCheck,
  svgCheckOutline,
  svgClock,
  svgCross,
  svgDoc,
  svgFlow,
  svgGear,
  svgGlobe,
  svgPlay,
  svgSearch,
  svgTrash,
  svgTrend,
  svgWarning,
  svgWarningOutline
} from "./app/icons.js";
import { createModalModule } from "./app/modal.js";
import { createReportsModule } from "./app/reports.js";
import {
  fieldInput,
  fieldSelect,
  fieldTextarea,
  renderBarChart,
  renderDateInput,
  renderDonutChart,
  renderFilterButton,
  renderLineChart,
  renderQuickAction,
  renderSearchBox,
  renderSelectControl,
  renderStatCard,
  rowsOrAllOption
} from "./app/ui.js";
import { buildGlobalVariables as buildGlobalVariablesFromModel, buildViewModel as buildViewModelFromState } from "./app/view-model.js";

const pageTitles = {
  overview: "工作台",
  apis: "接口管理",
  cases: "测试用例",
  suites: "场景编排",
  scheduler: "定时调度",
  execution: "执行中心",
  reports: "测试报告",
  envs: "环境管理"
};

const sidebarStorageKey = "flowforge.sidebar.collapsed";
const authTokenStorageKey = "flowforge.auth.token";
const rememberAuthStorageKey = "flowforge.auth.remember";
const persistedAuth = readPersistedAuthState(window, { authTokenStorageKey, rememberAuthStorageKey });

const state = {
  data: null,
  overviewSummary: null,
  reportSummary: null,
  reportInsights: null,
  schedulerCenter: null,
  globalVariables: null,
  governanceSummary: null,
  auditLogs: null,
  versions: null,
  runDetails: {},
  environmentDiagnostics: {},
  auth: {
    token: persistedAuth.token,
    remember: persistedAuth.remember,
    requirePasswordChange: false,
    user: null,
    status: "checking"
  },
  selections: {
    apis: [],
    cases: []
  },
  activeTab: "overview",
  selectedSuiteId: null,
  selectedRunId: null,
  sidebarCollapsed: readSidebarPreference(),
  executionView: "running",
  envTab: "environments",
  starterGuideCompleted: false,
  starterGuideSeen: false,
  starterGuideAutoOpened: false,
  filters: {
    apis: { q: "", moduleId: "all", method: "all" },
    cases: { q: "", priority: "all", status: "all" },
    execution: { q: "", status: "all", datasetRowId: "all" },
    reports: { range: "today", moduleId: "all", primaryRunId: "latest", compareRunId: "none", clusterQuery: "", caseFocusId: "", riskView: "all", guideFocus: "auto" },
    governance: {
      auditQuery: "",
      auditCollection: "all",
      auditAction: "all",
      auditDateFrom: "",
      auditDateTo: "",
      versionQuery: "",
      versionCollection: "all"
    }
  },
  modal: null,
  pendingReturnNavigation: null,
  toastTimer: null,
  pollTimer: null,
  executionLiveTimer: null
};

const pageBody = document.getElementById("pageBody");
const pageTitle = document.getElementById("pageTitle");
const modalRoot = document.getElementById("modalRoot");
const toastRoot = document.getElementById("toastRoot");
const appShell = document.querySelector(".app-shell");
const avatarNode = document.querySelector(".avatar");
const userNameNode = document.querySelector(".user-name");
const changePasswordButtonNode = document.getElementById("changePasswordButton");
const logoutButtonNode = document.getElementById("logoutButton");
let auxiliaryRefreshVersion = 0;
let runRefreshTimer = null;

const authModule = createAuthModule({
  state,
  storage: window,
  api,
  renderApp,
  refreshData,
  showToast,
  avatarNode,
  userNameNode,
  changePasswordButtonNode,
  logoutButtonNode,
  authTokenStorageKey,
  rememberAuthStorageKey
});

const modalModule = createModalModule({
  state,
  modalRoot,
  buildViewModel,
  escapeHtml,
  fieldInput,
  fieldTextarea,
  fieldSelect,
  stringifyFormValue,
  parseJson,
  parseJsonOrText,
  clientId,
  api,
  showToast,
  refreshData,
  isAuthenticated
});

const reportsModule = createReportsModule({
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
  showToast,
  downloadFile: triggerAuthenticatedDownload
});

const governanceModule = createGovernanceModule({
  state,
  api,
  showToast,
  refreshData,
  renderPage,
  openModal,
  triggerAuthenticatedDownload,
  renderStatCard,
  renderSearchBox,
  renderSelectControl,
  rowsOrAllOption,
  renderDateInput,
  formatNumber,
  formatDateTime,
  escapeHtml,
  svgDoc,
  svgClock,
  svgTrend,
  svgWarning
});

const executionModule = createExecutionModule({
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
});

const collectionsModule = createCollectionsModule({
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
  statusClassName,
  relativeTime,
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
  renderLineChart,
  renderPage
});

init().catch((error) => {
  pageBody.innerHTML = `<section class="empty-card">加载失败：${escapeHtml(error.message)}</section>`;
});

async function init() {
  bindEvents();
  renderApp();
  await initializeAuth();
}

function bindEvents() {
  document.addEventListener("click", handleClick);
  document.addEventListener("submit", handleSubmit);
  document.addEventListener("input", handleFilterChange);
  document.addEventListener("change", handleFilterChange);
}

function handleClick(event) {
  const tabButton = event.target.closest("[data-tab]");
  if (tabButton) {
    const nextTab = tabButton.dataset.tab;
    if (nextTab && pageTitles[nextTab]) {
      state.activeTab = nextTab;
      renderApp();
      refreshActiveTabData();
    }
    return;
  }

  const actionNode = event.target.closest("[data-action]");
  if (!actionNode) {
    if (event.target.classList.contains("modal-backdrop")) {
      closeModal();
    }
    return;
  }

  const { action } = actionNode.dataset;

  switch (action) {
    case "close-modal":
      closeModal();
      return;
    case "toggle-sidebar":
      if (!isAuthenticated()) {
        return;
      }
      toggleSidebar();
      return;
    case "logout":
      logout().catch((error) => showToast(error.message));
      return;
    case "open-modal":
      if (actionNode.dataset.modalType === "starter-guide") {
        state.starterGuideSeen = true;
      }
      openModal(actionNode.dataset.modalType, actionNode.dataset);
      return;
    case "start-starter-guide":
      state.starterGuideSeen = true;
      openModal("starter-guide", { guideStep: 1 });
      return;
    case "switch-execution-view":
      state.executionView = actionNode.dataset.value || "running";
      renderPage();
      return;
    case "refresh-scheduler":
      refreshSchedulerCenter({ sync: actionNode.dataset.sync === "true" }).catch((error) => showToast(error.message));
      return;
    case "toggle-scheduler-suite":
      toggleSchedulerSuite(actionNode.dataset.id).catch((error) => showToast(error.message));
      return;
    case "open-scheduler-suite":
      state.selectedSuiteId = actionNode.dataset.id || state.selectedSuiteId;
      state.activeTab = "suites";
      renderApp();
      return;
    case "switch-env-tab":
      state.envTab = actionNode.dataset.value || "environments";
      renderPage();
      refreshActiveTabData();
      return;
    case "run-environment-diagnostics":
      runEnvironmentDiagnostics(actionNode.dataset.envId).catch((error) => showToast(error.message));
      return;
    case "run-environment-auth-smoke":
      runEnvironmentAuthSmoke(actionNode.dataset.envId).catch((error) => showToast(error.message));
      return;
    case "toggle-user-status":
      toggleUserStatus(actionNode.dataset.id, actionNode.dataset.status);
      return;
    case "revoke-user-sessions":
      revokeUserSessions(actionNode.dataset.id);
      return;
    case "reset-user-password":
      resetUserPassword(actionNode.dataset.id);
      return;
    case "restore-version":
      restoreVersion(actionNode.dataset.id);
      return;
    case "confirm-restore-version":
      confirmRestoreVersion(actionNode.dataset.id);
      return;
    case "view-audit-log":
      openAuditLogDetail(actionNode.dataset.id);
      return;
    case "view-version":
      openVersionDetail(actionNode.dataset.id);
      return;
    case "export-audit-logs":
      exportAuditLogs();
      return;
    case "select-suite":
      state.selectedSuiteId = actionNode.dataset.id;
      renderPage();
      return;
    case "select-run":
      state.selectedRunId = actionNode.dataset.id;
      state.activeTab = "reports";
      state.filters.reports.primaryRunId = actionNode.dataset.id || "latest";
      renderApp();
      refreshActiveTabData();
      return;
    case "focus-report-case":
      focusReportCase(actionNode.dataset.caseId);
      return;
    case "focus-report-guide":
      focusReportGuide(actionNode.dataset.guideFocus || "auto");
      return;
    case "set-report-risk-view":
      state.filters.reports.riskView = actionNode.dataset.riskView || "all";
      state.filters.reports.guideFocus = actionNode.dataset.riskView && actionNode.dataset.riskView !== "all" ? "risks" : "auto";
      renderPage();
      return;
    case "clear-report-case-focus":
      clearReportCaseFocus();
      return;
    case "select-report-run":
      selectReportRun(actionNode.dataset.runId);
      return;
    case "select-execution-run":
      selectExecutionRun(actionNode.dataset.runId);
      return;
    case "run-suite":
    case "run-selected-suite":
      runSuite(actionNode.dataset.id || state.selectedSuiteId);
      return;
    case "open-execution-config":
      openExecutionConfig(actionNode.dataset);
      return;
    case "batch-run-cases":
      batchRunCases();
      return;
    case "create-default-case":
      createDefaultCaseForApi(actionNode.dataset.apiId).catch((error) => showToast(error.message));
      return;
    case "open-scene-builder-from-apis":
      openSceneBuilderFromApis(actionNode.dataset.apiId ? [actionNode.dataset.apiId] : []).catch((error) => showToast(error.message));
      return;
    case "batch-add-cases-to-suite":
      batchAddCasesToSuite();
      return;
    case "add-case-to-suite":
      addCaseToSuite(actionNode.dataset.caseId).catch((error) => showToast(error.message));
      return;
    case "run-case":
      runCase(actionNode.dataset.caseId);
      return;
    case "batch-clone-records":
      batchCloneRecords(actionNode.dataset.collection);
      return;
    case "batch-delete-records":
      batchDeleteRecords(actionNode.dataset.collection);
      return;
    case "quick-nav":
      state.activeTab = actionNode.dataset.target || "overview";
      renderApp();
      refreshActiveTabData();
      return;
    case "save-suite-config":
      saveSuiteConfig();
      return;
    case "task-control":
      document.getElementById("suiteConfigForm")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    case "delete-step":
      deleteSuiteStep(actionNode.dataset.stepId);
      return;
    case "move-step":
      moveSuiteStep(actionNode.dataset.stepId, actionNode.dataset.direction);
      return;
    case "toggle-step-enabled":
      toggleSuiteStepEnabled(actionNode.dataset.stepId);
      return;
    case "toggle-selection":
      toggleSelection(actionNode.dataset.collection, actionNode.dataset.id);
      return;
    case "toggle-all-selection":
      toggleAllSelection(actionNode.dataset.collection);
      return;
    case "view-step-log":
      openStepLog(actionNode.dataset.runId, actionNode.dataset.stepId).catch((error) => showToast(error.message));
      return;
    case "view-run-variables":
      openRunVariables(actionNode.dataset.runId).catch((error) => showToast(error.message));
      return;
    case "open-report-case":
      openRunReport(actionNode.dataset.runId, {
        caseId: actionNode.dataset.caseId || "",
        riskView: actionNode.dataset.riskView || "all"
      });
      return;
    case "view-run-report":
      openRunReport(actionNode.dataset.runId);
      return;
    case "view-record":
      openRecordDetail(actionNode.dataset.collection, actionNode.dataset.id);
      return;
    case "clone-record":
      cloneRecord(actionNode.dataset.collection, actionNode.dataset.id);
      return;
    case "delete-record":
      deleteRecord(actionNode.dataset.collection, actionNode.dataset.id);
      return;
    case "cancel-run":
      cancelRun(actionNode.dataset.runId);
      return;
    case "retry-run":
      retryRun(actionNode.dataset.runId);
      return;
    case "retry-failed-run":
      retryFailedRun(actionNode.dataset.runId);
      return;
    case "export-report":
      exportReport(actionNode.dataset.format || "excel");
      return;
    case "toggle-bell":
      showToast("当前为前端演示控制，实际调度能力后续可接入。");
      return;
    default:
      if (handleModalAction(action, actionNode)) {
        return;
      }
      return;
  }
}

function handleFilterChange(event) {
  const node = event.target;
  if (handleModalFieldChange(node)) {
    return;
  }
  const page = node.dataset.filterPage;
  const key = node.dataset.filterKey;
  if (!page || !key || !state.filters[page]) {
    return;
  }

  state.filters[page][key] = node.value;
  if (page === "reports") {
    if (key === "primaryRunId") {
      state.selectedRunId = node.value && node.value !== "latest" ? node.value : state.data?.runs?.[0]?.id || null;
      if (state.filters.reports.compareRunId === state.selectedRunId) {
        state.filters.reports.compareRunId = "none";
      }
    }
    if (key === "compareRunId" && node.value === state.selectedRunId) {
      state.filters.reports.compareRunId = "none";
    }
    refreshReportData().catch((error) => showToast(error.message));
    renderPage();
    return;
  }
  if (page === "governance") {
    refreshGovernancePageData().catch((error) => showToast(error.message));
    renderPage();
    return;
  }
  renderPage();
}

async function handleSubmit(event) {
  const form = event.target;
  if (form?.dataset?.authForm === "login") {
    event.preventDefault();
    await submitLoginForm(new FormData(form));
    return;
  }

  if (form?.dataset?.schedulerForm) {
    event.preventDefault();
    await submitSchedulerForm(form.dataset.schedulerForm, new FormData(form));
    return;
  }

  const modalType = form.dataset.modalType;
  if (!modalType) {
    return;
  }

  event.preventDefault();

  try {
    const result = await submitModalForm(modalType, new FormData(form));
    closeModal(true);
    if (result?.clearCaseSelection) {
      state.selections.cases = [];
    }
    if (result?.returnNavigation) {
      state.pendingReturnNavigation = result.returnNavigation;
    }
    if (result?.run) {
      executionModule.activateRun(result.run, result.successMessage || "");
      return;
    }
    await refreshData();
  } catch (error) {
    showToast(error.message);
  }
}

function openExecutionConfig(data = {}) {
  const sourceType = data.sourceType === "batch-cases" ? "batch-cases" : "suite";
  if (sourceType === "batch-cases" && !state.selections.cases.length) {
    showToast("请先勾选要执行的用例");
    return;
  }

  const suiteId = data.suiteId || state.selectedSuiteId || state.data?.suites?.[0]?.id || "";
  if (sourceType === "suite" && !suiteId) {
    showToast("请先创建一个场景");
    return;
  }

  openModal("execution-config", {
    sourceType,
    suiteId,
    caseIds: sourceType === "batch-cases" ? [...state.selections.cases] : []
  });
}

async function api(path, options = {}) {
  const authHeaders = !options.public && state.auth?.token ? { "x-session-token": state.auth.token } : {};
  const response = await fetch(path, {
    headers: {
      ...authHeaders,
      "content-type": "application/json",
      ...(options.headers ?? {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !options.public) {
      clearAuthState();
      renderApp();
    }
    throw new Error(payload.error || "请求失败");
  }

  return payload;
}

function isAuthenticated() {
  return authModule.isAuthenticated();
}

function persistAuthToken(token, remember = true) {
  return authModule.persistAuthToken(token, remember);
}

async function initializeAuth() {
  return authModule.initializeAuth();
}

function clearAuthState() {
  return authModule.clearAuthState();
}

async function submitLoginForm(formData) {
  return authModule.submitLoginForm(formData);
}

async function logout() {
  return authModule.logout();
}

function buildReportSummaryPath() {
  return reportsModule.buildReportSummaryPath();
}

async function refreshOverviewSummary() {
  state.overviewSummary = await api("/api/overview");
}

async function refreshGlobalVariables() {
  state.globalVariables = await api("/api/globals");
}

async function refreshSchedulerCenter({ sync = false } = {}) {
  state.schedulerCenter = sync ? await api("/api/scheduler/refresh", { method: "POST" }) : await api("/api/scheduler");
  renderPage();
  if (sync) {
    showToast("调度计划已同步");
  }
}

async function refreshGovernanceSummary() {
  return governanceModule.refreshGovernanceSummary();
}

async function refreshAuditLogs() {
  return governanceModule.refreshAuditLogs();
}

async function refreshVersions() {
  return governanceModule.refreshVersions();
}

async function refreshReportSummary() {
  return reportsModule.refreshReportSummary();
}

async function refreshReportInsights() {
  return reportsModule.refreshReportInsights();
}

async function refreshReportData() {
  return reportsModule.refreshReportData();
}

function selectReportRun(runId) {
  return reportsModule.selectReportRun(runId);
}

function focusReportCase(caseId) {
  return reportsModule.focusReportCase(caseId);
}

function clearReportCaseFocus() {
  return reportsModule.clearReportCaseFocus();
}

function focusReportGuide(guideFocus) {
  return reportsModule.focusReportGuide(guideFocus);
}

async function refreshGovernancePageData() {
  return governanceModule.refreshGovernancePageData();
}

function runSortKey(run) {
  return run?.queuedAt || run?.startedAt || run?.createdAt || "";
}

function syncRunsState(runs) {
  const validRunIds = new Set((runs || []).map((run) => run.id));
  state.runDetails = Object.fromEntries(
    Object.entries(state.runDetails).filter(([runId]) => validRunIds.has(runId))
  );
  state.selectedRunId ||= runs[0]?.id ?? null;

  if (state.selectedRunId && !runs.some((run) => run.id === state.selectedRunId)) {
    state.selectedRunId = runs[0]?.id ?? null;
  }
  if (state.filters.reports.primaryRunId !== "latest" && !runs.some((run) => run.id === state.filters.reports.primaryRunId)) {
    state.filters.reports.primaryRunId = "latest";
  }
  if (state.filters.reports.compareRunId !== "none" && !runs.some((run) => run.id === state.filters.reports.compareRunId)) {
    state.filters.reports.compareRunId = "none";
  }

  if (!state.data) {
    return;
  }

  state.data = {
    ...state.data,
    runs,
    queue: {
      ...(state.data.queue ?? {}),
      running: runs.filter((run) => run.status === "running").length,
      queued: runs.filter((run) => run.status === "queued").length
    }
  };
}

function upsertRunState(run) {
  if (!state.data || !run) {
    return;
  }

  const runs = [run, ...state.data.runs.filter((item) => item.id !== run.id)].sort((left, right) =>
    runSortKey(right).localeCompare(runSortKey(left))
  );
  syncRunsState(runs);
}

async function refreshData() {
  state.data = await api("/api/bootstrap");
  state.starterGuideCompleted = modalModule.readStarterGuideCompleted();
  state.starterGuideSeen = modalModule.readStarterGuideSeen();
  state.environmentDiagnostics = Object.fromEntries(
    Object.entries(state.environmentDiagnostics || {}).filter(([envId]) => state.data.environments.some((item) => item.id === envId))
  );
  state.selections.apis = state.selections.apis.filter((id) => state.data.apis.some((item) => item.id === id));
  state.selections.cases = state.selections.cases.filter((id) => state.data.cases.some((item) => item.id === id));
  state.selectedSuiteId ||= state.data.suites[0]?.id ?? null;

  if (state.selectedSuiteId && !state.data.suites.some((suite) => suite.id === state.selectedSuiteId)) {
    state.selectedSuiteId = state.data.suites[0]?.id ?? null;
  }

  syncRunsState(state.data.runs || []);
  applyPendingReturnNavigationState();
  renderApp();
  focusPendingReturnNavigation();
  ensureForcedPasswordChangeModal();
  maybeAutoOpenStarterGuide();
  ensurePolling();
  refreshActiveTabData();
}

function maybeAutoOpenStarterGuide() {
  if (
    !isAuthenticated() ||
    state.starterGuideCompleted ||
    state.starterGuideSeen ||
    state.starterGuideAutoOpened ||
    state.modal
  ) {
    return;
  }

  state.starterGuideAutoOpened = true;
  modalModule.markStarterGuideSeen();
  state.starterGuideSeen = true;
  openModal("starter-guide", { guideStep: 1 });
}

async function refreshRuns() {
  if (!state.data) {
    return;
  }

  const runs = await api("/api/runs");
  syncRunsState(runs);
  renderApp();
  ensurePolling();
  refreshActiveTabData();
}

function scheduleRunRefresh(delay = 120) {
  if (runRefreshTimer) {
    clearTimeout(runRefreshTimer);
  }

  runRefreshTimer = setTimeout(() => {
    runRefreshTimer = null;
    refreshRuns().catch(() => {
      // Let polling or later actions recover.
    });
  }, delay);
}

function refreshActiveTabData() {
  if (!state.data) {
    return;
  }

  const tasks = [];
  if (state.activeTab === "overview") {
    tasks.push(refreshOverviewSummary());
  }
  if (state.activeTab === "execution" && state.selectedRunId) {
    tasks.push(refreshSelectedRunDetail(state.selectedRunId));
  }
  if (state.activeTab === "reports") {
    tasks.push(refreshReportData());
  }
  if (state.activeTab === "scheduler") {
    tasks.push(refreshSchedulerCenter());
  }
  if (state.activeTab === "envs" && state.envTab === "globals") {
    tasks.push(refreshGlobalVariables());
  }
  if (state.activeTab === "envs" && state.envTab === "users" && state.auth.user?.role === "admin") {
    tasks.push(refreshGovernancePageData());
  }
  if (!tasks.length) {
    return;
  }

  const currentVersion = ++auxiliaryRefreshVersion;
  Promise.allSettled(tasks).then(() => {
    if (currentVersion !== auxiliaryRefreshVersion) {
      return;
    }
    renderPage();
  });
}

function hasActiveRuns() {
  return Boolean(state.data?.runs?.some((run) => run.status === "queued" || run.status === "running"));
}

function shouldRunExecutionLiveTicker() {
  return isAuthenticated() && state.activeTab === "execution" && hasActiveRuns();
}

function ensureExecutionLiveTicker() {
  if (state.executionLiveTimer) {
    clearInterval(state.executionLiveTimer);
    state.executionLiveTimer = null;
  }

  if (!shouldRunExecutionLiveTicker()) {
    return;
  }

  state.executionLiveTimer = setInterval(() => {
    if (!shouldRunExecutionLiveTicker()) {
      clearInterval(state.executionLiveTimer);
      state.executionLiveTimer = null;
      return;
    }
    renderPage();
  }, 1000);
}

function ensurePolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  if (!hasActiveRuns()) {
    return;
  }

  state.pollTimer = setInterval(async () => {
    try {
      await refreshRuns();
    } catch {
      // Let the next polling cycle retry.
    }
  }, 1000);
}

function renderApp() {
  document.body.classList.toggle("auth-mode", !isAuthenticated());
  if (appShell) {
    appShell.classList.toggle("auth-shell", !isAuthenticated());
  }
  updateSidebarState();
  updateNavigation();
  renderUserBadge();
  renderPage();
  renderModal();
  ensureExecutionLiveTicker();
}

function applyPendingReturnNavigationState() {
  const navigation = state.pendingReturnNavigation;
  if (!navigation || !state.data) {
    return;
  }

  if (navigation.tab === "reports") {
    const run = state.data.runs.find((item) => item.id === navigation.runId) || state.data.runs[0] || null;
    if (run) {
      state.selectedRunId = run.id;
      state.filters.reports.primaryRunId = run.id;
      if (state.filters.reports.compareRunId === run.id) {
        state.filters.reports.compareRunId = "none";
      }
    }
    state.activeTab = "reports";
    state.filters.reports.caseFocusId = navigation.guideFocus === "history" ? navigation.caseId || "" : "";
    state.filters.reports.guideFocus = navigation.guideFocus || (navigation.caseId ? "history" : "auto");
    state.filters.reports.riskView = navigation.riskView || "all";
    return;
  }

  if (navigation.tab === "execution") {
    const run = state.data.runs.find((item) => item.id === navigation.runId) || state.data.runs[0] || null;
    if (run) {
      state.selectedRunId = run.id;
      state.executionView = run.status === "queued" ? "queued" : run.status === "running" ? "running" : "history";
    }
    state.activeTab = "execution";
  }
}

function focusPendingReturnNavigation() {
  const navigation = state.pendingReturnNavigation;
  if (!navigation) {
    return;
  }

  if ((navigation.tab === "reports" && state.activeTab !== "reports") || (navigation.tab === "execution" && state.activeTab !== "execution")) {
    return;
  }

  let target = navigation.anchor ? document.querySelector(`[data-return-anchor="${navigation.anchor}"]`) : null;

  if (!target && navigation.tab === "reports") {
    const sectionId =
      navigation.guideFocus === "history"
        ? "report-guide-history"
        : navigation.guideFocus === "risks"
          ? "report-guide-risks"
          : "report-guide-failures";
    target = document.getElementById(sectionId) || document.querySelector(".report-focus-panel");
  }

  if (!target && navigation.tab === "execution") {
    target =
      (navigation.stepId && document.querySelector(`[data-step-row-id="${navigation.stepId}"]`)) ||
      document.querySelector(".execution-detail-panel");
  }

  if (!target) {
    return;
  }

  state.pendingReturnNavigation = null;
  requestAnimationFrame(() => {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("return-focus-target");
    window.setTimeout(() => target.classList.remove("return-focus-target"), 2200);
  });
}

function updateSidebarState() {
  const shell = document.querySelector(".app-shell");
  const collapseLabel = document.querySelector(".collapse-label");
  if (!shell) {
    return;
  }

  shell.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  if (collapseLabel) {
    collapseLabel.textContent = state.sidebarCollapsed ? "展开" : "收起";
  }
}

function updateNavigation() {
  if (!isAuthenticated()) {
    pageTitle.textContent = "";
    return;
  }
  document.querySelectorAll(".nav-item").forEach((node) => {
    node.classList.toggle("active", node.dataset.tab === state.activeTab);
  });
  pageTitle.textContent = pageTitles[state.activeTab];
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  try {
    window.localStorage.setItem(sidebarStorageKey, state.sidebarCollapsed ? "1" : "0");
  } catch {}
  updateSidebarState();
}

function readSidebarPreference() {
  try {
    return window.localStorage.getItem(sidebarStorageKey) === "1";
  } catch {
    return false;
  }
}

function renderUserBadge() {
  return authModule.renderUserBadge();
}

function renderPage() {
  if (state.auth.status === "checking") {
    pageBody.innerHTML = `<section class="empty-card">正在验证登录状态...</section>`;
    return;
  }

  if (!isAuthenticated()) {
    pageBody.innerHTML = renderLoginPage();
    return;
  }

  if (!state.data) {
    pageBody.innerHTML = `<section class="empty-card">正在加载数据...</section>`;
    return;
  }

  switch (state.activeTab) {
    case "overview":
      pageBody.innerHTML = renderOverviewPage();
      break;
    case "apis":
      pageBody.innerHTML = renderApisPage();
      break;
    case "cases":
      pageBody.innerHTML = renderCasesPage();
      break;
    case "suites":
      pageBody.innerHTML = renderSuitesPage();
      break;
    case "scheduler":
      pageBody.innerHTML = renderSchedulerPage();
      break;
    case "execution":
      pageBody.innerHTML = renderExecutionPage();
      break;
    case "reports":
      pageBody.innerHTML = renderReportsPage();
      break;
    case "envs":
      pageBody.innerHTML = renderEnvsPage();
      break;
    default:
      pageBody.innerHTML = `<section class="empty-card">未知页面。</section>`;
  }

  if (state.activeTab === "envs") {
    collectionsModule.syncEnvironmentDiagnosticsFocus();
  }
  focusPendingReturnNavigation();
}

function renderLoginPage() {
  return authModule.renderLoginPage();
}

function renderOverviewPage() {
  return collectionsModule.renderOverviewPage();
}

function renderApisPage() {
  return collectionsModule.renderApisPage();
}

function renderCasesPage() {
  return collectionsModule.renderCasesPage();
}

function renderSuitesPage() {
  return collectionsModule.renderSuitesPage();
}

function renderSchedulerPage() {
  return collectionsModule.renderSchedulerPage();
}

function renderExecutionPage() {
  return executionModule.renderExecutionPage();
}

function renderReportsPage() {
  return reportsModule.renderReportsPage();
}

function renderEnvsPage() {
  return collectionsModule.renderEnvsPage();
}

function renderUserGovernancePage(model) {
  return governanceModule.renderUserGovernancePage(model);
}

function isSelected(collection, id) {
  return collectionsModule.isSelected(collection, id);
}

function toggleSelection(collection, id) {
  return collectionsModule.toggleSelection(collection, id);
}

function toggleAllSelection(collection) {
  return collectionsModule.toggleAllSelection(collection);
}

function renderSelectionCheckbox(config) {
  return collectionsModule.renderSelectionCheckbox(config);
}

function selectedCount(collection) {
  return collectionsModule.selectedCount(collection);
}

async function submitSchedulerForm(suiteId, formData) {
  return collectionsModule.submitSchedulerForm(suiteId, formData);
}

async function toggleSchedulerSuite(suiteId) {
  return collectionsModule.toggleSchedulerSuite(suiteId);
}

function renderCountedButtonText(label, count) {
  return collectionsModule.renderCountedButtonText(label, count);
}

function filterApiRows(model) {
  return collectionsModule.filterApiRows(model);
}

function filterCaseRows(model) {
  return collectionsModule.filterCaseRows(model);
}

function openModal(type, data = {}) {
  return modalModule.openModal(type, data);
}

function closeModal(force = false) {
  return modalModule.closeModal(force);
}

function ensureForcedPasswordChangeModal() {
  return modalModule.ensureForcedPasswordChangeModal();
}

function renderModal() {
  return modalModule.renderModal();
}

function handleModalAction(action, actionNode) {
  return modalModule.handleModalAction(action, actionNode);
}

function handleModalFieldChange(target) {
  return modalModule.handleModalFieldChange(target);
}

async function submitModalForm(type, formData) {
  return modalModule.submitModalForm(type, formData);
}

async function saveSuiteConfig() {
  return modalModule.saveSuiteConfig();
}

async function deleteSuiteStep(stepId) {
  return modalModule.deleteSuiteStep(stepId);
}

async function moveSuiteStep(stepId, direction) {
  return modalModule.moveSuiteStep(stepId, direction);
}

async function toggleSuiteStepEnabled(stepId) {
  return modalModule.toggleSuiteStepEnabled(stepId);
}

async function batchAddCasesToSuite() {
  return modalModule.batchAddCasesToSuite();
}

async function addCaseToSuite(caseId) {
  return modalModule.addCaseToSuite(caseId);
}

async function createDefaultCaseForApi(apiId) {
  return modalModule.createDefaultCaseForApi(apiId);
}

async function openSceneBuilderFromApis(apiIds = []) {
  return modalModule.openSceneBuilderFromApis(apiIds);
}

function runCase(caseId) {
  return modalModule.runCase(caseId);
}

async function batchRunCases() {
  return executionModule.batchRunCases();
}

async function batchCloneRecords(collection) {
  return collectionsModule.batchCloneRecords(collection);
}

async function batchDeleteRecords(collection) {
  return collectionsModule.batchDeleteRecords(collection);
}

async function runEnvironmentDiagnostics(envId) {
  return collectionsModule.runEnvironmentDiagnostics(envId);
}

async function runEnvironmentAuthSmoke(envId) {
  return collectionsModule.runEnvironmentAuthSmoke(envId);
}

async function toggleUserStatus(userId, nextStatus) {
  return governanceModule.toggleUserStatus(userId, nextStatus);
}

async function revokeUserSessions(userId) {
  return governanceModule.revokeUserSessions(userId);
}

async function resetUserPassword(userId) {
  return governanceModule.resetUserPassword(userId);
}

function openAuditLogDetail(logId) {
  return governanceModule.openAuditLogDetail(logId);
}

function openVersionDetail(versionId) {
  return governanceModule.openVersionDetail(versionId);
}

async function restoreVersion(versionId) {
  return governanceModule.restoreVersion(versionId);
}

async function confirmRestoreVersion(versionId) {
  return governanceModule.confirmRestoreVersion(versionId);
}

async function exportAuditLogs() {
  return governanceModule.exportAuditLogs();
}

async function runSuite(suiteId) {
  return executionModule.runSuite(suiteId);
}

async function cancelRun(runId) {
  return executionModule.cancelRun(runId);
}

async function retryRun(runId) {
  return executionModule.retryRun(runId);
}

async function retryFailedRun(runId) {
  return executionModule.retryFailedRun(runId);
}

async function ensureRunDetail(runId) {
  return executionModule.ensureRunDetail(runId);
}

async function openStepLog(runId, stepId) {
  return executionModule.openStepLog(runId, stepId);
}

async function openRunVariables(runId) {
  return executionModule.openRunVariables(runId);
}

async function refreshSelectedRunDetail(runId) {
  return executionModule.refreshSelectedRunDetail(runId);
}

async function selectExecutionRun(runId) {
  return executionModule.selectExecutionRun(runId);
}

function openRecordDetail(collection, id) {
  return modalModule.openRecordDetail(collection, id);
}

async function cloneRecord(collection, id) {
  return modalModule.cloneRecord(collection, id);
}

async function deleteRecord(collection, id) {
  return modalModule.deleteRecord(collection, id);
}

function openRunReport(runId, options) {
  return reportsModule.openRunReport(runId, options);
}

function exportReport(format) {
  return reportsModule.exportReport(format);
}

async function triggerAuthenticatedDownload(url, fallbackFilename) {
  const response = await fetch(url, {
    headers: state.auth?.token ? { "x-session-token": state.auth.token } : {}
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "下载失败");
  }

  const blob = await response.blob();
  const downloadUrl = URL.createObjectURL(blob);
  const disposition = response.headers.get("content-disposition") || "";
  const matchedName = disposition.match(/filename=\"([^\"]+)\"/);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = matchedName?.[1] || fallbackFilename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(downloadUrl);
}

function showToast(message) {
  toastRoot.innerHTML = `<div class="toast">${escapeHtml(message)}</div>`;
  clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => {
    toastRoot.innerHTML = "";
  }, 2400);
}

function buildViewModel() {
  return buildViewModelFromState(state, {
    inferPriority,
    inferExecutionStatus,
    priorityText,
    normalizeEnvSlug
  });
}

function buildExecutionTasks(model) {
  return executionModule.buildExecutionTasks(model);
}

function buildTrendSeries(runs, days) {
  const labels = [];
  const passed = [];
  const failed = [];
  const counts = new Map();

  runs.forEach((run) => {
    const key = dateKey(run.finishedAt || run.startedAt);
    if (!counts.has(key)) {
      counts.set(key, { passed: 0, failed: 0 });
    }
    const item = counts.get(key);
    item.passed += run.summary.passed;
    item.failed += run.summary.failed;
  });

  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - index);
    const key = dateKey(date.toISOString());
    const point = counts.get(key) || { passed: 0, failed: 0 };
    labels.push(key.slice(5));
    passed.push(point.passed);
    failed.push(point.failed);
  }

  if (passed.every((value) => value === 0) && failed.every((value) => value === 0) && runs[0]) {
    passed[passed.length - 1] = runs[0].summary.passed;
    failed[failed.length - 1] = runs[0].summary.failed;
  }

  return { labels, passed, failed };
}

function buildModuleStats(model) {
  const moduleMap = new Map(model.modules.map((item) => [item.id, { name: item.name, passed: 0, failed: 0 }]));
  const apiMap = new Map(model.apis.map((item) => [item.id, item]));
  const caseMap = new Map(model.cases.map((item) => [item.id, item]));

  model.runs.forEach((run) => {
    run.steps.forEach((step) => {
      const caseEntity = caseMap.get(step.caseId);
      const apiEntity = apiMap.get(caseEntity?.apiId);
      const moduleId = apiEntity?.moduleId;
      const target = moduleMap.get(moduleId);
      if (!target) {
        return;
      }
      target[step.status === "failed" ? "failed" : "passed"] += 1;
    });
  });

  return [...moduleMap.values()];
}

function buildFailedRows(model, selectedRun) {
  const runList = selectedRun ? [selectedRun, ...model.runs.filter((item) => item.id !== selectedRun.id)] : model.runs;
  const apiMap = new Map(model.apis.map((item) => [item.id, item]));
  const caseMap = new Map(model.cases.map((item) => [item.id, item]));
  const rows = new Map();

  runList.forEach((run) => {
    run.steps
      .filter((step) => step.status === "failed")
      .forEach((step) => {
        const caseEntity = caseMap.get(step.caseId);
        if (!caseEntity) {
          return;
        }
        const apiEntity = apiMap.get(caseEntity.apiId);
        const key = `${run.id}:${step.caseId}`;
        if (!rows.has(key)) {
          rows.set(key, {
            runId: run.id,
            stepId: step.id,
            displayId: model.cases.find((item) => item.id === step.caseId)?.displayId || step.caseId,
            caseName: step.caseName,
            moduleName: model.modules.find((module) => module.id === apiEntity?.moduleId)?.name || "未知模块",
            error: step.message || step.assertions?.find((assertion) => !assertion.passed)?.message || "断言失败",
            count: 0,
            lastFailedAt: step.finishedAt
          });
        }
        rows.get(key).count += 1;
      });
  });

  return [...rows.values()].slice(0, 8);
}

function buildGlobalVariables(model) {
  return buildGlobalVariablesFromModel(model);
}
