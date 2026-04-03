import { createId } from "./utils.js";
import { resolveObjectPath } from "./jsonpath.js";

const fullTemplateRegex = /^{{\s*([^}]+?)\s*}}$/;
const templateRegex = /{{\s*([^}]+?)\s*}}/g;

function builtins() {
  return {
    now: new Date().toISOString(),
    timestamp: Date.now(),
    random: Math.random().toString(36).slice(2, 10),
    uuid: createId("var")
  };
}

function resolveExpression(expression, context) {
  const trimmed = expression.trim();
  const dynamic = builtins();

  if (trimmed in dynamic) {
    return dynamic[trimmed];
  }

  return resolveObjectPath({ ...context, builtin: dynamic }, trimmed);
}

export function renderTemplate(value, context = {}) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    const fullMatch = value.match(fullTemplateRegex);
    if (fullMatch) {
      const resolved = resolveExpression(fullMatch[1], context);
      return resolved === undefined ? value : resolved;
    }

    return value.replace(templateRegex, (_, expression) => {
      const resolved = resolveExpression(expression, context);
      return resolved === undefined ? "" : String(resolved);
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => renderTemplate(item, context));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, renderTemplate(item, context)])
    );
  }

  return value;
}
