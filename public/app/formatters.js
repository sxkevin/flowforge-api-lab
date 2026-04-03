export function stringifyFormValue(value, fallback = "") {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function parseJson(raw, fallback) {
  const text = String(raw || "").trim();
  if (!text) {
    return fallback;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`JSON 解析失败: ${error.message}`);
  }
}

export function parseJsonOrText(raw) {
  const text = String(raw || "").trim();
  if (!text) {
    return "";
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function inferPriority(tags = [], index = 0) {
  if (tags.includes("core") || tags.includes("smoke")) {
    return "high";
  }
  if (tags.includes("regression")) {
    return "medium";
  }
  return index % 3 === 0 ? "high" : index % 3 === 1 ? "medium" : "low";
}

export function inferExecutionStatus(index) {
  return ["passed", "failed", "passed", "running", "queued", "passed"][index % 6];
}

export function priorityText(priority) {
  if (priority === "high") {
    return "高";
  }
  if (priority === "medium") {
    return "中";
  }
  return "低";
}

export function statusText(status) {
  return {
    passed: "通过",
    failed: "失败",
    running: "执行中",
    queued: "排队中",
    canceled: "已取消",
    history: "已完成"
  }[status] || status;
}

export function statusClassName(status) {
  return status === "passed"
    ? "success"
    : status === "failed"
      ? "failed"
      : status === "running"
        ? "running"
        : "queued";
}

export function calcRate(value, total) {
  if (!total) {
    return "0%";
  }
  return `${((value / total) * 100).toFixed(1)}%`;
}

export function calcTrend(value, ratio) {
  if (!value) {
    return ratio > 0 ? `+${(ratio * 100).toFixed(1)}%` : `${(ratio * 100).toFixed(1)}%`;
  }
  return ratio > 0 ? `+${(ratio * 100).toFixed(1)}%` : `${(ratio * 100).toFixed(1)}%`;
}

export function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value || 0));
}

export function formatDuration(ms) {
  const value = Math.max(0, Number(ms || 0));
  const totalSeconds = Math.round(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;

  if (hours > 0) {
    return `${hours}h ${remainMinutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds || 0}s`;
}

export function formatDate(iso) {
  if (!iso) {
    return "-";
  }
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatDateTime(iso) {
  if (!iso) {
    return "-";
  }
  const date = new Date(iso);
  return `${formatDate(iso)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatClock(iso) {
  if (!iso) {
    return "--:--:--";
  }
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function relativeTime(iso) {
  if (!iso) {
    return "刚刚";
  }
  const diff = Date.now() - new Date(iso).getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  if (diff < minute) {
    return "刚刚";
  }
  if (diff < hour) {
    return `${Math.max(1, Math.round(diff / minute))}分钟前`;
  }
  return `${Math.max(1, Math.round(diff / hour))}小时前`;
}

export function normalizeEnvSlug(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "env";
}

export function serializeDataset(dataset) {
  return Object.entries(dataset)
    .map(([key, value]) => `data-${dashCase(key)}="${escapeHtml(String(value))}"`)
    .join(" ");
}

export function dashCase(value) {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

export function dateKey(iso) {
  return formatDate(iso);
}

export function pad(value) {
  return String(value).padStart(2, "0");
}

export function clientId(prefix) {
  return `${prefix}_${Math.random().toString(16).slice(2, 10)}`;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
