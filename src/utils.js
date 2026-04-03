import crypto from "node:crypto";

export function nowIso() {
  return new Date().toISOString();
}

export function createId(prefix = "id") {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function readJsonSafe(input, fallback) {
  if (input === undefined || input === null || input === "") {
    return fallback;
  }

  if (typeof input !== "string") {
    return input;
  }

  try {
    return JSON.parse(input);
  } catch (error) {
    return fallback;
  }
}

export function parseMaybeJson(input, fallback) {
  if (input === undefined || input === null || input === "") {
    return fallback;
  }

  if (typeof input !== "string") {
    return input;
  }

  return JSON.parse(input);
}

export function toObjectEntries(input) {
  if (!input) {
    return [];
  }

  if (Array.isArray(input)) {
    return input
      .filter((item) => item && item.key)
      .map((item) => ({ key: String(item.key), value: item.value ?? "" }));
  }

  return Object.entries(input).map(([key, value]) => ({ key, value }));
}

export function entriesToObject(entries = []) {
  return entries.reduce((result, entry) => {
    if (entry && entry.key) {
      result[String(entry.key)] = entry.value ?? "";
    }
    return result;
  }, {});
}

export function asArray(value, fallback = []) {
  return Array.isArray(value) ? value : fallback;
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
