const pageId = "F6E6FA1DEA26B030B7595AA6220B84BE";
const wsUrl = `ws://127.0.0.1:9222/devtools/page/${pageId}`;

async function main() {
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    const expr = `
      (() => {
        return {
          hasCheckModelError: typeof GeminiAdapter !== "undefined" && typeof GeminiAdapter.checkModelError === "function",
          geminiAdapterKeys: typeof GeminiAdapter !== "undefined" ? Object.keys(GeminiAdapter) : []
        };
      })()
    `;

    ws.send(JSON.stringify({
      id: 2,
      method: "Runtime.evaluate",
      params: { expression: expr, returnByValue: true }
    }));
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id === 2) {
      console.log("Runtime Adapter check:", JSON.stringify(data.result?.result?.value, null, 2));
      ws.close();
    }
  };
}

main().catch(console.error);
