export function createGovernanceModule(ctx) {
  const {
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
  } = ctx;

  function describePasswordPolicy(policy = {}) {
    const requirements = [];
    if (policy.requireUppercase) {
      requirements.push("大写");
    }
    if (policy.requireLowercase) {
      requirements.push("字母");
    }
    if (policy.requireDigit) {
      requirements.push("数字");
    }
    return requirements.length ? `需${requirements.join("/")}` : "按平台策略执行";
  }

  async function refreshGovernanceSummary() {
    state.governanceSummary = await api("/api/governance/summary");
  }

  async function refreshAuditLogs() {
    const params = new URLSearchParams({ limit: "20" });
    if (state.filters.governance.auditCollection !== "all") {
      params.set("collection", state.filters.governance.auditCollection);
    }
    if (state.filters.governance.auditAction !== "all") {
      params.set("action", state.filters.governance.auditAction);
    }
    if (state.filters.governance.auditDateFrom) {
      params.set("dateFrom", state.filters.governance.auditDateFrom);
    }
    if (state.filters.governance.auditDateTo) {
      params.set("dateTo", state.filters.governance.auditDateTo);
    }
    if (state.filters.governance.auditQuery.trim()) {
      params.set("q", state.filters.governance.auditQuery.trim());
    }
    state.auditLogs = await api(`/api/audit-logs?${params.toString()}`);
  }

  async function refreshVersions() {
    const params = new URLSearchParams({ limit: "20" });
    if (state.filters.governance.versionCollection !== "all") {
      params.set("collection", state.filters.governance.versionCollection);
    }
    if (state.filters.governance.versionQuery.trim()) {
      params.set("q", state.filters.governance.versionQuery.trim());
    }
    state.versions = await api(`/api/versions?${params.toString()}`);
  }

  async function refreshGovernancePageData() {
    await Promise.all([refreshGovernanceSummary(), refreshAuditLogs(), refreshVersions()]);
  }

  function renderUserGovernancePage(model) {
    if (state.auth.user?.role !== "admin") {
      return `<section class="empty-card">只有管理员可以查看和维护用户治理配置。</section>`;
    }

    const governance = state.governanceSummary;
    const activeSessionsByUser = governance?.activeSessionsByUser || {};
    const auditLogs = state.auditLogs ?? governance?.recentAuditLogs ?? [];
    const versions = state.versions ?? governance?.recentVersions ?? [];
    const filters = state.filters.governance;
    const users = (model.users || []).map((user) => ({
      ...user,
      activeSessionCount: activeSessionsByUser[user.id] || 0
    }));

    return `
      <div class="page-stack">
        <section class="summary-grid">
          ${renderStatCard("平台用户", formatNumber(governance?.counts?.users ?? users.length), "账号总数", "primary", svgDoc())}
          ${renderStatCard("在线会话", formatNumber(governance?.counts?.activeSessions ?? 0), "当前登录态", "warning", svgClock())}
          ${renderStatCard("审计日志", formatNumber(governance?.counts?.auditLogs ?? 0), "变更可追溯", "success", svgTrend())}
          ${renderStatCard("密码策略", `>=${governance?.passwordPolicy?.minLength ?? 8}`, describePasswordPolicy(governance?.passwordPolicy), "danger", svgWarning())}
        </section>

        <section class="toolbar">
          <div class="toolbar-left">
            <div class="panel-title">用户治理</div>
          </div>
          <div class="toolbar-right">
            <button class="primary-button" data-action="open-modal" data-modal-type="user">+ 新建用户</button>
          </div>
        </section>

        <section class="panel">
          ${
            users.length
              ? `
                <div class="report-table">
                  <div class="report-table-head governance-table-head">
                    <div>用户</div>
                    <div>账号</div>
                    <div>角色</div>
                    <div>状态</div>
                    <div>在线会话</div>
                    <div>最近登录</div>
                    <div>安全状态</div>
                    <div>操作</div>
                  </div>
                  ${users
                    .map(
                      (user) => `
                        <div class="report-table-row governance-table-row">
                          <div><strong>${escapeHtml(user.name)}</strong></div>
                          <div>${escapeHtml(user.username || "-")}</div>
                          <div><span class="small-pill status-queued">${escapeHtml(String(user.role || "").toUpperCase())}</span></div>
                          <div><span class="small-pill ${user.status === "active" ? "small-success" : "small-failed"}">${escapeHtml(user.status === "active" ? "启用" : "禁用")}</span></div>
                          <div>${escapeHtml(String(user.activeSessionCount))}</div>
                          <div>${escapeHtml(formatDateTime(user.lastLoginAt))}</div>
                          <div>${user.mustChangePassword ? `<span class="small-pill small-warning">待改密</span>` : `<span class="small-pill small-success">正常</span>`}</div>
                          <div class="row-actions governance-actions">
                            <button class="plain-button" data-action="open-modal" data-modal-type="user" data-record-id="${user.id}">编辑</button>
                            <button class="plain-button" data-action="toggle-user-status" data-id="${user.id}" data-status="${user.status === "active" ? "disabled" : "active"}">${user.status === "active" ? "禁用" : "启用"}</button>
                            <button class="plain-button" data-action="revoke-user-sessions" data-id="${user.id}">强制下线</button>
                            <button class="plain-button" data-action="reset-user-password" data-id="${user.id}">重置密码</button>
                          </div>
                        </div>
                      `
                    )
                    .join("")}
                </div>
              `
              : `<div class="empty-card">当前没有用户数据。</div>`
          }
        </section>

        <section class="report-bottom report-bottom-grid">
          <section class="panel panel-compact">
            <div class="panel-title-row">
              <div class="panel-title">审计日志</div>
            </div>
            <div class="toolbar toolbar-compact">
              <div class="toolbar-left">
                ${renderSearchBox("搜索操作人、对象或明细...", filters.auditQuery, "governance", "auditQuery")}
                ${renderSelectControl(
                  rowsOrAllOption(
                    [
                      { value: "users", label: "用户" },
                      { value: "datasets", label: "数据集" },
                      { value: "apis", label: "接口" },
                      { value: "cases", label: "用例" },
                      { value: "suites", label: "场景" },
                      { value: "runs", label: "运行" }
                    ],
                    "全部对象"
                  ),
                  filters.auditCollection,
                  "governance",
                  "auditCollection"
                )}
                ${renderSelectControl(
                  rowsOrAllOption(
                    [
                      { value: "login", label: "登录" },
                      { value: "logout", label: "退出" },
                      { value: "create", label: "创建" },
                      { value: "update", label: "更新" },
                      { value: "delete", label: "删除" },
                      { value: "restore", label: "恢复" },
                      { value: "changePassword", label: "改密" },
                      { value: "resetPassword", label: "重置密码" },
                      { value: "revokeSessions", label: "强制下线" }
                    ],
                    "全部动作"
                  ),
                  filters.auditAction,
                  "governance",
                  "auditAction"
                )}
                ${renderDateInput(filters.auditDateFrom, "governance", "auditDateFrom")}
                ${renderDateInput(filters.auditDateTo, "governance", "auditDateTo")}
              </div>
              <div class="toolbar-right">
                <button class="secondary-button" data-action="export-audit-logs">导出日志</button>
              </div>
            </div>
            ${
              auditLogs.length
                ? `
                  <div class="report-table report-table-compact governance-log-table">
                    <div class="report-table-head">
                      <div>时间</div>
                      <div>动作</div>
                      <div>对象</div>
                    </div>
                    ${auditLogs
                      .map(
                        (log) => `
                          <div class="report-table-row">
                            <div>${escapeHtml(formatDateTime(log.createdAt))}</div>
                            <div><strong>${escapeHtml(log.action)}</strong></div>
                            <div>
                              <button class="plain-button" data-action="view-audit-log" data-id="${log.id}">
                                ${escapeHtml(`${log.actorName} -> ${log.collection || "-"}:${log.entityName || log.entityId || "-"}`)}
                              </button>
                            </div>
                          </div>
                        `
                      )
                      .join("")}
                  </div>
                `
                : `<div class="empty-card">当前没有审计日志。</div>`
            }
          </section>

          <section class="panel panel-compact">
            <div class="panel-title-row">
              <div class="panel-title">版本恢复</div>
            </div>
            <div class="toolbar toolbar-compact">
              <div class="toolbar-left">
                ${renderSearchBox("搜索对象、操作者或快照名...", filters.versionQuery, "governance", "versionQuery")}
                ${renderSelectControl(
                  rowsOrAllOption(
                    [
                      { value: "datasets", label: "数据集" },
                      { value: "apis", label: "接口" },
                      { value: "cases", label: "用例" },
                      { value: "suites", label: "场景" },
                      { value: "environments", label: "环境" },
                      { value: "projects", label: "项目" },
                      { value: "services", label: "服务" },
                      { value: "modules", label: "模块" }
                    ],
                    "全部对象"
                  ),
                  filters.versionCollection,
                  "governance",
                  "versionCollection"
                )}
              </div>
            </div>
            ${
              versions.length
                ? `
                  <div class="report-table report-table-compact governance-version-table">
                    <div class="report-table-head">
                      <div>版本</div>
                      <div>对象</div>
                      <div>操作</div>
                    </div>
                    ${versions
                      .map(
                        (version) => `
                          <div class="report-table-row">
                            <div><strong>r${escapeHtml(String(version.revision || "-"))}</strong></div>
                            <div>
                              <button class="plain-button" data-action="view-version" data-id="${version.id}">
                                ${escapeHtml(`${version.collection}:${version.entityId}`)}
                              </button>
                            </div>
                            <div class="row-actions governance-actions">
                              <span class="small-pill status-queued">${escapeHtml(version.action)}</span>
                              <button class="plain-button" data-action="restore-version" data-id="${version.id}">预览并恢复</button>
                            </div>
                          </div>
                        `
                      )
                      .join("")}
                  </div>
                `
                : `<div class="empty-card">当前没有可恢复的版本记录。</div>`
            }
          </section>
        </section>
      </div>
    `;
  }

  async function toggleUserStatus(userId, nextStatus) {
    const user = state.data?.users?.find((item) => item.id === userId);
    if (!user) {
      showToast("用户不存在");
      return;
    }

    try {
      await api(`/api/users/${userId}`, {
        method: "PUT",
        body: JSON.stringify({
          name: user.name,
          username: user.username,
          role: user.role,
          status: nextStatus,
          mustChangePassword: user.mustChangePassword === true
        })
      });
      showToast(nextStatus === "active" ? "账号已启用" : "账号已禁用");
      await refreshData();
    } catch (error) {
      showToast(error.message);
    }
  }

  async function revokeUserSessions(userId) {
    try {
      const result = await api(`/api/users/${userId}/revoke-sessions`, { method: "POST" });
      showToast(`已强制下线 ${result.revokedCount || 0} 个会话`);
      await refreshGovernanceSummary();
      renderPage();
    } catch (error) {
      showToast(error.message);
    }
  }

  async function resetUserPassword(userId) {
    try {
      const result = await api(`/api/users/${userId}/reset-password`, { method: "POST" });
      openModal("detail", {
        title: "临时密码已生成",
        subtitle: "该密码只展示一次，请通知用户首次登录后立即修改。",
        sections: [
          { label: "用户", content: result.user?.name || userId },
          { label: "临时密码", content: result.temporaryPassword || "" }
        ]
      });
      await refreshData();
    } catch (error) {
      showToast(error.message);
    }
  }

  function openAuditLogDetail(logId) {
    const log = state.auditLogs?.find((item) => item.id === logId) || state.governanceSummary?.recentAuditLogs?.find((item) => item.id === logId);
    if (!log) {
      showToast("审计日志不存在");
      return;
    }

    openModal("detail", {
      title: "审计日志详情",
      subtitle: `${log.action} · ${formatDateTime(log.createdAt)}`,
      sections: [{ label: "基础信息", content: JSON.stringify(log, null, 2) }]
    });
  }

  function openVersionDetail(versionId) {
    const version = state.versions?.find((item) => item.id === versionId) || state.governanceSummary?.recentVersions?.find((item) => item.id === versionId);
    if (!version) {
      showToast("版本记录不存在");
      return;
    }

    openModal("detail", {
      title: "版本详情",
      subtitle: `${version.collection} · r${version.revision || "-"}`,
      sections: [
        { label: "当前快照", content: JSON.stringify(version.snapshot || {}, null, 2) },
        { label: "变更前快照", content: JSON.stringify(version.beforeSnapshot || {}, null, 2) }
      ]
    });
  }

  function diffLinesForVersion(version) {
    const beforeText = JSON.stringify(version.beforeSnapshot || {}, null, 2).split("\n");
    const afterText = JSON.stringify(version.snapshot || {}, null, 2).split("\n");
    const maxLines = Math.max(beforeText.length, afterText.length);
    const rows = [];

    for (let index = 0; index < maxLines; index += 1) {
      const before = beforeText[index] ?? "";
      const after = afterText[index] ?? "";
      if (before === after) {
        continue;
      }
      rows.push(`- ${before}`);
      rows.push(`+ ${after}`);
    }

    return rows.length ? rows.join("\n") : "当前版本与上一快照没有文本差异。";
  }

  async function restoreVersion(versionId) {
    const version = state.versions?.find((item) => item.id === versionId) || state.governanceSummary?.recentVersions?.find((item) => item.id === versionId);
    if (!version) {
      showToast("版本记录不存在");
      return;
    }

    let impact = null;
    try {
      impact = await api(`/api/versions/${version.id}/impact`);
    } catch (error) {
      showToast(`影响分析获取失败: ${error.message}`);
    }

    openModal("detail", {
      title: "恢复版本预览",
      subtitle: `${version.collection} · ${version.entityId} · r${version.revision || "-"}`,
      sections: [
        { label: "变更摘要", content: JSON.stringify({ action: version.action, actorName: version.actorName, createdAt: version.createdAt }, null, 2) },
        { label: "影响提示", content: JSON.stringify(impact || { message: "未获取到影响分析" }, null, 2) },
        { label: "差异预览", content: diffLinesForVersion(version) }
      ],
      actions: `
        <button type="button" class="secondary-button" data-action="close-modal">取消</button>
        <button type="button" class="primary-button" data-action="confirm-restore-version" data-id="${escapeHtml(version.id)}">确认恢复</button>
      `
    });
  }

  async function confirmRestoreVersion(versionId) {
    try {
      await api(`/api/versions/${versionId}/restore`, { method: "POST" });
      openModal(null);
      showToast("版本已恢复");
      await refreshData();
    } catch (error) {
      showToast(error.message);
    }
  }

  async function exportAuditLogs() {
    const params = new URLSearchParams({ limit: "500" });
    if (state.filters.governance.auditCollection !== "all") {
      params.set("collection", state.filters.governance.auditCollection);
    }
    if (state.filters.governance.auditAction !== "all") {
      params.set("action", state.filters.governance.auditAction);
    }
    if (state.filters.governance.auditDateFrom) {
      params.set("dateFrom", state.filters.governance.auditDateFrom);
    }
    if (state.filters.governance.auditDateTo) {
      params.set("dateTo", state.filters.governance.auditDateTo);
    }
    if (state.filters.governance.auditQuery.trim()) {
      params.set("q", state.filters.governance.auditQuery.trim());
    }

    try {
      await triggerAuthenticatedDownload(`/api/audit-logs/export?${params.toString()}`, "audit-logs.csv");
    } catch (error) {
      showToast(error.message);
    }
  }

  return {
    confirmRestoreVersion,
    exportAuditLogs,
    openAuditLogDetail,
    openVersionDetail,
    refreshAuditLogs,
    refreshGovernancePageData,
    refreshGovernanceSummary,
    refreshVersions,
    renderUserGovernancePage,
    resetUserPassword,
    restoreVersion,
    revokeUserSessions,
    toggleUserStatus
  };
}
