import { createId, nowIso } from "./utils.js";

const supportedMethods = ["get", "post", "put", "patch", "delete"];
const scalarTypes = new Set(["string", "number", "integer", "boolean"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function dereference(spec, node, seen = new Set()) {
  if (!isPlainObject(node) || !node.$ref) {
    return node;
  }

  const ref = String(node.$ref);
  if (!ref.startsWith("#/")) {
    return node;
  }
  if (seen.has(ref)) {
    return {};
  }

  const target = ref
    .slice(2)
    .split("/")
    .reduce((current, part) => current?.[part.replace(/~1/g, "/").replace(/~0/g, "~")], spec);

  if (!isPlainObject(target)) {
    return node;
  }

  const nextSeen = new Set(seen);
  nextSeen.add(ref);
  return dereference(spec, target, nextSeen);
}

function normalizeSchema(spec, schema, seen = new Set()) {
  const resolved = dereference(spec, schema, seen);
  if (!isPlainObject(resolved)) {
    return resolved;
  }

  const ref = resolved.$ref;
  const nextSeen = new Set(seen);
  if (ref && typeof ref === "string") {
    nextSeen.add(ref);
  }

  if (Array.isArray(resolved.allOf) && resolved.allOf.length > 0) {
    return resolved.allOf.reduce((merged, item) => {
      const current = normalizeSchema(spec, item, nextSeen);
      if (!isPlainObject(current)) {
        return merged;
      }
      return {
        ...merged,
        ...current,
        properties: {
          ...(merged.properties ?? {}),
          ...(current.properties ?? {})
        },
        required: [...new Set([...(merged.required ?? []), ...(current.required ?? [])])]
      };
    }, {});
  }

  if (Array.isArray(resolved.oneOf) && resolved.oneOf.length > 0) {
    return normalizeSchema(spec, resolved.oneOf[0], nextSeen);
  }

  if (Array.isArray(resolved.anyOf) && resolved.anyOf.length > 0) {
    return normalizeSchema(spec, resolved.anyOf[0], nextSeen);
  }

  const normalized = { ...resolved };
  if (isPlainObject(normalized.properties)) {
    normalized.properties = Object.fromEntries(
      Object.entries(normalized.properties).map(([key, value]) => [key, normalizeSchema(spec, value, nextSeen)])
    );
  }
  if (normalized.items) {
    normalized.items = normalizeSchema(spec, normalized.items, nextSeen);
  }
  if (normalized.additionalProperties && isPlainObject(normalized.additionalProperties)) {
    normalized.additionalProperties = normalizeSchema(spec, normalized.additionalProperties, nextSeen);
  }

  delete normalized.$ref;
  return normalized;
}

function inferSchemaType(schema) {
  if (!isPlainObject(schema)) {
    return null;
  }
  if (schema.type) {
    return schema.type;
  }
  if (isPlainObject(schema.properties)) {
    return "object";
  }
  if (schema.items) {
    return "array";
  }
  return null;
}

function sanitizeVarSegment(value) {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "") || "value";
}

function buildVarName(pathTokens) {
  return pathTokens.filter(Boolean).map(sanitizeVarSegment).join("_") || "value";
}

function buildScalarTemplate(schema, pathTokens) {
  if (!isPlainObject(schema)) {
    return `{{vars.${buildVarName(pathTokens)}}}`;
  }
  if (schema.example !== undefined) {
    return schema.example;
  }
  if (schema.default !== undefined) {
    return schema.default;
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }
  return `{{vars.${buildVarName(pathTokens)}}}`;
}

function buildTemplateFromSchema(spec, schema, pathTokens = []) {
  const normalized = normalizeSchema(spec, schema);
  const schemaType = inferSchemaType(normalized);

  if (schemaType === "object") {
    const properties = normalized.properties ?? {};
    return Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [key, buildTemplateFromSchema(spec, value, [...pathTokens, key])])
    );
  }

  if (schemaType === "array") {
    return normalized.items ? [buildTemplateFromSchema(spec, normalized.items, [...pathTokens, "item"])] : [];
  }

  if (scalarTypes.has(schemaType)) {
    return buildScalarTemplate(normalized, pathTokens);
  }

  return buildScalarTemplate(normalized, pathTokens);
}

function convertPathTemplate(urlPath) {
  return String(urlPath).replace(/\{([^}]+)\}/g, (_, name) => `{{vars.${buildVarName([name])}}}`);
}

function mergeParameters(spec, pathItem, operation) {
  const merged = new Map();
  for (const source of [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]) {
    const parameter = dereference(spec, source);
    if (!isPlainObject(parameter) || !parameter.name || !parameter.in) {
      continue;
    }
    merged.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  return [...merged.values()];
}

function buildParameterValue(spec, parameter) {
  if (parameter.example !== undefined) {
    return parameter.example;
  }
  return buildTemplateFromSchema(spec, parameter.schema, [parameter.name]);
}

function isJsonContentType(contentType) {
  return /[/+]json$/i.test(contentType) || /application\/json/i.test(contentType);
}

function selectBodyContent(requestBodyContent = {}) {
  const entries = Object.entries(requestBodyContent);
  if (!entries.length) {
    return null;
  }
  const jsonEntry = entries.find(([contentType]) => isJsonContentType(contentType));
  return jsonEntry ?? entries[0];
}

function detectBodyDefinition(spec, operation, method) {
  if (method === "get") {
    return { bodyMode: "none", bodyTemplate: "", contentType: null };
  }

  const bodyEntry = selectBodyContent(operation.requestBody?.content ?? {});
  if (!bodyEntry) {
    return { bodyMode: "none", bodyTemplate: "", contentType: null };
  }

  const [contentType, contentSchema] = bodyEntry;
  if (isJsonContentType(contentType)) {
    return {
      bodyMode: "json",
      bodyTemplate: buildTemplateFromSchema(spec, contentSchema?.schema, ["body"]),
      contentType
    };
  }

  return {
    bodyMode: "raw",
    bodyTemplate:
      contentSchema?.example ??
      (contentSchema?.examples
        ? Object.values(contentSchema.examples)[0]?.value ?? ""
        : ""),
    contentType
  };
}

function buildHeaders(spec, parameters, bodyContentType) {
  const headers = parameters
    .filter((parameter) => parameter.in === "header")
    .map((parameter) => ({
      key: parameter.name,
      value: buildParameterValue(spec, parameter)
    }));

  if (bodyContentType && !headers.some((header) => header.key.toLowerCase() === "content-type")) {
    headers.unshift({ key: "content-type", value: bodyContentType });
  }

  return headers;
}

function buildQuery(spec, parameters) {
  return parameters
    .filter((parameter) => parameter.in === "query")
    .map((parameter) => ({
      key: parameter.name,
      value: buildParameterValue(spec, parameter)
    }));
}

function selectSuccessResponse(operation) {
  const responses = Object.entries(operation.responses ?? {});
  const preferred = responses.find(([code]) => /^2\d\d$/.test(code));
  if (preferred) {
    return preferred;
  }
  return responses.find(([code]) => /^\d+$/.test(code)) ?? ["200", null];
}

function detectResponseAssertions(spec, operation) {
  const [statusCodeRaw, response] = selectSuccessResponse(operation);
  const statusCode = Number(statusCodeRaw) || 200;
  const assertions = [{ type: "status", expected: statusCode }];
  const responseContent = dereference(spec, response)?.content ?? {};
  const jsonResponseEntry = Object.entries(responseContent).find(([contentType]) => isJsonContentType(contentType));
  const schema = jsonResponseEntry ? normalizeSchema(spec, jsonResponseEntry[1]?.schema) : null;

  if (isPlainObject(schema)) {
    assertions.push({ type: "jsonSchema", schema });
  }

  return assertions;
}

export function importOpenApiSpec(specInput, moduleId) {
  const spec = typeof specInput === "string" ? JSON.parse(specInput) : specInput;
  const createdAt = nowIso();
  const apis = [];
  const cases = [];

  for (const [urlPath, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const method of supportedMethods) {
      if (!pathItem[method]) {
        continue;
      }

      const operation = dereference(spec, pathItem[method]);
      const parameters = mergeParameters(spec, pathItem, operation);
      const bodyDefinition = detectBodyDefinition(spec, operation, method);
      const apiId = createId("api");
      const caseId = createId("case");

      apis.push({
        id: apiId,
        moduleId,
        status: "active",
        name: operation.summary || operation.operationId || `${method.toUpperCase()} ${urlPath}`,
        method: method.toUpperCase(),
        path: convertPathTemplate(urlPath),
        headers: buildHeaders(spec, parameters, bodyDefinition.contentType),
        query: buildQuery(spec, parameters),
        bodyMode: bodyDefinition.bodyMode,
        bodyTemplate: bodyDefinition.bodyTemplate,
        preSteps: [],
        postSteps: [],
        tags: operation.tags ?? [],
        createdAt
      });

      cases.push({
        id: caseId,
        apiId,
        priority: inferCasePriority(operation.tags ?? []),
        name: `${operation.summary || operation.operationId || urlPath} 默认用例`,
        description: "由 OpenAPI 导入生成",
        tags: operation.tags ?? [],
        assertions: detectResponseAssertions(spec, operation),
        extracts: [],
        preScript: "",
        postScript: "",
        overrides: {},
        createdAt
      });
    }
  }

  return { apis, cases };
}

function inferCasePriority(tags = []) {
  if (tags.includes("critical") || tags.includes("p0") || tags.includes("high")) {
    return "high";
  }
  if (tags.includes("smoke") || tags.includes("core") || tags.includes("regression")) {
    return "medium";
  }
  return "low";
}
