(() => {
  "use strict";

  const RUNNER_URL = "http://127.0.0.1:8765";
  const DEBUG = true;

  const log = (...args) => {
    if (DEBUG) console.debug("[advanced-edge-agent/background]", ...args);
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

  async function executeActions(actions) {
    const response = await fetch(RUNNER_URL + "/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ protocol_version: 1, actions })
    });

    if (!response.ok) {
      throw new Error("Runner returned HTTP " + response.status);
    }

    return response.json();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return undefined;

    if (message.type === "health_check") {
      checkRunnerHealth().then(sendResponse);
      return true;
    }

    if (message.type === "execute_actions") {
      log("executing actions", message.actions);
      executeActions(message.actions)
        .then((payload) => sendResponse({ ok: true, payload }))
        .catch((error) => {
          log("execute error", error);
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
