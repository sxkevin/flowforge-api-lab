import { svgChevron, svgFilter, svgPulse, svgSearch } from "./icons.js";
import { escapeHtml, serializeDataset } from "./formatters.js";

export function renderStatCard(title, value, meta, tone, icon) {
  return `
    <article class="stat-card">
      <div>
        <h3>${escapeHtml(title)}</h3>
        <p class="stat-value">${escapeHtml(String(value))}</p>
        <div class="stat-meta ${meta.startsWith("-") ? "" : "trend-up"}">${escapeHtml(meta)}</div>
      </div>
      <div class="icon-box icon-${tone}">${icon}</div>
    </article>
  `;
}

export function renderQuickAction(label, action, dataset = {}) {
  return `
    <button class="quick-action" data-action="${action}" ${serializeDataset(dataset)}>
      ${svgPulse()}
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

export function renderSearchBox(placeholder, value, page, key) {
  return `
    <label class="search-box">
      ${svgSearch()}
      <input value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" data-filter-page="${page}" data-filter-key="${key}" />
    </label>
  `;
}

export function renderDateInput(value, page, key) {
  return `
    <label class="date-filter">
      <input type="date" value="${escapeHtml(value || "")}" data-filter-page="${page}" data-filter-key="${key}" />
    </label>
  `;
}

export function renderSelectControl(options, selectedValue, page, key) {
  return `
    <label class="control">
      <select data-filter-page="${page}" data-filter-key="${key}">
        ${options
          .map(
            (item) => `
              <option value="${escapeHtml(item.value)}" ${item.value === selectedValue ? "selected" : ""}>
                ${escapeHtml(item.label)}
              </option>
            `
          )
          .join("")}
      </select>
      ${svgChevron()}
    </label>
  `;
}

export function renderFilterButton() {
  return `<button class="control icon-filter" type="button">${svgFilter()}</button>`;
}

export function rowsOrAllOption(options, label) {
  return [{ value: "all", label }, ...options];
}

export function fieldInput(name, label, value = "", required = true, type = "text") {
  return `
    <div class="field">
      <label>${escapeHtml(label)}</label>
      <input type="${type}" name="${escapeHtml(name)}" value="${escapeHtml(value)}" ${required ? "required" : ""} />
    </div>
  `;
}

export function fieldTextarea(name, label, value = "", json = false, extraClass = "") {
  return `
    <div class="field ${extraClass}">
      <label>${escapeHtml(label)}</label>
      <textarea name="${escapeHtml(name)}" ${json ? 'spellcheck="false"' : ""}>${escapeHtml(value)}</textarea>
    </div>
  `;
}

export function fieldSelect(name, label, options, selectedValue = "") {
  return `
    <div class="field">
      <label>${escapeHtml(label)}</label>
      <select name="${escapeHtml(name)}">
        ${options
          .map(
            (item) =>
              `<option value="${escapeHtml(item.value)}" ${String(item.value) === String(selectedValue) ? "selected" : ""}>${escapeHtml(item.label)}</option>`
          )
          .join("")}
      </select>
    </div>
  `;
}

export function renderLineChart(labels, passValues, failValues, width, height) {
  const padding = { top: 18, right: 18, bottom: 42, left: 56 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...passValues, ...failValues);
  const ticks = 4;
  const series = [
    { color: "#55b37f", values: passValues },
    { color: "#e25546", values: failValues }
  ];

  const gridLines = Array.from({ length: ticks + 1 }, (_, index) => {
    const y = padding.top + (innerHeight / ticks) * index;
    const value = Math.round(maxValue - (maxValue / ticks) * index);
    return `
      <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#d7dce5" stroke-dasharray="4 6" />
      <text x="${padding.left - 12}" y="${y + 5}" text-anchor="end" fill="#70798c" font-size="14">${value}</text>
    `;
  }).join("");

  const xGrid = labels
    .map((label, index) => {
      const x = padding.left + (innerWidth / Math.max(1, labels.length - 1)) * index;
      return `
        <line x1="${x}" y1="${padding.top}" x2="${x}" y2="${height - padding.bottom}" stroke="#d7dce5" stroke-dasharray="4 6" />
        <text x="${x}" y="${height - 10}" text-anchor="middle" fill="#70798c" font-size="14">${label}</text>
      `;
    })
    .join("");

  const paths = series
    .map(({ color, values }) => {
      const points = values.map((value, index) => {
        const x = padding.left + (innerWidth / Math.max(1, values.length - 1)) * index;
        const y = padding.top + innerHeight - (value / maxValue) * innerHeight;
        return { x, y };
      });
      const path = points
        .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
        .join(" ");
      return `
        <path d="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" />
        ${points
          .map((point) => `<circle cx="${point.x}" cy="${point.y}" r="4.5" fill="#fff" stroke="${color}" stroke-width="3" />`)
          .join("")}
      `;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="trend chart">
      ${gridLines}
      ${xGrid}
      ${paths}
    </svg>
  `;
}

export function renderBarChart(moduleStats, width, height) {
  const safeStats = moduleStats.length ? moduleStats : [{ name: "默认模块", passed: 0, failed: 0 }];
  const padding = { top: 24, right: 20, bottom: 54, left: 64 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...safeStats.flatMap((item) => [item.passed, item.failed]));
  const groupWidth = innerWidth / safeStats.length;
  const barWidth = Math.min(64, groupWidth / 3);

  const gridLines = Array.from({ length: 5 }, (_, index) => {
    const y = padding.top + (innerHeight / 4) * index;
    const value = Math.round(maxValue - (maxValue / 4) * index);
    return `
      <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#d7dce5" stroke-dasharray="4 6" />
      <text x="${padding.left - 12}" y="${y + 5}" text-anchor="end" fill="#70798c" font-size="14">${value}</text>
    `;
  }).join("");

  const bars = safeStats
    .map((item, index) => {
      const x = padding.left + groupWidth * index + groupWidth / 2;
      const passHeight = (item.passed / maxValue) * innerHeight;
      const failHeight = (item.failed / maxValue) * innerHeight;
      return `
        <rect x="${x - barWidth - 6}" y="${padding.top + innerHeight - passHeight}" width="${barWidth}" height="${passHeight}" fill="#55b37f" />
        <rect x="${x + 6}" y="${padding.top + innerHeight - failHeight}" width="${barWidth}" height="${failHeight}" fill="#e25546" />
        <text x="${x}" y="${height - 16}" text-anchor="middle" fill="#70798c" font-size="14">${escapeHtml(item.name)}</text>
      `;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="module chart">
      ${gridLines}
      ${bars}
    </svg>
  `;
}

export function renderDonutChart(passed, failed) {
  const total = Math.max(1, passed + failed);
  const passedLength = (passed / total) * 314;
  const failedLength = (failed / total) * 314;
  return `
    <svg viewBox="0 0 260 260" role="img" aria-label="pass rate chart">
      <circle cx="130" cy="130" r="50" fill="none" stroke="#eef1f5" stroke-width="100"></circle>
      <circle cx="130" cy="130" r="50" fill="none" stroke="#55b37f" stroke-width="100" stroke-dasharray="${passedLength} ${314 - passedLength}" transform="rotate(-90 130 130)"></circle>
      <circle cx="130" cy="130" r="50" fill="none" stroke="#e25546" stroke-width="100" stroke-dasharray="${failedLength} ${314 - failedLength}" stroke-dashoffset="${-passedLength}" transform="rotate(-90 130 130)"></circle>
      <circle cx="130" cy="130" r="48" fill="#fff"></circle>
    </svg>
  `;
}
