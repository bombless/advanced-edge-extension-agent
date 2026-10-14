import { describe, it } from "node:test";
import assert from "node:assert/strict";

function cleanJsonString(raw) {
  // Replace unescaped single backslashes in Windows paths (like "D:\mcp-agent") with escaped ones
  return raw.replace(/(?<!\\)\\(?!["\\/bfnrtu])/g, "\\\\");
}

describe("Windows Path in Action Blocks", () => {
  it("fails raw JSON.parse with single backslash", () => {
    const raw = `[{"id":"a1","protocol_version":1,"tool":"list_directory","params":{"path":"D:\\mcp-agent-workspace"}}]`;
    // In raw JavaScript string: D:\mcp-agent-workspace has \m which is invalid JSON escape!
    const jsonStr = `[{"id":"a1","protocol_version":1,"tool":"list_directory","params":{"path":"D:\\mcp-agent-workspace"}}]`;
    assert.throws(() => JSON.parse(jsonStr));
  });

  it("succeeds after cleaning Windows backslashes", () => {
    const jsonStr = `[{"id":"a1","protocol_version":1,"tool":"list_directory","params":{"path":"D:\\mcp-agent-workspace"}}]`;
    const cleaned = cleanJsonString(jsonStr);
    const parsed = JSON.parse(cleaned);
    assert.equal(parsed[0].params.path, "D:\\mcp-agent-workspace");
  });
});
