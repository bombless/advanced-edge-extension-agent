(() => {
  "use strict";

  const TOOL_PROMPT = `You have access to external tools.

When you need to use a tool, output a tool call using exactly this format:
@actions[{"id":"a1","protocol_version":1,"tool":"TOOL_NAME","params":{...}}]

You may output multiple actions in one @actions[...] block.

Available tools:

1. list_directory
   params: {"path":"string"}

2. read_file
   params: {"path":"string"}

3. write_file
   params: {"path":"string","content":"string"}

4. replace_file
   params: {"path":"string","content":"string"}

After emitting @actions[...], stop and wait for the tool results.
Tool results will be provided as a new user message using @tool_results[...].
Do not fabricate tool results.
`;

  const DEBUG = true;
  const ACTION_DEBOUNCE_MS = 600;
  const MAX_ACTION_ROUNDS = 50;

  const executedActions = new Set();
  let actionRound = 0;
  let debounceTimer = null;
  let lastConversationText = "";
  let retryCount = 0;
  const MAX_AUTO_RETRIES = 3;

  // Auto-mode state stored in chrome.storage.local
  let isAgentModeActive = true;

  const log = (...args) => {
    if (DEBUG) console.debug("[advanced-edge-agent/content]", ...args);
  };

  function isGeminiPage() {
    return location.hostname === "gemini.google.com" && location.pathname.startsWith("/app");
  }

  function injectToolPrompt() {
    if (!isGeminiPage()) return false;
    const composer = GeminiAdapter.getComposer();
    if (!composer) return false;

    GeminiAdapter.appendToComposer(TOOL_PROMPT);
    composer.focus();
    updatePanelStatus("Prompt Injected", "success");
    return true;
  }

  async function handleActionBlocks(text) {
    if (!isAgentModeActive) return;
    if (actionRound >= MAX_ACTION_ROUNDS) {
      updatePanelStatus("Max rounds reached", "warn");
      return;
    }

    const blocks = AgentProtocol.extractActionBlocks(text);
    for (const block of blocks) {
      const freshActions = block.actions.filter((action) => {
        if (!action || typeof action !== "object") return false;
        const key = action.id ? "id:" + String(action.id) : AgentProtocol.stableActionKey(action);
        if (executedActions.has(key)) return false;
        executedActions.add(key);
        return true;
      });

      if (freshActions.length === 0) continue;

      actionRound += 1;
      updatePanelStatus(`Executing action (${freshActions.length})...`, "busy");

      chrome.runtime.sendMessage(
        { type: "execute_actions", actions: freshActions },
        async (response) => {
          if (chrome.runtime.lastError || !response?.ok) {
            const err = chrome.runtime.lastError || response?.error;
            log("runner execution error", err);
            updatePanelStatus("Runner Error", "error");
            await injectToolResults([{
              id: "runner-error-" + Date.now(),
              tool: "runtime",
              ok: false,
              error: err || { type: "RUNNER_ERROR", message: "Runner unavailable" }
            }]);
            return;
          }

          updatePanelStatus(`Action round ${actionRound} done`, "success");
          await injectToolResults(response.payload?.results || []);
        }
      );
      return;
    }
  }

  async function injectToolResults(results) {
    const text = AgentProtocol.makeToolResultsPrompt(results);
    GeminiAdapter.appendToComposer(text);
    const submitted = await GeminiAdapter.submitComposer();
    if (submitted) {
      log("tool results sent back to Gemini");
    } else {
      log("submitComposer deferred or failed (model was generating)");
    }
  }

  function scheduleScan() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      // 1. Check for Gemini Model Error and auto-repair
      if (isAgentModeActive && GeminiAdapter.checkModelError()) {
        if (retryCount < MAX_AUTO_RETRIES) {
          retryCount += 1;
          log("Gemini model error encountered, triggering auto-repair/retry, attempt:", retryCount);
          updatePanelStatus(`Model error, auto-retrying (${retryCount}/${MAX_AUTO_RETRIES})...`, "warn");
          GeminiAdapter.triggerRetry().then((ok) => {
            if (ok) {
              log("Auto-retry trigger succeeded");
            } else {
              log("Auto-retry trigger could not find clickable retry button");
            }
          });
          return;
        } else {
          updatePanelStatus("Model Error (Max Retries)", "error");
        }
      }

      const latest = GeminiAdapter.getLatestModelText();
      if (!latest || latest === lastConversationText) return;
      lastConversationText = latest;
      // Reset retry count on healthy model text update
      if (!GeminiAdapter.checkModelError()) {
        retryCount = 0;
      }
      log("scan triggered, latest text length:", latest.length);
      void handleActionBlocks(latest);
    }, ACTION_DEBOUNCE_MS);
  }

  function startObserver() {
    const conversation = GeminiAdapter.getConversation() || document.body;
    const observer = new MutationObserver(scheduleScan);
    observer.observe(conversation, { subtree: true, childList: true, characterData: true });
    log("observer started on:", conversation.tagName);
    
    // Also periodic poll every 1.5s as a failsafe against missed DOM events
    setInterval(scheduleScan, 1500);
  }

  // --- Proactive UI Panel (No shortcut keys needed!) ---
  function updatePanelStatus(text, statusType = "idle") {
    const badge = document.getElementById("aea-status-badge");
    if (!badge) return;
    badge.textContent = text;
    badge.className = "aea-badge " + statusType;
  }

  function setupAgentPanel() {
    if (document.getElementById("aea-control-panel")) return;

    const panel = document.createElement("div");
    panel.id = "aea-control-panel";
    panel.innerHTML = `
      <div class="aea-header">
        <span class="aea-title">🤖 Edge Agent</span>
        <span id="aea-status-badge" class="aea-badge idle">Ready</span>
      </div>
      <div class="aea-body">
        <label class="aea-switch-label">
          <input type="checkbox" id="aea-auto-toggle" ${isAgentModeActive ? "checked" : ""}>
          <span>Auto Tool Loop</span>
        </label>
        <button id="aea-inject-btn" class="aea-btn" title="Inject Tools System Instructions">
          Inject Prompt
        </button>
      </div>
    `;

    document.body.appendChild(panel);

    const toggle = document.getElementById("aea-auto-toggle");
    toggle?.addEventListener("change", (e) => {
      isAgentModeActive = Boolean(e.target.checked);
      chrome.storage.local.set({ isAgentModeActive });
      updatePanelStatus(isAgentModeActive ? "Agent Active" : "Agent Paused", isAgentModeActive ? "idle" : "warn");
    });

    document.getElementById("aea-inject-btn")?.addEventListener("click", () => {
      injectToolPrompt();
    });

    // Check Runner connectivity
    chrome.runtime.sendMessage({ type: "health_check" }, (res) => {
      if (res?.ok) {
        updatePanelStatus("Connected to Runner", "success");
      } else {
        updatePanelStatus("Runner Offline (:8765)", "warn");
      }
    });
  }

  // Auto-inject system prompt on new prompt submission if not yet present
  function hookAutoPromptInjection() {
    window.addEventListener("keydown", (e) => {
      if (!isAgentModeActive) return;
      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) {
        const text = GeminiAdapter.getComposerText();
        // If user is sending a prompt and this conversation has no model response yet
        const latest = GeminiAdapter.getLatestModelText();
        if (text && !latest && !text.includes("@actions") && !text.includes(TOOL_PROMPT.slice(0, 30))) {
          // Prepend tool prompt silently
          GeminiAdapter.setComposerText(TOOL_PROMPT + "\n\nUser Question:\n" + text);
          log("auto-prepended system prompt to initial query");
        }
      }
    }, true);
  }

  if (isGeminiPage()) {
    chrome.storage.local.get(["isAgentModeActive"], (result) => {
      if (typeof result.isAgentModeActive === "boolean") {
        isAgentModeActive = result.isAgentModeActive;
      }
    });

    startObserver();
    hookAutoPromptInjection();

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", setupAgentPanel);
    } else {
      setupAgentPanel();
    }
  }
})();
