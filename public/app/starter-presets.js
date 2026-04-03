function normalizePath(path, fallback = "/resource") {
  const raw = String(path || fallback).trim();
  if (!raw) {
    return fallback;
  }
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
}

function dedupeTags(tags = []) {
  return [...new Set((tags || []).filter(Boolean))];
}

function createApi(ref, payload) {
  return { ref, payload };
}

function createCase(ref, apiRef, payload) {
  return { ref, apiRef, payload };
}

export function getBusinessTemplateOptions() {
  return [
    {
      value: "login",
      label: "登录态接口",
      description: "自动生成登录接口、鉴权变量提取和带 Token 的验证接口。"
    },
    {
      value: "crud",
      label: "增删改查接口",
      description: "自动生成列表、详情、新增、更新、删除五个常见接口与默认场景。"
    },
    {
      value: "pagination",
      label: "分页列表接口",
      description: "生成分页查询接口、常用分页参数与返回结构断言。"
    },
    {
      value: "search",
      label: "搜索筛选接口",
      description: "生成带关键字、状态、排序条件的搜索类接口与默认校验。"
    },
    {
      value: "upload",
      label: "文件上传接口",
      description: "生成上传接口、结果查询接口，以及文件 ID 提取规则。"
    },
    {
      value: "batch",
      label: "批量操作接口",
      description: "生成批量创建、批量删除、批量查询等常见批处理接口。"
    }
  ];
}

export function buildBusinessTemplateBundle({
  templateKey,
  displayName,
  basePath,
  tags = [],
  createSuite = true
}) {
  const templateTags = dedupeTags(tags);
  const safeDisplayName = String(displayName || "业务对象").trim() || "业务对象";
  const normalizedBasePath =
    templateKey === "login" ? normalizePath(basePath || "/auth") : normalizePath(basePath || `/${safeDisplayName}`);

  if (templateKey === "login") {
    const loginPath = `${normalizedBasePath}/login`.replace(/\/{2,}/g, "/");
    const mePath = `${normalizedBasePath}/me`.replace(/\/{2,}/g, "/");
    return {
      apis: [
        createApi("login", {
          name: `${safeDisplayName}登录`,
          method: "POST",
          path: loginPath,
          status: "active",
          bodyMode: "json",
          headers: [{ key: "content-type", value: "application/json" }],
          query: [],
          bodyTemplate: {
            username: "{{vars.username}}",
            password: "{{vars.password}}"
          },
          tags: dedupeTags([...templateTags, "auth", "login"])
        }),
        createApi("profile", {
          name: `${safeDisplayName}登录态校验`,
          method: "GET",
          path: mePath,
          status: "active",
          bodyMode: "none",
          headers: [{ key: "authorization", value: "Bearer {{vars.authToken}}" }],
          query: [],
          bodyTemplate: "",
          tags: dedupeTags([...templateTags, "auth", "profile"])
        })
      ],
      cases: [
        createCase("login_success", "login", {
          name: `${safeDisplayName}登录成功`,
          description: "校验登录接口返回 200，并从返回体中提取 Token。",
          priority: "high",
          tags: dedupeTags([...templateTags, "smoke", "auth"]),
          assertions: [
            { type: "status", expected: 200 },
            { type: "fieldType", path: "$.token", expected: "string" }
          ],
          extracts: [{ name: "authToken", source: "jsonPath", path: "$.token" }],
          preScript: "",
          postScript: "",
          overrides: {}
        }),
        createCase("login_verify", "profile", {
          name: `${safeDisplayName}登录态验证`,
          description: "校验携带 Token 后接口可访问。",
          priority: "high",
          tags: dedupeTags([...templateTags, "smoke", "auth"]),
          assertions: [
            { type: "status", expected: 200 },
            { type: "exists", path: "$.id", expected: true }
          ],
          extracts: [],
          preScript: "",
          postScript: "",
          overrides: {}
        })
      ],
      suite: createSuite
        ? {
            name: `${safeDisplayName}登录链路`,
            description: "先登录，再验证登录态。",
            tags: dedupeTags([...templateTags, "starter", "auth"]),
            variables: {
              username: "demo@example.com",
              password: "pass123456"
            },
            caseRefs: ["login_success", "login_verify"]
          }
        : null
    };
  }

  if (templateKey === "pagination") {
    return {
      apis: [
        createApi("page_list", {
          name: `${safeDisplayName}分页列表`,
          method: "GET",
          path: normalizedBasePath,
          status: "active",
          bodyMode: "none",
          headers: [],
          query: [
            { key: "page", value: "1" },
            { key: "pageSize", value: "20" },
            { key: "keyword", value: "{{vars.keyword}}" }
          ],
          bodyTemplate: "",
          tags: dedupeTags([...templateTags, "list", "pagination"])
        })
      ],
      cases: [
        createCase("page_case", "page_list", {
          name: `${safeDisplayName}分页查询`,
          description: "校验分页查询成功，并包含总数字段和列表字段。",
          priority: "medium",
          tags: dedupeTags([...templateTags, "pagination", "smoke"]),
          assertions: [
            { type: "status", expected: 200 },
            { type: "fieldType", path: "$.total", expected: "number" },
            { type: "exists", path: "$.list", expected: true }
          ],
          extracts: [],
          preScript: "",
          postScript: "",
          overrides: {}
        })
      ],
      suite: createSuite
        ? {
            name: `${safeDisplayName}分页巡检`,
            description: "执行常见分页查询模板。",
            tags: dedupeTags([...templateTags, "starter", "pagination"]),
            variables: {
              keyword: ""
            },
            caseRefs: ["page_case"]
          }
        : null
    };
  }

  if (templateKey === "search") {
    return {
      apis: [
        createApi("search", {
          name: `${safeDisplayName}搜索`,
          method: "GET",
          path: normalizedBasePath,
          status: "active",
          bodyMode: "none",
          headers: [],
          query: [
            { key: "keyword", value: "{{vars.keyword}}" },
            { key: "status", value: "{{vars.status}}" },
            { key: "sortBy", value: "{{vars.sortBy}}" }
          ],
          bodyTemplate: "",
          tags: dedupeTags([...templateTags, "search", "filter"])
        })
      ],
      cases: [
        createCase("search_case", "search", {
          name: `${safeDisplayName}搜索结果可读`,
          description: "校验搜索接口返回成功，并包含结果列表。",
          priority: "medium",
          tags: dedupeTags([...templateTags, "search", "smoke"]),
          assertions: [
            { type: "status", expected: 200 },
            { type: "exists", path: "$.list", expected: true }
          ],
          extracts: [],
          preScript: "",
          postScript: "",
          overrides: {}
        })
      ],
      suite: createSuite
        ? {
            name: `${safeDisplayName}搜索巡检`,
            description: "执行一次典型的搜索和筛选请求。",
            tags: dedupeTags([...templateTags, "starter", "search"]),
            variables: {
              keyword: "",
              status: "active",
              sortBy: "createdAt"
            },
            caseRefs: ["search_case"]
          }
        : null
    };
  }

  if (templateKey === "upload") {
    const uploadBasePath = normalizePath(basePath || "/files");
    return {
      apis: [
        createApi("upload", {
          name: `${safeDisplayName}上传`,
          method: "POST",
          path: `${uploadBasePath}/upload`,
          status: "active",
          bodyMode: "raw",
          headers: [{ key: "content-type", value: "application/octet-stream" }],
          query: [],
          bodyTemplate: "sample-file-content",
          tags: dedupeTags([...templateTags, "upload", "file"])
        }),
        createApi("query_upload", {
          name: `${safeDisplayName}上传结果查询`,
          method: "GET",
          path: `${uploadBasePath}/{{vars.fileId}}`,
          status: "active",
          bodyMode: "none",
          headers: [],
          query: [],
          bodyTemplate: "",
          tags: dedupeTags([...templateTags, "upload", "query"])
        })
      ],
      cases: [
        createCase("upload_case", "upload", {
          name: `${safeDisplayName}上传成功`,
          description: "校验上传接口返回成功，并提取文件 ID。",
          priority: "high",
          tags: dedupeTags([...templateTags, "upload", "smoke"]),
          assertions: [
            { type: "status", expected: 200 },
            { type: "fieldType", path: "$.fileId", expected: "string" }
          ],
          extracts: [{ name: "fileId", source: "jsonPath", path: "$.fileId" }],
          preScript: "",
          postScript: "",
          overrides: {}
        }),
        createCase("upload_query_case", "query_upload", {
          name: `${safeDisplayName}上传记录可查`,
          description: "校验上传成功后能查到文件详情。",
          priority: "medium",
          tags: dedupeTags([...templateTags, "upload", "query"]),
          assertions: [
            { type: "status", expected: 200 },
            { type: "exists", path: "$.fileId", expected: true }
          ],
          extracts: [],
          preScript: "",
          postScript: "",
          overrides: {}
        })
      ],
      suite: createSuite
        ? {
            name: `${safeDisplayName}上传链路`,
            description: "上传文件后立即查询上传结果。",
            tags: dedupeTags([...templateTags, "starter", "upload"]),
            variables: {},
            caseRefs: ["upload_case", "upload_query_case"]
          }
        : null
    };
  }

  if (templateKey === "batch") {
    return {
      apis: [
        createApi("batch_create", {
          name: `${safeDisplayName}批量创建`,
          method: "POST",
          path: `${normalizedBasePath}/batch`,
          status: "active",
          bodyMode: "json",
          headers: [{ key: "content-type", value: "application/json" }],
          query: [],
          bodyTemplate: {
            items: [{ name: "{{vars.firstName}}" }, { name: "{{vars.secondName}}" }]
          },
          tags: dedupeTags([...templateTags, "batch", "create"])
        }),
        createApi("batch_query", {
          name: `${safeDisplayName}批量结果查询`,
          method: "GET",
          path: `${normalizedBasePath}/batch/{{vars.batchId}}`,
          status: "active",
          bodyMode: "none",
          headers: [],
          query: [],
          bodyTemplate: "",
          tags: dedupeTags([...templateTags, "batch", "query"])
        }),
        createApi("batch_delete", {
          name: `${safeDisplayName}批量删除`,
          method: "POST",
          path: `${normalizedBasePath}/batch-delete`,
          status: "active",
          bodyMode: "json",
          headers: [{ key: "content-type", value: "application/json" }],
          query: [],
          bodyTemplate: {
            ids: ["{{vars.firstId}}", "{{vars.secondId}}"]
          },
          tags: dedupeTags([...templateTags, "batch", "delete"])
        })
      ],
      cases: [
        createCase("batch_create_case", "batch_create", {
          name: `${safeDisplayName}批量创建成功`,
          description: "校验批量创建成功，并提取批次 ID。",
          priority: "high",
          tags: dedupeTags([...templateTags, "batch", "smoke"]),
          assertions: [
            { type: "status", expected: 200 },
            { type: "fieldType", path: "$.batchId", expected: "string" }
          ],
          extracts: [{ name: "batchId", source: "jsonPath", path: "$.batchId" }],
          preScript: "",
          postScript: "",
          overrides: {}
        }),
        createCase("batch_query_case", "batch_query", {
          name: `${safeDisplayName}批次结果可查`,
          description: "校验批量任务提交后可查询结果。",
          priority: "medium",
          tags: dedupeTags([...templateTags, "batch", "query"]),
          assertions: [
            { type: "status", expected: 200 },
            { type: "exists", path: "$.items", expected: true }
          ],
          extracts: [],
          preScript: "",
          postScript: "",
          overrides: {}
        }),
        createCase("batch_delete_case", "batch_delete", {
          name: `${safeDisplayName}批量删除成功`,
          description: "校验批量删除接口成功返回。",
          priority: "medium",
          tags: dedupeTags([...templateTags, "batch", "delete"]),
          assertions: [{ type: "status", expected: 200 }],
          extracts: [],
          preScript: "",
          postScript: "",
          overrides: {}
        })
      ],
      suite: createSuite
        ? {
            name: `${safeDisplayName}批量操作巡检`,
            description: "验证批量创建、查询、删除的典型链路。",
            tags: dedupeTags([...templateTags, "starter", "batch"]),
            variables: {
              firstName: `${safeDisplayName}A`,
              secondName: `${safeDisplayName}B`,
              firstId: "ID-1",
              secondId: "ID-2"
            },
            caseRefs: ["batch_create_case", "batch_query_case", "batch_delete_case"]
          }
        : null
    };
  }

  return {
    apis: [
      createApi("list", {
        name: `${safeDisplayName}列表`,
        method: "GET",
        path: normalizedBasePath,
        status: "active",
        bodyMode: "none",
        headers: [],
        query: [],
        bodyTemplate: "",
        tags: dedupeTags([...templateTags, "crud", "list"])
      }),
      createApi("detail", {
        name: `${safeDisplayName}详情`,
        method: "GET",
        path: `${normalizedBasePath}/{{vars.resourceId}}`,
        status: "active",
        bodyMode: "none",
        headers: [],
        query: [],
        bodyTemplate: "",
        tags: dedupeTags([...templateTags, "crud", "detail"])
      }),
      createApi("create", {
        name: `${safeDisplayName}新增`,
        method: "POST",
        path: normalizedBasePath,
        status: "active",
        bodyMode: "json",
        headers: [{ key: "content-type", value: "application/json" }],
        query: [],
        bodyTemplate: {
          name: "{{vars.resourceName}}"
        },
        tags: dedupeTags([...templateTags, "crud", "create"])
      }),
      createApi("update", {
        name: `${safeDisplayName}更新`,
        method: "PUT",
        path: `${normalizedBasePath}/{{vars.resourceId}}`,
        status: "active",
        bodyMode: "json",
        headers: [{ key: "content-type", value: "application/json" }],
        query: [],
        bodyTemplate: {
          name: "{{vars.updatedResourceName}}"
        },
        tags: dedupeTags([...templateTags, "crud", "update"])
      }),
      createApi("delete", {
        name: `${safeDisplayName}删除`,
        method: "DELETE",
        path: `${normalizedBasePath}/{{vars.resourceId}}`,
        status: "active",
        bodyMode: "none",
        headers: [],
        query: [],
        bodyTemplate: "",
        tags: dedupeTags([...templateTags, "crud", "delete"])
      })
    ],
    cases: [
      createCase("create_case", "create", {
        name: `${safeDisplayName}新增成功`,
        description: "创建资源并提取资源 ID，用于后续详情、更新、删除。",
        priority: "high",
        tags: dedupeTags([...templateTags, "crud", "smoke"]),
        assertions: [
          { type: "status", expected: 201 },
          { type: "fieldType", path: "$.id", expected: "string" }
        ],
        extracts: [{ name: "resourceId", source: "jsonPath", path: "$.id" }],
        preScript: "",
        postScript: "",
        overrides: {}
      }),
      createCase("detail_case", "detail", {
        name: `${safeDisplayName}详情可读`,
        description: "校验创建后可读取详情。",
        priority: "medium",
        tags: dedupeTags([...templateTags, "crud", "detail"]),
        assertions: [
          { type: "status", expected: 200 },
          { type: "exists", path: "$.id", expected: true }
        ],
        extracts: [],
        preScript: "",
        postScript: "",
        overrides: {}
      }),
      createCase("update_case", "update", {
        name: `${safeDisplayName}更新成功`,
        description: "校验更新接口成功。",
        priority: "medium",
        tags: dedupeTags([...templateTags, "crud", "update"]),
        assertions: [
          { type: "status", expected: 200 },
          { type: "exists", path: "$.id", expected: true }
        ],
        extracts: [],
        preScript: "",
        postScript: "",
        overrides: {}
      }),
      createCase("list_case", "list", {
        name: `${safeDisplayName}列表可读`,
        description: "校验列表接口成功返回。",
        priority: "medium",
        tags: dedupeTags([...templateTags, "crud", "list"]),
        assertions: [
          { type: "status", expected: 200 },
          { type: "exists", path: "$", expected: true }
        ],
        extracts: [],
        preScript: "",
        postScript: "",
        overrides: {}
      }),
      createCase("delete_case", "delete", {
        name: `${safeDisplayName}删除成功`,
        description: "校验删除接口成功返回。",
        priority: "medium",
        tags: dedupeTags([...templateTags, "crud", "delete"]),
        assertions: [{ type: "status", expected: 200 }],
        extracts: [],
        preScript: "",
        postScript: "",
        overrides: {}
      })
    ],
    suite: createSuite
      ? {
          name: `${safeDisplayName}增删改查巡检`,
          description: "依次执行新增、详情、更新、列表、删除。",
          tags: dedupeTags([...templateTags, "starter", "crud"]),
          variables: {
            resourceName: `${safeDisplayName}示例`,
            updatedResourceName: `${safeDisplayName}更新后`
          },
          caseRefs: ["create_case", "detail_case", "update_case", "list_case", "delete_case"]
        }
      : null
  };
}
