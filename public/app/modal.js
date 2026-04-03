import { buildBusinessTemplateBundle, getBusinessTemplateOptions } from "./starter-presets.js";

export function createModalModule(ctx) {
  const {
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
  } = ctx;

  const starterGuideStorageKey = "flowforge.starter-guide.completed";
  const starterGuideSeenStorageKey = "flowforge.starter-guide.seen";

  function readStarterGuideCompleted() {
    try {
      return window.localStorage.getItem(starterGuideStorageKey) === "1";
    } catch {
      return false;
    }
  }

  function readStarterGuideSeen() {
    try {
      return window.localStorage.getItem(starterGuideSeenStorageKey) === "1";
    } catch {
      return false;
    }
  }

  function markStarterGuideCompleted() {
    try {
      window.localStorage.setItem(starterGuideStorageKey, "1");
      window.localStorage.setItem(starterGuideSeenStorageKey, "1");
    } catch {}
  }

  function markStarterGuideSeen() {
    try {
      window.localStorage.setItem(starterGuideSeenStorageKey, "1");
    } catch {}
  }

  function parseTagInput(raw) {
    return [...new Set(String(raw || "").split(/[,\n]/).map((item) => item.trim()).filter(Boolean))];
  }

  function dedupeList(values = []) {
    return [...new Set((values || []).filter(Boolean))];
  }

  function formatTagInput(tags = []) {
    return Array.isArray(tags) ? tags.join(", ") : "";
  }

  function toKeyValueRows(entries = []) {
    if (Array.isArray(entries) && entries.length) {
      return entries
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          key: String(item.key || ""),
          value: item.value === undefined || item.value === null ? "" : String(item.value)
        }));
    }

    if (entries && typeof entries === "object") {
      return Object.entries(entries).map(([key, value]) => ({
        key: String(key || ""),
        value: value === undefined || value === null ? "" : String(value)
      }));
    }

    return [{ key: "", value: "" }];
  }

  function normalizeBodyTemplate(value) {
    if (value === undefined || value === null || value === "") {
      return "";
    }
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
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
    return [...new Set((values || []).filter(Boolean))];
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
        const inputs = uniqueValues(scopedExpressions.filter((entry) => entry.scope === "vars").map((entry) => entry.name)).map((name) => ({
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

  function renderBuilderHint(text) {
    return `<div class="builder-hint">${escapeHtml(text)}</div>`;
  }

  function buildModalReturnNavigation(recordId = "") {
    const data = state.modal?.data || {};
    const tab = String(data.returnTab || "").trim();
    if (!tab) {
      return null;
    }

    return {
      tab,
      runId: String(data.returnRunId || "").trim(),
      stepId: String(data.returnStepId || "").trim(),
      caseId: String(data.returnCaseId || recordId || "").trim(),
      guideFocus: String(data.returnGuideFocus || "").trim(),
      riskView: String(data.returnRiskView || "").trim(),
      anchor: String(data.returnAnchor || "").trim()
    };
  }

  function formatPreviewValue(value, maxLength = 56) {
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

  function buildExecutionVariablePreview({ suite, model, environment }) {
    const previewItems = buildSuiteVariablePreview(suite, model);
    const known = [];
    const runtime = [];
    const missing = [];
    const contexts = [];
    const seen = new Set();
    const pushUnique = (bucket, key, entry) => {
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      bucket.push(entry);
    };

    uniqueValues(previewItems.flatMap((item) => item.contexts || []).filter((entry) => entry.scope === "env").map((entry) => entry.name)).forEach((name) => {
      const value = resolveEnvironmentReferenceValue(environment, name);
      pushUnique(known, `env:${name}`, {
        label: `env.${name}`,
        value: formatPreviewValue(value),
        source: environment?.displayName || environment?.name || "当前环境",
        tone: value === undefined ? "warning" : "context"
      });
    });

    uniqueValues(previewItems.flatMap((item) => item.contexts || []).filter((entry) => entry.scope === "suite").map((entry) => entry.name)).forEach((name) => {
      const value = suite?.variables?.[name];
      pushUnique(known, `suite:${name}`, {
        label: `suite.${name}`,
        value: formatPreviewValue(value),
        source: suite?.name || "当前场景",
        tone: value === undefined ? "warning" : "context"
      });
    });

    previewItems.forEach((item) => {
      (item.inputs || []).forEach((entry) => {
        if (entry.source?.type === "suite" && Object.prototype.hasOwnProperty.call(suite?.variables || {}, entry.name)) {
          pushUnique(known, `vars-known:${entry.name}`, {
            label: `vars.${entry.name}`,
            value: formatPreviewValue(suite.variables?.[entry.name]),
            source: "场景变量预置值",
            tone: "input"
          });
          return;
        }
        if (entry.source?.type === "step") {
          pushUnique(runtime, `vars-runtime:${entry.name}`, {
            label: `vars.${entry.name}`,
            value: "运行时生成",
            source: entry.source.label,
            tone: "output"
          });
          return;
        }
        pushUnique(missing, `vars-missing:${entry.name}`, {
          label: `vars.${entry.name}`,
          value: "缺少来源",
          source: item.name,
          tone: "warning"
        });
      });
    });

    uniqueValues(
      previewItems.flatMap((item) =>
        (item.contexts || [])
          .filter((entry) => entry.scope === "dataset" || entry.scope === "builtin")
          .map((entry) => `${entry.scope}.${entry.name}`)
      )
    ).forEach((name) => {
      pushUnique(contexts, `ctx:${name}`, {
        label: name,
        value: name.startsWith("dataset.") ? "执行时按数据行决定" : "执行时自动生成",
        source: name.startsWith("dataset.") ? "数据集上下文" : "内置上下文",
        tone: "context"
      });
    });

    return {
      known: known.slice(0, 6),
      runtime: runtime.slice(0, 4),
      missing: missing.slice(0, 4),
      contexts: contexts.slice(0, 4)
    };
  }

  function renderTagField(name, label, value = "", placeholder = "smoke, regression") {
    return `
      <div class="field full-span">
        <label>${escapeHtml(label)}</label>
        <input type="text" name="${escapeHtml(name)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" />
        ${renderBuilderHint("用逗号分隔多个标签，例如 smoke, auth, regression。")}
      </div>
    `;
  }

  function serializeActionDataset(dataset = {}) {
    return Object.entries(dataset)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => `data-${String(key).replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}="${escapeHtml(String(value))}"`)
      .join(" ");
  }

  function renderKeyValueEditor({
    editorType,
    title,
    rows,
    keyName,
    valueName,
    keyLabel = "名称",
    valueLabel = "值",
    keyPlaceholder = "key",
    valuePlaceholder = "value",
    addLabel = "添加一行",
    rowClassName = ""
  }) {
    const safeRows = rows?.length ? rows : [{ key: "", value: "" }];
    return `
      <div class="builder-card full-span">
        <div class="builder-card-head">
          <div>
            <strong>${escapeHtml(title)}</strong>
            ${renderBuilderHint("逐行填写，不需要自己拼 JSON。")}
          </div>
          <button type="button" class="secondary-button small-button" data-action="add-editor-row" data-editor="${escapeHtml(editorType)}">${escapeHtml(addLabel)}</button>
        </div>
        <div class="visual-editor" data-editor-root="${escapeHtml(editorType)}">
          ${safeRows
            .map(
              (row) => `
                <div class="visual-row ${escapeHtml(rowClassName)}" data-editor-row="${escapeHtml(editorType)}">
                  <label class="inline-field">
                    <span>${escapeHtml(keyLabel)}</span>
                    <input type="text" name="${escapeHtml(keyName)}" value="${escapeHtml(row.key || "")}" placeholder="${escapeHtml(keyPlaceholder)}" />
                  </label>
                  <label class="inline-field">
                    <span>${escapeHtml(valueLabel)}</span>
                    <input type="text" name="${escapeHtml(valueName)}" value="${escapeHtml(row.value || "")}" placeholder="${escapeHtml(valuePlaceholder)}" />
                  </label>
                  <button type="button" class="plain-button text-danger" data-action="remove-editor-row">删除</button>
                </div>
              `
            )
            .join("")}
        </div>
      </div>
    `;
  }

  function renderAssertionEditor(assertions = []) {
    const safeRows = assertions?.length
      ? assertions.map((item) => ({
          type: item.type || "status",
          path: item.path || "",
          operator: item.operator || (item.type === "responseTime" ? "lte" : "equals"),
          expected:
            item.expected === undefined || item.expected === null
              ? ""
              : typeof item.expected === "string"
                ? item.expected
                : JSON.stringify(item.expected),
          name: item.name || "",
          schema: item.schema ? JSON.stringify(item.schema, null, 2) : ""
        }))
      : [{ type: "status", path: "", operator: "equals", expected: "200", name: "", schema: "" }];

    return `
      <div class="builder-card full-span">
        <div class="builder-card-head">
          <div>
            <strong>断言规则</strong>
            ${renderBuilderHint("常用场景直接用下拉和输入框即可，例如状态码=200、字段存在。")}
          </div>
          <button type="button" class="secondary-button small-button" data-action="add-editor-row" data-editor="assertions">添加断言</button>
        </div>
        <div class="visual-editor" data-editor-root="assertions">
          ${safeRows.map((row) => renderAssertionRow(row)).join("")}
        </div>
      </div>
    `;
  }

  function renderAssertionRow(row = {}) {
    return `
      <div class="visual-row visual-row-assertion" data-editor-row="assertions">
        <label class="inline-field" data-assertion-field="type">
          <span>类型</span>
          <select name="assertionType">
            ${[
              ["status", "状态码"],
              ["jsonPath", "字段值"],
              ["exists", "字段存在"],
              ["fieldType", "字段类型"],
              ["responseTime", "响应时间"],
              ["headerEquals", "响应头"],
              ["bodyContains", "响应包含文本"],
              ["xpath", "XPath"],
              ["jsonSchema", "JSON Schema"]
            ]
              .map(
                ([value, label]) =>
                  `<option value="${escapeHtml(value)}" ${row.type === value ? "selected" : ""}>${escapeHtml(label)}</option>`
              )
              .join("")}
          </select>
        </label>
        <label class="inline-field" data-assertion-field="path">
          <span>路径/字段</span>
          <input type="text" name="assertionPath" value="${escapeHtml(row.path || "")}" placeholder="$.data.id / //item/text()" />
        </label>
        <label class="inline-field" data-assertion-field="operator">
          <span>比较方式</span>
          <select name="assertionOperator">
            ${[
              ["equals", "等于"],
              ["notEquals", "不等于"],
              ["contains", "包含"],
              ["gt", "大于"],
              ["gte", "大于等于"],
              ["lt", "小于"],
              ["lte", "小于等于"]
            ]
              .map(
                ([value, label]) =>
                  `<option value="${escapeHtml(value)}" ${String(row.operator || "equals") === value ? "selected" : ""}>${escapeHtml(label)}</option>`
              )
              .join("")}
          </select>
        </label>
        <label class="inline-field" data-assertion-field="expected">
          <span>期望值</span>
          <input type="text" name="assertionExpected" value="${escapeHtml(row.expected || "")}" placeholder="200 / success / string" />
        </label>
        <label class="inline-field" data-assertion-field="name">
          <span>响应头名</span>
          <input type="text" name="assertionName" value="${escapeHtml(row.name || "")}" placeholder="content-type" />
        </label>
        <label class="inline-field inline-field-wide" data-assertion-field="schema">
          <span>Schema(JSON)</span>
          <textarea name="assertionSchema" spellcheck="false" placeholder='{"type":"object"}'>${escapeHtml(row.schema || "")}</textarea>
        </label>
        <button type="button" class="plain-button text-danger" data-action="remove-editor-row">删除</button>
      </div>
    `;
  }

  function renderExtractEditor(extracts = []) {
    const safeRows = extracts?.length
      ? extracts.map((item) => ({
          name: item.name || "",
          source: item.source || "jsonPath",
          path: item.path || "",
          header: item.header || ""
        }))
      : [{ name: "", source: "jsonPath", path: "", header: "" }];

    return `
      <div class="builder-card full-span">
        <div class="builder-card-head">
          <div>
            <strong>变量提取</strong>
            ${renderBuilderHint("把接口返回里的关键值保存下来，供后续接口继续使用。")}
          </div>
          <button type="button" class="secondary-button small-button" data-action="add-editor-row" data-editor="extracts">添加提取规则</button>
        </div>
        <div class="visual-editor" data-editor-root="extracts">
          ${safeRows.map((row) => renderExtractRow(row)).join("")}
        </div>
      </div>
    `;
  }

  function renderExtractRow(row = {}) {
    return `
      <div class="visual-row visual-row-extract" data-editor-row="extracts">
        <label class="inline-field" data-extract-field="name">
          <span>变量名</span>
          <input type="text" name="extractName" value="${escapeHtml(row.name || "")}" placeholder="authToken" />
        </label>
        <label class="inline-field" data-extract-field="source">
          <span>来源</span>
          <select name="extractSource">
            ${[
              ["jsonPath", "JSON 字段"],
              ["xpath", "XPath"],
              ["header", "响应头"],
              ["status", "状态码"]
            ]
              .map(
                ([value, label]) =>
                  `<option value="${escapeHtml(value)}" ${row.source === value ? "selected" : ""}>${escapeHtml(label)}</option>`
              )
              .join("")}
          </select>
        </label>
        <label class="inline-field" data-extract-field="path">
          <span>路径</span>
          <input type="text" name="extractPath" value="${escapeHtml(row.path || "")}" placeholder="$.token / //token/text()" />
        </label>
        <label class="inline-field" data-extract-field="header">
          <span>响应头名</span>
          <input type="text" name="extractHeader" value="${escapeHtml(row.header || "")}" placeholder="x-request-id" />
        </label>
        <button type="button" class="plain-button text-danger" data-action="remove-editor-row">删除</button>
      </div>
    `;
  }

  function renderKeyValueEditorRow(editorType, row = {}) {
    const configMap = {
      headers: { keyName: "headerKey", valueName: "headerValue", keyLabel: "Header", valueLabel: "值", keyPlaceholder: "content-type", valuePlaceholder: "application/json" },
      query: { keyName: "queryKey", valueName: "queryValue", keyLabel: "参数名", valueLabel: "参数值", keyPlaceholder: "page", valuePlaceholder: "1" },
      "override-headers": { keyName: "overrideHeaderKey", valueName: "overrideHeaderValue", keyLabel: "Header", valueLabel: "值", keyPlaceholder: "authorization", valuePlaceholder: "Bearer {{vars.authToken}}" },
      "override-query": { keyName: "overrideQueryKey", valueName: "overrideQueryValue", keyLabel: "参数名", valueLabel: "参数值", keyPlaceholder: "id", valuePlaceholder: "{{vars.resourceId}}" },
      "env-headers": { keyName: "envHeaderKey", valueName: "envHeaderValue", keyLabel: "Header", valueLabel: "值", keyPlaceholder: "x-tenant-id", valuePlaceholder: "demo" },
      "env-variables": { keyName: "envVariableKey", valueName: "envVariableValue", keyLabel: "变量名", valueLabel: "变量值", keyPlaceholder: "tenantId", valuePlaceholder: "demo" },
      "suite-variables": { keyName: "suiteVariableKey", valueName: "suiteVariableValue", keyLabel: "变量名", valueLabel: "变量值", keyPlaceholder: "resourceId", valuePlaceholder: "10001" }
    };
    const config = configMap[editorType];
    if (!config) {
      return "";
    }
    return `
      <div class="visual-row" data-editor-row="${escapeHtml(editorType)}">
        <label class="inline-field">
          <span>${escapeHtml(config.keyLabel)}</span>
          <input type="text" name="${escapeHtml(config.keyName)}" value="${escapeHtml(row.key || "")}" placeholder="${escapeHtml(config.keyPlaceholder)}" />
        </label>
        <label class="inline-field">
          <span>${escapeHtml(config.valueLabel)}</span>
          <input type="text" name="${escapeHtml(config.valueName)}" value="${escapeHtml(row.value || "")}" placeholder="${escapeHtml(config.valuePlaceholder)}" />
        </label>
        <button type="button" class="plain-button text-danger" data-action="remove-editor-row">删除</button>
      </div>
    `;
  }

  function renderAuthBuilder(auth = {}) {
    return `
      <div class="builder-card full-span">
        <div class="builder-card-head">
          <div>
            <strong>鉴权配置</strong>
            ${renderBuilderHint("新手只需要选择无鉴权、Bearer Token 或 API Key。")}
          </div>
        </div>
        <div class="visual-row visual-row-auth">
          <label class="inline-field">
            <span>鉴权方式</span>
            <select name="authType">
              <option value="none" ${!auth.type || auth.type === "none" ? "selected" : ""}>无鉴权</option>
              <option value="bearer" ${auth.type === "bearer" ? "selected" : ""}>Bearer Token</option>
              <option value="apikey" ${auth.type === "apikey" ? "selected" : ""}>API Key</option>
            </select>
          </label>
          <label class="inline-field">
            <span>Header 名</span>
            <input type="text" name="authHeader" value="${escapeHtml(auth.header || "")}" placeholder="authorization / x-api-key" />
          </label>
          <label class="inline-field inline-field-wide">
            <span>Header 值</span>
            <input type="text" name="authValue" value="${escapeHtml(auth.value || "")}" placeholder="Bearer token 或固定 key 值" />
          </label>
        </div>
      </div>
    `;
  }

  function renderGuideStep(title, description, body, step, activeStep) {
    return `
      <section class="guide-step ${step === activeStep ? "is-active" : ""}" data-guide-panel="${step}">
        <div class="guide-step-head">
          <span class="guide-step-index">0${step}</span>
          <div>
            <strong>${escapeHtml(title)}</strong>
            <p>${escapeHtml(description)}</p>
          </div>
        </div>
        <div class="guide-step-body">
          ${body}
        </div>
      </section>
    `;
  }

  function renderSceneBuilderSourcePicker(activeSource) {
    return `
      <section class="scene-builder-source-picker full-span">
        ${[
          ["apis", "从已有接口生成", "勾选已有接口，自动复用现有用例；若没有用例，系统会补一条默认用例。"],
          ["template", "从业务模板生成", "适合登录、CRUD、分页、搜索、上传、批量等常见业务链路。"],
          ["openapi", "从 OpenAPI 生成", "导入规范后自动生成接口、默认用例和可执行场景。"]
        ]
          .map(
            ([value, title, description]) => `
              <button
                type="button"
                class="scene-source-card ${activeSource === value ? "is-active" : ""}"
                data-action="set-scene-source"
                data-value="${escapeHtml(value)}"
              >
                <strong>${escapeHtml(title)}</strong>
                <p>${escapeHtml(description)}</p>
              </button>
            `
          )
          .join("")}
      </section>
    `;
  }

  function getOrderedSuiteItems(suite) {
    return suite?.items?.slice().sort((a, b) => a.order - b.order) || [];
  }

  function getPreviousSuiteStep(suite, stepId = "") {
    const items = getOrderedSuiteItems(suite);
    if (!items.length) {
      return null;
    }
    if (!stepId) {
      return items[items.length - 1] || null;
    }
    const currentIndex = items.findIndex((item) => item.id === stepId);
    return currentIndex > 0 ? items[currentIndex - 1] : null;
  }

  function parseStepParallelConfig(currentStep, previousStep) {
    const currentGroup = String(currentStep?.parallelGroup || "").trim();
    if (!currentGroup) {
      return { mode: "serial", value: "" };
    }
    if (previousStep && String(previousStep.parallelGroup || "").trim() === currentGroup) {
      return { mode: "inherit", value: currentGroup };
    }
    return { mode: "custom", value: currentGroup };
  }

  function decodeConditionExpected(text) {
    const raw = String(text || "").trim();
    if (!raw) {
      return "";
    }
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      try {
        return JSON.parse(raw.replace(/^'/, '"').replace(/'$/, '"'));
      } catch {
        return raw.slice(1, -1);
      }
    }
    if (raw === "True") {
      return "true";
    }
    if (raw === "False") {
      return "false";
    }
    if (raw === "None") {
      return "null";
    }
    return raw;
  }

  function parseStepConditionConfig(condition) {
    const source = String(condition || "").trim();
    if (!source) {
      return {
        mode: "always",
        scope: "vars",
        variable: "",
        expected: "",
        script: ""
      };
    }

    let match = source.match(/^(vars|env|suite|dataset)\.([A-Za-z_][\w.]*)\s+is\s+not\s+None$/);
    if (match) {
      return {
        mode: "exists",
        scope: match[1],
        variable: match[2],
        expected: "",
        script: ""
      };
    }

    match = source.match(/^(vars|env|suite|dataset)\.([A-Za-z_][\w.]*)\s+is\s+None$/);
    if (match) {
      return {
        mode: "missing",
        scope: match[1],
        variable: match[2],
        expected: "",
        script: ""
      };
    }

    match = source.match(/^(vars|env|suite|dataset)\.([A-Za-z_][\w.]*)\s*==\s*(.+)$/);
    if (match) {
      return {
        mode: "equals",
        scope: match[1],
        variable: match[2],
        expected: String(decodeConditionExpected(match[3])),
        script: ""
      };
    }

    return {
      mode: "custom",
      scope: "vars",
      variable: "",
      expected: "",
      script: source
    };
  }

  function serializeConditionExpected(value) {
    const text = String(value || "").trim();
    if (!text) {
      return '""';
    }
    if (/^-?\d+(\.\d+)?$/.test(text)) {
      return text;
    }
    if (/^(true|false)$/i.test(text)) {
      return text.toLowerCase() === "true" ? "True" : "False";
    }
    if (/^null$/i.test(text)) {
      return "None";
    }
    return JSON.stringify(text);
  }

  function buildStepConditionExpression(formData) {
    const mode = String(formData.get("conditionMode") || "always");
    const scope = String(formData.get("conditionScope") || "vars");
    const variable = String(formData.get("conditionVarName") || "").trim();
    if (mode === "always") {
      return "";
    }
    if (mode === "custom") {
      return String(formData.get("conditionScript") || "").trim();
    }
    if (!variable) {
      return "";
    }
    if (mode === "exists") {
      return `${scope}.${variable} is not None`;
    }
    if (mode === "missing") {
      return `${scope}.${variable} is None`;
    }
    return `${scope}.${variable} == ${serializeConditionExpected(formData.get("conditionExpected"))}`;
  }

  function createParallelGroupId(previousStep) {
    const seed = previousStep?.order || Date.now();
    return `parallel_${seed}_${Date.now().toString(36).slice(-4)}`;
  }

  function parseRepeatedRows(formData, keys) {
    const columns = Object.fromEntries(keys.map((key) => [key, formData.getAll(key)]));
    const count = Math.max(...keys.map((key) => columns[key].length), 0);
    return Array.from({ length: count }, (_, index) =>
      Object.fromEntries(keys.map((key) => [key, columns[key][index]]))
    );
  }

  function parseArrayEntries(formData, keyField, valueField) {
    return parseRepeatedRows(formData, [keyField, valueField])
      .map((row) => ({
        key: String(row[keyField] || "").trim(),
        value: String(row[valueField] || "").trim()
      }))
      .filter((row) => row.key || row.value);
  }

  function parseObjectEntries(formData, keyField, valueField) {
    return Object.fromEntries(
      parseArrayEntries(formData, keyField, valueField)
        .filter((row) => row.key)
        .map((row) => [row.key, row.value])
    );
  }

  function parseAssertionRules(formData) {
    return parseRepeatedRows(formData, ["assertionType", "assertionPath", "assertionOperator", "assertionExpected", "assertionName", "assertionSchema"])
      .map((row) => {
        const type = String(row.assertionType || "status");
        const expectedText = String(row.assertionExpected || "").trim();
        const assertion = { type };

        if (row.assertionPath) {
          assertion.path = String(row.assertionPath).trim();
        }
        if (type !== "exists" && row.assertionOperator) {
          assertion.operator = String(row.assertionOperator || "equals");
        }
        if (type === "headerEquals" && row.assertionName) {
          assertion.name = String(row.assertionName).trim();
        }
        if (type === "jsonSchema") {
          assertion.schema = parseJson(row.assertionSchema, { type: "object" });
          return assertion;
        }

        if (type === "status" || type === "responseTime") {
          assertion.expected = Number(expectedText || 0);
          return assertion;
        }
        if (type === "exists") {
          assertion.expected = true;
          return assertion;
        }
        assertion.expected = parseJsonOrText(expectedText);
        return assertion;
      })
      .filter((row) => row.type && (row.type === "status" || row.path || row.name || row.schema || row.expected !== ""));
  }

  function parseExtractRules(formData) {
    return parseRepeatedRows(formData, ["extractName", "extractSource", "extractPath", "extractHeader"])
      .map((row) => {
        const name = String(row.extractName || "").trim();
        const source = String(row.extractSource || "jsonPath");
        if (!name) {
          return null;
        }
        return {
          name,
          source,
          ...(row.extractPath ? { path: String(row.extractPath).trim() } : {}),
          ...(source === "header" && row.extractHeader ? { header: String(row.extractHeader).trim() } : {})
        };
      })
      .filter(Boolean);
  }

  function parseAuthConfig(formData) {
    const type = String(formData.get("authType") || "none");
    if (type === "none") {
      return { type: "none", value: "" };
    }
    if (type === "bearer") {
      return {
        type,
        value: String(formData.get("authValue") || "").trim()
      };
    }
    return {
      type,
      header: String(formData.get("authHeader") || "").trim() || "x-api-key",
      value: String(formData.get("authValue") || "").trim()
    };
  }

  function parseBodyText(raw) {
    const text = String(raw || "").trim();
    if (!text) {
      return "";
    }
    return parseJsonOrText(text);
  }

  async function autoRecheckEnvironment(environmentId, { rerunSmoke = false } = {}) {
    if (!environmentId) {
      return null;
    }

    const previousRuntime = state.environmentDiagnostics[environmentId] || {};
    const previousDiagnostics = previousRuntime.diagnostics || null;
    const previousCheckMap = new Map((previousDiagnostics?.checks || []).map((item) => [item.key, item]));
    const previousSmokeStatus = previousRuntime.smoke?.status || "";

    state.environmentDiagnostics[environmentId] = {
      ...previousRuntime,
      loading: true,
      ...(rerunSmoke ? { smokeLoading: true } : {})
    };

    const diagnostics = await api(`/api/environments/${environmentId}/diagnostics`);
    let smoke = state.environmentDiagnostics[environmentId]?.smoke || null;

    if (rerunSmoke) {
      smoke = await api(`/api/environments/${environmentId}/auth-smoke`, {
        method: "POST",
        body: JSON.stringify({})
      });
    }

    const changedCheckKeys = (diagnostics?.checks || [])
      .filter((check) => {
        const previous = previousCheckMap.get(check.key);
        return !previous || previous.status !== check.status || previous.message !== check.message || previous.detail !== check.detail;
      })
      .map((check) => check.key);
    const smokeChanged = rerunSmoke && previousSmokeStatus !== (smoke?.status || "");
    const anchorCheckKey = changedCheckKeys[0] || diagnostics?.checks?.find((item) => item.status !== "passed")?.key || diagnostics?.checks?.[0]?.key || "";

    state.environmentDiagnostics[environmentId] = {
      ...(state.environmentDiagnostics[environmentId] || {}),
      diagnostics,
      loading: false,
      ...(rerunSmoke ? { smoke, smokeLoading: false } : {}),
      spotlight: {
        pending: true,
        changedCheckKeys,
        smokeChanged,
        anchorCheckKey,
        checkedAt: diagnostics?.checkedAt || new Date().toISOString()
      }
    };

    return { diagnostics, smoke };
  }

  function getProjectIdByApiId(apiId, model) {
    const apiEntity = model.apis.find((item) => item.id === apiId);
    const moduleEntity = model.modules.find((item) => item.id === apiEntity?.moduleId);
    const serviceEntity = model.services.find((item) => item.id === moduleEntity?.serviceId);
    return serviceEntity?.projectId || model.projects[0]?.id || null;
  }

  function getProjectIdByModuleId(moduleId, model) {
    const moduleEntity = model.modules.find((item) => item.id === moduleId);
    const serviceEntity = model.services.find((item) => item.id === moduleEntity?.serviceId);
    return serviceEntity?.projectId || model.projects[0]?.id || null;
  }

  async function createSuiteWithCaseRefs({ model, projectId, environmentId, suiteName, description, tags = [], variables = {}, caseIds = [] }) {
    if (!projectId || !caseIds.length) {
      return null;
    }

    return api("/api/suites", {
      method: "POST",
      body: JSON.stringify({
        projectId,
        name: suiteName,
        description,
        tags,
        variables,
        items: caseIds.map((caseId, index) => ({
          id: clientId("suite_item"),
          itemType: "case",
          caseId,
          role: "test",
          parallelGroup: "",
          order: index + 1,
          continueOnFailure: false
        })),
        scenarioAssertions: [],
        schedule: {
          enabled: false,
          intervalMinutes: 30
        },
        defaultEnvironmentId: environmentId || model.environments[0]?.id || null,
        timeoutSeconds: 300,
        failureStrategy: "stop"
      })
    });
  }

  async function createBusinessTemplateAssets(model, formData, overrides = {}) {
    const templateKey = String(overrides.templateKey || formData.get("templateKey") || "login");
    const createSuite = overrides.createSuite ?? (formData.get("createSuite") !== "false");
    const inputTags = dedupeList(overrides.tags || parseTagInput(formData.get("tags")));
    const bundle = buildBusinessTemplateBundle({
      templateKey,
      displayName: overrides.displayName || formData.get("displayName"),
      basePath: overrides.basePath || formData.get("basePath"),
      tags: inputTags,
      createSuite
    });

    const moduleId = String(overrides.moduleId || formData.get("moduleId") || "");
    const projectId = String(overrides.projectId || formData.get("projectId") || model.projects[0]?.id || "");
    const environmentId = String(overrides.environmentId || formData.get("environmentId") || model.environments[0]?.id || "");
    const apiIdByRef = new Map();
    const caseIdByRef = new Map();

    for (const apiTemplate of bundle.apis) {
      const createdApi = await api("/api/apis", {
        method: "POST",
        body: JSON.stringify({
          moduleId,
          creator: state.auth.user?.name || "系统",
          ...apiTemplate.payload
        })
      });
      apiIdByRef.set(apiTemplate.ref, createdApi.id);
    }

    for (const caseTemplate of bundle.cases) {
      const createdCase = await api("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          apiId: apiIdByRef.get(caseTemplate.apiRef),
          creator: state.auth.user?.name || "系统",
          ...caseTemplate.payload
        })
      });
      caseIdByRef.set(caseTemplate.ref, createdCase.id);
    }

    let suite = null;
    if (bundle.suite) {
      const mergedSuiteTags = dedupeList([...(bundle.suite.tags || []), ...inputTags]);
      suite = await createSuiteWithCaseRefs({
        model,
        projectId,
        environmentId,
        suiteName: String(overrides.suiteName || formData.get("suiteName") || bundle.suite.name),
        description: String(overrides.description || formData.get("description") || bundle.suite.description),
        tags: mergedSuiteTags,
        variables: bundle.suite.variables,
        caseIds: bundle.suite.caseRefs.map((item) => caseIdByRef.get(item)).filter(Boolean)
      });
      state.selectedSuiteId = suite?.id || state.selectedSuiteId;
    }

    return {
      apiCount: bundle.apis.length,
      caseCount: bundle.cases.length,
      suite
    };
  }

  async function importOpenApiAssets({
    model,
    moduleId,
    projectId,
    environmentId,
    suiteName,
    spec,
    description = "由 OpenAPI 新手导入自动生成",
    tags = ["openapi", "starter", "generated"]
  }) {
    const imported = await api("/api/import/openapi", {
      method: "POST",
      body: JSON.stringify({
        moduleId,
        spec: typeof spec === "string" ? parseJson(spec, {}) : spec
      })
    });
    const suite = await createSuiteWithCaseRefs({
      model,
      projectId,
      environmentId,
      suiteName: suiteName || "OpenAPI 默认场景",
      description,
      tags,
      variables: {},
      caseIds: (imported.cases || []).map((item) => item.id)
    });
    state.selectedSuiteId = suite?.id || state.selectedSuiteId;
    return {
      imported,
      suite
    };
  }

  async function createDefaultCaseForApi(apiEntity, extraTags = []) {
    if (!apiEntity?.id) {
      return null;
    }

    return api("/api/cases", {
      method: "POST",
      body: JSON.stringify({
        apiId: apiEntity.id,
        name: `${apiEntity.name} · 默认校验`,
        creator: state.auth.user?.name || "系统",
        priority: "medium",
        description: "由场景向导自动补齐的默认用例",
        tags: dedupeList(["starter", "scene-builder", ...extraTags]),
        assertions: [
          { type: "status", expected: 200 },
          { type: "responseTime", operator: "lte", expected: 3000 }
        ],
        extracts: [],
        preScript: "",
        postScript: "",
        overrides: {}
      })
    });
  }

  async function quickCreateDefaultCase(apiId) {
    const model = buildViewModel();
    const apiEntity = model.apis.find((item) => item.id === apiId);
    if (!apiEntity) {
      showToast("接口不存在");
      return null;
    }

    const existingCase = model.cases.find((item) => item.apiId === apiId) || null;
    if (existingCase) {
      openModal("case", { recordId: existingCase.id });
      showToast("该接口已有用例，已为你打开现有用例");
      return existingCase;
    }

    const createdCase = await createDefaultCaseForApi(apiEntity, ["quick-create"]);
    await refreshData();
    if (createdCase?.id) {
      openModal("case", { recordId: createdCase.id });
      showToast("已生成默认用例，建议再补一下断言和变量提取");
    }
    return createdCase;
  }

  function openSceneBuilderFromApis(apiIds = []) {
    const ids = dedupeList((apiIds.length ? apiIds : state.selections.apis || []).map((item) => String(item || "").trim()).filter(Boolean));
    if (!ids.length) {
      showToast("请先勾选接口，或从某条接口右侧直接发起");
      return false;
    }
    state.selections.apis = ids;
    openModal("scene-builder", {
      source: "apis",
      apiIds: ids,
      suiteName: ids.length === 1 ? "单接口验证场景" : `接口组合场景（${ids.length}个接口）`
    });
    return true;
  }

  async function createSuiteFromSelectedApis(model, formData) {
    const selectedApiIds = dedupeList(formData.getAll("sceneApiId").map((item) => String(item || "").trim()).filter(Boolean));
    if (!selectedApiIds.length) {
      throw new Error("请至少勾选一个接口");
    }

    const selectedProjectIds = dedupeList(selectedApiIds.map((apiId) => getProjectIdByApiId(apiId, model)).filter(Boolean));
    if (selectedProjectIds.length > 1) {
      throw new Error("当前勾选的接口属于多个项目，请分批创建场景");
    }

    const existingCaseByApiId = new Map();
    model.cases.forEach((item) => {
      if (!existingCaseByApiId.has(item.apiId)) {
        existingCaseByApiId.set(item.apiId, item.id);
      }
    });

    const suiteTags = parseTagInput(formData.get("tags"));
    const caseIds = [];
    let createdCaseCount = 0;
    for (const apiId of selectedApiIds) {
      const reusedCaseId = existingCaseByApiId.get(apiId);
      if (reusedCaseId) {
        caseIds.push(reusedCaseId);
        continue;
      }
      const apiEntity = model.apis.find((item) => item.id === apiId);
      const createdCase = await createDefaultCaseForApi(apiEntity, suiteTags);
      if (createdCase?.id) {
        caseIds.push(createdCase.id);
        createdCaseCount += 1;
      }
    }

    const suite = await createSuiteWithCaseRefs({
      model,
      projectId: selectedProjectIds[0] || model.projects[0]?.id || "",
      environmentId: String(formData.get("environmentId") || model.environments[0]?.id || ""),
      suiteName: String(formData.get("suiteName") || "接口组合场景"),
      description: String(formData.get("description") || "由场景向导根据已选接口自动生成"),
      tags: suiteTags,
      variables: {},
      caseIds
    });
    state.selectedSuiteId = suite?.id || state.selectedSuiteId;

    return {
      suite,
      caseCount: caseIds.length,
      createdCaseCount
    };
  }

  async function runGeneratedSuite({
    suiteId,
    environmentId,
    priority = "high",
    timeoutSeconds = 300,
    failureStrategy = "stop"
  }) {
    if (!suiteId || !environmentId) {
      return null;
    }

    return api("/api/runs", {
      method: "POST",
      body: JSON.stringify({
        suiteId,
        environmentId,
        trigger: "manual",
        options: {
          environmentId,
          priority,
          timeoutSeconds,
          failureStrategy,
          stopOnDatasetFailure: true
        }
      })
    });
  }

  function renderEditorRow(editorType) {
    const keyValueRow = renderKeyValueEditorRow(editorType);
    if (keyValueRow) {
      return keyValueRow;
    }
    if (editorType === "assertions") {
      return renderAssertionRow();
    }
    if (editorType === "extracts") {
      return renderExtractRow();
    }
    return "";
  }

  function appendEditorRows(editorType, rows = [], root = null) {
    const targetRoot = root || modalRoot.querySelector(`[data-editor-root="${editorType}"]`);
    if (!targetRoot || !rows.length) {
      return [];
    }

    const insertedNodes = [];
    rows.forEach((row) => {
      const html =
        renderKeyValueEditorRow(editorType, row) ||
        (editorType === "assertions" ? renderAssertionRow(row) : editorType === "extracts" ? renderExtractRow(row) : "");
      if (!html) {
        return;
      }
      targetRoot.insertAdjacentHTML("beforeend", html);
      if (targetRoot.lastElementChild) {
        insertedNodes.push(targetRoot.lastElementChild);
      }
    });

    syncModalDynamicState();
    return insertedNodes;
  }

  function addEditorRow(editorType, actionNode) {
    const root =
      actionNode?.closest(".builder-card")?.querySelector(`[data-editor-root="${editorType}"]`) ||
      modalRoot.querySelector(`[data-editor-root="${editorType}"]`);
    if (!root) {
      return false;
    }
    const html = renderEditorRow(editorType);
    if (!html) {
      return false;
    }
    root.insertAdjacentHTML("beforeend", html);
    syncModalDynamicState();
    return true;
  }

  function fillMissingEnvironmentVariables() {
    const form = modalRoot.querySelector('[data-modal-type="environment"]');
    const envId = String(state.modal?.data?.envId || "");
    if (!form || !envId) {
      return false;
    }

    const diagnostics = state.environmentDiagnostics?.[envId]?.diagnostics;
    const missingVariables = (diagnostics?.missingEnvVariables || []).map((item) => String(item || "").trim()).filter(Boolean);
    if (!missingVariables.length) {
      showToast("当前没有待补的环境变量");
      return true;
    }

    const existingKeys = new Set(
      [...form.querySelectorAll('[data-editor-row="env-variables"] [name="envVariableKey"]')]
        .map((node) => String(node.value || "").trim())
        .filter(Boolean)
    );
    const appendRows = missingVariables.filter((name) => !existingKeys.has(name)).map((name) => ({ key: name, value: "" }));

    if (!appendRows.length) {
      showToast("缺失变量名已经全部补到表单里了");
      state.modal.data.focusField = "envVariables";
      state.modal.data.focusVariable = missingVariables[0] || "";
      applyModalFocusGuide();
      return true;
    }

    appendEditorRows("env-variables", appendRows, form.querySelector('[data-editor-root="env-variables"]'));
    state.modal.data.focusField = "envVariables";
    state.modal.data.focusVariable = appendRows[0]?.key || "";
    applyModalFocusGuide();
    showToast(`已补入 ${appendRows.length} 个缺失变量名`);
    return true;
  }

  function setNamedFieldValue(form, fieldName, value) {
    const field = form?.querySelector(`[name="${fieldName}"]`);
    if (!field) {
      return false;
    }
    field.value = value;
    field.dispatchEvent(new Event("change", { bubbles: true }));
    field.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  function applyEnvironmentAuthQuickFix(mode = "bearer") {
    const form = modalRoot.querySelector('[data-modal-type="environment"]');
    if (!form) {
      return false;
    }

    if (mode === "bearer") {
      setNamedFieldValue(form, "authType", "bearer");
      setNamedFieldValue(form, "authHeader", "authorization");
      state.modal.data.focusField = "authValue";
      applyModalFocusGuide();
      showToast("已切到 Bearer 鉴权，下一步只需要填 Token");
      return true;
    }

    if (mode === "apikey") {
      setNamedFieldValue(form, "authType", "apikey");
      setNamedFieldValue(form, "authHeader", "x-api-key");
      state.modal.data.focusField = "authValue";
      applyModalFocusGuide();
      showToast("已切到 API Key 鉴权，下一步只需要填 Key 值");
      return true;
    }

    return false;
  }

  function addSuggestedEnvironmentHeader(headerKey, defaultValue = "") {
    const form = modalRoot.querySelector('[data-modal-type="environment"]');
    if (!form || !headerKey) {
      return false;
    }

    const existingRows = [...form.querySelectorAll('[data-editor-row="env-headers"]')];
    const matchedRow = existingRows.find((row) => String(row.querySelector('[name="envHeaderKey"]')?.value || "").trim().toLowerCase() === headerKey.toLowerCase());
    if (matchedRow) {
      state.modal.data.focusField = "headers";
      matchedRow.classList.add("is-focus-target");
      matchedRow.scrollIntoView({ behavior: "smooth", block: "nearest" });
      matchedRow.querySelector('[name="envHeaderValue"]')?.focus();
      showToast(`${headerKey} 已存在，直接补值即可`);
      return true;
    }

    appendEditorRows("env-headers", [{ key: headerKey, value: defaultValue }], form.querySelector('[data-editor-root="env-headers"]'));
    state.modal.data.focusField = "headers";
    applyModalFocusGuide();
    const lastRow = [...form.querySelectorAll('[data-editor-row="env-headers"]')].pop();
    lastRow?.querySelector('[name="envHeaderValue"]')?.focus();
    showToast(`已补入公共 Header ${headerKey}`);
    return true;
  }

  function maybeRemoveEditorRow(actionNode) {
    const row = actionNode?.closest("[data-editor-row]");
    const root = row?.parentElement;
    if (!row || !root) {
      return false;
    }
    if (root.children.length <= 1) {
      const inputs = row.querySelectorAll("input, textarea");
      inputs.forEach((input) => {
        input.value = "";
      });
      row.querySelectorAll("select").forEach((select) => {
        select.selectedIndex = 0;
      });
      syncModalDynamicState();
      return true;
    }
    row.remove();
    syncModalDynamicState();
    return true;
  }

  function showGuideStep(step) {
    const form = modalRoot.querySelector('[data-modal-type="starter-guide"]');
    if (!form) {
      return false;
    }
    const panels = [...form.querySelectorAll("[data-guide-panel]")];
    const steps = panels.map((node) => Number(node.dataset.guidePanel)).filter(Number.isFinite);
    const clamped = Math.max(Math.min(step, Math.max(...steps)), Math.min(...steps));
    form.querySelector('[name="guideStep"]')?.setAttribute("value", String(clamped));
    panels.forEach((panel) => {
      panel.classList.toggle("is-active", Number(panel.dataset.guidePanel) === clamped);
    });
    form.querySelectorAll("[data-guide-progress-step]").forEach((node) => {
      const current = Number(node.dataset.guideProgressStep);
      node.classList.toggle("is-active", current === clamped);
      node.classList.toggle("is-complete", current < clamped);
    });
    const prevButton = form.querySelector('[data-action="guide-prev"]');
    const nextButton = form.querySelector('[data-action="guide-next"]');
    if (prevButton) {
      prevButton.toggleAttribute("disabled", clamped <= Math.min(...steps));
    }
    if (nextButton) {
      nextButton.toggleAttribute("disabled", clamped >= Math.max(...steps));
    }
    return true;
  }

  function getTemplateDefaultPath(templateKey, displayName = "") {
    const safeName = String(displayName || "").trim().replace(/\s+/g, "-").toLowerCase();
    if (templateKey === "login") {
      return "/auth";
    }
    if (templateKey === "pagination") {
      return safeName ? `/${safeName}` : "/items";
    }
    if (templateKey === "search") {
      return safeName ? `/${safeName}/search` : "/search";
    }
    if (templateKey === "upload") {
      return safeName ? `/${safeName}` : "/files";
    }
    if (templateKey === "batch") {
      return safeName ? `/${safeName}` : "/batch-resource";
    }
    return safeName ? `/${safeName}` : "/resources";
  }

  function syncTemplatePath(templateKey, displayName, basePathInput) {
    if (!basePathInput) {
      return;
    }
    const suggested = getTemplateDefaultPath(templateKey, displayName);
    const currentValue = String(basePathInput.value || "").trim();
    if (!currentValue || currentValue === basePathInput.dataset.suggestedPath) {
      basePathInput.value = suggested;
    }
    basePathInput.dataset.suggestedPath = suggested;
    basePathInput.placeholder = suggested;
  }

  function setFieldVisibility(fieldNode, visible) {
    if (!fieldNode) {
      return;
    }
    fieldNode.classList.toggle("is-hidden", !visible);
  }

  function syncAssertionRow(row) {
    if (!row) {
      return;
    }
    const type = String(row.querySelector('[name="assertionType"]')?.value || "status");
    row.dataset.assertionKind = type;
    setFieldVisibility(row.querySelector('[data-assertion-field="path"]'), !["status", "responseTime", "bodyContains"].includes(type));
    setFieldVisibility(row.querySelector('[data-assertion-field="operator"]'), !["jsonSchema"].includes(type));
    setFieldVisibility(row.querySelector('[data-assertion-field="expected"]'), !["jsonSchema", "exists"].includes(type));
    setFieldVisibility(row.querySelector('[data-assertion-field="name"]'), type === "headerEquals");
    setFieldVisibility(row.querySelector('[data-assertion-field="schema"]'), type === "jsonSchema");

    const pathInput = row.querySelector('[name="assertionPath"]');
    const expectedInput = row.querySelector('[name="assertionExpected"]');
    const nameInput = row.querySelector('[name="assertionName"]');
    const schemaInput = row.querySelector('[name="assertionSchema"]');
    if (pathInput) {
      pathInput.placeholder =
        type === "xpath" ? "//item/text()" : type === "headerEquals" ? "" : type === "bodyContains" ? "" : "$.data.id";
    }
    if (expectedInput) {
      expectedInput.placeholder =
        type === "status"
          ? "200"
          : type === "responseTime"
            ? "2000"
            : type === "fieldType"
              ? "string"
              : "success";
    }
    if (nameInput) {
      nameInput.placeholder = "content-type";
    }
    if (schemaInput) {
      schemaInput.placeholder = '{"type":"object","required":["id"]}';
    }
  }

  function syncExtractRow(row) {
    if (!row) {
      return;
    }
    const source = String(row.querySelector('[name="extractSource"]')?.value || "jsonPath");
    row.dataset.extractKind = source;
    setFieldVisibility(row.querySelector('[data-extract-field="path"]'), source === "jsonPath" || source === "xpath");
    setFieldVisibility(row.querySelector('[data-extract-field="header"]'), source === "header");
    const pathInput = row.querySelector('[name="extractPath"]');
    if (pathInput) {
      pathInput.placeholder = source === "xpath" ? "//token/text()" : "$.token";
    }
  }

  function syncBusinessTemplateForm(form) {
    if (!form) {
      return;
    }
    const templateKey = String(form.querySelector('[name="templateKey"]')?.value || "login");
    const displayName = String(form.querySelector('[name="displayName"]')?.value || "");
    syncTemplatePath(templateKey, displayName, form.querySelector('[name="basePath"]'));
  }

  function syncOpenApiForm(form) {
    if (!form) {
      return;
    }
    const starterMode = form.querySelector('[name="starterMode"]')?.value !== "false";
    ["projectId", "environmentId", "suiteName"].forEach((name) => {
      setFieldVisibility(form.querySelector(`[name="${name}"]`)?.closest(".field"), starterMode);
    });
  }

  function syncSceneBuilderForm(form) {
    if (!form) {
      return;
    }

    const source = String(form.querySelector('[name="sceneSource"]')?.value || "apis");
    form.querySelectorAll(".scene-source-card").forEach((node) => {
      node.classList.toggle("is-active", node.dataset.value === source);
    });
    form.querySelectorAll("[data-scene-section]").forEach((node) => {
      node.classList.toggle("is-hidden", node.dataset.sceneSection !== source);
    });

    syncTemplatePath(
      String(form.querySelector('[name="templateKey"]')?.value || "login"),
      String(form.querySelector('[name="templateDisplayName"]')?.value || ""),
      form.querySelector('[name="templateBasePath"]')
    );

    const query = String(form.querySelector('[name="sceneApiQuery"]')?.value || "").trim().toLowerCase();
    const moduleId = String(form.querySelector('[name="sceneApiModuleId"]')?.value || "all");
    let visibleCount = 0;
    let selectedCount = 0;
    form.querySelectorAll("[data-scene-api-item]").forEach((node) => {
      const text = `${node.dataset.apiName || ""} ${node.dataset.apiPath || ""} ${node.dataset.apiMethod || ""}`.toLowerCase();
      const matchesQuery = !query || text.includes(query);
      const matchesModule = moduleId === "all" || node.dataset.apiModuleId === moduleId;
      const visible = matchesQuery && matchesModule;
      const checked = Boolean(node.querySelector('input[name="sceneApiId"]')?.checked);
      node.classList.toggle("is-selected", checked);
      node.classList.toggle("is-hidden", !visible);
      if (visible) {
        visibleCount += 1;
      }
      if (checked) {
        selectedCount += 1;
      }
    });

    const countNode = form.querySelector("[data-scene-api-count]");
    if (countNode) {
      countNode.textContent = `已选 ${selectedCount} 个接口`;
    }

    const emptyNode = form.querySelector("[data-scene-api-empty]");
    if (emptyNode) {
      emptyNode.classList.toggle("is-hidden", visibleCount > 0);
    }
  }

  function buildExecutionImpactSummary({ form, model, sourceType, suite, caseIds = [] }) {
    const selectedEnvironmentId = String(form?.querySelector('[name="environmentId"]')?.value || suite?.defaultEnvironmentId || model.environments[0]?.id || "");
    const selectedEnvironment = model.environments.find((item) => item.id === selectedEnvironmentId) || model.environments[0] || null;
    const priority = String(form?.querySelector('[name="priority"]')?.value || "normal");
    const timeoutSeconds = Number(form?.querySelector('[name="timeoutSeconds"]')?.value || suite?.timeoutSeconds || 300);
    const failureStrategy = String(form?.querySelector('[name="failureStrategy"]')?.value || suite?.failureStrategy || "stop");
    const maxRetries = Number(form?.querySelector('[name="maxRetries"]')?.value || suite?.executionConfig?.maxRetries || 0);
    const stopOnDatasetFailure = String(form?.querySelector('[name="stopOnDatasetFailure"]')?.value || "true") !== "false";

    let summary = {
      targetName: sourceType === "batch-cases" ? "批量用例" : suite?.name || "未命名场景",
      targetLabel: sourceType === "batch-cases" ? "本次批量执行" : "本次场景执行",
      environmentName: selectedEnvironment?.name || "未选择环境",
      priorityText: priority === "high" ? "高优先级" : priority === "low" ? "低优先级" : "普通优先级",
      timeoutText: `${Number.isFinite(timeoutSeconds) ? timeoutSeconds : 300} 秒超时`,
      failureText: failureStrategy === "continue" ? "失败继续" : "失败即停",
      retryText: maxRetries > 0 ? `失败重试 ${maxRetries} 次` : "不自动重试",
      datasetText: stopOnDatasetFailure ? "数据行失败即停" : "数据行失败继续",
      chips: [],
      notes: []
    };

    if (sourceType === "batch-cases") {
      const selectedCases = model.cases.filter((item) => caseIds.includes(item.id));
      const selectedApis = new Set(selectedCases.map((item) => item.apiId).filter(Boolean));
      const hasLoginCase = selectedCases.some((item) => /login|signin|auth|token|session/i.test(`${item.name} ${item.apiName}`));
      summary.chips = [
        `${selectedCases.length} 条用例`,
        `${selectedApis.size} 个接口`,
        hasLoginCase ? "包含登录校验" : ""
      ].filter(Boolean);
      summary.notes = [
        `会直接执行当前勾选的 ${selectedCases.length} 条用例，不经过场景编排顺序。`,
        hasLoginCase ? "当前批次包含登录或鉴权相关用例，更适合先确认环境可用性。" : "当前批次更像离散接口回归，适合快速确认核心接口是否还能跑通。"
      ];
      return summary;
    }

    const orderedItems = suite?.items?.slice().sort((a, b) => a.order - b.order) || [];
    const caseItems = orderedItems.filter((item) => item.itemType !== "suite");
    const childSuites = orderedItems.filter((item) => item.itemType === "suite");
    const apiCount = new Set(caseItems.map((item) => `${item.method || "GET"} ${item.path || "/"}`)).size;
    const setupCount = orderedItems.filter((item) => item.role === "setup").length;
    const teardownCount = orderedItems.filter((item) => item.role === "teardown").length;
    const hasLoginChain = orderedItems.some((item) => /login|signin|auth|token|session/i.test(`${item.caseName || ""} ${item.path || ""} ${item.roleText || ""}`) || item.role === "setup");
    const variablePreview = buildSuiteVariablePreview(suite, model);
    const variableReads = variablePreview.reduce((sum, item) => sum + (item.inputs?.length || 0), 0);
    const variableWrites = variablePreview.reduce((sum, item) => sum + (item.outputs?.length || 0), 0);
    const variableValuePreview = buildExecutionVariablePreview({
      suite,
      model,
      environment: selectedEnvironment
    });
    const latestRun = state.data?.runs?.find((run) => run.suiteId === suite?.id) || null;
    const latestFailedStep = latestRun?.steps?.find((step) => step.status === "failed") || null;

    summary.chips = [
      `${orderedItems.length} 步`,
      `${apiCount} 个接口`,
      childSuites.length ? `${childSuites.length} 个子场景` : "",
      hasLoginChain ? "包含登录链路" : ""
    ].filter(Boolean);
    summary.notes = [
      `预计会读取 ${variableReads} 个前置变量，产出 ${variableWrites} 个变量。`,
      setupCount || teardownCount
        ? `当前链路包含 ${setupCount} 个前置步骤、${teardownCount} 个后置步骤。`
        : "当前链路主要由业务步骤组成，适合直接验证接口串联是否稳定。",
      latestFailedStep
        ? `最近一次主要卡在 ${latestFailedStep.caseName || latestFailedStep.apiName || "未知步骤"}。`
        : "最近没有明显失败热点，可以把这次执行当成稳定性确认。"
    ];
    summary.variableValuePreview = variableValuePreview;
    return summary;
  }

  function renderVariablePreviewGroup(title, items = [], emptyText = "") {
    return `
      <article class="execution-variable-card">
        <strong>${escapeHtml(title)}</strong>
        ${
          items.length
            ? `
              <div class="execution-variable-list">
                ${items
                  .map(
                    (item) => `
                      <div class="execution-variable-item">
                        <div class="execution-variable-head">
                          <span class="route-chip route-chip-${escapeHtml(item.tone || "context")}">${escapeHtml(item.label)}</span>
                          <strong>${escapeHtml(item.value)}</strong>
                        </div>
                        <span>${escapeHtml(item.source)}</span>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            `
            : `<p class="subdued-text">${escapeHtml(emptyText)}</p>`
        }
      </article>
    `;
  }

  function renderExecutionImpactSummary(summary) {
    return `
      <section class="builder-note full-span execution-impact-note" data-execution-impact-note="true">
        <strong>${escapeHtml(summary.targetLabel)}</strong>
        <p>${escapeHtml(`目标：${summary.targetName} · 环境：${summary.environmentName}`)}</p>
        <div class="execution-impact-chip-list">
          ${(summary.chips || []).map((item) => `<span class="route-chip">${escapeHtml(item)}</span>`).join("")}
          <span class="route-chip">${escapeHtml(summary.priorityText)}</span>
          <span class="route-chip">${escapeHtml(summary.timeoutText)}</span>
          <span class="route-chip">${escapeHtml(summary.failureText)}</span>
          <span class="route-chip">${escapeHtml(summary.retryText)}</span>
          <span class="route-chip">${escapeHtml(summary.datasetText)}</span>
        </div>
        <div class="execution-impact-list">
          ${(summary.notes || []).map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
        </div>
        ${
          summary.variableValuePreview
            ? `
              <div class="execution-variable-preview">
                ${renderVariablePreviewGroup("执行前已知变量", summary.variableValuePreview.known, "当前还没有执行前可直接确定的变量值。")}
                ${renderVariablePreviewGroup("运行时产出变量", summary.variableValuePreview.runtime, "这次链路里没有依赖前置步骤产出的运行时变量。")}
                ${renderVariablePreviewGroup("待确认上下文", [...summary.variableValuePreview.contexts, ...summary.variableValuePreview.missing], "当前没有待确认的上下文或缺失变量。")}
              </div>
            `
            : ""
        }
      </section>
    `;
  }

  function syncExecutionConfigForm(form) {
    if (!form) {
      return;
    }

    const model = buildViewModel();
    const sourceType = String(form.querySelector('[name="sourceType"]')?.value || "suite");
    const suiteId = String(form.querySelector('[name="suiteId"]')?.value || state.selectedSuiteId || "");
    const suite = sourceType === "suite" ? model.suites.find((item) => item.id === suiteId) || null : null;
    const caseIds =
      sourceType === "batch-cases"
        ? [...form.querySelectorAll('input[name="caseIds[]"]')].map((node) => String(node.value || "")).filter(Boolean)
        : [];
    const summary = buildExecutionImpactSummary({ form, model, sourceType, suite, caseIds });
    const summaryNode = form.querySelector('[data-execution-impact-note="true"]');
    if (summaryNode) {
      summaryNode.outerHTML = renderExecutionImpactSummary(summary);
    }
  }

  function syncStepForm(form) {
    if (!form) {
      return;
    }

    const itemType = String(form.querySelector('[name="itemType"]')?.value || "case");
    setFieldVisibility(form.querySelector('[name="caseId"]')?.closest(".field"), itemType === "case");
    setFieldVisibility(form.querySelector('[name="suiteIdRef"]')?.closest(".field"), itemType === "suite");

    const conditionMode = String(form.querySelector('[name="conditionMode"]')?.value || "always");
    setFieldVisibility(form.querySelector('[name="conditionScope"]')?.closest(".field"), conditionMode !== "always" && conditionMode !== "custom");
    setFieldVisibility(form.querySelector('[name="conditionVarName"]')?.closest(".field"), conditionMode !== "always" && conditionMode !== "custom");
    setFieldVisibility(form.querySelector('[name="conditionExpected"]')?.closest(".field"), conditionMode === "equals");
    setFieldVisibility(form.querySelector('[name="conditionScript"]')?.closest(".field"), conditionMode === "custom");

    const conditionNote = form.querySelector("[data-step-condition-note]");
    if (conditionNote) {
      const noteText =
        conditionMode === "always"
          ? "当前步骤不加执行条件，会按场景顺序直接执行。"
          : conditionMode === "exists"
            ? "只有当指定变量已经存在时，当前步骤才会继续执行。"
            : conditionMode === "missing"
              ? "只有当指定变量还不存在时，当前步骤才会执行。"
              : conditionMode === "equals"
                ? "常用于判断前一步提取的变量值，例如状态、类型、开关位。"
                : "自定义表达式基于当前执行器能力，支持 vars / env / suite / dataset。";
      conditionNote.querySelector("p").textContent = noteText;
    }

    const parallelMode = String(form.querySelector('[name="parallelMode"]')?.value || "serial");
    setFieldVisibility(form.querySelector('[name="parallelGroupValue"]')?.closest(".field"), parallelMode === "custom");
    const parallelNote = form.querySelector("[data-step-parallel-note]");
    if (parallelNote) {
      const previousStepName = String(form.querySelector('[name="stepPreviousName"]')?.value || "");
      const previousGroup = String(form.querySelector('[name="stepPreviousParallelGroup"]')?.value || "");
      let noteText = "当前步骤会按顺序串行执行，不和其他步骤并发。";
      if (parallelMode === "inherit") {
        noteText = previousStepName
          ? previousGroup
            ? `会加入上一条步骤“${previousStepName}”所在的并行组，和它同组执行。`
            : `会把当前步骤和上一条步骤“${previousStepName}”一起放进新的并行组。`
          : "当前前面还没有步骤，无法直接加入上一组并行。";
      } else if (parallelMode === "custom") {
        noteText = "为当前步骤指定一个并行组名，后续相同组名的相邻步骤会并行执行。";
      }
      parallelNote.querySelector("p").textContent = noteText;
    }
  }

  function syncModalDynamicState() {
    modalRoot.querySelectorAll('[data-editor-row="assertions"]').forEach(syncAssertionRow);
    modalRoot.querySelectorAll('[data-editor-row="extracts"]').forEach(syncExtractRow);
    syncBusinessTemplateForm(modalRoot.querySelector('[data-modal-type="business-template"]'));
    syncOpenApiForm(modalRoot.querySelector('[data-modal-type="openapi"]'));
    syncSceneBuilderForm(modalRoot.querySelector('[data-modal-type="scene-builder"]'));
    syncExecutionConfigForm(modalRoot.querySelector('[data-modal-type="execution-config"]'));
    syncStepForm(modalRoot.querySelector('[data-modal-type="step"]'));
    showGuideStep(Number(modalRoot.querySelector('[data-modal-type="starter-guide"] [name="guideStep"]')?.value || 1));
    applyModalFocusGuide();
  }

  function applyModalFocusGuide() {
    const modalForm = modalRoot.querySelector(".modal-form");
    if (!modalForm) {
      return;
    }

    const focusField = String(state.modal?.data?.focusField || "");
    const focusVariable = String(state.modal?.data?.focusVariable || "").trim();
    if (!focusField) {
      return;
    }

    modalForm.querySelectorAll(".is-focus-target").forEach((node) => node.classList.remove("is-focus-target"));

    const focusNode =
      modalForm.querySelector(`[data-focus-field="${focusField}"]`) ||
      modalForm.querySelector(`[name="${focusField}"]`)?.closest(".field") ||
      null;
    if (focusNode) {
      focusNode.classList.add("is-focus-target");
      focusNode.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    let inputToFocus =
      modalForm.querySelector(`[name="${focusField}"]`) ||
      focusNode?.querySelector("input, select, textarea") ||
      null;

    if (focusField === "envVariables" && focusVariable) {
      const rows = [...modalForm.querySelectorAll('[data-editor-row="env-variables"]')];
      const matchedRow = rows.find((row) => String(row.querySelector('[name="envVariableKey"]')?.value || "").trim() === focusVariable);
      inputToFocus = matchedRow?.querySelector('[name="envVariableValue"]') || inputToFocus;
    }

    if (inputToFocus && typeof inputToFocus.focus === "function") {
      requestAnimationFrame(() => {
        inputToFocus.focus();
        if (typeof inputToFocus.select === "function" && inputToFocus.tagName === "INPUT") {
          inputToFocus.select();
        }
      });
    }
  }

  function openModal(type, data = {}) {
    if (!type) {
      state.modal = null;
      renderModal();
      return;
    }
    if (type === "starter-guide") {
      markStarterGuideSeen();
    }
    state.modal = { type, data };
    renderModal();
  }

  function closeModal(force = false) {
    if (!force && state.modal?.data?.locked) {
      return;
    }
    state.modal = null;
    renderModal();
  }

  function ensureForcedPasswordChangeModal() {
    if (!isAuthenticated() || !state.auth.requirePasswordChange) {
      return;
    }
    if (state.modal?.type === "change-password") {
      return;
    }
    openModal("change-password", {
      locked: true,
      subtitle: "当前账号需要先完成改密，才能继续使用系统。"
    });
    showToast("当前账号需要先修改密码");
  }

  function renderModal() {
    if (!state.modal) {
      modalRoot.innerHTML = "";
      return;
    }

    if (state.modal.type === "detail") {
      modalRoot.innerHTML = renderDetailModal(state.modal.data);
      return;
    }

    modalRoot.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal">
        ${renderFormModal(state.modal.type, state.modal.data)}
      </div>
    `;
    syncModalDynamicState();
  }

  function renderModalShell({ title, subtitle = "", body = "", actions = "", formType = "" }) {
    const content = formType
      ? `
        <form class="modal-form" data-modal-type="${formType}">
          <div class="modal-body">${body}</div>
          <div class="modal-actions">${actions}</div>
        </form>
      `
      : `
        <div class="modal-detail">
          <div class="modal-body">${body}</div>
          ${actions ? `<div class="modal-actions">${actions}</div>` : ""}
        </div>
      `;

    return `
      <div class="modal-header">
        <div>
          <h2>${escapeHtml(title)}</h2>
          ${subtitle ? `<p class="panel-subtitle">${escapeHtml(subtitle)}</p>` : ""}
        </div>
        <button class="modal-close" data-action="close-modal">×</button>
      </div>
      ${content}
    `;
  }

  function renderFormModal(type, data) {
    const model = buildViewModel();
    const currentEnv = model.environments.find((env) => env.id === data.envId) || null;
    const currentApi = model.apis.find((apiItem) => apiItem.id === data.recordId) || null;
    const currentCase = model.cases.find((testCase) => testCase.id === data.recordId) || null;
    const currentUser = model.users.find((user) => user.id === data.recordId) || null;
    const currentSuite = model.suites.find((suite) => suite.id === (data.suiteId || state.selectedSuiteId)) || null;
    const currentStep = currentSuite?.items.find((item) => item.id === data.stepId) || null;

    const renderEnvironmentRepairGuide = () => {
      if (type !== "environment" || !data.repairKey) {
        return "";
      }

      const titleMap = {
        baseUrl: "正在修复 Base URL",
        headers: "正在修复公共 Header",
        auth: "正在修复鉴权配置",
        variables: "正在修复环境变量",
        probe: "正在处理连通性问题",
        runner: "正在处理执行器问题"
      };

      const suggestionMap = {
        baseUrl: "优先确认协议、域名、端口和基础路径是否正确。",
        headers: "如果服务需要公共租户头、应用头或固定标识，建议先在这里补齐。",
        auth: "先确认鉴权方式，再补 Token、API Key 或请求头名称。",
        variables: "如果接口模板里引用了 env.variables.xxx，这里要提供对应变量。",
        probe: "连通性失败通常先看地址，再看鉴权，最后再看网络链路。",
        runner: "执行器不可用不是环境表单能完全修掉的问题，但可以先检查本环境配置是否完整。"
      };

      const title = titleMap[data.repairKey] || "正在修复环境配置";
      const message = String(data.repairMessage || "").trim();
      const detail = data.focusVariable ? `建议先处理变量 ${data.focusVariable}` : suggestionMap[data.repairKey] || "";
      const envId = String(currentEnv?.id || data.envId || "");
      const missingVariables =
        data.repairKey === "variables"
          ? (state.environmentDiagnostics?.[envId]?.diagnostics?.missingEnvVariables || [])
              .map((item) => String(item || "").trim())
              .filter(Boolean)
          : [];

      return `
        <section class="repair-guide-card full-span">
          <div class="repair-guide-head">
            <strong>${escapeHtml(title)}</strong>
            ${currentEnv ? `<span class="route-chip">${escapeHtml(currentEnv.displayName)}</span>` : ""}
          </div>
          ${message ? `<p>${escapeHtml(message)}</p>` : ""}
          ${detail ? `<div class="subdued-text">${escapeHtml(detail)}</div>` : ""}
          ${
            missingVariables.length
              ? `
                <div class="repair-guide-actions">
                  <button type="button" class="secondary-button small-button" data-action="fill-missing-env-variables">一键补入缺失变量名</button>
                  <span class="subdued-text">待补：${escapeHtml(missingVariables.slice(0, 4).join(", "))}${missingVariables.length > 4 ? " ..." : ""}</span>
                </div>
              `
              : ""
          }
          ${
            data.repairKey === "auth" || (data.repairKey === "probe" && data.focusField === "authValue")
              ? `
                <div class="repair-guide-actions">
                  <button type="button" class="secondary-button small-button" data-action="apply-auth-quick-fix" data-mode="bearer">一键切到 Bearer</button>
                  <button type="button" class="secondary-button small-button" data-action="apply-auth-quick-fix" data-mode="apikey">一键切到 API Key</button>
                  <span class="subdued-text">系统会帮你补默认头名，剩下只需要填真实 Token 或 Key。</span>
                </div>
              `
              : ""
          }
          ${
            data.repairKey === "headers"
              ? `
                <div class="repair-guide-actions">
                  <button type="button" class="secondary-button small-button" data-action="add-env-header-quick-fix" data-header-key="x-tenant-id">补 x-tenant-id</button>
                  <button type="button" class="secondary-button small-button" data-action="add-env-header-quick-fix" data-header-key="x-app-id">补 x-app-id</button>
                  <span class="subdued-text">如果目标服务要求公共租户头或应用头，可以先从这两个常见字段开始。</span>
                </div>
              `
              : ""
          }
        </section>
      `;
    };

    if (type === "api") {
      return renderModalShell({
        title: currentApi ? "编辑接口" : "新建接口",
        subtitle: "用表单向导配置接口定义，请求参数不再需要手写 JSON。",
        formType: "api",
        body: `
          ${currentApi ? `<input type="hidden" name="id" value="${currentApi.id}" />` : ""}
          <div class="modal-grid">
            ${fieldSelect("moduleId", "所属模块", model.modules.map((item) => ({ value: item.id, label: item.name })), currentApi?.moduleId)}
            ${fieldInput("name", "接口名称", currentApi?.name || "")}
            ${fieldInput("creator", "创建人", currentApi?.creator || "系统")}
            ${fieldSelect("method", "请求方法", ["GET", "POST", "PUT", "PATCH", "DELETE"].map((item) => ({ value: item, label: item })), currentApi?.method || "GET")}
            ${fieldInput("path", "接口路径", currentApi?.path || "/api/v1/example")}
            ${fieldSelect("status", "接口状态", [{ value: "active", label: "正常" }, { value: "deprecated", label: "已废弃" }], currentApi?.status || "active")}
            ${renderTagField("tags", "标签", formatTagInput(currentApi?.tags))}
            ${fieldSelect("bodyMode", "Body 模式", ["none", "json", "raw"].map((item) => ({ value: item, label: item })), currentApi?.bodyMode || "json")}
            ${renderKeyValueEditor({
              editorType: "headers",
              title: "请求头",
              rows: toKeyValueRows(currentApi?.headers),
              keyName: "headerKey",
              valueName: "headerValue",
              keyLabel: "Header",
              valueLabel: "值",
              keyPlaceholder: "content-type",
              valuePlaceholder: "application/json",
              addLabel: "添加 Header"
            })}
            ${renderKeyValueEditor({
              editorType: "query",
              title: "Query 参数",
              rows: toKeyValueRows(currentApi?.query),
              keyName: "queryKey",
              valueName: "queryValue",
              keyLabel: "参数名",
              valueLabel: "参数值",
              keyPlaceholder: "page",
              valuePlaceholder: "1",
              addLabel: "添加 Query"
            })}
            <div class="field full-span">
              <label>请求体模板</label>
              <textarea name="bodyTemplate" spellcheck="false" placeholder='{"name":"demo"}'>${escapeHtml(normalizeBodyTemplate(currentApi?.bodyTemplate || (currentApi?.bodyMode === "json" ? {} : "")))}</textarea>
              ${renderBuilderHint("这里填写接口请求体示例。支持 JSON，也支持普通文本。")}
            </div>
          </div>
        `,
        actions: `
          <button type="button" class="secondary-button" data-action="close-modal">取消</button>
          <button type="submit" class="primary-button">${currentApi ? "保存接口" : "创建接口"}</button>
        `
      });
    }

    if (type === "case") {
      return renderModalShell({
        title: currentCase ? "编辑用例" : "新建用例",
        subtitle: "通过可视化规则配置断言和变量提取，不再直接编辑 extracts / assertions JSON。",
        formType: "case",
        body: `
          ${currentCase ? `<input type="hidden" name="id" value="${currentCase.id}" />` : ""}
          <div class="modal-grid">
            ${fieldSelect("apiId", "关联接口", model.apis.map((item) => ({ value: item.id, label: `${item.name} · ${item.method}` })), currentCase?.apiId)}
            ${fieldInput("name", "用例名称", currentCase?.name || "")}
            ${fieldInput("creator", "创建人", currentCase?.creator || "系统")}
            ${fieldSelect(
              "priority",
              "优先级",
              [
                { value: "high", label: "高" },
                { value: "medium", label: "中" },
                { value: "low", label: "低" }
              ],
              currentCase?.priority || "medium"
            )}
            ${fieldTextarea("description", "描述", currentCase?.description || "", false, "full-span")}
            ${renderTagField("tags", "标签", formatTagInput(currentCase?.tags))}
            ${renderAssertionEditor(currentCase?.assertions)}
            ${renderExtractEditor(currentCase?.extracts)}
            ${renderKeyValueEditor({
              editorType: "override-headers",
              title: "覆盖 Headers",
              rows: toKeyValueRows(currentCase?.overrides?.headers),
              keyName: "overrideHeaderKey",
              valueName: "overrideHeaderValue",
              keyLabel: "Header",
              valueLabel: "值",
              keyPlaceholder: "authorization",
              valuePlaceholder: "Bearer {{vars.authToken}}",
              addLabel: "添加覆盖 Header"
            })}
            ${renderKeyValueEditor({
              editorType: "override-query",
              title: "覆盖 Query",
              rows: toKeyValueRows(currentCase?.overrides?.query),
              keyName: "overrideQueryKey",
              valueName: "overrideQueryValue",
              keyLabel: "参数名",
              valueLabel: "参数值",
              keyPlaceholder: "id",
              valuePlaceholder: "{{vars.resourceId}}",
              addLabel: "添加覆盖 Query"
            })}
            <div class="field full-span">
              <label>覆盖请求体</label>
              <textarea name="overrideBody" spellcheck="false" placeholder='{"name":"updated"}'>${escapeHtml(normalizeBodyTemplate(currentCase?.overrides?.body))}</textarea>
              ${renderBuilderHint("只有本条用例需要覆盖接口默认请求体时再填写。")}
            </div>
            ${fieldTextarea("preScript", "前置脚本", currentCase?.preScript || "", false)}
            ${fieldTextarea("postScript", "后置脚本", currentCase?.postScript || 'assert(response.status < 500, "response should not be 5xx");', false)}
          </div>
        `,
        actions: `
          <button type="button" class="secondary-button" data-action="close-modal">取消</button>
          <button type="submit" class="primary-button">${currentCase ? "保存用例" : "创建用例"}</button>
        `
      });
    }

    if (type === "business-template") {
      const templateOptions = getBusinessTemplateOptions();
      return renderModalShell({
        title: "业务模板中心",
        subtitle: "面向新手快速生成登录、增删改查、分页等常见接口与默认场景。",
        formType: "business-template",
        body: `
          <div class="modal-grid">
            ${fieldSelect("moduleId", "目标模块", model.modules.map((item) => ({ value: item.id, label: item.name })), model.modules[0]?.id)}
            ${fieldSelect("projectId", "所属项目", model.projects.map((item) => ({ value: item.id, label: item.name })), model.projects[0]?.id)}
            ${fieldSelect("environmentId", "默认环境", model.environments.map((item) => ({ value: item.id, label: item.name })), model.environments[0]?.id)}
            ${fieldSelect("templateKey", "模板类型", templateOptions.map((item) => ({ value: item.value, label: item.label })), "login")}
            ${fieldInput("displayName", "业务名称", "用户中心")}
            <div class="field">
              <label>基础路径</label>
              <input type="text" name="basePath" value="" placeholder="/auth 或 /users" />
              ${renderBuilderHint("不填会按模板类型自动给默认值，例如登录模板用 /auth，CRUD 模板用 /业务名称。")}
            </div>
            ${renderTagField("tags", "模板标签", "starter, template")}
            ${fieldSelect("createSuite", "自动生成默认场景", [{ value: "true", label: "是" }, { value: "false", label: "否" }], "true")}
          </div>
          <section class="template-gallery full-span">
            ${templateOptions
              .map(
                (item) => `
                  <article class="template-card">
                    <strong>${escapeHtml(item.label)}</strong>
                    <p>${escapeHtml(item.description)}</p>
                  </article>
                `
              )
              .join("")}
          </section>
        `,
        actions: `
          <button type="button" class="secondary-button" data-action="close-modal">取消</button>
          <button type="submit" class="primary-button">生成模板</button>
        `
      });
    }

    if (type === "scene-builder") {
      const templateOptions = getBusinessTemplateOptions();
      const activeSource = String(data.source || "apis");
      const selectedApiIds = new Set(
        Array.isArray(data.apiIds) && data.apiIds.length ? data.apiIds : state.selections.apis || []
      );
      return renderModalShell({
        title: "场景向导",
        subtitle: "按来源一步生成可直接执行的场景。支持业务模板、已有接口、OpenAPI 三种方式。",
        formType: "scene-builder",
        body: `
          <input type="hidden" name="sceneSource" value="${escapeHtml(activeSource)}" />
          <div class="scene-builder-progress full-span">
            <span class="scene-builder-progress-step is-active">1. 选来源</span>
            <span class="scene-builder-progress-step is-active">2. 补信息</span>
            <span class="scene-builder-progress-step is-active">3. 生成场景</span>
          </div>
          ${renderSceneBuilderSourcePicker(activeSource)}
          <div class="modal-grid">
            ${fieldInput("suiteName", "场景名称", data.suiteName || "新手向导场景")}
            ${fieldSelect("environmentId", "默认执行环境", model.environments.map((item) => ({ value: item.id, label: item.name })), model.environments[0]?.id)}
            ${fieldSelect(
              "autoRun",
              "生成后立即执行",
              [
                { value: "true", label: "是，生成后马上执行" },
                { value: "false", label: "否，只生成场景" }
              ],
              "true"
            )}
            ${fieldSelect(
              "runPriority",
              "执行优先级",
              [
                { value: "high", label: "高，适合首次验证" },
                { value: "normal", label: "普通" },
                { value: "low", label: "低" }
              ],
              "high"
            )}
            ${fieldTextarea("description", "场景描述", "由场景向导自动生成，可直接执行。", false, "full-span")}
            ${renderTagField("tags", "场景标签", "starter, smoke, guided")}

            <section class="builder-card full-span" data-scene-section="apis">
              <div class="builder-card-head">
                <div>
                  <strong>选择已有接口</strong>
                  ${renderBuilderHint("优先复用已有用例；若接口还没有用例，系统会自动补一条默认用例。")}
                </div>
              </div>
              <div class="scene-api-toolbar">
                <div class="field">
                  <label>搜索接口</label>
                  <input type="text" name="sceneApiQuery" value="" placeholder="按名称、方法或路径筛选" />
                </div>
                <div class="field">
                  <label>按模块筛选</label>
                  <select name="sceneApiModuleId">
                    <option value="all">全部模块</option>
                    ${model.modules.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")}
                  </select>
                </div>
              </div>
              <div class="scene-api-selection">
                ${model.apis
                  .map(
                    (item) => `
                      <label
                        class="scene-api-option ${selectedApiIds.has(item.id) ? "is-selected" : ""}"
                        data-scene-api-item
                        data-api-name="${escapeHtml(item.name)}"
                        data-api-path="${escapeHtml(item.path)}"
                        data-api-method="${escapeHtml(item.method)}"
                        data-api-module-id="${escapeHtml(item.moduleId)}"
                      >
                        <input type="checkbox" name="sceneApiId" value="${escapeHtml(item.id)}" ${selectedApiIds.has(item.id) ? "checked" : ""} />
                        <div>
                          <strong>${escapeHtml(item.name)}</strong>
                          <p>${escapeHtml(`${item.method} ${item.path}`)}</p>
                          <span>${escapeHtml(model.modules.find((module) => module.id === item.moduleId)?.name || "未分组")}</span>
                        </div>
                      </label>
                    `
                  )
                  .join("")}
              </div>
              <div class="scene-builder-summary">
                <strong data-scene-api-count>已选 ${escapeHtml(String(selectedApiIds.size))} 个接口</strong>
                <p>默认用例会补充“状态码=200”和“响应时间 <= 3000ms”两条校验。若开启“立即执行”，生成后会自动跳到执行中心。</p>
              </div>
              <div class="empty-card is-hidden" data-scene-api-empty>没有匹配的接口，换个关键字或模块试试。</div>
            </section>

            <section class="builder-card full-span" data-scene-section="template">
              <div class="builder-card-head">
                <div>
                  <strong>选择业务模板</strong>
                  ${renderBuilderHint("适合快速起一个登录、CRUD、分页、搜索、上传或批量操作的标准场景。")}
                </div>
              </div>
              <div class="modal-grid">
                ${fieldSelect("templateProjectId", "所属项目", model.projects.map((item) => ({ value: item.id, label: item.name })), model.projects[0]?.id)}
                ${fieldSelect("templateModuleId", "目标模块", model.modules.map((item) => ({ value: item.id, label: item.name })), model.modules[0]?.id)}
                ${fieldSelect("templateKey", "模板类型", templateOptions.map((item) => ({ value: item.value, label: item.label })), "login")}
                ${fieldInput("templateDisplayName", "业务名称", "用户中心")}
                <div class="field">
                  <label>基础路径</label>
                  <input type="text" name="templateBasePath" value="" placeholder="/auth 或 /users" />
                  ${renderBuilderHint("不填时会按模板类型自动给出建议路径。")}
                </div>
              </div>
              <section class="template-gallery full-span">
                ${templateOptions
                  .map(
                    (item) => `
                      <article class="template-card">
                        <strong>${escapeHtml(item.label)}</strong>
                        <p>${escapeHtml(item.description)}</p>
                      </article>
                    `
                  )
                  .join("")}
              </section>
            </section>

            <section class="builder-card full-span" data-scene-section="openapi">
              <div class="builder-card-head">
                <div>
                  <strong>导入 OpenAPI</strong>
                  ${renderBuilderHint("导入后会自动生成接口、默认用例，再组合成一个可执行场景。")}
                </div>
              </div>
              <div class="modal-grid">
                ${fieldSelect("openapiProjectId", "所属项目", model.projects.map((item) => ({ value: item.id, label: item.name })), model.projects[0]?.id)}
                ${fieldSelect("openapiModuleId", "目标模块", model.modules.map((item) => ({ value: item.id, label: item.name })), model.modules[0]?.id)}
                ${fieldTextarea("openapiSpec", "OpenAPI JSON", '{"openapi":"3.0.0","info":{"title":"demo","version":"1.0.0"},"paths":{}}', true, "full-span")}
              </div>
            </section>
          </div>
        `,
        actions: `
          <button type="button" class="secondary-button" data-action="close-modal">取消</button>
          <button type="submit" class="primary-button">生成场景</button>
        `
      });
    }

    if (type === "suite") {
      return renderModalShell({
        title: "新建场景",
        subtitle: "先创建场景，再到编排页添加步骤。",
        formType: "suite",
        body: `
          <div class="modal-grid">
            ${fieldSelect("projectId", "所属项目", model.projects.map((item) => ({ value: item.id, label: item.name })))}
            ${fieldInput("name", "场景名称")}
            ${fieldTextarea("description", "场景描述", "", false, "full-span")}
            ${renderTagField("tags", "标签", "smoke, core")}
            ${renderKeyValueEditor({
              editorType: "suite-variables",
              title: "场景变量",
              rows: [{ key: "", value: "" }],
              keyName: "suiteVariableKey",
              valueName: "suiteVariableValue",
              keyLabel: "变量名",
              valueLabel: "变量值",
              keyPlaceholder: "resourceId",
              valuePlaceholder: "10001",
              addLabel: "添加场景变量"
            })}
            ${fieldInput("intervalMinutes", "定时执行间隔(分钟)", "30", false, "number")}
          </div>
        `,
        actions: `
          <button type="button" class="secondary-button" data-action="close-modal">取消</button>
          <button type="submit" class="primary-button">创建场景</button>
        `
      });
    }

    if (type === "environment") {
      return renderModalShell({
        title: currentEnv ? "编辑环境" : "新建环境",
        subtitle: "按向导配置 base URL、公共 Header、环境变量和鉴权方式。",
        formType: "environment",
        body: `
          ${currentEnv ? `<input type="hidden" name="id" value="${currentEnv.id}" />` : ""}
          <div class="modal-grid">
            ${renderEnvironmentRepairGuide()}
            <div class="field" data-focus-field="name">
              <label>环境名称</label>
              <input type="text" name="name" value="${escapeHtml(currentEnv?.displayName || "")}" required />
            </div>
            <div class="field" data-focus-field="baseUrl">
              <label>Base URL</label>
              <input type="text" name="baseUrl" value="${escapeHtml(currentEnv?.baseUrl || "https://api.example.com")}" required />
            </div>
            ${fieldTextarea("description", "环境描述", currentEnv?.description || "", false, "full-span")}
            <div data-focus-field="headers" class="full-span">
            ${renderKeyValueEditor({
              editorType: "env-headers",
              title: "公共 Headers",
              rows: toKeyValueRows(currentEnv?.headersObject),
              keyName: "envHeaderKey",
              valueName: "envHeaderValue",
              keyLabel: "Header",
              valueLabel: "值",
              keyPlaceholder: "x-tenant-id",
              valuePlaceholder: "demo",
              addLabel: "添加公共 Header"
            })}
            </div>
            <div data-focus-field="envVariables" class="full-span">
            ${renderKeyValueEditor({
              editorType: "env-variables",
              title: "环境变量",
              rows: toKeyValueRows(currentEnv?.variablesObject),
              keyName: "envVariableKey",
              valueName: "envVariableValue",
              keyLabel: "变量名",
              valueLabel: "变量值",
              keyPlaceholder: "baseUserId",
              valuePlaceholder: "U1001",
              addLabel: "添加环境变量"
            })}
            </div>
            <div data-focus-field="authType" class="full-span">
              ${renderAuthBuilder(currentEnv?.authObject || { type: "none", value: "" })}
            </div>
          </div>
        `,
        actions: `
          <button type="button" class="secondary-button" data-action="close-modal">取消</button>
          <button type="submit" class="primary-button">${currentEnv ? "保存环境" : "创建环境"}</button>
        `
      });
    }

    if (type === "user") {
      return renderModalShell({
        title: currentUser ? "编辑用户" : "新建用户",
        subtitle: "管理员可创建账号、分配角色，并要求首次登录改密。",
        formType: "user",
        body: `
          ${currentUser ? `<input type="hidden" name="id" value="${currentUser.id}" />` : ""}
          <div class="modal-grid">
            ${fieldInput("name", "显示名称", currentUser?.name || "")}
            ${fieldInput("username", "登录账号", currentUser?.username || "")}
            ${fieldSelect("role", "角色", [{ value: "admin", label: "管理员" }, { value: "editor", label: "测试开发" }, { value: "viewer", label: "业务只读" }], currentUser?.role || "viewer")}
            ${fieldSelect("status", "账号状态", [{ value: "active", label: "启用" }, { value: "disabled", label: "禁用" }], currentUser?.status || "active")}
            ${fieldInput("password", currentUser ? "新密码(留空则不修改)" : "初始密码", "", !currentUser, "password")}
            ${fieldSelect("mustChangePassword", "首次登录改密", [{ value: "true", label: "要求修改" }, { value: "false", label: "不强制" }], currentUser?.mustChangePassword === false ? "false" : "true")}
          </div>
        `,
        actions: `
          <button type="button" class="secondary-button" data-action="close-modal">取消</button>
          <button type="submit" class="primary-button">${currentUser ? "保存用户" : "创建用户"}</button>
        `
      });
    }

    if (type === "change-password") {
      return renderModalShell({
        title: "修改密码",
        subtitle: data.subtitle || "修改当前登录账号的密码，至少 8 位，需包含字母和数字。",
        formType: "change-password",
        body: `
          <div class="modal-grid modal-grid-compact">
            ${fieldInput("currentPassword", "当前密码", "", true, "password")}
            ${fieldInput("nextPassword", "新密码", "", true, "password")}
            ${fieldInput("confirmPassword", "确认新密码", "", true, "password")}
          </div>
        `,
        actions: `
          <button type="button" class="secondary-button" data-action="close-modal">取消</button>
          <button type="submit" class="primary-button">更新密码</button>
        `
      });
    }

    if (type === "openapi") {
      return renderModalShell({
        title: "OpenAPI 新手导入",
        subtitle: "一键导入接口、默认断言，并可自动生成一个可直接执行的默认场景。",
        formType: "openapi",
        body: `
          <div class="modal-grid">
            ${fieldSelect("moduleId", "目标模块", model.modules.map((item) => ({ value: item.id, label: item.name })), model.modules[0]?.id)}
            ${fieldSelect("projectId", "场景所属项目", model.projects.map((item) => ({ value: item.id, label: item.name })), model.projects[0]?.id)}
            ${fieldSelect("environmentId", "默认执行环境", model.environments.map((item) => ({ value: item.id, label: item.name })), model.environments[0]?.id)}
            ${fieldSelect("starterMode", "导入模式", [{ value: "true", label: "新手模式：同时生成默认场景" }, { value: "false", label: "仅导入接口和用例" }], "true")}
            ${fieldInput("suiteName", "默认场景名称", "OpenAPI 默认场景")}
            ${fieldTextarea("spec", "OpenAPI JSON", '{"openapi":"3.0.0","info":{"title":"demo","version":"1.0.0"},"paths":{}}', true, "full-span")}
          </div>
        `,
        actions: `
          <button type="button" class="secondary-button" data-action="close-modal">取消</button>
          <button type="submit" class="primary-button">开始导入</button>
        `
      });
    }

    if (type === "starter-guide") {
      const activeStep = Number(data.guideStep || 1);
      const guideAssertions = data.assertions || [
        { type: "status", path: "", operator: "equals", expected: "200", name: "", schema: "" },
        { type: "exists", path: "$.data.id", operator: "equals", expected: "", name: "", schema: "" }
      ];
      return renderModalShell({
        title: "第一次使用引导",
        subtitle: "按“选环境 -> 选接口 -> 设校验 -> 点执行”走一遍，新手也能快速做出第一条接口自动化。",
        formType: "starter-guide",
        body: `
          <input type="hidden" name="guideStep" value="${escapeHtml(String(activeStep))}" />
          <div class="guide-progress">
            ${[1, 2, 3, 4]
              .map(
                (step) => `
                  <button type="button" class="guide-progress-step ${step === activeStep ? "is-active" : step < activeStep ? "is-complete" : ""}" data-action="open-guide-step" data-step="${step}" data-guide-progress-step="${step}">
                    <span>${step}</span>
                  </button>
                `
              )
              .join("")}
          </div>
          ${renderGuideStep(
            "选择环境",
            "决定这次测试发往哪个系统地址。",
            fieldSelect("environmentId", "执行环境", model.environments.map((item) => ({ value: item.id, label: `${item.name} · ${item.baseUrl}` })), model.environments[0]?.id),
            1,
            activeStep
          )}
          ${renderGuideStep(
            "选择接口",
            "挑一个已经存在的接口作为第一条自动化测试。",
            `
              ${fieldSelect("apiId", "测试接口", model.apis.map((item) => ({ value: item.id, label: `${item.name} · ${item.method} ${item.path}` })), model.apis[0]?.id)}
              ${fieldInput("caseName", "用例名称", "新手引导 · 首条自动化")}
            `,
            2,
            activeStep
          )}
          ${renderGuideStep(
            "设置校验",
            "给这条接口加上最常见的通过标准。",
            renderAssertionEditor(guideAssertions),
            3,
            activeStep
          )}
          ${renderGuideStep(
            "开始执行",
            "系统会自动创建一条用例、一个最小场景，并立刻执行。",
            `
              ${fieldInput("suiteName", "场景名称", "新手引导场景")}
              ${renderTagField("guideTags", "引导标签", "starter, guide, smoke")}
              <div class="builder-note">
                <strong>执行后你会得到：</strong>
                <p>1 条新用例、1 个新场景，以及 1 次实际执行记录。</p>
              </div>
            `,
            4,
            activeStep
          )}
        `,
        actions: `
          <button type="button" class="secondary-button" data-action="skip-starter-guide">以后再说</button>
          <button type="button" class="secondary-button" data-action="guide-prev">上一步</button>
          <button type="button" class="secondary-button" data-action="guide-next">下一步</button>
          <button type="submit" class="primary-button">创建并执行</button>
        `
      });
    }

    if (type === "step") {
      const availableSuites = model.suites.filter((item) => item.id !== (currentSuite?.id || data.suiteId || state.selectedSuiteId));
      const currentItemType = currentStep?.itemType === "suite" ? "suite" : "case";
      const previousStep = getPreviousSuiteStep(currentSuite, currentStep?.id || "");
      const parallelConfig = parseStepParallelConfig(currentStep, previousStep);
      const conditionConfig = parseStepConditionConfig(currentStep?.condition || "");
      return renderModalShell({
        title: currentStep ? "编辑步骤" : "添加步骤",
        subtitle: currentStep ? "调整当前步骤的执行控制、并行分支、子场景和工厂角色。" : "可添加普通用例步骤，也可以引用子场景作为可复用节点。",
        formType: "step",
        body: `
          <input type="hidden" name="suiteId" value="${escapeHtml(currentSuite?.id || data.suiteId || state.selectedSuiteId || "")}" />
          ${currentStep ? `<input type="hidden" name="stepId" value="${escapeHtml(currentStep.id)}" />` : ""}
          <input type="hidden" name="stepPreviousId" value="${escapeHtml(previousStep?.id || "")}" />
          <input type="hidden" name="stepPreviousName" value="${escapeHtml(previousStep?.caseName || "")}" />
          <input type="hidden" name="stepPreviousParallelGroup" value="${escapeHtml(previousStep?.parallelGroup || "")}" />
          <div class="modal-grid">
            ${fieldSelect(
              "itemType",
              "步骤类型",
              [
                { value: "case", label: "普通用例" },
                { value: "suite", label: "子场景复用" }
              ],
              currentItemType
            )}
            ${fieldSelect("caseId", "选择用例", model.cases.map((item) => ({ value: item.id, label: `${item.displayId} · ${item.name}` })), currentStep?.caseId)}
            ${fieldSelect("suiteIdRef", "引用子场景", [{ value: "", label: "不引用" }, ...availableSuites.map((item) => ({ value: item.id, label: item.name }))], currentStep?.suiteId || "")}
            ${fieldSelect(
              "role",
              "步骤角色",
              [
                { value: "setup", label: "前置工厂" },
                { value: "test", label: "业务步骤" },
                { value: "teardown", label: "后置清理" }
              ],
              currentStep?.role || "test"
            )}
            ${fieldSelect(
              "enabled",
              "步骤状态",
              [
                { value: "true", label: "启用" },
                { value: "false", label: "禁用" }
              ],
              currentStep?.enabled === false ? "false" : "true"
            )}
            ${fieldSelect(
              "continueOnFailure",
              "失败控制",
              [
                { value: "false", label: "失败即停" },
                { value: "true", label: "失败继续" }
              ],
              currentStep?.continueOnFailure ? "true" : "false"
            )}
            ${fieldInput("timeoutMs", "步骤超时(毫秒，可留空)", currentStep?.timeoutMs ? String(currentStep.timeoutMs) : "", false, "number")}
            ${fieldSelect(
              "parallelMode",
              "执行顺序",
              [
                { value: "serial", label: "串行执行" },
                { value: "inherit", label: previousStep ? "与上一条组成并行" : "与上一条组成并行（当前不可用）" },
                { value: "custom", label: "自定义并行组" }
              ],
              previousStep ? parallelConfig.mode : parallelConfig.mode === "inherit" ? "serial" : parallelConfig.mode
            )}
            ${fieldInput("parallelGroupValue", "并行组名称", parallelConfig.value || "", false)}
            <div class="builder-note full-span" data-step-parallel-note>
              <strong>并行效果</strong>
              <p>${escapeHtml(previousStep ? "当前会根据你的选择自动生成串行或并行关系。" : "当前前面还没有步骤，默认只能先串行执行。")}</p>
            </div>
            ${fieldSelect(
              "conditionMode",
              "执行条件",
              [
                { value: "always", label: "始终执行" },
                { value: "exists", label: "变量存在时执行" },
                { value: "missing", label: "变量不存在时执行" },
                { value: "equals", label: "变量等于指定值时执行" },
                { value: "custom", label: "自定义表达式" }
              ],
              conditionConfig.mode
            )}
            ${fieldSelect(
              "conditionScope",
              "变量来源",
              [
                { value: "vars", label: "前置步骤变量 vars" },
                { value: "env", label: "环境变量 env" },
                { value: "suite", label: "场景变量 suite" },
                { value: "dataset", label: "数据集 dataset" }
              ],
              conditionConfig.scope
            )}
            ${fieldInput("conditionVarName", "变量名", conditionConfig.variable || "", false)}
            ${fieldInput("conditionExpected", "期望值", conditionConfig.expected || "", false)}
            ${fieldTextarea("conditionScript", "自定义表达式", conditionConfig.script || "", false, "full-span")}
            <div class="builder-note full-span" data-step-condition-note>
              <strong>条件说明</strong>
              <p>${escapeHtml(conditionConfig.mode === "custom" ? "自定义表达式会直接按执行器脚本规则解析。" : "优先使用可视化条件，避免直接写表达式。")}</p>
            </div>
          </div>
        `,
        actions: `
          <button type="button" class="secondary-button" data-action="close-modal">取消</button>
          <button type="submit" class="primary-button">${currentStep ? "保存步骤" : "添加步骤"}</button>
        `
      });
    }

    if (type === "execution-config") {
      const sourceType = data.sourceType === "batch-cases" ? "batch-cases" : "suite";
      const suite =
        sourceType === "suite"
          ? model.suites.find((item) => item.id === (data.suiteId || state.selectedSuiteId)) || model.suites[0] || null
          : null;
      const environmentId = data.environmentId || suite?.defaultEnvironmentId || model.environments[0]?.id || "";
      const executionConfig = suite?.executionConfig || {};
      const timeoutSeconds = data.timeoutSeconds || suite?.timeoutSeconds || 300;
      const failureStrategy = data.failureStrategy || suite?.failureStrategy || "stop";
      const priority = data.priority || executionConfig.priority || "normal";
      const maxRetries = data.maxRetries ?? executionConfig.maxRetries ?? 0;
      const stopOnDatasetFailure = data.stopOnDatasetFailure ?? executionConfig.stopOnDatasetFailure ?? true;
      const caseCount = Array.isArray(data.caseIds) ? data.caseIds.length : state.selections.cases.length;
      const summary = buildExecutionImpactSummary({
        form: null,
        model,
        sourceType,
        suite,
        caseIds: Array.isArray(data.caseIds) ? data.caseIds : state.selections.cases
      });
      return renderModalShell({
        title: sourceType === "batch-cases" ? "批量执行配置" : "执行场景配置",
        subtitle:
          sourceType === "batch-cases"
            ? `本次将执行 ${caseCount} 条已勾选用例，并使用以下运行参数。`
            : `场景：${suite?.name || "未选择场景"}。以下配置只影响本次运行，不会改动默认资产配置。`,
        formType: "execution-config",
        body: `
          <input type="hidden" name="sourceType" value="${sourceType}" />
          <input type="hidden" name="suiteId" value="${escapeHtml(suite?.id || data.suiteId || "")}" />
          ${(Array.isArray(data.caseIds) ? data.caseIds : state.selections.cases || []).map((caseId) => `<input type="hidden" name="caseIds[]" value="${escapeHtml(String(caseId || ""))}" />`).join("")}
          <div class="modal-grid">
            ${renderExecutionImpactSummary(summary)}
            ${fieldSelect("environmentId", "执行环境", model.environments.map((item) => ({ value: item.id, label: item.name })), environmentId)}
            ${fieldSelect(
              "priority",
              "队列优先级",
              [
                { value: "high", label: "高" },
                { value: "normal", label: "普通" },
                { value: "low", label: "低" }
              ],
              priority
            )}
            ${fieldInput("maxRetries", "失败重试次数", String(maxRetries), true, "number")}
            ${fieldInput("timeoutSeconds", "单次运行超时(秒)", String(timeoutSeconds), true, "number")}
            ${fieldSelect(
              "failureStrategy",
              "失败策略",
              [
                { value: "stop", label: "立即停止" },
                { value: "continue", label: "失败继续" }
              ],
              failureStrategy
            )}
            ${fieldSelect(
              "stopOnDatasetFailure",
              "数据行失败策略",
              [
                { value: "true", label: "某行失败即停止后续数据行" },
                { value: "false", label: "继续执行剩余数据行" }
              ],
              stopOnDatasetFailure === false ? "false" : "true"
            )}
          </div>
        `,
        actions: `
          <button type="button" class="secondary-button" data-action="close-modal">取消</button>
          <button type="submit" class="primary-button">提交执行</button>
        `
      });
    }

    return "";
  }

  function renderDetailModal(data) {
    const renderSection = (section) => {
      if (section.format === "grid") {
        return `
          <div class="modal-section">
            <label>${escapeHtml(section.label)}</label>
            <div class="detail-grid">
              ${(section.items || [])
                .map(
                  (item) => `
                    <article class="detail-card">
                      <span class="detail-card-label">${escapeHtml(item.label)}</span>
                      <strong>${escapeHtml(item.value)}</strong>
                    </article>
                  `
                )
                .join("")}
            </div>
          </div>
        `;
      }

      if (section.format === "kv-list") {
        return `
          <div class="modal-section">
            <label>${escapeHtml(section.label)}</label>
            <div class="detail-kv-list">
              ${(section.items || [])
                .map(
                  (item) => `
                    <div class="detail-kv-row">
                      <span>${escapeHtml(item.label)}</span>
                      <strong>${escapeHtml(item.value)}</strong>
                    </div>
                  `
                )
                .join("") || '<span class="subdued-text">暂无</span>'}
            </div>
          </div>
        `;
      }

      if (section.format === "chips") {
        return `
          <div class="modal-section">
            <label>${escapeHtml(section.label)}</label>
            <div class="detail-chip-list">
              ${(section.items || [])
                .map((item) => `<span class="tag-pill">${escapeHtml(item)}</span>`)
                .join("") || '<span class="subdued-text">暂无</span>'}
            </div>
          </div>
        `;
      }

      if (section.format === "rule-list") {
        return `
          <div class="modal-section">
            <label>${escapeHtml(section.label)}</label>
            <div class="detail-rule-list">
              ${(section.items || [])
                .map(
                  (item) => `
                    <article class="detail-rule-card">
                      <strong>${escapeHtml(item.title)}</strong>
                      <p>${escapeHtml(item.description)}</p>
                    </article>
                  `
                )
                .join("") || '<span class="subdued-text">暂无</span>'}
            </div>
          </div>
        `;
      }

      if (section.format === "assertion-list") {
        return `
          <div class="modal-section">
            <label>${escapeHtml(section.label)}</label>
            <div class="detail-assertion-list">
              ${(section.items || [])
                .map(
                  (item) => `
                    <article class="detail-assertion-card">
                      <div class="detail-assertion-head">
                        <strong>${escapeHtml(item.title || "断言")}</strong>
                        <span class="detail-assertion-status ${item.passed ? "is-passed" : "is-failed"}">${escapeHtml(item.passed ? "通过" : "失败")}</span>
                      </div>
                      <div class="detail-assertion-meta">
                        ${(item.meta || [])
                          .map(
                            (metaItem) => `
                              <div class="detail-assertion-meta-row">
                                <span>${escapeHtml(metaItem.label || "-")}</span>
                                <strong>${escapeHtml(metaItem.value || "-")}</strong>
                              </div>
                            `
                          )
                          .join("")}
                      </div>
                      ${item.message ? `<p>${escapeHtml(item.message)}</p>` : ""}
                    </article>
                  `
                )
                .join("") || '<span class="subdued-text">暂无</span>'}
            </div>
          </div>
        `;
      }

      if (section.format === "action-list") {
        return `
          <div class="modal-section">
            <label>${escapeHtml(section.label)}</label>
            <div class="detail-action-list">
              ${(section.items || [])
                .map(
                  (item) => `
                    <article class="detail-action-card">
                      <strong>${escapeHtml(item.title || "下一步")}</strong>
                      <p>${escapeHtml(item.description || "")}</p>
                      <div class="button-row">
                        ${(item.buttons || [])
                          .map(
                            (button) => `
                              <button class="${escapeHtml(button.className || "secondary-button")}" data-action="${escapeHtml(button.action || "close-modal")}" ${serializeActionDataset(button.dataset || {})}>
                                ${escapeHtml(button.label || "继续")}
                              </button>
                            `
                          )
                          .join("")}
                      </div>
                    </article>
                  `
                )
                .join("") || '<span class="subdued-text">暂无</span>'}
            </div>
          </div>
        `;
      }

      return `
        <div class="modal-section">
          <label>${escapeHtml(section.label)}</label>
          <textarea class="detail-textarea" readonly>${escapeHtml(section.content || "")}</textarea>
        </div>
      `;
    };

    return `
      <div class="modal-backdrop"></div>
      <div class="modal modal-detail-shell">
        ${renderModalShell({
          title: data.title || "详情",
          subtitle: data.subtitle || "",
          body: data.sections.map(renderSection).join(""),
          actions: data.actions || ""
        })}
      </div>
    `;
  }

  async function submitModalForm(type, formData) {
    if (type === "api") {
      const payload = {
        moduleId: formData.get("moduleId"),
        name: formData.get("name"),
        creator: formData.get("creator"),
        method: formData.get("method"),
        path: formData.get("path"),
        status: formData.get("status"),
        tags: parseTagInput(formData.get("tags")),
        bodyMode: formData.get("bodyMode"),
        headers: parseArrayEntries(formData, "headerKey", "headerValue"),
        query: parseArrayEntries(formData, "queryKey", "queryValue"),
        bodyTemplate: parseBodyText(formData.get("bodyTemplate"))
      };
      if (formData.get("id")) {
        await api(`/api/apis/${formData.get("id")}`, { method: "PUT", body: JSON.stringify(payload) });
        showToast("接口已更新");
      } else {
        await api("/api/apis", { method: "POST", body: JSON.stringify(payload) });
        showToast("接口已创建");
      }
      return;
    }

    if (type === "case") {
      const payload = {
        apiId: formData.get("apiId"),
        name: formData.get("name"),
        creator: formData.get("creator"),
        priority: formData.get("priority"),
        description: formData.get("description"),
        tags: parseTagInput(formData.get("tags")),
        assertions: parseAssertionRules(formData),
        extracts: parseExtractRules(formData),
        preScript: formData.get("preScript"),
        postScript: formData.get("postScript"),
        overrides: {
          headers: Object.fromEntries(
            parseArrayEntries(formData, "overrideHeaderKey", "overrideHeaderValue")
              .filter((item) => item.key)
              .map((item) => [item.key, item.value])
          ),
          query: parseArrayEntries(formData, "overrideQueryKey", "overrideQueryValue"),
          ...(String(formData.get("overrideBody") || "").trim() ? { body: parseBodyText(formData.get("overrideBody")) } : {})
        }
      };
      const caseId = String(formData.get("id") || "");
      if (formData.get("id")) {
        await api(`/api/cases/${formData.get("id")}`, { method: "PUT", body: JSON.stringify(payload) });
        showToast("用例已更新");
      } else {
        const createdCase = await api("/api/cases", { method: "POST", body: JSON.stringify(payload) });
        showToast("用例已创建");
        return {
          returnNavigation: buildModalReturnNavigation(createdCase?.id || "")
        };
      }
      return {
        returnNavigation: buildModalReturnNavigation(caseId)
      };
    }

    if (type === "suite") {
      const intervalMinutes = Number(formData.get("intervalMinutes") || 0);
      const payload = {
        projectId: formData.get("projectId"),
        name: formData.get("name"),
        description: formData.get("description"),
        tags: parseTagInput(formData.get("tags")),
        continueOnFailure: false,
        variables: parseObjectEntries(formData, "suiteVariableKey", "suiteVariableValue"),
        items: [],
        scenarioAssertions: [],
        schedule: {
          enabled: intervalMinutes > 0,
          intervalMinutes: intervalMinutes || 30
        },
        defaultEnvironmentId: state.data.environments[0]?.id || null,
        timeoutSeconds: 300,
        failureStrategy: "stop"
      };
      const suite = await api("/api/suites", { method: "POST", body: JSON.stringify(payload) });
      state.selectedSuiteId = suite.id;
      showToast("场景已创建");
      return;
    }

    if (type === "environment") {
      const payload = {
        name: formData.get("name"),
        description: formData.get("description"),
        baseUrl: formData.get("baseUrl"),
        headers: parseObjectEntries(formData, "envHeaderKey", "envHeaderValue"),
        variables: parseObjectEntries(formData, "envVariableKey", "envVariableValue"),
        auth: parseAuthConfig(formData)
      };

      const existingEnvId = String(formData.get("id") || "");
      const shouldRerunSmoke =
        Boolean(state.environmentDiagnostics?.[existingEnvId]?.smoke) ||
        ["auth", "probe"].includes(String(state.modal?.data?.repairKey || ""));
      let savedEnvironment = null;

      if (existingEnvId) {
        savedEnvironment = await api(`/api/environments/${existingEnvId}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        savedEnvironment = await api("/api/environments", { method: "POST", body: JSON.stringify(payload) });
      }
      try {
        const recheck = await autoRecheckEnvironment(savedEnvironment?.id || existingEnvId, { rerunSmoke: shouldRerunSmoke });
        const statusText =
          recheck?.diagnostics?.summary?.status === "passed"
            ? "自动体检通过"
            : recheck?.diagnostics?.summary?.status === "warning"
              ? "自动体检完成，仍有待确认项"
              : "自动体检完成，仍有异常项";
        showToast(`${existingEnvId ? "环境已更新" : "环境已创建"}，${statusText}`);
      } catch (error) {
        state.environmentDiagnostics[savedEnvironment?.id || existingEnvId] = {
          ...(state.environmentDiagnostics[savedEnvironment?.id || existingEnvId] || {}),
          loading: false,
          smokeLoading: false
        };
        showToast(`${existingEnvId ? "环境已更新" : "环境已创建"}，但自动重检失败：${error.message}`);
      }
      return {
        returnNavigation: buildModalReturnNavigation(savedEnvironment?.id || existingEnvId)
      };
    }

    if (type === "user") {
      const password = String(formData.get("password") || "").trim();
      const payload = {
        name: formData.get("name"),
        username: formData.get("username"),
        role: formData.get("role"),
        status: formData.get("status"),
        mustChangePassword: formData.get("mustChangePassword") === "true"
      };
      if (password) {
        payload.password = password;
      }

      if (formData.get("id")) {
        await api(`/api/users/${formData.get("id")}`, { method: "PUT", body: JSON.stringify(payload) });
        showToast("用户已更新");
      } else {
        await api("/api/users", { method: "POST", body: JSON.stringify(payload) });
        showToast("用户已创建");
      }
      return;
    }

    if (type === "change-password") {
      const currentPassword = String(formData.get("currentPassword") || "");
      const nextPassword = String(formData.get("nextPassword") || "");
      const confirmPassword = String(formData.get("confirmPassword") || "");

      if (nextPassword !== confirmPassword) {
        throw new Error("两次输入的新密码不一致");
      }

      const result = await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, nextPassword })
      });
      if (result?.user) {
        state.auth.user = result.user;
        state.auth.requirePasswordChange = result.user.mustChangePassword === true;
      }
      state.auth.requirePasswordChange = false;
      showToast("密码已更新");
      return;
    }

    if (type === "openapi") {
      const model = buildViewModel();
      let suite = null;
      if (formData.get("starterMode") !== "false") {
        ({ suite } = await importOpenApiAssets({
          model,
          moduleId: formData.get("moduleId"),
          projectId: formData.get("projectId"),
          environmentId: formData.get("environmentId"),
          suiteName: formData.get("suiteName") || "OpenAPI 默认场景",
          spec: formData.get("spec")
        }));
      } else {
        await api("/api/import/openapi", {
          method: "POST",
          body: JSON.stringify({
            moduleId: formData.get("moduleId"),
            spec: parseJson(formData.get("spec"), {})
          })
        });
      }
      showToast(suite ? "OpenAPI 导入完成，并已生成默认场景" : "OpenAPI 导入完成");
      return;
    }

    if (type === "business-template") {
      const model = buildViewModel();
      const result = await createBusinessTemplateAssets(model, formData);
      showToast(`模板已生成：${result.apiCount} 个接口，${result.caseCount} 条用例${result.suite ? "，并创建了默认场景" : ""}`);
      return;
    }

    if (type === "scene-builder") {
      const model = buildViewModel();
      const source = String(formData.get("sceneSource") || "apis");
      const environmentId = String(formData.get("environmentId") || model.environments[0]?.id || "");
      const autoRun = formData.get("autoRun") !== "false";
      const runPriority = String(formData.get("runPriority") || "high");

      if (source === "template") {
        const templateProjectId =
          String(formData.get("templateProjectId") || "") || getProjectIdByModuleId(formData.get("templateModuleId"), model);
        const result = await createBusinessTemplateAssets(model, formData, {
          createSuite: true,
          projectId: templateProjectId,
          moduleId: formData.get("templateModuleId"),
          environmentId,
          templateKey: formData.get("templateKey"),
          displayName: formData.get("templateDisplayName"),
          basePath: formData.get("templateBasePath"),
          suiteName: formData.get("suiteName"),
          description: formData.get("description"),
          tags: parseTagInput(formData.get("tags"))
        });
        const run = autoRun ? await runGeneratedSuite({ suiteId: result.suite?.id, environmentId, priority: runPriority }) : null;
        if (!run) {
          showToast(`业务模板场景已生成：${result.apiCount} 个接口，${result.caseCount} 条用例`);
          return;
        }
        return {
          run,
          successMessage: `业务模板场景已生成，并已提交执行任务`
        };
      }

      if (source === "openapi") {
        const { imported, suite } = await importOpenApiAssets({
          model,
          moduleId: formData.get("openapiModuleId"),
          projectId: formData.get("openapiProjectId"),
          environmentId,
          suiteName: formData.get("suiteName"),
          spec: formData.get("openapiSpec"),
          description: formData.get("description"),
          tags: dedupeList(["openapi", "scene-builder", ...parseTagInput(formData.get("tags"))])
        });
        const run = autoRun ? await runGeneratedSuite({ suiteId: suite?.id, environmentId, priority: runPriority }) : null;
        if (!run) {
          showToast(`OpenAPI 场景已生成：${imported.apis?.length || 0} 个接口，${imported.cases?.length || 0} 条用例`);
          return { suite };
        }
        return {
          run,
          successMessage: `OpenAPI 场景已生成，并已提交执行任务`
        };
      }

      const result = await createSuiteFromSelectedApis(model, formData);
      const run = autoRun ? await runGeneratedSuite({ suiteId: result.suite?.id, environmentId, priority: runPriority }) : null;
      if (!run) {
        showToast(
          `场景已生成：共 ${result.caseCount} 条步骤${result.createdCaseCount ? `，其中自动补了 ${result.createdCaseCount} 条默认用例` : ""}`
        );
        return;
      }
      return {
        run,
        successMessage: `场景已生成，并已提交 ${result.caseCount} 条步骤的执行任务`
      };
    }

    if (type === "starter-guide") {
      const model = buildViewModel();
      const apiId = String(formData.get("apiId") || "");
      const environmentId = String(formData.get("environmentId") || model.environments[0]?.id || "");
      const projectId = getProjectIdByApiId(apiId, model);
      if (!projectId) {
        throw new Error("未找到该接口所属项目，无法创建引导场景");
      }

      const createdCase = await api("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          apiId,
          name: formData.get("caseName") || "新手引导 · 首条自动化",
          creator: state.auth.user?.name || "系统",
          priority: "high",
          description: "由第一次使用引导自动生成",
          tags: parseTagInput(formData.get("guideTags")),
          assertions: parseAssertionRules(formData),
          extracts: [],
          preScript: "",
          postScript: "",
          overrides: {}
        })
      });

      const suite = await createSuiteWithCaseRefs({
        model,
        projectId,
        environmentId,
        suiteName: formData.get("suiteName") || "新手引导场景",
        description: "由第一次使用引导自动生成",
        tags: parseTagInput(formData.get("guideTags")),
        variables: {},
        caseIds: [createdCase.id]
      });
      state.selectedSuiteId = suite?.id || state.selectedSuiteId;

      const run = await api("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          suiteId: suite.id,
          environmentId,
          trigger: "manual",
          options: {
            environmentId,
            priority: "high",
            timeoutSeconds: 300,
            failureStrategy: "stop",
            stopOnDatasetFailure: true
          }
        })
      });
      markStarterGuideCompleted();
      await refreshData();
      return { run, successMessage: "已按引导创建并执行第一条自动化任务" };
    }

    if (type === "step") {
      const suiteId = formData.get("suiteId");
      const suite = state.data.suites.find((item) => item.id === suiteId);
      if (!suite) {
        throw new Error("场景不存在");
      }

      const stepId = String(formData.get("stepId") || "");
      const itemType = String(formData.get("itemType") || "case") === "suite" ? "suite" : "case";
      const previousStep = getPreviousSuiteStep(suite, stepId);
      const parallelMode = String(formData.get("parallelMode") || "serial");
      let parallelGroup = "";
      let shouldAssignPreviousParallelGroup = false;
      if (parallelMode === "inherit" && previousStep) {
        parallelGroup = String(previousStep.parallelGroup || "").trim() || createParallelGroupId(previousStep);
        shouldAssignPreviousParallelGroup = !String(previousStep.parallelGroup || "").trim();
      } else if (parallelMode === "custom") {
        parallelGroup = String(formData.get("parallelGroupValue") || "").trim() || createParallelGroupId(previousStep);
      }
      const stepPayload = {
        itemType,
        caseId: itemType === "case" ? formData.get("caseId") : undefined,
        suiteId: itemType === "suite" ? formData.get("suiteIdRef") : undefined,
        role: String(formData.get("role") || "test"),
        continueOnFailure: formData.get("continueOnFailure") === "true",
        enabled: formData.get("enabled") !== "false",
        condition: buildStepConditionExpression(formData),
        timeoutMs: formData.get("timeoutMs") ? Number(formData.get("timeoutMs")) : null,
        parallelGroup
      };
      if (itemType === "case" && !stepPayload.caseId) {
        throw new Error("请选择用例");
      }
      if (itemType === "suite" && !stepPayload.suiteId) {
        throw new Error("请选择引用的子场景");
      }
      const nextItems = stepId
        ? suite.items
            .map((item) => (item.id === stepId ? { ...item, ...stepPayload } : item))
            .sort((a, b) => a.order - b.order)
            .map((item, index) => ({ ...item, order: index + 1 }))
        : [
            ...suite.items,
            {
              id: clientId("suite_item"),
              ...stepPayload,
              order: suite.items.length + 1
            }
          ];

      if (parallelMode === "inherit" && !previousStep) {
        throw new Error("当前前面还没有步骤，不能直接加入上一组并行");
      }

      if (shouldAssignPreviousParallelGroup && previousStep?.id) {
        nextItems = nextItems.map((item) => (item.id === previousStep.id ? { ...item, parallelGroup } : item));
      }

      await api(`/api/suites/${suite.id}`, {
        method: "PUT",
        body: JSON.stringify({ items: nextItems })
      });
      showToast(stepId ? "步骤已更新" : "步骤已添加");
      return;
    }

    if (type === "execution-config") {
      const sourceType = String(formData.get("sourceType") || "suite");
      const options = {
        environmentId: formData.get("environmentId"),
        priority: formData.get("priority"),
        maxRetries: Number(formData.get("maxRetries") || 0),
        timeoutSeconds: Number(formData.get("timeoutSeconds") || 300),
        failureStrategy: formData.get("failureStrategy"),
        stopOnDatasetFailure: formData.get("stopOnDatasetFailure") === "true"
      };

      if (sourceType === "batch-cases") {
        const caseIds = [...state.selections.cases];
        if (!caseIds.length) {
          throw new Error("请先勾选要执行的用例");
        }
        const suite = state.data.suites.find((item) => item.id === state.selectedSuiteId) || state.data.suites[0] || null;
        const projectId = suite?.projectId || state.data.projects[0]?.id || null;
        const run = await api("/api/runs/batch-cases", {
          method: "POST",
          body: JSON.stringify({
            caseIds,
            projectId,
            environmentId: options.environmentId,
            trigger: "manual",
            options
          })
        });
        return { run, clearCaseSelection: true, successMessage: "批量执行任务已提交" };
      }

      const suiteId = String(formData.get("suiteId") || state.selectedSuiteId || "");
      if (!suiteId) {
        throw new Error("未选择执行场景");
      }
      const run = await api("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          suiteId,
          environmentId: options.environmentId,
          trigger: "manual",
          options
        })
      });
      return { run, successMessage: "场景执行任务已提交" };
    }
  }

  async function saveSuiteConfig() {
    const form = document.getElementById("suiteConfigForm");
    const suite = state.data.suites.find((item) => item.id === state.selectedSuiteId);
    if (!form || !suite) {
      showToast("未找到场景配置");
      return;
    }

    const formData = new FormData(form);
    const failureStrategy = formData.get("failureStrategy");
    const intervalMinutes = Number(formData.get("intervalMinutes") || 30);

    try {
      await api(`/api/suites/${suite.id}`, {
        method: "PUT",
        body: JSON.stringify({
          defaultEnvironmentId: formData.get("defaultEnvironmentId"),
          datasetId: formData.get("datasetId") || null,
          timeoutSeconds: Number(formData.get("timeoutSeconds") || 300),
          failureStrategy,
          continueOnFailure: failureStrategy === "continue",
          schedule: {
            enabled: formData.get("scheduleEnabled") === "true",
            intervalMinutes: Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes : 30
          },
          executionConfig: {
            priority: formData.get("executionPriority") || "normal",
            maxRetries: Number(formData.get("maxRetries") || 0),
            stopOnDatasetFailure: formData.get("stopOnDatasetFailure") === "true"
          }
        })
      });
      showToast("场景配置已保存");
      await refreshData();
    } catch (error) {
      showToast(error.message);
    }
  }

  async function deleteSuiteStep(stepId) {
    const suite = state.data.suites.find((item) => item.id === state.selectedSuiteId);
    if (!suite || !stepId) {
      return;
    }

    const nextItems = suite.items
      .filter((item) => item.id !== stepId)
      .sort((a, b) => a.order - b.order)
      .map((item, index) => ({ ...item, order: index + 1 }));

    try {
      await api(`/api/suites/${suite.id}`, {
        method: "PUT",
        body: JSON.stringify({ items: nextItems })
      });
      showToast("步骤已删除");
      await refreshData();
    } catch (error) {
      showToast(error.message);
    }
  }

  async function moveSuiteStep(stepId, direction) {
    const suite = state.data.suites.find((item) => item.id === state.selectedSuiteId);
    if (!suite || !stepId) {
      return;
    }

    const sortedItems = suite.items.slice().sort((a, b) => a.order - b.order);
    const currentIndex = sortedItems.findIndex((item) => item.id === stepId);
    if (currentIndex === -1) {
      return;
    }

    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= sortedItems.length) {
      return;
    }

    const nextItems = sortedItems.slice();
    [nextItems[currentIndex], nextItems[targetIndex]] = [nextItems[targetIndex], nextItems[currentIndex]];

    try {
      await api(`/api/suites/${suite.id}`, {
        method: "PUT",
        body: JSON.stringify({
          items: nextItems.map((item, index) => ({ ...item, order: index + 1 }))
        })
      });
      await refreshData();
    } catch (error) {
      showToast(error.message);
    }
  }

  async function toggleSuiteStepEnabled(stepId) {
    const suite = state.data.suites.find((item) => item.id === state.selectedSuiteId);
    if (!suite || !stepId) {
      return;
    }

    const nextItems = suite.items.map((item) => (item.id === stepId ? { ...item, enabled: item.enabled === false } : item));
    const target = nextItems.find((item) => item.id === stepId);

    try {
      await api(`/api/suites/${suite.id}`, {
        method: "PUT",
        body: JSON.stringify({ items: nextItems })
      });
      showToast(target?.enabled === false ? "步骤已禁用" : "步骤已启用");
      await refreshData();
    } catch (error) {
      showToast(error.message);
    }
  }

  async function appendCasesToSuite(caseIds = []) {
    const normalizedCaseIds = dedupeList(caseIds.map((item) => String(item || "").trim()).filter(Boolean));
    if (!normalizedCaseIds.length) {
      showToast("请先勾选要加入场景的用例");
      return false;
    }

    const suite = state.data.suites.find((item) => item.id === state.selectedSuiteId) || state.data.suites[0];
    if (!suite) {
      showToast("请先创建一个场景");
      return false;
    }

    const existingCaseIds = new Set(suite.items.map((item) => item.caseId));
    const appendIds = normalizedCaseIds.filter((caseId) => !existingCaseIds.has(caseId));
    if (!appendIds.length) {
      showToast("选中的用例已全部存在于当前场景");
      return false;
    }

      const nextItems = [
        ...suite.items,
        ...appendIds.map((caseId, index) => ({
          id: clientId("suite_item"),
          itemType: "case",
          caseId,
          role: "test",
          parallelGroup: "",
          order: suite.items.length + index + 1,
          continueOnFailure: false
        }))
      ];

    try {
      await api(`/api/suites/${suite.id}`, {
        method: "PUT",
        body: JSON.stringify({ items: nextItems })
      });
      showToast(`已向场景“${suite.name}”添加 ${appendIds.length} 条用例`);
      await refreshData();
      return true;
    } catch (error) {
      showToast(error.message);
      return false;
    }
  }

  async function batchAddCasesToSuite() {
    const caseIds = state.selections.cases;
    if (!caseIds.length) {
      showToast("请先勾选要加入场景的用例");
      return;
    }
    const appended = await appendCasesToSuite(caseIds);
    if (appended) {
      state.selections.cases = [];
    }
  }

  async function addCaseToSuite(caseId) {
    if (!caseId) {
      return;
    }
    await appendCasesToSuite([caseId]);
  }

  function runCase(caseId) {
    if (!caseId) {
      return false;
    }
    state.selections.cases = [caseId];
    openModal("execution-config", {
      sourceType: "batch-cases",
      caseIds: [caseId]
    });
    return true;
  }

  function handleModalAction(action, actionNode) {
    if (action === "add-editor-row") {
      return addEditorRow(actionNode.dataset.editor, actionNode);
    }
    if (action === "remove-editor-row") {
      return maybeRemoveEditorRow(actionNode);
    }
    if (action === "guide-next") {
      const current = Number(modalRoot.querySelector('[name="guideStep"]')?.value || 1);
      return showGuideStep(current + 1);
    }
    if (action === "guide-prev") {
      const current = Number(modalRoot.querySelector('[name="guideStep"]')?.value || 1);
      return showGuideStep(current - 1);
    }
    if (action === "open-guide-step") {
      return showGuideStep(Number(actionNode.dataset.step || 1));
    }
    if (action === "set-scene-source") {
      const form = actionNode.closest('[data-modal-type="scene-builder"]');
      const sourceInput = form?.querySelector('[name="sceneSource"]');
      if (!form || !sourceInput) {
        return false;
      }
      sourceInput.value = actionNode.dataset.value || "apis";
      syncSceneBuilderForm(form);
      return true;
    }
    if (action === "skip-starter-guide") {
      markStarterGuideSeen();
      closeModal();
      return true;
    }
    if (action === "fill-missing-env-variables") {
      return fillMissingEnvironmentVariables();
    }
    if (action === "apply-auth-quick-fix") {
      return applyEnvironmentAuthQuickFix(actionNode.dataset.mode || "bearer");
    }
    if (action === "add-env-header-quick-fix") {
      return addSuggestedEnvironmentHeader(actionNode.dataset.headerKey || "", actionNode.dataset.headerValue || "");
    }
    return false;
  }

  function handleModalFieldChange(target) {
    if (!target || !modalRoot.contains(target)) {
      return false;
    }
    const assertionRow = target.closest('[data-editor-row="assertions"]');
    if (assertionRow) {
      syncAssertionRow(assertionRow);
      return true;
    }
    const extractRow = target.closest('[data-editor-row="extracts"]');
    if (extractRow) {
      syncExtractRow(extractRow);
      return true;
    }
    const modalForm = target.closest(".modal-form");
    if (modalForm?.dataset.modalType === "business-template") {
      syncBusinessTemplateForm(modalForm);
      return true;
    }
    if (modalForm?.dataset.modalType === "openapi") {
      syncOpenApiForm(modalForm);
      return true;
    }
    if (modalForm?.dataset.modalType === "scene-builder") {
      syncSceneBuilderForm(modalForm);
      return true;
    }
    if (modalForm?.dataset.modalType === "execution-config") {
      syncExecutionConfigForm(modalForm);
      return true;
    }
    if (modalForm?.dataset.modalType === "step") {
      syncStepForm(modalForm);
      return true;
    }
    if (modalForm?.dataset.modalType === "starter-guide" && target.name === "guideStep") {
      showGuideStep(Number(target.value || 1));
      return true;
    }
    return false;
  }

  function buildRecordDetailSections(collection, entity) {
    const formatAssertion = (assertion) => {
      const typeText = {
        status: "状态码",
        jsonPath: "字段值",
        exists: "字段存在",
        fieldType: "字段类型",
        responseTime: "响应时间",
        headerEquals: "响应头",
        bodyContains: "响应包含文本",
        xpath: "XPath",
        jsonSchema: "JSON Schema"
      }[assertion.type] || assertion.type;
      const path = assertion.path ? ` · ${assertion.path}` : "";
      const expected =
        assertion.type === "jsonSchema"
          ? "使用 Schema 校验返回结构"
          : assertion.type === "exists"
            ? "字段需要存在"
            : `期望 ${assertion.expected}`;
      return {
        title: `${typeText}${path}`,
        description: expected
      };
    };

    const formatExtract = (extract) => ({
      title: `${extract.name} <- ${extract.source}`,
      description:
        extract.source === "header"
          ? `从响应头 ${extract.header || extract.name} 提取`
          : extract.path
            ? `从 ${extract.path} 提取`
            : "提取当前状态值"
    });

    if (collection === "apis") {
      const moduleName = state.data?.modules?.find((item) => item.id === entity.moduleId)?.name || entity.moduleId;
      const relatedCases = (state.data?.cases || []).filter((item) => item.apiId === entity.id);
      return [
        {
          label: "基础信息",
          format: "grid",
          items: [
            { label: "接口名称", value: entity.name || "-" },
            { label: "请求方法", value: entity.method || "-" },
            { label: "接口路径", value: entity.path || "-" },
            { label: "所属模块", value: moduleName || "-" },
            { label: "接口状态", value: entity.status === "deprecated" ? "已废弃" : "正常" }
          ]
        },
        {
          label: "标签",
          format: "chips",
          items: entity.tags || []
        },
        {
          label: "请求头",
          format: "kv-list",
          items: (entity.headers || []).map((item) => ({ label: item.key || "-", value: item.value || "-" }))
        },
        {
          label: "Query 参数",
          format: "kv-list",
          items: (entity.query || []).map((item) => ({ label: item.key || "-", value: item.value || "-" }))
        },
        {
          label: "请求体模板",
          content: typeof entity.bodyTemplate === "string" ? entity.bodyTemplate : JSON.stringify(entity.bodyTemplate ?? "", null, 2)
        },
        {
          label: "下一步建议",
          format: "action-list",
          items: [
            relatedCases.length
              ? {
                  title: `这条接口已经有 ${relatedCases.length} 条用例`,
                  description: "下一步更适合把它们编排进场景，或者继续打开已有用例补断言和变量提取。",
                  buttons: [
                    { label: "生成场景", action: "open-scene-builder-from-apis", className: "primary-button", dataset: { apiId: entity.id } },
                    { label: "编辑接口", action: "open-modal", className: "secondary-button", dataset: { modalType: "api", recordId: entity.id } }
                  ]
                }
              : {
                  title: "先生成一条默认用例",
                  description: "接口定义已经齐了，建议下一步先补出“状态码=200”的默认用例，再决定是否进入场景编排。",
                  buttons: [
                    { label: "生成默认用例", action: "create-default-case", className: "primary-button", dataset: { apiId: entity.id } },
                    { label: "生成场景", action: "open-scene-builder-from-apis", className: "secondary-button", dataset: { apiId: entity.id } }
                  ]
                }
          ]
        }
      ];
    }

    if (collection === "cases") {
      const apiName = state.data?.apis?.find((item) => item.id === entity.apiId)?.name || entity.apiId;
      const relatedSuites = (state.data?.suites || []).filter((suite) => (suite.items || []).some((item) => item.caseId === entity.id));
      return [
        {
          label: "基础信息",
          format: "grid",
          items: [
            { label: "用例名称", value: entity.name || "-" },
            { label: "关联接口", value: apiName || "-" },
            { label: "优先级", value: entity.priority || "-" },
            { label: "描述", value: entity.description || "-" }
          ]
        },
        {
          label: "标签",
          format: "chips",
          items: entity.tags || []
        },
        {
          label: "断言规则",
          format: "rule-list",
          items: (entity.assertions || []).map(formatAssertion)
        },
        {
          label: "变量提取",
          format: "rule-list",
          items: (entity.extracts || []).map(formatExtract)
        },
        {
          label: "覆盖配置",
          content: JSON.stringify(entity.overrides || {}, null, 2)
        },
        {
          label: "下一步建议",
          format: "action-list",
          items: [
            relatedSuites.length
              ? {
                  title: `这条用例已进入 ${relatedSuites.length} 个场景`,
                  description: "如果你只是想快速验证，直接执行这条用例；如果要看依赖关系，去场景编排页继续串链路。",
                  buttons: [
                    { label: "执行用例", action: "run-case", className: "primary-button", dataset: { caseId: entity.id } },
                    { label: "加入当前场景", action: "add-case-to-suite", className: "secondary-button", dataset: { caseId: entity.id } }
                  ]
                }
              : {
                  title: "建议把这条用例加进场景",
                  description: "单条用例已经能执行，但如果要解决接口前后依赖，下一步应该把它加入场景，再和其他接口串起来。",
                  buttons: [
                    { label: "加入当前场景", action: "add-case-to-suite", className: "primary-button", dataset: { caseId: entity.id } },
                    { label: "执行用例", action: "run-case", className: "secondary-button", dataset: { caseId: entity.id } }
                  ]
                }
          ]
        }
      ];
    }

    return [{ label: "基础信息", content: JSON.stringify(entity, null, 2) }];
  }

  function openRecordDetail(collection, id) {
    if (!collection || !id) {
      return;
    }

    const entity = state.data?.[collection]?.find((item) => item.id === id);
    if (!entity) {
      showToast("记录不存在");
      return;
    }

    const titleMap = {
      apis: entity.name || "接口详情",
      cases: entity.name || "用例详情"
    };

    openModal("detail", {
      title: titleMap[collection] || "详情",
      subtitle: `${collection.slice(0, -1)} · ${id}`,
      sections: buildRecordDetailSections(collection, entity),
      actions:
        collection === "apis"
          ? `
            <button type="button" class="secondary-button" data-action="close-modal">关闭</button>
            <button type="button" class="secondary-button" data-action="open-modal" data-modal-type="api" data-record-id="${escapeHtml(entity.id)}">编辑接口</button>
            <button type="button" class="primary-button" data-action="open-scene-builder-from-apis" data-api-id="${escapeHtml(entity.id)}">继续生成场景</button>
          `
          : collection === "cases"
            ? `
              <button type="button" class="secondary-button" data-action="close-modal">关闭</button>
              <button type="button" class="secondary-button" data-action="open-modal" data-modal-type="case" data-record-id="${escapeHtml(entity.id)}">编辑用例</button>
              <button type="button" class="primary-button" data-action="run-case" data-case-id="${escapeHtml(entity.id)}">立即执行</button>
            `
            : ""
    });
  }

  async function cloneRecord(collection, id) {
    if (!collection || !id) {
      return;
    }

    try {
      const cloned = await api(`/api/${collection}/${id}/clone`, { method: "POST" });
      showToast(`${collection === "apis" ? "接口" : collection === "cases" ? "用例" : "记录"}已复制`);
      if (collection === "apis" || collection === "cases") {
        openModal(collection === "apis" ? "api" : "case", { recordId: cloned.id });
      }
      await refreshData();
    } catch (error) {
      showToast(error.message);
    }
  }

  async function deleteRecord(collection, id) {
    if (!collection || !id) {
      return;
    }

    const label = collection === "apis" ? "接口" : collection === "cases" ? "用例" : "记录";
    if (!window.confirm(`确认删除该${label}？`)) {
      return;
    }

    try {
      await api(`/api/${collection}/${id}`, { method: "DELETE" });
      showToast(`${label}已删除`);
      await refreshData();
    } catch (error) {
      showToast(error.message);
    }
  }

  return {
    addCaseToSuite,
    batchAddCasesToSuite,
    closeModal,
    cloneRecord,
    createDefaultCaseForApi: quickCreateDefaultCase,
    deleteRecord,
    deleteSuiteStep,
    ensureForcedPasswordChangeModal,
    handleModalAction,
    handleModalFieldChange,
    moveSuiteStep,
    markStarterGuideCompleted,
    markStarterGuideSeen,
    openModal,
    openSceneBuilderFromApis,
    openRecordDetail,
    readStarterGuideCompleted,
    readStarterGuideSeen,
    renderModal,
    runCase,
    saveSuiteConfig,
    submitModalForm,
    toggleSuiteStepEnabled
  };
}
