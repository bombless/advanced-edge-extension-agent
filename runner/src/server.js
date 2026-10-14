import http from "node:http";
import { createWorkspaceGuard } from "./security.js";
import { createTools, executeActionBatch } from "./tools/index.js";

const PORT = 8765;
const HOST = "127.0.0.1";
const WORKSPACE_DIR = process.env.AGENT_WORKSPACE || process.cwd();

async function main() {
  const guard = await createWorkspaceGuard(WORKSPACE_DIR);
  const tools = createTools(guard);

  const server = http.createServer(async (req, res) => {
    // CORS headers for Edge / Chrome extensions
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", workspace: guard.root }));
      return;
    }

    if (req.method === "POST" && req.url === "/execute") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });

      req.on("end", async () => {
        try {
          const parsed = JSON.parse(body || "{}");
          const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
          const results = await executeActionBatch(tools, actions);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ protocol_version: 1, results }));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            error: {
              type: "BAD_REQUEST",
              message: err instanceof Error ? err.message : String(err)
            }
          }));
        }
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { type: "NOT_FOUND", message: "Not found" } }));
  });

  server.listen(PORT, HOST, () => {
    console.log(`[Advanced Edge Agent Runner] Listening on http://${HOST}:${PORT}`);
    console.log(`[Workspace Sandbox] ${guard.root}`);
  });
}

main().catch((err) => {
  console.error("Failed to start runner:", err);
  process.exit(1);
});
