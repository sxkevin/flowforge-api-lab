import { isPlainObject } from "./utils.js";

function tokenizePath(path) {
  if (!path) {
    return [];
  }

  let normalized = String(path).trim();
  normalized = normalized.replace(/^\$\./, "");
  normalized = normalized.replace(/^\$/, "");
  if (!normalized) {
    return [];
  }

  const tokens = [];
  const segments = normalized.split(".");

  for (const segment of segments) {
    if (!segment) {
      continue;
    }

    const regex = /([^[\]]+)|\[(\d+|".+?"|'.+?')\]/g;
    let match;
    while ((match = regex.exec(segment))) {
      const token = match[1] ?? match[2];
      if (token === undefined) {
        continue;
      }

      if (/^\d+$/.test(token)) {
        tokens.push(Number(token));
      } else {
        tokens.push(token.replace(/^['"]|['"]$/g, ""));
      }
    }
  }

  return tokens;
}

export function resolveJsonPath(target, path) {
  const tokens = tokenizePath(path);
  if (!tokens.length) {
    return target;
  }

  let current = target;
  for (const token of tokens) {
    if (current === null || current === undefined) {
      return undefined;
    }

    current = current[token];
  }

  return current;
}

export function resolveObjectPath(target, path) {
  if (!path) {
    return target;
  }

  if (!isPlainObject(target) && !Array.isArray(target)) {
    return undefined;
  }

  return resolveJsonPath(target, path);
}

export function resolveXPath(xml, path) {
  if (!xml || !path) {
    return undefined;
  }

  let normalized = String(path).trim();
  const wantsText = normalized.endsWith("/text()");
  normalized = normalized.replace(/\/text\(\)$/, "");
  normalized = normalized.replace(/^\/+/, "");

  if (!normalized) {
    return undefined;
  }

  let current = String(xml);
  const parts = normalized.split("/").filter(Boolean);

  for (const rawPart of parts) {
    const match = rawPart.match(/^([A-Za-z0-9:_-]+)(?:\[(\d+)\])?$/);
    if (!match) {
      return undefined;
    }

    const tag = match[1];
    const index = Number(match[2] ?? "1") - 1;
    const regex = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "g");
    const matches = [...current.matchAll(regex)];
    if (!matches[index]) {
      return undefined;
    }
    current = matches[index][1];
  }

  if (wantsText) {
    return current.replace(/<[^>]+>/g, "").trim();
  }

  return current.trim();
}
