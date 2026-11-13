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

Please acknowledge your readiness and ask the user what task you should assist with.
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

  // Auto-mode state and retry strategy ("regenerate" or "prompt") stored in storage
  let isAgentModeActive = true;
  let autoInitNewChat = true; // Automatically send initial system prompt on new chat
  let retryStrategy = "prompt"; // default: prompt ("你再试试") which is far more reliable for tool loop recovery!
  let customRetryPrompt = "你再试试";

  const log = (...args) => {
    if (DEBUG) console.debug("[advanced-edge-agent/content]", new Date().toISOString(), ...args);
  };
  let scanSequence = 0;
  let actionSequence = 0;
  let mutationBatchCount = 0;

  function isCodeArtsPage() {
    return location.hostname === "devcloud.cn-north-4.huaweicloud.com" && location.pathname.startsWith("/chat/");
  }

  function injectToolPrompt() {
    if (!isCodeArtsPage()) return false;
    const composer = CodeArtsAdapter.getComposer();
    if (!composer) return false;

    CodeArtsAdapter.appendToComposer(TOOL_PROMPT);
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
    log("action parse", {
      textLength: text.length,
      blockCount: blocks.length,
      actionCounts: blocks.map((block) => block.actions.length),
      tools: blocks.flatMap((block) => block.actions.map((action) => action?.tool || "unknown"))
    });
    for (const block of blocks) {
      const freshActions = block.actions.filter((action) => {
        if (!action || typeof action !== "object") return false;
        // Key uniquely by action ID if provided, otherwise stable JSON of tool + params
        // Models commonly reuse IDs such as "a1" across separate turns/conversations.
        // Include the tool and params so a new action with the same ID is not dropped.
        const key = action.id
          ? "id:" + String(action.id) + ":" + AgentProtocol.stableActionKey(action)
          : AgentProtocol.stableActionKey(action);
        if (executedActions.has(key)) return false;
        return true;
      });

      if (freshActions.length === 0) {
        log("action block skipped: all action IDs were already executed", block.actions.map((action) => action?.id || null));
        continue;
      }
      const requestId = "aea-" + Date.now() + "-" + (++actionSequence);
      const dispatchStartedAt = Date.now();
      log("action dispatch prepared", {
        requestId, count: freshActions.length,
        ids: freshActions.map((action) => action.id || null),
        tools: freshActions.map((action) => action.tool || "unknown")
      });

      // Mark all fresh actions in this block as executed immediately
      for (const action of freshActions) {
        // Models commonly reuse IDs such as "a1" across separate turns/conversations.
        // Include the tool and params so a new action with the same ID is not dropped.
        const key = action.id
          ? "id:" + String(action.id) + ":" + AgentProtocol.stableActionKey(action)
          : AgentProtocol.stableActionKey(action);
        executedActions.add(key);
      }

      actionRound += 1;
      updatePanelStatus(`Executing action (${freshActions.length})...`, "busy");

      chrome.runtime.sendMessage(
        { type: "execute_actions", requestId, actions: freshActions },
        async (response) => {
          const runtimeError = chrome.runtime.lastError?.message || null;
          log("action response received", {
            requestId, elapsedMs: Date.now() - dispatchStartedAt,
            runtimeError, responseOk: Boolean(response?.ok),
            resultCount: response?.payload?.results?.length
          });
          if (runtimeError || !response?.ok) {
            const err = runtimeError || response?.error;
            log("runner execution error", { requestId, error: err });
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
          await injectToolResults(response.payload?.results || [], requestId);
        }
      );
      return;
    }
  }

  async function injectToolResults(results, requestId = "unknown") {
    log("tool result injection stage 1", {
      requestId, resultCount: results.length,
      results: results.map((item) => ({ id: item?.id, tool: item?.tool, ok: item?.ok, error: item?.error?.message }))
    });
    const text = AgentProtocol.makeToolResultsPrompt(results);
    // Clear composer completely first to ensure no stale user text or leftover retry prompt remains
    CodeArtsAdapter.setComposerText(text);
    const submitted = await CodeArtsAdapter.submitComposer();
    log("tool result injection stage 2: submitComposer", {
      requestId, submitted, composerLength: text.length,
      generatingAfterSubmitAttempt: CodeArtsAdapter.isGenerating()
    });
    if (submitted) {
      log("tool results sent back to Gemini");
    } else {
      log("submitComposer deferred or failed (model was generating)");
    }
  }

  function scheduleScan(trigger = "mutation") {
    mutationBatchCount += trigger === "mutation" ? 1 : 0;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const scanId = ++scanSequence;
      const pendingMutationBatches = mutationBatchCount;
      mutationBatchCount = 0;
      log("scan begin", { scanId, trigger, pendingMutationBatches, agentMode: isAgentModeActive });
      // 1. Check for Gemini Model Error and auto-repair
      if (isAgentModeActive && CodeArtsAdapter.checkModelError()) {
        if (retryCount < MAX_AUTO_RETRIES) {
          retryCount += 1;
          log("Gemini model error encountered, triggering auto-repair strategy:", retryStrategy, "attempt:", retryCount);
          updatePanelStatus(`Model error, auto-retrying (${retryCount}/${MAX_AUTO_RETRIES})...`, "warn");

          if (retryStrategy === "prompt") {
            CodeArtsAdapter.sendRetryPrompt(customRetryPrompt).then((ok) => {
              log("sendRetryPrompt result:", ok);
            });
          } else {
            CodeArtsAdapter.triggerRetry().then((ok) => {
              if (ok) {
                log("Auto-retry trigger succeeded");
              } else {
                log("Auto-retry trigger could not find clickable retry button, falling back to prompt");
                CodeArtsAdapter.sendRetryPrompt(customRetryPrompt);
              }
            });
          }
          return;
        } else {
          updatePanelStatus("Model Error (Max Retries)", "error");
        }
      }

      const latest = CodeArtsAdapter.getLatestModelText();
      if (!latest || latest === lastConversationText) {
        log("scan no-op", {
          scanId, reason: !latest ? "no-visible-assistant-text" : "text-unchanged",
          latestLength: latest?.length || 0, generating: CodeArtsAdapter.isGenerating()
        });
        return;
      }
      lastConversationText = latest;
      // Reset retry count on healthy model text update
      if (!CodeArtsAdapter.checkModelError()) {
        retryCount = 0;
      }
      log("scan text changed", {
        scanId, latestLength: latest.length,
        generating: CodeArtsAdapter.isGenerating()
      });
      void handleActionBlocks(latest);
    }, ACTION_DEBOUNCE_MS);
  }

  function startObserver() {
    const conversation = CodeArtsAdapter.getConversation() || document.body;
    const observer = new MutationObserver((records) => {
      scheduleScan("mutation");
      if (mutationBatchCount === 1 || mutationBatchCount % 20 === 0) {
        log("observer mutation batch", {
          recordCount: records.length, totalBatchesSinceScan: mutationBatchCount,
          conversationTag: conversation.tagName, conversationClass: conversation.className
        });
      }
    });
    observer.observe(conversation, { subtree: true, childList: true, characterData: true });
    log("observer started", {
      tag: conversation.tagName, className: conversation.className,
      selector: ".chat-page, .chat-main, .chat-view-wrapper"
    });
    setInterval(() => scheduleScan("poll"), 1500);
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
          <span>Auto Loop</span>
        </label>
        <label class="aea-switch-label" title="在新会话打开时自动发送初始协议提示词">
          <input type="checkbox" id="aea-auto-init-toggle" ${autoInitNewChat ? "checked" : ""}>
          <span>Auto Init</span>
        </label>
        <button id="aea-inject-btn" class="aea-btn" title="Inject Tools System Instructions">
          Inject
        </button>
      </div>
      <div class="aea-strategy-row">
        <span class="aea-strategy-label">报错自愈:</span>
        <select id="aea-retry-strategy-select" class="aea-select">
          <option value="prompt" ${retryStrategy === "prompt" ? "selected" : ""}>回复《你再试试》</option>
          <option value="regenerate" ${retryStrategy === "regenerate" ? "selected" : ""}>点击重新生成</option>
        </select>
      </div>
    `;

    document.body.appendChild(panel);

    // Drag the floating panel by its header and remember its last position.
    const header = panel.querySelector(".aea-header");
    let dragState = null;

    const clampPanelPosition = (left, top) => ({
      left: Math.max(0, Math.min(left, window.innerWidth - panel.offsetWidth)),
      top: Math.max(0, Math.min(top, window.innerHeight - panel.offsetHeight))
    });

    chrome.storage.local.get(["aeaPanelPosition"], (stored) => {
      const saved = stored?.aeaPanelPosition;
      if (!dragState && Number.isFinite(saved?.left) && Number.isFinite(saved?.top)) {
        const position = clampPanelPosition(saved.left, saved.top);
        panel.style.left = `${position.left}px`;
        panel.style.top = `${position.top}px`;
        panel.style.right = "auto";
        panel.style.bottom = "auto";
      }
    });

    header?.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button, input, select, a")) return;
      const rect = panel.getBoundingClientRect();
      dragState = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top
      };
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      header.setPointerCapture(event.pointerId);
      panel.classList.add("aea-dragging");
      event.preventDefault();
    });

    header?.addEventListener("pointermove", (event) => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      const position = clampPanelPosition(
        event.clientX - dragState.offsetX,
        event.clientY - dragState.offsetY
      );
      panel.style.left = `${position.left}px`;
      panel.style.top = `${position.top}px`;
    });

    const finishDragging = (event) => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      dragState = null;
      panel.classList.remove("aea-dragging");
      const rect = panel.getBoundingClientRect();
      chrome.storage.local.set({ aeaPanelPosition: { left: rect.left, top: rect.top } });
    };
    header?.addEventListener("pointerup", finishDragging);
    header?.addEventListener("pointercancel", finishDragging);

    const toggle = document.getElementById("aea-auto-toggle");
    toggle?.addEventListener("change", (e) => {
      isAgentModeActive = Boolean(e.target.checked);
      chrome.storage.local.set({ isAgentModeActive });
      updatePanelStatus(isAgentModeActive ? "Agent Active" : "Agent Paused", isAgentModeActive ? "idle" : "warn");
    });

    const initToggle = document.getElementById("aea-auto-init-toggle");
    initToggle?.addEventListener("change", (e) => {
      autoInitNewChat = Boolean(e.target.checked);
      chrome.storage.local.set({ autoInitNewChat });
      log("autoInitNewChat set to:", autoInitNewChat);
    });

    const strategySelect = document.getElementById("aea-retry-strategy-select");
    strategySelect?.addEventListener("change", (e) => {
      retryStrategy = e.target.value;
      chrome.storage.local.set({ retryStrategy });
      log("retry strategy changed to:", retryStrategy);
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

  let hasTriggeredAutoInit = false;
  let lastAutoInitPath = location.pathname;
  let lastAutoInitHadResponses = false;

  async function checkAndAutoInitChat() {
    if (!autoInitNewChat || !isAgentModeActive) return;

    // A fresh session typically has path == "/app" or "/app/" without an ID, or empty messages
    const isNewChatUrl = location.pathname === "/chat/home" || location.pathname === "/chat/home/";
    const hasExistingResponses = Boolean(CodeArtsAdapter.getLatestModelText());

    // Gemini is an SPA: starting a new chat does not reload this content script.
    // Reset the one-shot guard when the route changes or a populated conversation becomes empty.
    if (location.pathname !== lastAutoInitPath || (lastAutoInitHadResponses && !hasExistingResponses)) {
      log("conversation transition detected", {
        fromPath: lastAutoInitPath,
        toPath: location.pathname,
        hadResponses: lastAutoInitHadResponses,
        hasResponses: hasExistingResponses
      });
      hasTriggeredAutoInit = false;
      lastAutoInitPath = location.pathname;
    }
    lastAutoInitHadResponses = hasExistingResponses;

    if (hasTriggeredAutoInit) return;

    if (isNewChatUrl || !hasExistingResponses) {
      // Check if composer is ready
      const composer = CodeArtsAdapter.getComposer();
      if (!composer) {
        log("auto-init waiting: composer not found");
        return;
      }

      const currentText = (CodeArtsAdapter.getComposerText() || "").trim();
      // Only trigger if composer is empty (or just whitespace/newlines) and no prior responses
      if (!currentText && !hasExistingResponses) {
        hasTriggeredAutoInit = true;
        log("auto-init stage 1: fresh conversation detected; composer is empty");
        updatePanelStatus("Auto-initializing...", "busy");
        
        const filled = CodeArtsAdapter.setComposerText(TOOL_PROMPT);
        log("auto-init stage 2: setComposerText", { filled, composerTextLength: CodeArtsAdapter.getComposerText().length });
        if (!filled || !CodeArtsAdapter.getComposerText().includes("Available tools:")) {
          hasTriggeredAutoInit = false;
          updatePanelStatus("Auto-init: composer fill failed", "error");
          return;
        }
        await new Promise((r) => setTimeout(r, 400));
        const submitted = await CodeArtsAdapter.submitComposer();
        log("auto-init stage 3: submitComposer result", submitted);
        if (submitted) {
          updatePanelStatus("Initial prompt submitted", "success");
        } else {
          hasTriggeredAutoInit = false;
          updatePanelStatus("Auto-init: submit failed", "error");
        }
      }
    }
  }

  // Auto-inject system prompt on new prompt submission if not yet present
  function hookAutoPromptInjection() {
    window.addEventListener("keydown", (e) => {
      if (!isAgentModeActive) return;
      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) {
        const text = CodeArtsAdapter.getComposerText();
        // If user is sending a prompt and this conversation has no model response yet
        const latest = CodeArtsAdapter.getLatestModelText();
        if (text && !latest && !text.includes("@actions") && !text.includes(TOOL_PROMPT.slice(0, 30))) {
          // Prepend tool prompt silently
          CodeArtsAdapter.setComposerText(TOOL_PROMPT + "\n\nUser Question:\n" + text);
          log("auto-prepended system prompt to initial query");
        }
      }
    }, true);
  }

  if (isCodeArtsPage()) {
    chrome.storage.local.get(["isAgentModeActive", "autoInitNewChat", "retryStrategy", "customRetryPrompt"], (result) => {
      if (typeof result.isAgentModeActive === "boolean") {
        isAgentModeActive = result.isAgentModeActive;
      }
      if (typeof result.autoInitNewChat === "boolean") {
        autoInitNewChat = result.autoInitNewChat;
      }
      if (typeof result.retryStrategy === "string") {
        retryStrategy = result.retryStrategy;
      }
      if (typeof result.customRetryPrompt === "string") {
        customRetryPrompt = result.customRetryPrompt;
      }

      // The panel is created before storage.get() completes; synchronize its controls
      // so the visible switches always reflect the values that actually gate the loop.
      const autoToggle = document.getElementById("aea-auto-toggle");
      const initToggle = document.getElementById("aea-auto-init-toggle");
      if (autoToggle) autoToggle.checked = isAgentModeActive;
      if (initToggle) initToggle.checked = autoInitNewChat;
      log("settings loaded", { isAgentModeActive, autoInitNewChat, retryStrategy });

      // Gemini navigation is SPA-based, so keep watching for later new chats too.
      const initInterval = setInterval(() => {
        checkAndAutoInitChat();
      }, 800);
      log("auto-init watcher started (SPA navigation aware)");
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
