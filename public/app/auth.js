export function readPersistedAuthState(storage, { authTokenStorageKey, rememberAuthStorageKey }) {
  try {
    const remembered = storage.localStorage.getItem(rememberAuthStorageKey) !== "0";
    const rememberedToken = storage.localStorage.getItem(authTokenStorageKey);
    if (rememberedToken && String(rememberedToken).trim()) {
      return { token: String(rememberedToken), remember: true };
    }

    const sessionToken = storage.sessionStorage.getItem(authTokenStorageKey);
    if (sessionToken && String(sessionToken).trim()) {
      return { token: String(sessionToken), remember: false };
    }

    return {
      token: null,
      remember: remembered
    };
  } catch {
    return { token: null, remember: true };
  }
}

export function createAuthModule(ctx) {
  const {
    state,
    storage,
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
  } = ctx;

  function persistAuthToken(token, remember = true) {
    try {
      storage.localStorage.setItem(rememberAuthStorageKey, remember ? "1" : "0");
      storage.localStorage.removeItem(authTokenStorageKey);
      storage.sessionStorage.removeItem(authTokenStorageKey);
      if (!token) {
        return;
      }
      if (remember) {
        storage.localStorage.setItem(authTokenStorageKey, token);
      } else {
        storage.sessionStorage.setItem(authTokenStorageKey, token);
      }
    } catch {}
  }

  function isAuthenticated() {
    return state.auth.status === "authenticated";
  }

  function clearAuthState() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
    if (state.executionLiveTimer) {
      clearInterval(state.executionLiveTimer);
      state.executionLiveTimer = null;
    }

    state.auth = {
      token: null,
      remember: state.auth?.remember ?? true,
      requirePasswordChange: false,
      user: null,
      status: "unauthenticated"
    };
    state.data = null;
    state.overviewSummary = null;
    state.reportSummary = null;
    state.globalVariables = null;
    state.governanceSummary = null;
    state.auditLogs = null;
    state.versions = null;
    state.runDetails = {};
    persistAuthToken(null, state.auth.remember);
  }

  async function initializeAuth() {
    if (!state.auth.token) {
      state.auth.status = "unauthenticated";
      renderApp();
      return;
    }

    try {
      const payload = await api("/api/auth/me");
      state.auth.user = payload.user;
      state.auth.token = payload.token;
      state.auth.remember = payload.remember ?? state.auth.remember;
      state.auth.requirePasswordChange = payload.user?.mustChangePassword === true;
      state.auth.status = "authenticated";
      persistAuthToken(payload.token, state.auth.remember);
      await refreshData();
    } catch {
      clearAuthState();
      renderApp();
    }
  }

  async function submitLoginForm(formData) {
    try {
      const remember = formData.get("remember") === "on";
      state.auth.remember = remember;
      const payload = await api("/api/auth/login", {
        method: "POST",
        public: true,
        body: JSON.stringify({
          username: String(formData.get("username") || "").trim(),
          password: String(formData.get("password") || ""),
          remember
        })
      });

      state.auth = {
        token: payload.token,
        remember: payload.remember ?? remember,
        requirePasswordChange: payload.user?.mustChangePassword === true,
        user: payload.user,
        status: "authenticated"
      };
      persistAuthToken(payload.token, state.auth.remember);
      await refreshData();
      showToast(`欢迎回来，${payload.user.name}`);
    } catch (error) {
      showToast(error.message);
      renderApp();
    }
  }

  async function logout() {
    try {
      if (state.auth.token) {
        await api("/api/auth/logout", { method: "POST" });
      }
    } catch {}

    clearAuthState();
    renderApp();
  }

  function renderLoginPage() {
    return `
      <section class="login-shell">
        <div class="login-panel">
          <div class="login-copy">
            <span class="login-eyebrow">FlowForge API Lab</span>
            <div class="login-copy-head">
              <h2>自动化测试平台</h2>
              <p>统一管理接口资产、用例编排、执行调度和测试报告，登录后直接进入工作区。</p>
            </div>
            <div class="login-visual-grid">
              <article class="login-role-card accent-violet">
                <div class="login-role-figure">
                  <span class="login-role-eye"></span>
                  <span class="login-role-eye"></span>
                </div>
                <strong>平台管理员</strong>
                <span>用户治理 / 版本恢复</span>
              </article>
              <article class="login-role-card accent-ink">
                <div class="login-role-figure">
                  <span class="login-role-eye"></span>
                  <span class="login-role-eye"></span>
                </div>
                <strong>测试开发</strong>
                <span>接口编排 / 数据驱动</span>
              </article>
              <article class="login-role-card accent-orange">
                <div class="login-role-figure">
                  <span class="login-role-eye"></span>
                  <span class="login-role-eye"></span>
                </div>
                <strong>业务只读</strong>
                <span>报告查看 / 结果追踪</span>
              </article>
              <article class="login-role-card accent-gold">
                <div class="login-role-figure pentagon">
                  <span class="login-role-eye"></span>
                  <span class="login-role-eye"></span>
                </div>
                <strong>执行中枢</strong>
                <span>调度 / 洞察 / 风险提示</span>
              </article>
            </div>
            <div class="login-feature-strip">

            </div>
            <div class="login-side-note">
              演示账号：
              管理员 <strong>admin / admin123</strong>，测试开发 <strong>editor / editor123</strong>，业务只读 <strong>viewer / viewer123</strong>。
            </div>
          </div>
          <form class="login-form" data-auth-form="login">
            <div class="login-form-head">
              <div class="login-form-copy">
                <strong>账号登录</strong>
                <span>请输入用户名和密码</span>
              </div>
              <span class="login-security-pill">${state.auth.remember ? "默认记住登录" : "本次仅会话有效"}</span>
            </div>
            <label class="form-field">
              <span>账号</span>
              <input name="username" type="text" placeholder="请输入账号" autocomplete="username" required />
            </label>
            <label class="form-field">
              <span>密码</span>
              <input name="password" type="password" placeholder="请输入密码" autocomplete="current-password" required />
            </label>
            <label class="login-check">
              <input name="remember" type="checkbox" ${state.auth.remember ? "checked" : ""} />
              <span>记住登录</span>
            </label>
            <div class="login-form-footer">
              <span>首次登录后可在右上角修改密码。</span>
            </div>
            <button class="primary-button login-submit" type="submit">登录并进入系统</button>
          </form>
        </div>
      </section>
    `;
  }

  function renderUserBadge() {
    const user = state.auth.user || state.data?.currentUser;
    if (!user) {
      if (avatarNode) {
        avatarNode.textContent = "QA";
      }
      if (userNameNode) {
        userNameNode.textContent = "未登录";
      }
      if (changePasswordButtonNode) {
        changePasswordButtonNode.hidden = true;
      }
      if (logoutButtonNode) {
        logoutButtonNode.hidden = true;
      }
      return;
    }

    if (avatarNode) {
      const roleMark = { admin: "AD", editor: "ED", viewer: "VW" }[user.role] || "QA";
      avatarNode.textContent = roleMark;
    }

    if (userNameNode) {
      userNameNode.textContent = `${user.name} · ${String(user.role || "").toUpperCase()}`;
    }

    if (changePasswordButtonNode) {
      changePasswordButtonNode.hidden = !isAuthenticated();
    }

    if (logoutButtonNode) {
      logoutButtonNode.hidden = !isAuthenticated();
    }
  }

  return {
    clearAuthState,
    initializeAuth,
    isAuthenticated,
    logout,
    persistAuthToken,
    renderLoginPage,
    renderUserBadge,
    submitLoginForm
  };
}
