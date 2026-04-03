import { createId, nowIso } from "./utils.js";

function emptySummary() {
  return {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0
  };
}

function normalizePriority(priority) {
  return {
    high: "high",
    low: "low"
  }[priority] || "normal";
}

function priorityRank(priority) {
  return {
    high: 0,
    normal: 1,
    low: 2
  }[normalizePriority(priority)] ?? 1;
}

export class RunQueue {
  constructor(storage, runnerClient, options = {}) {
    this.storage = storage;
    this.runnerClient = runnerClient;
    this.concurrency = Math.max(1, Number(options.concurrency || process.env.RUN_CONCURRENCY || 1));
    this.queue = [];
    this.running = new Set();
    this.controllers = new Map();
  }

  recover() {
    const runs = this.storage.list("runs");
    const queuedRuns = runs.filter((run) => run.status === "queued");
    const interruptedRuns = runs.filter((run) => run.status === "running");

    for (const run of interruptedRuns) {
      this.storage.update("runs", run.id, {
        status: "failed",
        finishedAt: nowIso(),
        message: "execution interrupted by service restart"
      });
    }

    for (const run of queuedRuns.reverse()) {
      this.insertTask({
        runId: run.id,
        suiteId: run.suiteId,
        environmentId: run.environmentId,
        trigger: run.trigger || "manual",
        priority: run.queueMeta?.priority || "normal"
      });
    }

    this.syncQueuePositions();
    this.drain();
  }

  createQueuedRun(suite, environment, trigger, runFields = {}) {
    const executionConfig = suite.executionConfig || {};
    const executionOverrides = runFields.executionOverrides || {};
    const overrideExecutionConfig = executionOverrides.executionConfig || {};
    const effectivePriority = runFields.priority || overrideExecutionConfig.priority || executionConfig.priority;
    const effectiveMaxRetries =
      runFields.maxAttempts ||
      (overrideExecutionConfig.maxRetries !== undefined
        ? Number(overrideExecutionConfig.maxRetries) + 1
        : Number(executionConfig.maxRetries || 0) + 1);
    return {
      id: createId("run"),
      suiteId: suite.id,
      suiteName: suite.name,
      environmentId: environment.id,
      environmentName: environment.name,
      trigger,
      status: "queued",
      message: "waiting in queue",
      createdAt: nowIso(),
      queuedAt: nowIso(),
      startedAt: null,
      finishedAt: null,
      duration: 0,
      summary: emptySummary(),
      shareToken: createId("share"),
      variablesSnapshot: {},
      steps: [],
      attempt: Number(runFields.attempt || 1),
      maxAttempts: Number(effectiveMaxRetries),
      executionOverrides,
      queueMeta: {
        position: null,
        maxConcurrency: this.concurrency,
        priority: normalizePriority(effectivePriority)
      }
    };
  }

  snapshotQueue() {
    return {
      running: this.running.size,
      queued: this.queue.length,
      concurrency: this.concurrency
    };
  }

  syncQueuePositions() {
    this.queue.forEach((task, index) => {
      this.storage.update("runs", task.runId, {
        queueMeta: {
          position: index + 1,
          maxConcurrency: this.concurrency,
          priority: normalizePriority(task.priority)
        }
      });
    });
  }

  insertTask(task) {
    const nextTask = {
      ...task,
      priority: normalizePriority(task.priority)
    };
    const insertIndex = this.queue.findIndex((item) => priorityRank(nextTask.priority) < priorityRank(item.priority));
    if (insertIndex === -1) {
      this.queue.push(nextTask);
      return;
    }
    this.queue.splice(insertIndex, 0, nextTask);
  }

  enqueueRun({ suiteId, environmentId, trigger = "manual", retriedFromRunId = null, runFields = {} }) {
    const suite = this.storage.find("suites", suiteId);
    const environment = this.storage.find("environments", environmentId);
    if (!suite) {
      throw new Error(`suiteId references missing suite ${suiteId}`);
    }
    if (!environment) {
      throw new Error(`environmentId references missing environment ${environmentId}`);
    }

    const run = {
      ...this.createQueuedRun(suite, environment, trigger, runFields),
      ...runFields
    };
    if (retriedFromRunId) {
      run.retriedFromRunId = retriedFromRunId;
    }
    this.storage.addRun(run);
    this.insertTask({
      runId: run.id,
      suiteId,
      environmentId,
      trigger,
      priority: run.queueMeta?.priority || "normal"
    });
    this.syncQueuePositions();
    this.drain();
    return run;
  }

  cancelRun(runId) {
    const existing = this.storage.find("runs", runId);
    const queuedIndex = this.queue.findIndex((task) => task.runId === runId);
    if (queuedIndex !== -1) {
      this.queue.splice(queuedIndex, 1);
      this.syncQueuePositions();
      const canceled = this.storage.update("runs", runId, {
        status: "canceled",
        message: "canceled while waiting in queue",
        finishedAt: nowIso(),
        queueMeta: {
          position: null,
          maxConcurrency: this.concurrency,
          priority: existing?.queueMeta?.priority || "normal"
        }
      });
      const suite = canceled ? this.storage.find("suites", canceled.suiteId) : null;
      if (suite?.ephemeral) {
        this.storage.remove("suites", suite.id);
      }
      return canceled;
    }

    const controller = this.controllers.get(runId);
    if (controller) {
      controller.abort();
      return this.storage.update("runs", runId, {
        status: "canceled",
        message: "cancel requested",
        finishedAt: nowIso(),
        queueMeta: {
          position: null,
          maxConcurrency: this.concurrency,
          priority: existing?.queueMeta?.priority || "normal"
        }
      });
    }

    if (!existing) {
      return null;
    }
    throw new Error(`run ${runId} can no longer be canceled`);
  }

  retryRun(runId) {
    const run = this.storage.find("runs", runId);
    if (!run) {
      return null;
    }
    if (run.sourceType === "batch-cases") {
      throw new Error(`run ${runId} does not support retry`);
    }
    if (!["failed", "passed", "canceled"].includes(run.status)) {
      throw new Error(`run ${runId} is not retryable`);
    }
    if (!this.storage.find("suites", run.suiteId)) {
      throw new Error(`run ${runId} can no longer be retried`);
    }
    return this.enqueueRun({
      suiteId: run.suiteId,
      environmentId: run.environmentId,
      trigger: "retry",
      retriedFromRunId: run.id,
      runFields: {
        priority: run.queueMeta?.priority || "normal",
        requestedBy: run.requestedBy,
        requestedById: run.requestedById,
        sourceType: run.sourceType,
        executionOverrides: run.executionOverrides || {}
      }
    });
  }

  async drain() {
    while (this.running.size < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) {
        return;
      }
      this.syncQueuePositions();
      this.running.add(task.runId);
      this.executeTask(task)
        .catch((error) => {
          console.error("Run queue task failed", error);
        })
        .finally(() => {
          this.running.delete(task.runId);
          this.drain();
        });
    }
  }

  async executeTask(task) {
    const current = this.storage.find("runs", task.runId);
    if (!current) {
      return;
    }

    const controller = new AbortController();
    this.controllers.set(task.runId, controller);
    this.storage.update("runs", task.runId, {
      status: "running",
      message: "execution in progress",
      startedAt: nowIso(),
      queueMeta: {
        position: null,
        maxConcurrency: this.concurrency,
        priority: current.queueMeta?.priority || "normal"
      }
    });

    try {
      const result = await this.runnerClient.executeSuite(
        this.storage.getExecutionSnapshotForSuite(task.suiteId, task.environmentId, current.executionOverrides),
        task.suiteId,
        task.environmentId,
        task.trigger,
        { signal: controller.signal }
      );

      this.storage.update("runs", task.runId, {
        ...result,
        id: task.runId,
        shareToken: current.shareToken,
        createdAt: current.createdAt,
        queuedAt: current.queuedAt,
        attempt: current.attempt,
        maxAttempts: current.maxAttempts,
        queueMeta: {
          position: null,
          maxConcurrency: this.concurrency,
          priority: current.queueMeta?.priority || "normal"
        },
        message: result.status === "passed" ? "execution passed" : "execution finished with failures"
      });

      const suite = this.storage.find("suites", task.suiteId);
      const finishedRun = this.storage.find("runs", task.runId);
      if (finishedRun?.status === "failed" && suite && !suite.ephemeral && Number(finishedRun.attempt || 1) < Number(finishedRun.maxAttempts || 1)) {
        const retryRun = this.enqueueRun({
          suiteId: task.suiteId,
          environmentId: task.environmentId,
          trigger: "auto-retry",
          retriedFromRunId: task.runId,
          runFields: {
            attempt: Number(finishedRun.attempt || 1) + 1,
            maxAttempts: finishedRun.maxAttempts,
            priority: finishedRun.queueMeta?.priority || suite.executionConfig?.priority || "normal",
            requestedBy: finishedRun.requestedBy,
            requestedById: finishedRun.requestedById,
            sourceType: finishedRun.sourceType,
            executionOverrides: finishedRun.executionOverrides || {}
          }
        });
        this.storage.update("runs", task.runId, {
          retriedByRunId: retryRun.id,
          message: `execution finished with failures, retry scheduled (${retryRun.attempt}/${retryRun.maxAttempts})`
        });
      }
    } catch (error) {
      const failedAt = nowIso();
      const existing = this.storage.find("runs", task.runId);
      if (error.name === "AbortError") {
        this.storage.update("runs", task.runId, {
          ...existing,
          status: "canceled",
          message: existing?.message === "cancel requested" ? existing.message : "execution canceled",
          finishedAt: failedAt,
          duration: existing?.startedAt ? Math.max(0, Date.parse(failedAt) - Date.parse(existing.startedAt)) : 0,
          queueMeta: {
            position: null,
            maxConcurrency: this.concurrency,
            priority: existing?.queueMeta?.priority || "normal"
          }
        });
        return;
      }
      this.storage.update("runs", task.runId, {
        ...existing,
        status: "failed",
        message: error.message,
        finishedAt: failedAt,
        duration: existing?.startedAt ? Math.max(0, Date.parse(failedAt) - Date.parse(existing.startedAt)) : 0,
        summary: existing?.summary ?? emptySummary(),
        queueMeta: {
          position: null,
          maxConcurrency: this.concurrency,
          priority: existing?.queueMeta?.priority || "normal"
        }
      });
    } finally {
      this.controllers.delete(task.runId);
      const suite = this.storage.find("suites", task.suiteId);
      if (suite?.ephemeral) {
        this.storage.remove("suites", suite.id);
      }
    }
  }
}
