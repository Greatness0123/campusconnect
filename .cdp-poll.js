// Transient CDP driver: polls the harness page until window.__testResults is set.
const WebSocket = require("ws");
const http = require("http");

const DEBUG_PORT = 9333;
const TIMEOUT_MS = 240000;

function fetchJson(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port: DEBUG_PORT, path }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
  });
}

async function main() {
  let page = null;
  const started = Date.now();
  while (!page) {
    if (Date.now() - started > 30000) throw new Error("no debuggable page target appeared");
    try {
      const targets = await fetchJson("/json/list");
      page = targets.find((t) => t.type === "page" && t.url.includes("convert-test"));
    } catch {
      /* chrome not up yet */
    }
    if (!page) await new Promise((r) => setTimeout(r, 500));
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  let nextId = 0;
  const pending = new Map();

  ws.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send("Runtime.enable");
  console.log("CDP attached, polling for results…");

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await send("Runtime.evaluate", {
        expression: "window.__testResults || null",
        returnByValue: true,
      });
      const value = response?.result?.value;
      if (value) {
        console.log(JSON.stringify(value, null, 2));
        ws.close();
        process.exit(value.pass ? 0 : 1);
      }
    } catch (error) {
      // execution context may be mid-navigation (dev-server compile) — keep polling
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.error("TIMEOUT: harness never reported results");
  process.exit(2);
}

main().catch((error) => {
  console.error("POLLER FATAL:", error);
  process.exit(3);
});
