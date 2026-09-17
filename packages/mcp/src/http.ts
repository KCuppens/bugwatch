import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { BugwatchClient } from "./client.js";
import { createBugwatchServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

/**
 * Hosted (network-accessible) Bugwatch MCP server over the Streamable HTTP
 * transport. Runs on infrauno behind Caddy at /mcp.
 *
 * Auth model (single shared key): the server holds ONE Bugwatch agent key
 * (BUGWATCH_AGENT_KEY / BUGWATCH_API_KEY) and every caller acts as that key.
 * Because the endpoint is public, callers are gated by a shared bearer secret
 * (MCP_AUTH_TOKEN). If MCP_AUTH_TOKEN is unset the endpoint is OPEN — a loud
 * warning is logged at boot. Set it in production.
 */

const PORT = Number(process.env.MCP_HTTP_PORT || process.env.PORT || 3002);
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

function main() {
  // Fail fast if the upstream key is missing — the server can't do anything
  // useful without it.
  let client: BugwatchClient;
  try {
    client = new BugwatchClient();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (!MCP_AUTH_TOKEN) {
    console.warn(
      "[bugwatch-mcp] WARNING: MCP_AUTH_TOKEN is not set — the /mcp endpoint is UNAUTHENTICATED. " +
        "Anyone who can reach it acts as the configured Bugwatch agent key. Set MCP_AUTH_TOKEN in production."
    );
  }

  const app = express();
  app.use(express.json({ limit: "4mb" }));

  // Liveness probe for the container healthcheck / load balancer.
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", server: SERVER_NAME, version: SERVER_VERSION });
  });

  // Constant-time-ish bearer check against the shared secret.
  function authorized(req: Request): boolean {
    if (!MCP_AUTH_TOKEN) return true;
    const header = req.header("authorization") || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match?.[1] === MCP_AUTH_TOKEN;
  }

  function unauthorized(res: Response) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized: valid bearer token required" },
      id: null,
    });
  }

  // Stateless Streamable HTTP: a fresh server + transport per request. No
  // session store to leak or grow, which suits a single-key server well.
  app.post("/mcp", async (req: Request, res: Response) => {
    if (!authorized(req)) {
      unauthorized(res);
      return;
    }
    try {
      const server = createBugwatchServer(client);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[bugwatch-mcp] request error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // Stateless mode does not support server-initiated streams or session teardown.
  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. This endpoint is stateless; use POST." },
      id: null,
    });
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  app.listen(PORT, () => {
    console.error(`[bugwatch-mcp] Streamable HTTP server listening on :${PORT} (POST /mcp)`);
  });
}

main();
