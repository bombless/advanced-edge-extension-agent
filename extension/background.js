(() => {
  "use strict";

  const RUNNER_URL = "http://127.0.0.1:8765";
  const DEBUG = true;

  const log = (...args) => {
    if (DEBUG) console.debug("[advanced-edge-agent/background]", new Date().toISOString(), ...args);
  };

  async function checkRunnerHealth() {
    try {
      const res = await fetch(RUNNER_URL + "/health", { method: "GET" });
      if (res.ok) {
        const data = await res.json();
        return { ok: true, data };
      }
      return { ok: false, error: "HTTP " + res.status };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function executeActions(actions, requestId = "unknown") {
    const startedAt = Date.now();
    log("runner request start", { requestId, count: actions?.length || 0, tools: (actions || []).map((action) => action?.tool || "unknown") });
    const response = await fetch(RUNNER_URL + "/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ protocol_version: 1, actions })
    });

    log("runner HTTP response", { requestId, status: response.status, elapsedMs: Date.now() - startedAt });
    if (!response.ok) throw new Error("Runner returned HTTP " + response.status);
    const payload = await response.json();
    log("runner response parsed", {
      requestId, elapsedMs: Date.now() - startedAt, resultCount: payload?.results?.length,
      results: (payload?.results || []).map((item) => ({ id: item?.id, tool: item?.tool, ok: item?.ok, error: item?.error?.message }))
    });
    return payload;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return undefined;

    if (message.type === "health_check") {
      checkRunnerHealth().then(sendResponse);
      return true;
    }

    if (message.type === "execute_actions") {
      const requestId = message.requestId || "no-request-id";
      log("execute_actions message received", { requestId, senderTabId: _sender?.tab?.id, count: message.actions?.length || 0 });
      executeActions(message.actions, requestId)
        .then((payload) => {
          log("execute_actions reply success", { requestId, resultCount: payload?.results?.length });
          sendResponse({ ok: true, payload });
        })
        .catch((error) => {
          log("execute error", { requestId, error: error instanceof Error ? error.message : String(error) });
          sendResponse({
            ok: false,
            error: {
              type: "RUNNER_ERROR",
              message: error instanceof Error ? error.message : String(error)
            }
          });
        });
      return true;
    }
  });
})();
