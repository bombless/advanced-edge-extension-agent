import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createWorkspaceGuard } from "../src/security.js";
import { createTools, executeActionBatch } from "../src/tools/index.js";

describe("Runner Sandbox & Tools", () => {
  it("blocks directory traversal outside workspace", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agent-runner-test-"));
    const guard = await createWorkspaceGuard(tmp);
    const tools = createTools(guard);

    const results = await executeActionBatch(tools, [
      { id: "1", tool: "read_file", params: { path: "../outside.txt" } }
    ]);

    assert.equal(results[0]?.ok, false);
    assert.match(results[0]?.error?.message || "", /resolves outside/);

    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("creates and reads files within workspace", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agent-runner-test-"));
    const guard = await createWorkspaceGuard(tmp);
    const tools = createTools(guard);

    const write = await executeActionBatch(tools, [
      { id: "1", tool: "write_file", params: { path: "hello.txt", content: "Edge Agent!" } }
    ]);
    assert.equal(write[0]?.ok, true);

    const read = await executeActionBatch(tools, [
      { id: "2", tool: "read_file", params: { path: "hello.txt" } }
    ]);
    assert.equal(read[0]?.ok, true);
    assert.equal(read[0]?.result?.content, "Edge Agent!");

    await fs.rm(tmp, { recursive: true, force: true });
  });
});
