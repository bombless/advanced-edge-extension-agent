(() => {
  "use strict";

  // Automatically route CodeArts messages over the authenticated API when the
  // native web composer would reject them for exceeding its 5,000-char limit.
  const LIMIT = 5000;
  const MODEL_ID = "kimi-k3.1-pro";
  const SELECTOR = 'textarea.mc-textarea, textarea[placeholder*="尽管吩咐"], textarea[placeholder*="请输入您的问题"]';
  const SEND_BUTTON_SELECTOR = ".chat-input-area button.mc-button-simple, .input-box button.mc-button-simple";
  const STATUS_ID = "aea-long-send-status";
  let busy = false;

  const visible = (el) => {
    if (!el) return false;
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
  };

  function currentSessionId() {
    try {
      const id = new URL(location.href).searchParams.get("sessionId");
      return id && /^[a-zA-Z0-9-]{8,80}$/.test(id) ? id : null;
    } catch { return null; }
  }

  function csrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)devclouddevuibjtcftk=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function composer() {
    return [...document.querySelectorAll(SELECTOR)].find(visible) || null;
  }

  function status(message, isError = false) {
    const node = document.getElementById(STATUS_ID);
    if (node) {
      node.textContent = message;
      node.style.color = isError ? "#b42318" : "inherit";
    }
    console[isError ? "error" : "info"]("[aea-long-message]", new Date().toISOString(), message);
  }

  async function sendLongMessage(text, sessionId) {
    const headers = { "Content-Type": "application/json", "Accept": "text/event-stream" };
    const token = csrfToken();
    if (token) headers.cftk = token;

    const response = await fetch(
      "/chat/codebaseservice/v1/cloudagent/sessions/" + encodeURIComponent(sessionId) + "/messages",
      {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify({ content: text, model_id: MODEL_ID, repos: [] })
      }
    );
    if (!response.ok) throw new Error("CodeArts API 返回 HTTP " + response.status);
    if (!response.body) throw new Error("服务器没有返回可读取的流式响应");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sawError = false;
    let streamBytes = 0;

    function inspectFrame(frame) {
      const eventMatch = frame.match(/^event:\s*(.+)$/m);
      const dataMatch = frame.match(/^data:\s*(.+)$/m);
      const eventName = eventMatch?.[1]?.trim().toLowerCase() || "";
      if (eventName === "error") sawError = true;
      if (dataMatch) {
        try {
          const payload = JSON.parse(dataMatch[1]);
          if (payload?.error || payload?.status === "failed" || payload?.status === "error") sawError = true;
        } catch { /* non-JSON SSE data is allowed */ }
      }
    }

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      streamBytes += value.byteLength;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() || "";
      for (const frame of frames) inspectFrame(frame);
    }
    buffer += decoder.decode();
    if (buffer.trim()) inspectFrame(buffer);
    if (sawError) throw new Error("服务器流式响应报告了处理错误，请检查会话后重试");
    if (!streamBytes) throw new Error("服务器返回了空响应流");
    return { bytes: streamBytes };
  }

  async function sendAutomatically(text, source) {
    if (busy) return;
    const sessionId = currentSessionId();
    if (!sessionId) {
      status("长消息已拦截，但当前 URL 未找到有效 sessionId；消息仍保留在输入框中。", true);
      return;
    }

    busy = true;
    status("检测到 " + text.length.toLocaleString() + " 个字符（超过 " + LIMIT +
      "），已自动切换 API 发送；触发方式：" + source + "。");
    try {
      const result = await sendLongMessage(text, sessionId);
      status("API 已完成响应（" + result.bytes.toLocaleString() +
        " 字节），正在刷新页面同步会话…");
      setTimeout(() => location.reload(), 1000);
    } catch (error) {
      busy = false;
      status((error instanceof Error ? error.message : String(error)) +
        "；原消息保留在输入框中，请勿连续重复点击发送。", true);
    }
  }

  function interceptIfLong(event, source) {
    const input = composer();
    if (!input) return false;
    const text = input.value || "";
    if (text.length <= LIMIT) return false;

    // Stop CodeArts' own submit handler before it can display the 5,000-char
    // validation message. The API request is now the sole send operation.
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    if (!busy) void sendAutomatically(text, source);
    return true;
  }

  function installAutomaticInterception() {
    // Native send button, including programmatic .click() from CodeArtsAdapter.
    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(SEND_BUTTON_SELECTOR)) return;
      interceptIfLong(event, "send-button");
    }, true);

    // Enter-to-send. Shift+Enter remains a newline as in the native composer.
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      const target = event.target;
      if (!(target instanceof Element) || !target.matches(SELECTOR)) return;
      interceptIfLong(event, "enter-key");
    }, true);

    // Also cover forms that submit without a button click.
    document.addEventListener("submit", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLFormElement)) return;
      if (!target.querySelector(SELECTOR)) return;
      interceptIfLong(event, "form-submit");
    }, true);
  }

  function mountStatus() {
    if (location.hostname !== "devcloud.cn-north-4.huaweicloud.com" ||
        !location.pathname.startsWith("/chat/") ||
        document.getElementById(STATUS_ID)) return;

    const input = composer();
    if (!input) return;
    const host = document.createElement("div");
    host.id = "aea-long-send-host";
    host.style.cssText = "display:flex;align-items:center;margin:6px 0;min-height:18px;";
    const note = document.createElement("span");
    note.id = STATUS_ID;
    note.style.cssText = "font-size:12px;color:inherit;";
    note.textContent = "长消息自动发送已启用（超过 5000 字符时自动切换 API）。";
    host.append(note);

    const anchor = input.closest(".chat-input-area, .input-box") || input.parentElement;
    if (anchor?.parentElement) anchor.parentElement.insertBefore(host, anchor.nextSibling);
    else input.insertAdjacentElement("afterend", host);
  }

  if (location.hostname === "devcloud.cn-north-4.huaweicloud.com" &&
      location.pathname.startsWith("/chat/")) {
    installAutomaticInterception();
    const observer = new MutationObserver(mountStatus);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    mountStatus();
    setInterval(mountStatus, 1800);
  }
})();