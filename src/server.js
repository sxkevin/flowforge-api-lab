import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { RunQueue } from "./run-queue.js";
import { RunnerClient } from "./runner-client.js";
import { Scheduler } from "./scheduler.js";
import { PlatformService } from "./services/platform-service.js";
import { Storage } from "./storage.js";
import { createId } from "./utils.js";

const preferredPort = Number(process.env.PORT || 3000);
const hasExplicitPort = Boolean(process.env.PORT);
const publicDir = path.join(process.cwd(), "public");
const storage = new Storage(preferredPort);
const runnerClient = new RunnerClient();
const runQueue = new RunQueue(storage, runnerClient);
const scheduler = new Scheduler(storage, runQueue);
const platform = new PlatformService({ storage, runnerClient, scheduler, runQueue });
const demoOrders = new Map();
let currentPort = preferredPort;
let hasLoggedListening = false;

runQueue.recover();
scheduler.refresh();

function getBaseUrl(request) {
  const host = request?.headers?.host ?? `localhost:${currentPort}`;
  return `http://${host}`;
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data, null, 2));
}

function sendText(response, statusCode, contentType, data, extraHeaders = {}) {
  response.writeHead(statusCode, { "content-type": contentType, ...extraHeaders });
  response.end(data);
}

function notFound(response) {
  sendJson(response, 404, { error: "not found" });
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

function serveStatic(request, response, pathname) {
  let filePath = pathname === "/" ? "/index.html" : pathname;
  filePath = path.join(publicDir, filePath);
  if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath)) {
    return false;
  }

  const extension = path.extname(filePath);
  const contentType =
    extension === ".html"
      ? "text/html; charset=utf-8"
      : extension === ".css"
        ? "text/css; charset=utf-8"
        : extension === ".js"
          ? "application/javascript; charset=utf-8"
          : "text/plain; charset=utf-8";

  sendText(response, 200, contentType, fs.readFileSync(filePath));
  return true;
}

function extractId(pathname) {
  return pathname.split("/").filter(Boolean).pop();
}

function getRequestContext(request) {
  const authorization = request.headers.authorization;
  const bearerToken =
    typeof authorization === "string" && authorization.toLowerCase().startsWith("bearer ")
      ? authorization.slice(7).trim()
      : null;

  return {
    authToken: request.headers["x-session-token"] || bearerToken,
    userId: request.headers["x-user-id"],
    userName: request.headers["x-user-name"]
  };
}

async function routeCollection(request, response, pathname, collectionName) {
  const context = getRequestContext(request);
  if (pathname === `/api/${collectionName}` && request.method === "GET") {
    return sendJson(response, 200, platform.listCollection(collectionName, context));
  }

  if (pathname === `/api/${collectionName}` && request.method === "POST") {
    try {
      const payload = await readBody(request);
      return sendJson(response, 201, platform.createCollectionEntity(collectionName, payload, context));
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  if (pathname === `/api/${collectionName}/batch-clone` && request.method === "POST") {
    try {
      const payload = await readBody(request);
      return sendJson(response, 201, platform.cloneCollectionEntities(collectionName, payload.ids, context));
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  if (pathname === `/api/${collectionName}/batch-delete` && request.method === "POST") {
    try {
      const payload = await readBody(request);
      return sendJson(response, 200, platform.removeCollectionEntities(collectionName, payload.ids, context));
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  if (pathname.startsWith(`/api/${collectionName}/`) && request.method === "GET") {
    const entity = platform.getCollectionEntity(collectionName, extractId(pathname), context);
    if (!entity) {
      return notFound(response);
    }
    return sendJson(response, 200, entity);
  }

  if (new RegExp(`^/api/${collectionName}/[^/]+/clone$`).test(pathname) && request.method === "POST") {
    try {
      const entity = platform.cloneCollectionEntity(collectionName, pathname.split("/")[3], context);
      if (!entity) {
        return notFound(response);
      }
      return sendJson(response, 201, entity);
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  if (pathname.startsWith(`/api/${collectionName}/`) && request.method === "PUT") {
    try {
      const payload = await readBody(request);
      const entity = platform.updateCollectionEntity(collectionName, extractId(pathname), payload, context);
      if (!entity) {
        return notFound(response);
      }
      return sendJson(response, 200, entity);
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  if (pathname.startsWith(`/api/${collectionName}/`) && request.method === "DELETE") {
    try {
      const removed = platform.removeCollectionEntity(collectionName, extractId(pathname), context);
      if (!removed) {
        return notFound(response);
      }
      return sendJson(response, 200, { success: true });
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  return false;
}

async function handleApi(request, response, url) {
  const { pathname } = url;
  const context = getRequestContext(request);

  if (pathname === "/api/auth/login" && request.method === "POST") {
    try {
      const payload = await readBody(request);
      return sendJson(response, 200, platform.login(payload));
    } catch (error) {
      return sendJson(response, 401, { error: error.message });
    }
  }

  if (pathname === "/api/auth/me" && request.method === "GET") {
    try {
      return sendJson(response, 200, platform.getAuthenticatedProfile(context));
    } catch (error) {
      return sendJson(response, 401, { error: error.message });
    }
  }

  if (pathname === "/api/auth/logout" && request.method === "POST") {
    try {
      return sendJson(response, 200, platform.logout(context));
    } catch (error) {
      return sendJson(response, 401, { error: error.message });
    }
  }

  if (pathname === "/api/auth/change-password" && request.method === "POST") {
    try {
      const payload = await readBody(request);
      return sendJson(response, 200, platform.changePassword(payload, context));
    } catch (error) {
      const statusCode = error.message === "authentication required" ? 401 : 400;
      return sendJson(response, statusCode, { error: error.message });
    }
  }

  if (pathname.startsWith("/api/") && pathname !== "/api/ci/trigger") {
    try {
      platform.requireAuthenticatedActor(context);
    } catch (error) {
      return sendJson(response, 401, { error: error.message });
    }
  }

  if (pathname === "/api/bootstrap" && request.method === "GET") {
    const baseUrl = getBaseUrl(request);
    return sendJson(response, 200, platform.getBootstrap(baseUrl, context));
  }

  if (pathname === "/api/overview" && request.method === "GET") {
    return sendJson(response, 200, platform.getOverviewSummary());
  }

  if (pathname === "/api/admin/seed" && request.method === "POST") {
    try {
      const payload = await readBody(request);
      return sendJson(response, 201, platform.seedPlatformSamples(payload, context));
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  if (pathname === "/api/governance/summary" && request.method === "GET") {
    return sendJson(response, 200, platform.getGovernanceSummary(context));
  }

  if (/^\/api\/users\/[^/]+\/revoke-sessions$/.test(pathname) && request.method === "POST") {
    try {
      return sendJson(response, 200, platform.revokeUserSessions(pathname.split("/")[3], context));
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  if (/^\/api\/users\/[^/]+\/reset-password$/.test(pathname) && request.method === "POST") {
    try {
      return sendJson(response, 200, platform.resetUserPassword(pathname.split("/")[3], context));
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  if (pathname === "/api/globals" && request.method === "GET") {
    return sendJson(response, 200, platform.getGlobalVariables());
  }

  if (/^\/api\/environments\/[^/]+\/diagnostics$/.test(pathname) && request.method === "GET") {
    try {
      return sendJson(response, 200, await platform.getEnvironmentDiagnostics(pathname.split("/")[3], context));
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  if (/^\/api\/environments\/[^/]+\/auth-smoke$/.test(pathname) && request.method === "POST") {
    try {
      return sendJson(response, 200, await platform.runEnvironmentAuthSmoke(pathname.split("/")[3], context));
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  if (pathname === "/api/reports/summary" && request.method === "GET") {
    return sendJson(
      response,
      200,
      platform.getReportSummary({
        range: url.searchParams.get("range") || "today",
        moduleId: url.searchParams.get("moduleId") || "all",
        runId: url.searchParams.get("runId") || null
      })
    );
  }

  if (pathname === "/api/reports/insights" && request.method === "GET") {
    return sendJson(
      response,
      200,
      platform.getReportInsights({
        range: url.searchParams.get("range") || "7d",
        moduleId: url.searchParams.get("moduleId") || "all"
      })
    );
  }

  if (pathname === "/api/scheduler" && request.method === "GET") {
    return sendJson(response, 200, platform.getSchedulerCenter(context));
  }

  if (pathname === "/api/versions" && request.method === "GET") {
    return sendJson(
      response,
      200,
      platform.listVersions(
        {
          collection: url.searchParams.get("collection") || null,
          entityId: url.searchParams.get("entityId") || null,
          limit: url.searchParams.get("limit") || 50,
          q: url.searchParams.get("q") || null
        },
        context
      )
    );
  }

  if (/^\/api\/versions\/[^/]+\/impact$/.test(pathname) && request.method === "GET") {
    try {
      return sendJson(response, 200, platform.getVersionImpact(pathname.split("/")[3], context));
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  if (/^\/api\/versions\/[^/]+\/restore$/.test(pathname) && request.method === "POST") {
    try {
      return sendJson(response, 201, platform.restoreVersion(pathname.split("/")[3], context));
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  if (pathname === "/api/audit-logs" && request.method === "GET") {
    return sendJson(
      response,
      200,
      platform.listAuditLogs(
        {
          actorId: url.searchParams.get("actorId") || null,
          collection: url.searchParams.get("collection") || null,
          action: url.searchParams.get("action") || null,
          limit: url.searchParams.get("limit") || 100,
          q: url.searchParams.get("q") || null,
          dateFrom: url.searchParams.get("dateFrom") || null,
          dateTo: url.searchParams.get("dateTo") || null
        },
        context
      )
    );
  }

  if (pathname === "/api/audit-logs/export" && request.method === "GET") {
    try {
      const exported = platform.exportAuditLogs(
        {
          actorId: url.searchParams.get("actorId") || null,
          collection: url.searchParams.get("collection") || null,
          action: url.searchParams.get("action") || null,
          limit: url.searchParams.get("limit") || 500,
          q: url.searchParams.get("q") || null,
          dateFrom: url.searchParams.get("dateFrom") || null,
          dateTo: url.searchParams.get("dateTo") || null
        },
        context
      );
      return sendText(response, 200, exported.contentType, exported.body, {
        "content-disposition": `attachment; filename="${exported.filename}"`
      });
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  if (pathname === "/api/import/openapi" && request.method === "POST") {
    try {
      const payload = await readBody(request);
      return sendJson(response, 201, platform.importOpenApi(payload.spec, payload.moduleId, context));
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  if (pathname === "/api/runs" && request.method === "GET") {
    return sendJson(response, 200, platform.listRuns(context));
  }

  if (pathname === "/api/runs" && request.method === "POST") {
    try {
      const payload = await readBody(request);
      return sendJson(
        response,
        201,
        await platform.triggerRun(payload.suiteId, payload.environmentId, payload.trigger ?? "manual", context, payload.options ?? payload)
      );
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  if (pathname === "/api/runs/batch-cases" && request.method === "POST") {
    try {
      const payload = await readBody(request);
      return sendJson(
        response,
        201,
        await platform.triggerBatchCaseRun(payload.caseIds, {
          projectId: payload.projectId,
          environmentId: payload.environmentId,
          trigger: payload.trigger ?? "manual",
          context,
          options: payload.options ?? payload
        })
      );
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  if (/^\/api\/runs\/[^/]+\/share$/.test(pathname) && request.method === "GET") {
    const shared = platform.getRunShare(pathname.split("/")[3], getBaseUrl(request));
    if (!shared) {
      return notFound(response);
    }
    return sendJson(response, 200, shared);
  }

  if (pathname.startsWith("/api/runs/") && request.method === "GET") {
    const run = platform.getRun(extractId(pathname), context);
    if (!run) {
      return notFound(response);
    }
    return sendJson(response, 200, run);
  }

  if (/^\/api\/runs\/[^/]+\/cancel$/.test(pathname) && request.method === "POST") {
    try {
      const run = platform.cancelRun(pathname.split("/")[3], context);
      if (!run) {
        return notFound(response);
      }
      return sendJson(response, 200, run);
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  if (/^\/api\/runs\/[^/]+\/retry$/.test(pathname) && request.method === "POST") {
    try {
      const run = platform.retryRun(pathname.split("/")[3], context);
      if (!run) {
        return notFound(response);
      }
      return sendJson(response, 201, run);
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  if (/^\/api\/runs\/[^/]+\/retry-failed$/.test(pathname) && request.method === "POST") {
    try {
      const run = platform.retryFailedRun(pathname.split("/")[3], context);
      if (!run) {
        return notFound(response);
      }
      return sendJson(response, 201, run);
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  if (pathname === "/api/ci/trigger" && request.method === "POST") {
    try {
      const payload = await readBody(request);
      return sendJson(response, 201, await platform.triggerCi(request.headers["x-ci-token"], payload));
    } catch (error) {
      return sendJson(response, error.message === "invalid ci token" ? 401 : 400, { error: error.message });
    }
  }

  if (pathname.startsWith("/report/") && request.method === "GET") {
    const token = extractId(pathname);
    const run = storage.list("runs").find((item) => item.shareToken === token);
    if (!run) {
      return notFound(response);
    }
    return sendJson(response, 200, run);
  }

  if (pathname === "/api/scheduler/refresh" && request.method === "POST") {
    return sendJson(response, 200, platform.refreshScheduler(context));
  }

  const collections = ["users", "projects", "services", "modules", "apis", "cases", "datasets", "environments", "suites"];
  for (const collection of collections) {
    const handled = await routeCollection(request, response, pathname, collection);
    if (handled !== false) {
      return handled;
    }
  }

  return false;
}

function sendDemoJson(response, statusCode, payload) {
  sendJson(response, statusCode, { success: true, traceId: createId("trace"), data: payload });
}

async function handleDemoApi(request, response, url) {
  const { pathname } = url;

  if (pathname === "/demo-api/health" && request.method === "GET") {
    return sendDemoJson(response, 200, { status: "UP" });
  }

  if (pathname === "/demo-api/auth/login" && request.method === "POST") {
    const body = await readBody(request);
    if (body.username !== "demo" || body.password !== "pass123") {
      return sendJson(response, 401, { success: false, message: "invalid credentials" });
    }

    return sendDemoJson(response, 200, {
      token: "demo-token",
      userId: "U1001",
      name: "Demo User"
    });
  }

  if (pathname === "/demo-api/orders" && request.method === "POST") {
    if (request.headers.authorization !== "Bearer demo-token") {
      return sendJson(response, 403, { success: false, message: "forbidden" });
    }

    const body = await readBody(request);
    const orderId = createId("order");
    demoOrders.set(orderId, {
      orderId,
      skuId: body.skuId,
      quantity: body.quantity,
      amount: body.amount,
      status: "CREATED"
    });

    return sendDemoJson(response, 201, demoOrders.get(orderId));
  }

  if (pathname === "/demo-api/payments" && request.method === "POST") {
    if (request.headers.authorization !== "Bearer demo-token") {
      return sendJson(response, 403, { success: false, message: "forbidden" });
    }

    const body = await readBody(request);
    const order = demoOrders.get(body.orderId);
    if (!order) {
      return sendJson(response, 404, { success: false, message: "order not found" });
    }

    order.status = "PAID";
    return sendDemoJson(response, 200, {
      paymentId: createId("payment"),
      orderId: order.orderId,
      status: "PAID"
    });
  }

  if (/^\/demo-api\/orders\/[^/]+$/.test(pathname) && request.method === "GET") {
    if (request.headers.authorization !== "Bearer demo-token") {
      return sendJson(response, 403, { success: false, message: "forbidden" });
    }

    const orderId = extractId(pathname);
    const order = demoOrders.get(orderId);
    if (!order) {
      return sendJson(response, 404, { success: false, message: "order not found" });
    }

    return sendDemoJson(response, 200, order);
  }

  return false;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, getBaseUrl(request));

  try {
    const apiHandled = await handleApi(request, response, url);
    if (apiHandled !== false) {
      return;
    }

    const demoHandled = await handleDemoApi(request, response, url);
    if (demoHandled !== false) {
      return;
    }

    if (serveStatic(request, response, url.pathname)) {
      return;
    }

    notFound(response);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

function startServer(port) {
  currentPort = port;
  server.listen(port);
}

server.on("listening", () => {
  if (hasLoggedListening) {
    return;
  }

  hasLoggedListening = true;
  platform.syncLocalDemoEnvironment(currentPort);
  console.log(`FlowForge API Lab running at http://localhost:${currentPort}`);
});

server.on("error", (error) => {
  if (error.code !== "EADDRINUSE") {
    throw error;
  }

  if (hasExplicitPort) {
    console.error(`Port ${preferredPort} is already in use. Change PORT or stop the existing process.`);
    process.exit(1);
  }

  const nextPort = currentPort + 1;
  if (nextPort > preferredPort + 20) {
    console.error(`Ports ${preferredPort}-${nextPort - 1} are all in use. Stop an existing process or set PORT.`);
    process.exit(1);
  }

  console.warn(`Port ${currentPort} is already in use, retrying on ${nextPort}...`);
  startServer(nextPort);
});

startServer(preferredPort);
