import fs from "node:fs/promises";
import path from "node:path";

export function createTools(guard) {
  return {
    async list_directory({ path: dirPath = "." }) {
      const target = guard.resolveSafe(dirPath);
      const entries = await fs.readdir(target, { withFileTypes: true });
      return {
        path: path.relative(guard.root, target) || ".",
        entries: entries.map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? "directory" : "file"
        }))
      };
    },

    async read_file({ path: filePath }) {
      if (!filePath) throw new Error("Missing required parameter: path");
      const target = guard.resolveSafe(filePath);
      const content = await fs.readFile(target, "utf-8");
      return {
        path: path.relative(guard.root, target),
        content
      };
    },

    async write_file({ path: filePath, content = "" }) {
      if (!filePath) throw new Error("Missing required parameter: path");
      const target = guard.resolveSafe(filePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, "utf-8");
      return {
        path: path.relative(guard.root, target),
        written_bytes: Buffer.byteLength(content, "utf-8")
      };
    },

    async replace_file({ path: filePath, content = "" }) {
      if (!filePath) throw new Error("Missing required parameter: path");
      const target = guard.resolveSafe(filePath);
      await fs.writeFile(target, content, "utf-8");
      return {
        path: path.relative(guard.root, target),
        replaced_bytes: Buffer.byteLength(content, "utf-8")
      };
    }
  };
}

export async function executeActionBatch(tools, actions) {
  const results = [];
  for (const action of actions) {
    if (!action || typeof action !== "object") {
      results.push({
        id: action?.id,
        tool: "unknown",
        ok: false,
        error: { type: "INVALID_ACTION", message: "Action must be an object" }
      });
      continue;
    }

    const { id, tool, params = {} } = action;
    const handler = tools[tool];

    if (!handler) {
      results.push({
        id,
        tool,
        ok: false,
        error: { type: "TOOL_NOT_FOUND", message: `Tool "${tool}" is not supported` }
      });
      continue;
    }

    try {
      const res = await handler(params);
      results.push({ id, tool, ok: true, result: res });
    } catch (err) {
      results.push({
        id,
        tool,
        ok: false,
        error: {
          type: err?.name || "TOOL_EXECUTION_ERROR",
          message: err?.message || String(err)
        }
      });
    }
  }
  return results;
}
