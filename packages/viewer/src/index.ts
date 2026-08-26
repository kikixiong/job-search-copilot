import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { feedbackDispositionSchema, JobSearchService } from "@kikixiong/job-search-copilot-core";
import { z } from "zod";

const feedbackInput = z.object({
  opportunityId: z.uuid(),
  disposition: feedbackDispositionSchema,
  reason: z.string().trim().min(1).max(1000).optional()
}).strict().superRefine((value, context) => {
  if (["rejected", "information_error", "closed"].includes(value.disposition) && !value.reason) {
    context.addIssue({ code: "custom", message: "此反馈需要填写原因。", path: ["reason"] });
  }
});
const reviewInput = z.object({ packetId: z.uuid(), acknowledgedConfirmFields: z.array(z.string().trim().min(1)).max(100) }).strict();
const mimeTypes: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

export interface ViewerLauncher {
  urlFor(workspaceId: string): Promise<string>;
  open(url: string): Promise<void>;
  close(): Promise<void>;
}

interface ViewerOptions {
  service: JobSearchService;
  staticDirectory?: string;
  tokenTtlMs?: number;
  openBrowser?: (url: string) => Promise<void>;
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(body));
}

function viewerState(value: unknown): unknown {
  if (typeof value === "string") {
    if (/^file:/i.test(value) || /(^|\s)(?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|var|private|opt|etc)\/)[^\s]*/.test(value)) return "[REDACTED]";
    return value;
  }
  if (Array.isArray(value)) return value.map(viewerState);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).flatMap(([key, nested]) => {
      const semanticKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (/(resumetext|extractedtext|storedpath|applicationanswers?|cookie|authorization|bearer|token|(?:local|artifact|file)(?:path|directory))/.test(semanticKey)) return [];
      return [[key, viewerState(nested)]];
    }));
  }
  return value;
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new Error("请求内容过大。");
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw new Error("请求必须是有效 JSON。"); }
}

function defaultBrowserOpen(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") throw new Error("Viewer 只能打开 127.0.0.1 HTTP 地址。");
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32.exe" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const child = spawn(command, args, { shell: false, detached: true, stdio: "ignore" });
  child.unref();
  return Promise.resolve();
}

export function createViewerLauncher(options: ViewerOptions): ViewerLauncher {
  const staticDirectory = resolve(options.staticDirectory ?? fileURLToPath(new URL("../static", import.meta.url)));
  const tokens = new Map<string, { workspaceId: string; expiresAt: number }>();
  const sessions = new Map<string, string>();
  let port = 0;
  let startPromise: Promise<void> | undefined;
  const server = createServer(async (request, response) => {
    try {
      const expectedHost = `127.0.0.1:${port}`;
      if (request.headers.host !== expectedHost) return json(response, 403, { error: "Host 不在本机 Viewer 边界内。" });
      const requestUrl = new URL(request.url ?? "/", `http://${expectedHost}`);
      if (request.method === "GET" && requestUrl.pathname === "/" && requestUrl.searchParams.has("token")) {
        const token = requestUrl.searchParams.get("token") ?? "";
        const grant = tokens.get(token);
        tokens.delete(token);
        if (!grant || grant.expiresAt < Date.now()) return json(response, 401, { error: "打开链接无效、已过期或已使用。" });
        const session = randomBytes(32).toString("hex");
        sessions.set(session, grant.workspaceId);
        response.writeHead(303, { location: "/", "set-cookie": `viewer_session=${session}; HttpOnly; SameSite=Strict; Path=/`, "cache-control": "no-store" });
        return response.end();
      }
      const cookie = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("viewer_session="))?.slice("viewer_session=".length);
      const workspaceId = cookie ? sessions.get(cookie) : undefined;
      if (requestUrl.pathname.startsWith("/api/")) {
        if (!workspaceId) return json(response, 401, { error: "Viewer 会话无效，请重新打开。" });
        if (request.method === "POST" && request.headers.origin !== `http://${expectedHost}`) return json(response, 403, { error: "跨来源修改请求已拒绝。" });
        if (request.method === "GET" && requestUrl.pathname === "/api/snapshot") {
          return json(response, 200, viewerState(await options.service.getWorkspaceSnapshot({ workspaceId })));
        }
        if (request.method === "POST" && requestUrl.pathname === "/api/feedback") {
          const input = feedbackInput.parse(await readJson(request));
          return json(response, 200, await options.service.recordFeedback({ workspaceId, opportunityId: input.opportunityId, disposition: input.disposition, reason: input.reason }));
        }
        if (request.method === "POST" && requestUrl.pathname === "/api/application/review") {
          const input = reviewInput.parse(await readJson(request));
          const snapshot = await options.service.getWorkspaceSnapshot({ workspaceId });
          const packet = snapshot.applicationPackets.find(({ id }) => id === input.packetId);
          if (!packet) return json(response, 404, { error: "申请材料包不存在。" });
          const acknowledged = new Set(input.acknowledgedConfirmFields);
          const missing = packet.fields.filter(({ classification, key }) => classification === "confirm" && !acknowledged.has(key));
          if (missing.length) return json(response, 400, { error: "请先逐项确认所有待确认字段。", fields: missing.map(({ key }) => key) });
          const result = await options.service.reviewApplicationPacket({ workspaceId, packetId: input.packetId });
          return json(response, 200, { id: result.id, status: result.status });
        }
        return json(response, 404, { error: "接口不存在。" });
      }
      if (request.method !== "GET" && request.method !== "HEAD") return json(response, 404, { error: "路由不存在。" });
      const relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
      let target = resolve(staticDirectory, relativePath || "index.html");
      if (target !== staticDirectory && !target.startsWith(`${staticDirectory}${sep}`)) return json(response, 404, { error: "资源不存在。" });
      if (!extname(target)) target = resolve(staticDirectory, "index.html");
      let contents: Buffer;
      try { contents = await readFile(target); }
      catch { target = resolve(staticDirectory, "index.html"); contents = await readFile(target); }
      response.writeHead(200, { "content-type": mimeTypes[extname(target)] ?? "application/octet-stream", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
      if (request.method === "HEAD") return response.end();
      response.end(contents);
    } catch (error) {
      const message = error instanceof Error ? error.message : "请求失败。";
      json(response, /not found/i.test(message) ? 404 : 400, { error: message });
    }
  });

  async function start() {
    if (startPromise) return startPromise;
    startPromise = new Promise((resolveStart, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") return reject(new Error("Viewer 未取得本机端口。"));
        port = address.port;
        resolveStart();
      });
    });
    return startPromise;
  }

  return {
    async urlFor(workspaceId) {
      await options.service.getWorkspaceSnapshot({ workspaceId });
      await start();
      const token = randomBytes(32).toString("hex");
      tokens.set(token, { workspaceId, expiresAt: Date.now() + (options.tokenTtlMs ?? 60_000) });
      return `http://127.0.0.1:${port}/?token=${token}`;
    },
    async open(url) {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || parsed.port !== String(port)) throw new Error("Viewer 拒绝打开非本机地址。");
      await (options.openBrowser ?? defaultBrowserOpen)(url);
    },
    async close() {
      tokens.clear(); sessions.clear();
      if (!server.listening) return;
      await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    }
  };
}
