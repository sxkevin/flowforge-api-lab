export class Scheduler {
  constructor(storage, runQueue) {
    this.storage = storage;
    this.runQueue = runQueue;
    this.timers = new Map();
    this.runtime = new Map();
    this.lastRefreshedAt = null;
  }

  clearAll() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  scheduleNext(suiteId, environmentId, intervalMs, dueAt) {
    const runtime = this.runtime.get(suiteId);
    if (!runtime) {
      return;
    }

    runtime.status = "active";
    runtime.nextTriggerAt = new Date(dueAt).toISOString();

    const timer = setTimeout(async () => {
      const activeRuntime = this.runtime.get(suiteId);
      if (!activeRuntime) {
        return;
      }

      activeRuntime.lastTriggeredAt = new Date().toISOString();
      activeRuntime.nextTriggerAt = null;
      activeRuntime.lastError = null;

      try {
        const run = this.runQueue.enqueueRun({
          suiteId,
          environmentId,
          trigger: "schedule",
          runFields: {
            sourceType: "scheduled-suite"
          }
        });
        activeRuntime.lastRunId = run.id;
      } catch (error) {
        activeRuntime.lastError = error.message;
      } finally {
        const suite = this.storage.find("suites", suiteId);
        const environment = this.storage.find("environments", environmentId);
        const currentRuntime = this.runtime.get(suiteId);
        if (!currentRuntime) {
          return;
        }

        if (suite?.schedule?.enabled && intervalMs > 0 && environment) {
          this.scheduleNext(suiteId, environmentId, intervalMs, Date.now() + intervalMs);
          return;
        }

        currentRuntime.status = suite?.schedule?.enabled ? "invalid" : "paused";
        currentRuntime.nextTriggerAt = null;
      }
    }, Math.max(250, dueAt - Date.now()));

    this.timers.set(suiteId, timer);
  }

  describe() {
    return {
      refreshedAt: this.lastRefreshedAt,
      schedules: Array.from(this.runtime.values()).map((item) => ({ ...item }))
    };
  }

  refresh() {
    const previousRuntime = new Map(this.runtime);
    this.clearAll();
    this.runtime = new Map();
    const suites = this.storage.list("suites");
    const environments = this.storage.list("environments");
    const fallbackEnvironment = environments[0];
    this.lastRefreshedAt = new Date().toISOString();

    for (const suite of suites) {
      if (suite?.ephemeral) {
        continue;
      }

      const enabled = Boolean(suite.schedule?.enabled);
      const intervalMinutes = Number(suite.schedule?.intervalMinutes || 0);
      const intervalMs = intervalMinutes * 60 * 1000;
      const environment =
        (suite.defaultEnvironmentId && this.storage.find("environments", suite.defaultEnvironmentId)) ||
        fallbackEnvironment;
      const previous = previousRuntime.get(suite.id) || {};
      const runtime = {
        suiteId: suite.id,
        suiteName: suite.name,
        enabled,
        intervalMinutes: intervalMinutes > 0 ? intervalMinutes : 0,
        environmentId: environment?.id ?? null,
        environmentName: environment?.name ?? "",
        status: enabled ? "active" : "paused",
        nextTriggerAt: null,
        lastTriggeredAt: previous.lastTriggeredAt ?? null,
        lastRunId: previous.lastRunId ?? null,
        lastError: previous.lastError ?? null
      };

      if (enabled && (!intervalMs || !environment)) {
        runtime.status = "invalid";
        runtime.lastError ||= !environment ? "未找到可执行环境" : "调度周期无效";
      }

      this.runtime.set(suite.id, runtime);

      if (!enabled || !intervalMs || !environment) {
        continue;
      }

      this.scheduleNext(suite.id, environment.id, intervalMs, Date.now() + intervalMs);
    }

    return this.describe();
  }
}
