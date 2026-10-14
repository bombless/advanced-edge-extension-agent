(() => {
  "use strict";

  const COMPOSER_SELECTORS = [
    'rich-textarea [contenteditable="true"]',
    'div.ql-editor[contenteditable="true"]',
    '[aria-label="Enter a prompt here"]',
    'textarea',
    '[contenteditable="true"][role="textbox"]'
  ];

  const ASSISTANT_SELECTORS = [
    "model-response",
    ".model-response",
    "response-container",
    ".response-container",
    ".presented-response-container",
    "message-content",
    ".message-content",
    '[aria-label="Gemini response"]',
    '[data-message-author-role="assistant"]',
    '[data-message-author-role="model"]',
    'article[data-author="assistant"]',
    '.conversation-container',
    'chat-window'
  ];

  function visible(element) {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0;
  }

  function getComposerEntry() {
    for (const selector of COMPOSER_SELECTORS) {
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        if (visible(node)) return { node, selector };
      }
    }
    return null;
  }

  function getComposer() {
    return getComposerEntry()?.node || null;
  }

  function getComposerText() {
    const composer = getComposer();
    if (!composer) return "";
    return composer instanceof HTMLTextAreaElement
      ? composer.value
      : composer.innerText || composer.textContent || "";
  }

  function setComposerText(text) {
    const composer = getComposer();
    if (!composer) return false;

    composer.focus();
    if (composer instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      )?.set;
      setter?.call(composer, text);
    } else {
      // In Chromium / Edge, select all and execCommand keeps editor internal model in sync
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(composer);
      selection?.removeAllRanges();
      selection?.addRange(range);

      const inserted = document.execCommand("insertText", false, text);
      if (!inserted) {
        composer.textContent = text;
      }
    }

    composer.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: text
    }));
    composer.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function appendToComposer(text) {
    const current = getComposerText();
    const separator = current && !current.endsWith("\n") ? "\n\n" : "";
    return setComposerText(current + separator + text);
  }

  function isGenerating() {
    // Check if Stop button is present and visible
    const stopBtn = document.querySelector(
      'button[aria-label*="Stop"], button[aria-label*="停止"], button[aria-label*="终止"], .stop-button, [data-test-id="stop-button"]'
    );
    if (stopBtn && visible(stopBtn)) return true;

    // Check if there is an active streaming indicator
    const spinner = document.querySelector('mat-progress-spinner, .loading-spinner, .pulsing');
    if (spinner && visible(spinner)) return true;

    return false;
  }

  function getSendButton() {
    // Only return the button if its aria-label explicitly indicates sending, not stopping
    const candidates = document.querySelectorAll(
      'button[aria-label*="Send"], button[aria-label*="发送"], .send-button, [data-test-id="send-button"]'
    );
    for (const btn of candidates) {
      if (!visible(btn)) continue;
      const label = (btn.getAttribute("aria-label") || "").toLowerCase();
      // Ensure it's not a stop/cancel button
      if (label.includes("stop") || label.includes("停止") || label.includes("终止")) {
        continue;
      }
      return btn;
    }
    return null;
  }

  async function waitForGenerationToFinish(maxWaitMs = 15000, pollIntervalMs = 300) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (!isGenerating()) {
        // Extra grace period to allow DOM state to transition from Stop to Send
        await new Promise((r) => setTimeout(r, 400));
        if (!isGenerating()) return true;
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    return false;
  }

  async function submitComposer() {
    const composer = getComposer();
    if (!composer) return false;

    // 1. Wait until generation completely finishes
    await waitForGenerationToFinish();

    composer.focus();

    // 2. Locate the real Send button (and make sure it's not the Stop button)
    const submitBtn = getSendButton();
    if (submitBtn) {
      submitBtn.click();
      return true;
    }

    // 3. Fallback: dispatch Enter key event only when not generating
    if (!isGenerating()) {
      composer.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      }));
      return true;
    }

    return false;
  }

  function checkModelError() {
    const errorPhrases = [
      "I seem to be encountering an error",
      "遇到错误",
      "出错了",
      "An error occurred",
      "Something went wrong",
      "Can I try something else for you"
    ];

    const bodyText = document.body.innerText || "";
    for (const phrase of errorPhrases) {
      if (bodyText.includes(phrase)) {
        return true;
      }
    }
    return false;
  }

  async function triggerRetry() {
    // 1. Try finding popup / inline menu item with data-test-id="regenerate-option"
    const regenerateOption = document.querySelector('[data-test-id="regenerate-option"]');
    if (regenerateOption && visible(regenerateOption)) {
      regenerateOption.click();
      return true;
    }

    // 2. Try finding chip / pill with "重试" or "Retry"
    const spans = Array.from(document.querySelectorAll('span.label, .chip-label, button span'));
    for (const span of spans) {
      const text = span.innerText?.trim();
      if (text === "重试" || text === "Retry") {
        const clickable = span.closest('button, [role="button"], [role="menuitem"], gem-menu-item') || span.parentElement;
        if (clickable && visible(clickable)) {
          clickable.click();
          return true;
        }
      }
    }

    // 3. Try finding "重做" (Redo/Regenerate) button in model response toolbar
    const buttons = Array.from(document.querySelectorAll('button'));
    const redoButtons = buttons.filter((b) => {
      const label = b.getAttribute("aria-label") || "";
      return label === "重做" || label === "Redo" || label.includes("Retry") || label.includes("重新生成");
    });

    if (redoButtons.length > 0) {
      // Click the latest redo button
      const lastRedo = redoButtons[redoButtons.length - 1];
      if (lastRedo && visible(lastRedo)) {
        lastRedo.click();
        return true;
      }
    }

    return false;
  }

  function getConversation() {
    return document.querySelector("main") || document.body;
  }

  function getLatestModelText() {
    const nodes = [];
    for (const selector of ASSISTANT_SELECTORS) {
      document.querySelectorAll(selector).forEach((node) => {
        if (visible(node)) nodes.push(node);
      });
    }

    const unique = [...new Set(nodes)];
    // Search from the latest downwards
    for (let i = unique.length - 1; i >= 0; i -= 1) {
      const text = unique[i]?.innerText || unique[i]?.textContent || "";
      if (text.includes("@actions[")) {
        return text;
      }
    }

    // Fallback: search entire main/body if assistant selectors missed modern Web Component shadow DOM
    const bodyText = document.body.innerText || document.body.textContent || "";
    if (bodyText.includes("@actions[")) {
      return bodyText;
    }

    const latest = unique[unique.length - 1];
    return latest?.innerText || latest?.textContent || "";
  }

  globalThis.GeminiAdapter = Object.freeze({
    getComposer,
    getComposerText,
    setComposerText,
    appendToComposer,
    submitComposer,
    checkModelError,
    triggerRetry,
    isGenerating,
    waitForGenerationToFinish,
    getConversation,
    getLatestModelText
  });
})();
