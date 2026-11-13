import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";

const protocolPath = fileURLToPath(new URL("../../extension/protocol.js", import.meta.url));
const context = { console };
context.globalThis = context;
vm.runInNewContext(fs.readFileSync(protocolPath, "utf8"), context);
const { extractActionBlocks } = context.AgentProtocol;

describe("Gemini action JSON compatibility", () => {
  it("preserves Windows paths with invalid backslash escapes", () => {
    const response = String.raw`@actions[{"id":"a1","protocol_version":1,"tool":"read_file","params":{"path":"D:\mcp-agent-workspace\project\file.txt"}}]`;
    const blocks = extractActionBlocks(response);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].actions[0].params.path, String.raw`D:\mcp-agent-workspace\project\file.txt`);
  });

  it("does not turn path segments like temp/native into tab or newline escapes", () => {
    const response = String.raw`@actions[{"id":"a1","protocol_version":1,"tool":"read_file","params":{"path":"D:\temp\native\typescript.txt"}}]`;
    const blocks = extractActionBlocks(response);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].actions[0].params.path, String.raw`D:\temp\native\typescript.txt`);
  });

  it("keeps already-valid escaped Windows paths unchanged", () => {
    const response = String.raw`@actions[{"id":"a1","protocol_version":1,"tool":"read_file","params":{"path":"D:\\temp\\native.txt"}}]`;
    const blocks = extractActionBlocks(response);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].actions[0].params.path, String.raw`D:\temp\native.txt`);
  });
});