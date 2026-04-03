import { resolveJsonPath, resolveXPath } from "./jsonpath.js";

function typeOfValue(value) {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

function compareValues(actual, expected, operator = "equals") {
  switch (operator) {
    case "equals":
      return actual === expected;
    case "notEquals":
      return actual !== expected;
    case "contains":
      return String(actual).includes(String(expected));
    case "gt":
      return Number(actual) > Number(expected);
    case "gte":
      return Number(actual) >= Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    case "lte":
      return Number(actual) <= Number(expected);
    case "exists":
      return actual !== undefined && actual !== null;
    default:
      return false;
  }
}

function validateSchema(schema, data, path = "$") {
  const errors = [];

  if (!schema || typeof schema !== "object") {
    return errors;
  }

  if (schema.type) {
    const actualType = typeOfValue(data);
    if (schema.type !== actualType) {
      errors.push(`${path} expected type ${schema.type} but got ${actualType}`);
      return errors;
    }
  }

  if (schema.required && Array.isArray(schema.required) && data && typeof data === "object") {
    for (const key of schema.required) {
      if (!(key in data)) {
        errors.push(`${path}.${key} is required`);
      }
    }
  }

  if (schema.properties && data && typeof data === "object") {
    for (const [key, propertySchema] of Object.entries(schema.properties)) {
      if (key in data) {
        errors.push(...validateSchema(propertySchema, data[key], `${path}.${key}`));
      }
    }
  }

  if (schema.items && Array.isArray(data)) {
    data.forEach((item, index) => {
      errors.push(...validateSchema(schema.items, item, `${path}[${index}]`));
    });
  }

  return errors;
}

export function runAssertions(assertions = [], responseContext = {}) {
  const results = [];
  const headers = responseContext.headers ?? {};
  const body = responseContext.body;
  const bodyText = responseContext.bodyText ?? "";

  for (const assertion of assertions) {
    let passed = false;
    let actual;
    let expected = assertion.expected;

    switch (assertion.type) {
      case "status":
        actual = responseContext.status;
        passed = compareValues(actual, Number(expected), assertion.operator ?? "equals");
        break;
      case "fieldEquals":
      case "jsonPath":
        actual = resolveJsonPath(body, assertion.path);
        passed = compareValues(actual, expected, assertion.operator ?? "equals");
        break;
      case "fieldType":
        actual = typeOfValue(resolveJsonPath(body, assertion.path));
        passed = compareValues(actual, expected, "equals");
        break;
      case "exists":
        actual = resolveJsonPath(body, assertion.path);
        passed = compareValues(actual, expected, "exists");
        break;
      case "responseTime":
        actual = responseContext.duration;
        passed = compareValues(actual, Number(expected), assertion.operator ?? "lte");
        break;
      case "headerEquals":
        actual = headers[String(assertion.name || "").toLowerCase()];
        passed = compareValues(actual, expected, assertion.operator ?? "equals");
        break;
      case "bodyContains":
        actual = bodyText;
        passed = compareValues(actual, expected, "contains");
        break;
      case "jsonSchema": {
        actual = body;
        const errors = validateSchema(assertion.schema, body);
        passed = errors.length === 0;
        expected = assertion.schema;
        if (!passed) {
          results.push({
            type: assertion.type,
            passed,
            actual,
            expected,
            message: errors.join("; ")
          });
          continue;
        }
        break;
      }
      case "xpath":
        actual = resolveXPath(bodyText, assertion.path);
        passed = compareValues(actual, expected, assertion.operator ?? "equals");
        break;
      default:
        actual = undefined;
        passed = false;
        break;
    }

    results.push({
      type: assertion.type,
      passed,
      actual,
      expected,
      message: passed
        ? `${assertion.type} passed`
        : `${assertion.type} failed: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    });
  }

  return results;
}
