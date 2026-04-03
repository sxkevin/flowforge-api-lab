export class RunnerClient {
  constructor(baseUrl = process.env.RUNNER_URL || "http://127.0.0.1:8010") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async executeSuite(snapshot, suiteId, environmentId, trigger = "manual", options = {}) {
    const response = await fetch(`${this.baseUrl}/execute-suite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: options.signal,
      body: JSON.stringify({
        snapshot,
        suiteId,
        environmentId,
        trigger
      })
    });

    const payload = await response.json().catch(() => ({ error: "runner returned invalid json" }));
    if (!response.ok) {
      throw new Error(payload.error || `runner request failed with ${response.status}`);
    }

    return payload;
  }

  async health() {
    const response = await fetch(`${this.baseUrl}/health`);
    if (!response.ok) {
      throw new Error(`runner health check failed with ${response.status}`);
    }
    return response.json();
  }
}
