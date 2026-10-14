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

  function submitComposer() {
    const composer = getComposer();
    if (!composer) return false;

    composer.focus();
    const submitBtn = document.querySelector('button[aria-label*="Send"], button[aria-label*="发送"], .send-button');
    if (submitBtn && visible(submitBtn)) {
      submitBtn.click();
      return true;
    }

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
    getConversation,
    getLatestModelText
  });
})();
