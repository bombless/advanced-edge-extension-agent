(() => {
  "use strict";

  const PROTOCOL_VERSION = 1;
  const ACTION_PREFIX = "@actions[";
  const RESULT_PREFIX = "@tool_results[";

  function sanitizeJson(raw) {
    // Models may emit single-backslash Windows paths. Segments such as
    // \typescript or \native resemble valid JSON escapes and can be silently
    // corrupted by JSON.parse. This fallback preserves existing escaped pairs.
    let output = "";
    let inString = false;
    let escaped = false;
    let stringContent = "";
    let windowsPath = false;

    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i];
      if (!inString) {
        if (ch === '"') {
          inString = true;
          stringContent = "";
          windowsPath = false;
        }
        output += ch;
        continue;
      }
      if (escaped) {
        escaped = false;
        stringContent += ch;
        output += ch;
        continue;
      }
      if (ch === '"') {
        inString = false;
        output += ch;
        continue;
      }
      if (ch === "\\") {
        if (!windowsPath && /^[A-Za-z]:$/.test(stringContent)) windowsPath = true;
        const next = raw[i + 1];
        if (windowsPath && next === "\\") {
          output += "\\\\";
          i += 1;
          stringContent += "\\";
          continue;
        }
        if (windowsPath || (next && !/["\\/bfnrtu]/.test(next))) {
          output += "\\\\";
          continue;
        }
        output += ch;
        escaped = true;
        continue;
      }
      stringContent += ch;
      output += ch;
    }
    return output;
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
          // Normalize Windows paths before parsing: JSON.parse accepts sequences
          // like \t and \n, but in a path these are usually literal separators.
          actions = JSON.parse(sanitizeJson(raw));
        } catch {
          actions = JSON.parse(raw);
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
