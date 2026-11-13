(() => {
  "use strict";

  // CodeArts currently renders its composer as a Vue-controlled textarea.
  // Keep selectors narrow for input/submission and tolerant for streamed replies.
  const COMPOSER_SELECTOR = 'textarea.mc-textarea, textarea[placeholder*="尽管吩咐"], textarea[placeholder*="请输入您的问题"]';

  function visible(element) {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function getComposer() {
    return [...document.querySelectorAll(COMPOSER_SELECTOR)].find(visible) || null;
  }

  function getComposerText() { return getComposer()?.value || ""; }

  function setComposerText(text) {
    const composer = getComposer();
    if (!composer) return false;
    composer.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) setter.call(composer, String(text));
    else composer.value = String(text);
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(text) }));
    composer.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function appendToComposer(text) {
    const current = getComposerText();
    return setComposerText(current + (current && !current.endsWith("\n") ? "\n\n" : "") + text);
  }

  function isGenerating() {
    return [...document.querySelectorAll("button")].some((button) => {
      if (!visible(button)) return false;
      const label = `${button.getAttribute("aria-label") || ""} ${button.title || ""} ${button.innerText || ""}`;
      return /停止|停止回答|stop answering/i.test(label);
    });
  }

  async function waitForGenerationToFinish(maxWaitMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (!isGenerating()) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        if (!isGenerating()) return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }

  function getSendButton() {
    const button = document.querySelector(".chat-input-area button.mc-button-simple, .input-box button.mc-button-simple");
    return button && visible(button) && !button.disabled ? button : null;
  }

  async function submitComposer() {
    const composer = getComposer();
    if (!composer) {
      console.debug("[advanced-edge-agent/codearts]", new Date().toISOString(), "submit blocked: composer missing");
      return false;
    }
    const initialGenerating = isGenerating();
    const waitStartedAt = Date.now();
    console.debug("[advanced-edge-agent/codearts]", new Date().toISOString(), "submit wait begin", { initialGenerating, composerLength: composer.value?.length || 0 });
    const finished = await waitForGenerationToFinish();
    const elapsedMs = Date.now() - waitStartedAt;
    const button = getSendButton();
    console.debug("[advanced-edge-agent/codearts]", new Date().toISOString(), "submit wait end", {
      finished, elapsedMs, generating: isGenerating(),
      sendButtonFound: Boolean(button), sendButtonDisabled: button ? button.disabled : null
    });
    if (!button) return false;
    button.click();
    console.debug("[advanced-edge-agent/codearts]", new Date().toISOString(), "send button clicked");
    return true;
  }

  function getConversation() {
    return document.querySelector(".chat-page, .chat-main, .chat-view-wrapper") || document.body;
  }

  function getLatestModelResponseNode() {
    // CodeArts messages use .message-with-share-select.assistant > .as-message-container.assistant.
    // The previous generic selectors did not match this DOM, so the observer never saw model output.
    const turns = [...document.querySelectorAll(".message-with-share-select.assistant")];
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      const turn = turns[i];
      if (!visible(turn) || turn.closest("#aea-control-panel")) continue;
      const content = turn.querySelector(
        ".mc-markdown-render, .message-text-wrapper, .as-bubble-content.assistant"
      );
      if (content && visible(content) && (content.innerText || "").trim()) return content;
    }

    // Fallback selectors for future CodeArts UI variants.
    const selectors = [
      '[data-message-role="assistant"]', '[data-role="assistant"]',
      '[class*="assistant-message"]', '[class*="message-assistant"]',
      '[class*="assistant-content"]', '[class*="markdown-body"]',
      '[class*="message-content"]', '[class*="answer-content"]'
    ];
    for (const selector of selectors) {
      const nodes = [...document.querySelectorAll(selector)].filter((node) =>
        visible(node) && !node.closest("#aea-control-panel") && !node.closest(".chat-input-area") &&
        (node.innerText || "").trim()
      );
      if (nodes.length) return nodes.at(-1);
    }
    return null;
  }

  function getLatestModelText() {
    return getLatestModelResponseNode()?.innerText?.trim() || "";
  }

  // CodeArts has no verified stable retry selector; never click guessed controls.
  function checkModelError() { return false; }
  async function triggerRetry() { return false; }
  async function sendRetryPrompt() { return false; }

  globalThis.CodeArtsAdapter = Object.freeze({
    getComposer, getComposerText, setComposerText, appendToComposer,
    submitComposer, isGenerating, waitForGenerationToFinish,
    getConversation, getLatestModelText, checkModelError, triggerRetry, sendRetryPrompt
  });
})();
