import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { feedbackDispositionSchema, JobSearchService, redactPublicText as safeText, redactPublicUrl as publicUrl, type WorkspaceRecoverySnapshot } from "@kikixiong/job-search-copilot-core";
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
const reviewInput = z.object({ packetId: z.uuid(), revision: z.number().int().positive(), acknowledgedFieldIds: z.array(z.uuid()).max(100) }).strict();
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

const traceFields = new Set(["queryText", "source", "retrievedAt", "sourceTier", "sourceUrl", "locator", "lifecycle", "confidence", "dedupDecision", "eligibility", "matchExplanation", "failure", "queryCount", "sourceCount", "resultCount", "beforeScope", "afterScope"]);
function publicTraceFields(attributes: Record<string, unknown>) {
  const fields: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!traceFields.has(key)) continue;
    if (key === "sourceUrl") fields[key] = typeof value === "string" ? publicUrl(value) : null;
    else if (typeof value === "string") fields[key] = safeText(value);
    else if (typeof value === "number" || typeof value === "boolean" || value === null) fields[key] = value;
  }
  return fields;
}

function safeLocator(value: string) {
  try {
    const parsed = new URL(value);
    if (["http:", "https:"].includes(parsed.protocol)) return publicUrl(value) ?? "[REDACTED]";
  } catch { /* A locator may be a page section or selector. */ }
  return safeText(value);
}

function publicTargetingConstraints(constraints: WorkspaceRecoverySnapshot["runs"][number]["searchBrief"]["targetingConstraints"]) {
  return {
    schemaVersion: constraints.schemaVersion,
    status: constraints.status,
    targetKinds: [...constraints.targetKinds],
    employmentTypes: [...constraints.employmentTypes],
    levels: constraints.levels.map(safeText),
    domains: constraints.domains.map(safeText),
    availability: constraints.availability ? safeText(constraints.availability) : null,
    workAuthorization: constraints.workAuthorization.map(safeText),
    visa: constraints.visa ? safeText(constraints.visa) : null,
    timing: constraints.timing ? safeText(constraints.timing) : null,
    hardExclusions: constraints.hardExclusions.map(safeText),
    breadth: constraints.breadth,
    unknowns: constraints.unknowns.map(safeText),
    contradictions: constraints.contradictions.map((item) => ({ field: safeText(item.field), details: item.details.map(safeText) }))
  };
}

function viewerSnapshot(snapshot: WorkspaceRecoverySnapshot) {
  return {
    workspace: { id: snapshot.workspace.id, name: safeText(snapshot.workspace.name), createdAt: snapshot.workspace.createdAt },
    resumeImported: snapshot.resumeImported,
    latestProfile: snapshot.latestProfile ? { version: snapshot.latestProfile.version, headline: safeText(snapshot.latestProfile.headline), skills: snapshot.latestProfile.skills.map(safeText), positioningTracks: snapshot.latestProfile.positioningTracks.map((track) => ({ name: safeText(track.name), summary: safeText(track.summary), targetRoles: track.targetRoles.map(safeText) })), targetingConstraints: publicTargetingConstraints(snapshot.latestProfile.targetingConstraints), createdAt: snapshot.latestProfile.createdAt } : null,
    latestSearchBrief: snapshot.latestSearchBrief ? { version: snapshot.latestSearchBrief.version, data: { keywords: snapshot.latestSearchBrief.data.keywords.map(safeText), locations: snapshot.latestSearchBrief.data.locations.map(safeText), targetingConstraints: publicTargetingConstraints(snapshot.latestSearchBrief.data.targetingConstraints) }, createdAt: snapshot.latestSearchBrief.createdAt } : null,
    latestPreference: snapshot.latestPreference ? { version: snapshot.latestPreference.version, data: { preferredLocations: snapshot.latestPreference.data.preferredLocations.map(safeText), preferredRoles: snapshot.latestPreference.data.preferredRoles.map(safeText) }, createdAt: snapshot.latestPreference.createdAt } : null,
    runs: snapshot.runs.map((run) => ({ id: run.id, profileVersion: run.profileVersion, searchBriefVersion: run.searchBriefVersion, preferenceVersion: run.preferenceVersion, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt, searchBrief: { keywords: run.searchBrief.keywords.map(safeText), locations: run.searchBrief.locations.map(safeText), targetingConstraints: publicTargetingConstraints(run.searchBrief.targetingConstraints) }, queryAttempts: run.queryAttempts.map((attempt) => ({ id: attempt.id, runId: attempt.runId, text: safeText(attempt.text), source: safeText(attempt.source), status: attempt.status, retrievedAt: attempt.retrievedAt, locator: safeLocator(attempt.locator), sourceTier: attempt.sourceTier, failure: attempt.failure ? { code: attempt.failure.code, summary: safeText(attempt.failure.summary) } : null })), summary: run.summary })),
    feedback: snapshot.feedback.map((item) => ({ id: item.id, opportunityId: item.opportunityId, disposition: item.disposition, reason: item.reason ? safeText(item.reason) : null, createdAt: item.createdAt })),
    applicationPackets: snapshot.applicationPackets.map((packet) => ({ id: packet.id, opportunityId: packet.opportunityId, status: packet.status, revision: packet.revision, audit: packet.audit ? { version: packet.audit.version, retrievedAt: packet.audit.retrievedAt, destinationUrl: publicUrl(packet.audit.destinationUrl), status: packet.audit.status } : null, guidance: { mode: packet.guidance.mode, reasons: [...packet.guidance.reasons], auditVersion: packet.guidance.auditVersion }, attachments: packet.attachments.map((item) => ({ name: safeText(item.name), status: item.status, locator: item.locator ? safeText(item.locator) : null })), unknowns: packet.unknowns.map(safeText), fields: packet.fields.map((field) => ({ id: field.id, key: safeText(field.key), label: safeText(field.label), classification: field.classification, provenance: field.provenance ? { source: field.provenance.source, locator: safeText(field.provenance.locator), reviewed: field.provenance.reviewed, sensitive: field.provenance.sensitive } : null })), createdAt: packet.createdAt, updatedAt: packet.updatedAt })),
    opportunities: snapshot.opportunities.map((item) => ({ id: item.id, kind: item.kind, company: safeText(item.company), title: safeText(item.title), location: safeText(item.location), canonicalApplyUrl: publicUrl(item.canonicalApplyUrl), requisitionId: item.requisitionId ? safeText(item.requisitionId) : null, eligibility: item.eligibility, evidenceStatus: item.evidenceStatus, sourceObservations: item.sourceObservations.map((observation) => ({ id: observation.id, runId: observation.runId, sourceUrl: publicUrl(observation.sourceUrl), sourceType: observation.sourceType, sourceTier: observation.sourceTier, status: observation.status, observedAt: observation.observedAt, retrievedAt: observation.retrievedAt, locator: safeLocator(observation.locator), confidence: observation.confidence, deadline: observation.deadline, conflict: observation.conflict ? { kind: observation.conflict.kind, summary: safeText(observation.conflict.summary), relatedLocator: observation.conflict.relatedLocator ? safeLocator(observation.conflict.relatedLocator) : undefined } : null, dedupeDecision: { action: observation.dedupeDecision.action, matchedBy: observation.dedupeDecision.matchedBy, survivorOpportunityId: observation.dedupeDecision.survivorOpportunityId, mergedOpportunityIds: [...observation.dedupeDecision.mergedOpportunityIds] } })), match: item.match ? { runId: item.match.runId, score: item.match.score, factors: Object.fromEntries(Object.entries(item.match.factors).map(([key, value]) => [safeText(key), value])), reasons: item.match.reasons.map(safeText), gaps: item.match.gaps.map(safeText), unknowns: item.match.unknowns.map(safeText) } : null, createdAt: item.createdAt, updatedAt: item.updatedAt })),
    trace: snapshot.trace.map((event) => ({ id: event.id, runId: event.runId, name: safeText(event.name), startedAt: event.startedAt, endedAt: event.endedAt, status: event.status, fields: publicTraceFields(event.attributes) }))
  };
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

export function browserLaunchSpec(url: string, platform: NodeJS.Platform | string = process.platform) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") throw new Error("Viewer 只能打开 127.0.0.1 HTTP 地址。");
  const command = platform === "darwin" ? "open" : platform === "win32" ? "rundll32.exe" : "xdg-open";
  const args = platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  return { command, args, options: { shell: false as const, detached: true, stdio: "ignore" as const } };
}

export function defaultBrowserOpen(url: string, environment: NodeJS.ProcessEnv = process.env) {
  const spec = browserLaunchSpec(url);
  return new Promise<void>((resolveOpen, reject) => {
    const child = spawn(spec.command, spec.args, { ...spec.options, env: environment });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolveOpen();
    });
  });
}

export function createViewerLauncher(options: ViewerOptions): ViewerLauncher {
  const staticDirectory = resolve(options.staticDirectory ?? fileURLToPath(new URL("../static", import.meta.url)));
  const tokens = new Map<string, { workspaceId: string; expiresAt: number }>();
  const sessions = new Map<string, { cookieSecret: string; workspaceId: string }>();
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
        const routeHandle = randomBytes(32).toString("hex");
        const cookieSecret = randomBytes(32).toString("hex");
        const sessionPath = `/s/${routeHandle}/`;
        sessions.set(routeHandle, { cookieSecret, workspaceId: grant.workspaceId });
        response.writeHead(303, { location: sessionPath, "set-cookie": `viewer_session=${cookieSecret}; HttpOnly; SameSite=Strict; Path=${sessionPath}`, "cache-control": "no-store" });
        return response.end();
      }
      const scoped = requestUrl.pathname.match(/^\/s\/([a-f0-9]{64})\/(.*)$/);
      const pathSession = scoped?.[1];
      const scopedPath = scoped?.[2] ?? requestUrl.pathname.replace(/^\/+/, "");
      const cookie = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("viewer_session="))?.slice("viewer_session=".length);
      const session = pathSession ? sessions.get(pathSession) : undefined;
      const workspaceId = cookie && session && cookie === session.cookieSecret ? session.workspaceId : undefined;
      if (scopedPath.startsWith("api/")) {
        if (!workspaceId) return json(response, 401, { error: "Viewer 会话无效，请重新打开。" });
        if (request.method === "POST" && request.headers.origin !== `http://${expectedHost}`) return json(response, 403, { error: "跨来源修改请求已拒绝。" });
        if (request.method === "GET" && scopedPath === "api/snapshot") {
          return json(response, 200, viewerSnapshot(await options.service.getWorkspaceSnapshot({ workspaceId })));
        }
        if (request.method === "POST" && scopedPath === "api/feedback") {
          const input = feedbackInput.parse(await readJson(request));
          const result = await options.service.recordFeedback({ workspaceId, opportunityId: input.opportunityId, disposition: input.disposition, reason: input.reason });
          return json(response, 200, { id: result.id, opportunityId: result.opportunityId, disposition: result.disposition });
        }
        if (request.method === "POST" && scopedPath === "api/application/review") {
          const input = reviewInput.parse(await readJson(request));
          const result = await options.service.reviewApplicationPacket({ workspaceId, packetId: input.packetId, revision: input.revision, acknowledgedFieldIds: input.acknowledgedFieldIds });
          return json(response, 200, { id: result.id, status: result.status, revision: result.revision });
        }
        return json(response, 404, { error: "接口不存在。" });
      }
      if (request.method !== "GET" && request.method !== "HEAD") return json(response, 404, { error: "路由不存在。" });
      const relativePath = decodeURIComponent(scopedPath);
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
