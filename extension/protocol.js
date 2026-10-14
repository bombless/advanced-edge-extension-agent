(() => {
  "use strict";

  const PROTOCOL_VERSION = 1;
  const ACTION_PREFIX = "@actions[";
  const RESULT_PREFIX = "@tool_results[";

  function sanitizeJson(raw) {
    // LLMs on Windows frequently output unescaped backslashes in paths like "D:\mcp-agent-workspace"
    // Valid JSON escape characters after backslash are: ", \, /, b, f, n, r, t, u
    // Any other backslash must be escaped as \\
    return raw.replace(/(?<!\\)\\(?!["\\/bfnrtu])/g, "\\\\");
  }

  function extractActionBlocks(text) {
    const blocks = [];
    let searchFrom = 0;

    while (searchFrom < text.length) {
      const start = text.indexOf(ACTION_PREFIX, searchFrom);
      if (start === -1) break;

      const jsonStart = start + ACTION_PREFIX.length - 1;
      const jsonEnd = findMatchingJsonBracket(text, jsonStart);
      if (jsonEnd === -1) break;

      const raw = text.slice(jsonStart, jsonEnd + 1);
      try {
        let actions;
        try {
          actions = JSON.parse(raw);
        } catch {
          actions = JSON.parse(sanitizeJson(raw));
        }

        if (Array.isArray(actions)) {
          blocks.push({
            raw,
            actions,
            start,
            end: jsonEnd + 1
          });
        }
      } catch (err) {
        // Wait for streaming completion or log syntax failure
        console.debug("[protocol] JSON parse failed on candidate block:", raw, err);
      }

      searchFrom = jsonEnd + 1;
    }

    return blocks;
  }

  function findMatchingJsonBracket(text, openIndex) {
    if (text[openIndex] !== "[") return -1;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = openIndex; i < text.length; i += 1) {
      const ch = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
      } else if (ch === "[") {
        depth += 1;
      } else if (ch === "]") {
        depth -= 1;
        if (depth === 0) return i;
      }
    }

    return -1;
  }

  function stableActionKey(action) {
    return JSON.stringify({
      tool: action.tool,
      params: action.params
    });
  }

  function makeToolResultsPrompt(results) {
    return RESULT_PREFIX + JSON.stringify(results) + "]";
  }

  globalThis.AgentProtocol = Object.freeze({
    PROTOCOL_VERSION,
    extractActionBlocks,
    stableActionKey,
    makeToolResultsPrompt
  });
})();
