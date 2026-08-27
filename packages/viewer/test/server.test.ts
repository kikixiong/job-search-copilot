import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { JobSearchService } from "@kikixiong/job-search-copilot-core";
import { browserLaunchSpec, createViewerLauncher } from "../src/index.js";
import * as viewerModule from "../src/index.js";

const syntheticRootHome = ["/ro", "ot"].join("");
const syntheticCredentialUrl = ["https://user:pass", "@boards.greenhouse.io/synthetic/jobs/candidate@example.test"].join("");

async function fixture(tokenTtlMs?: number, exactDestinations = false) {
  const dataRoot = await mkdtemp(join(tmpdir(), "viewer-data-"));
  const staticDirectory = await mkdtemp(join(tmpdir(), "viewer-static-"));
  await writeFile(join(staticDirectory, "index.html"), "<!doctype html><main>求职证据台</main>");
  const service = new JobSearchService({ dataRoot });
  const workspace = await service.openWorkspace({ name: `Synthetic Viewer private@example.test /Volumes/private/a 路径：${syntheticRootHome}/private/a` });
  const profile = await service.commitProfile({ workspaceId: workspace.id, baseVersion: null, profile: { headline: ["Product Engineer +1 415", "-555-2671 /mnt/private/a Bear", "er opaque-session"].join(""), skills: ["TypeScript", "sk-live-secret", "C:\\private\\c", "/data/private/a"], positioningTracks: [{ name: "Product", summary: "/srv/private/a /workspace/private/a", targetRoles: ["Engineer", `路径:${syntheticRootHome}`, `参见${syntheticRootHome}/private/resume.pdf`] }] } });
  const run = await service.beginSearchRun({ workspaceId: workspace.id, profileVersion: profile.version, searchBrief: { keywords: ["product engineer"], locations: ["Remote"] }, preferenceVersion: null });
  const exactDestination = "https://boards.greenhouse.io/synthetic/jobs/1";
  const batch = await service.recordSearchBatch({
    workspaceId: workspace.id,
    runId: run.id,
    query: { text: "product engineer", source: "synthetic" },
    opportunities: [{ kind: "job", company: "Synthetic Co", title: "Product Engineer", location: "Remote", canonicalApplyUrl: exactDestinations ? exactDestination : `${syntheticCredentialUrl}?token=query-secret&keep=public`, eligibility: "eligible", evidence: { sourceUrl: exactDestinations ? exactDestination : `${syntheticCredentialUrl}?api_key=query-secret&keep=public`, sourceType: "official", status: "open" }, match: { score: 91, factors: { skills: 95 }, reasons: ["技能匹配 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature", "\\\\server\\share"], gaps: ["file:///secret"], unknowns: [] } }]
  });
  const packet = await service.upsertApplicationPacket({ workspaceId: workspace.id, opportunityId: batch.opportunities[0].id, status: "draft", fields: [{ key: "email", label: "邮箱", value: "private@example.test", provenance: { source: "profile", locator: "profile.contact.email", reviewed: true, sensitive: false } }, { key: "salary", label: "期望薪资", value: "100", provenance: { source: "user_confirmed", locator: "conversation.salary", reviewed: true, sensitive: false } }, { key: "signature", label: "签名", value: "", provenance: { source: "unknown", locator: "live-form.signature", reviewed: false, sensitive: true } }], audit: { version: 1, retrievedAt: new Date().toISOString(), destinationUrl: exactDestinations ? exactDestination : "https://boards.greenhouse.io/synthetic/jobs/candidate@example.test?credential=audit-secret", status: "verified" }, attachments: [{ name: "resume.pdf", status: "ready", locator: "packet.resume" }], unknowns: ["推荐人待核实 api_key=abcdefgh1234 cookie=session-value"] });
  await service.recordTraceEvent({ workspaceId: workspace.id, runId: run.id, traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331", name: "viewer.synthetic", startedAt: "2026-01-01T00:00:00.000Z", status: "ok", attributes: { source: "Synthetic", locator: "official.jobs", beforeScope: "前端", afterScope: "产品", artifactPath: "/Volumes/private/a", note: "/mnt/a /srv/b C:\\private\\c \\\\server\\share file:///secret" } });
  const launcher = createViewerLauncher({ service, staticDirectory, tokenTtlMs, openBrowser: async () => {} });
  return { service, workspace, opportunity: batch.opportunities[0], packet, launcher };
}

async function authenticate(url: string) {
  const first = await fetch(url, { redirect: "manual" });
  const cookie = first.headers.get("set-cookie")!;
  const cleanUrl = new URL(first.headers.get("location")!, url).toString();
  return { first, cookie: cookie.split(";", 1)[0], cleanUrl };
}

async function hostileHostStatus(url: string) {
  const parsed = new URL(url);
  return new Promise<number>((resolve, reject) => {
    const outgoing = request({ hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + "api/snapshot", headers: { host: "evil.example" } }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

function api(cleanUrl: string, route: string) { return new URL(`api/${route}`, cleanUrl).toString(); }

test("builds shell-free argument-array opener specs on every supported platform", () => {
  const url = "http://127.0.0.1:4123/?token=" + "a".repeat(64);
  assert.deepEqual(browserLaunchSpec(url, "darwin"), { command: "open", args: [url], options: { shell: false, detached: true, stdio: "ignore" } });
  assert.deepEqual(browserLaunchSpec(url, "linux"), { command: "xdg-open", args: [url], options: { shell: false, detached: true, stdio: "ignore" } });
  assert.deepEqual(browserLaunchSpec(url, "win32"), { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url], options: { shell: false, detached: true, stdio: "ignore" } });
  assert.throws(() => browserLaunchSpec("https://example.test", "linux"), /127\.0\.0\.1|loopback|本机/i);
});

test("rejects a missing desktop opener without an uncaught child-process error", async () => {
  const defaultBrowserOpen = (viewerModule as { defaultBrowserOpen?: (url: string, environment?: NodeJS.ProcessEnv) => Promise<void> }).defaultBrowserOpen;
  assert.equal(typeof defaultBrowserOpen, "function", "default browser opener is not exported");
  const url = "http://127.0.0.1:4123/?token=" + "a".repeat(64);
  await assert.rejects(defaultBrowserOpen!(url, { ...process.env, PATH: "" }), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
  await new Promise((resolve) => setTimeout(resolve, 25));
});

test("binds an OS-selected loopback port and exchanges a one-use token for an independent path handle and cookie secret", async () => {
  const { service, workspace, launcher } = await fixture();
  try {
    const url = await launcher.urlFor(workspace.id);
    const parsed = new URL(url);
    assert.equal(parsed.hostname, "127.0.0.1");
    assert.notEqual(parsed.port, "0");
    assert.equal(parsed.searchParams.get("token")?.length, 64);
    const { first, cookie, cleanUrl } = await authenticate(url);
    assert.equal(first.status, 303);
    assert.match(first.headers.get("set-cookie")!, /HttpOnly/i);
    assert.match(first.headers.get("set-cookie")!, /SameSite=Strict/i);
    assert.match(first.headers.get("set-cookie")!, new RegExp(`Path=${new URL(cleanUrl).pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.equal(new URL(cleanUrl).search, "");
    assert.match(new URL(cleanUrl).pathname, /^\/s\/[0-9a-f]{64}\/$/);
    assert.equal((await fetch(url, { redirect: "manual" })).status, 401);
    const routeHandle = new URL(cleanUrl).pathname.split("/")[2];
    assert.equal((await fetch(api(cleanUrl, "snapshot"), { headers: { cookie: `viewer_session=${routeHandle}` } })).status, 401);
    assert.equal((await fetch(api(cleanUrl, "snapshot"), { headers: { cookie } })).status, 200);
  } finally { await launcher.close(); service.close(); }
});

test("rejects an expired launch token", async () => {
  const { service, workspace, launcher } = await fixture(1);
  try {
    const url = await launcher.urlFor(workspace.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal((await fetch(url, { redirect: "manual" })).status, 401);
  } finally { await launcher.close(); service.close(); }
});

test("rejects hostile Host and Origin headers and returns explicit auth errors", async () => {
  const { service, workspace, opportunity, launcher } = await fixture();
  try {
    const url = await launcher.urlFor(workspace.id);
    const { cookie, cleanUrl } = await authenticate(url);
    assert.equal((await fetch(api(cleanUrl, "snapshot"))).status, 401);
    assert.equal(await hostileHostStatus(cleanUrl), 403);
    assert.equal((await fetch(api(cleanUrl, "feedback"), { method: "POST", headers: { cookie, origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ opportunityId: opportunity.id, disposition: "interested" }) })).status, 403);
  } finally { await launcher.close(); service.close(); }
});

test("serves a workspace-scoped redacted snapshot without values, secrets, tokens, or local paths", async () => {
  const { service, workspace, launcher } = await fixture();
  try {
    const url = await launcher.urlFor(workspace.id);
    const { cookie, cleanUrl } = await authenticate(url);
    const response = await fetch(api(cleanUrl, "snapshot"), { headers: { cookie } });
    const snapshot = await response.json() as any;
    assert.equal(snapshot.workspace.id, workspace.id);
    assert.equal(snapshot.applicationPackets[0].fields.find((field: any) => field.key === "email").value, undefined);
    const serialized = JSON.stringify(snapshot);
    for (const forbidden of ["private@example.test", "candidate@example.test", ["415", "-555-2671"].join(""), "sk-live-secret", "eyJhbGciOiJIUzI1NiJ9", "user:pass", "query-secret", "audit-secret", "/Volumes", "/mnt", "/srv", `路径:${syntheticRootHome}`, `路径：${syntheticRootHome}`, `参见${syntheticRootHome}`, syntheticRootHome, "/data", "/workspace", "Bearer opaque", "cookie=session", "C:\\\\private", "\\\\server", "file:///", "viewer-data-", "storedPath", "extractedText"]) assert.equal(serialized.includes(forbidden), false, forbidden);
    assert.deepEqual(Object.keys(snapshot.trace[0]).sort(), ["endedAt", "fields", "id", "name", "runId", "startedAt", "status"].sort());
  } finally { await launcher.close(); service.close(); }
});

test("computes ATS guidance from full raw destination identity before public URL projection", async () => {
  const { service, workspace, launcher } = await fixture();
  try {
    const { cookie, cleanUrl } = await authenticate(await launcher.urlFor(workspace.id));
    const snapshot = await (await fetch(api(cleanUrl, "snapshot"), { headers: { cookie } })).json() as any;
    assert.equal(snapshot.applicationPackets[0].guidance.mode, "copy");
    assert.equal(snapshot.applicationPackets[0].guidance.auditVersion, 1);
    assert.ok(snapshot.applicationPackets[0].guidance.reasons.includes("destination_mismatch"));
    const guidance = JSON.stringify(snapshot.applicationPackets[0].guidance);
    for (const forbidden of ["user", "pass", "query-secret"]) assert.equal(guidance.includes(forbidden), false);
  } finally { await launcher.close(); service.close(); }
});

test("returns reviewed ATS guidance only when all raw destinations match exactly", async () => {
  const { service, workspace, launcher } = await fixture(undefined, true);
  try {
    const { cookie, cleanUrl } = await authenticate(await launcher.urlFor(workspace.id));
    const snapshot = await (await fetch(api(cleanUrl, "snapshot"), { headers: { cookie } })).json() as any;
    assert.deepEqual(snapshot.applicationPackets[0].guidance, { mode: "reviewed", reasons: [], auditVersion: 1 });
  } finally { await launcher.close(); service.close(); }
});

test("records every disposition, requires reasons for negative corrections, and never creates preferences", async () => {
  const { service, workspace, opportunity, launcher } = await fixture();
  try {
    const url = await launcher.urlFor(workspace.id);
    const { cookie, cleanUrl } = await authenticate(url);
    const origin = new URL(url).origin;
    const post = (body: object) => fetch(api(cleanUrl, "feedback"), { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify(body) });
    for (const disposition of ["interested", "later", "applied"]) {
      const response = await post({ opportunityId: opportunity.id, disposition });
      assert.equal(response.status, 200);
      assert.deepEqual(Object.keys(await response.json()).sort(), ["disposition", "id", "opportunityId"].sort());
    }
    for (const disposition of ["rejected", "information_error", "closed"]) {
      assert.equal((await post({ opportunityId: opportunity.id, disposition })).status, 400);
      assert.equal((await post({ opportunityId: opportunity.id, disposition, reason: "合成测试原因" })).status, 200);
    }
    const snapshot = await service.getWorkspaceSnapshot({ workspaceId: workspace.id });
    assert.equal(snapshot.feedback.length, 6);
    assert.equal(snapshot.latestPreference, null);
  } finally { await launcher.close(); service.close(); }
});

test("reviews only after all confirm fields are acknowledged and exposes no submit route", async () => {
  const { service, workspace, packet, launcher } = await fixture();
  try {
    const url = await launcher.urlFor(workspace.id);
    const { cookie, cleanUrl } = await authenticate(url);
    const origin = new URL(url).origin;
    const request = (body: object) => fetch(api(cleanUrl, "application/review"), { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify(body) });
    const confirmIds = packet.fields.filter(({ classification }) => classification === "confirm").map(({ id }) => id);
    assert.equal((await request({ packetId: packet.id, revision: packet.revision, acknowledgedFieldIds: [] })).status, 400);
    assert.equal((await request({ packetId: packet.id, revision: packet.revision - 1, acknowledgedFieldIds: confirmIds })).status, 400);
    assert.equal((await request({ packetId: "00000000-0000-4000-8000-000000000000", revision: 1, acknowledgedFieldIds: [] })).status, 404);
    assert.equal((await request({ packetId: packet.id, revision: packet.revision, acknowledgedFieldIds: confirmIds })).status, 200);
    assert.equal((await fetch(api(cleanUrl, "application/submit"), { method: "POST", headers: { cookie, origin } })).status, 404);
  } finally { await launcher.close(); service.close(); }
});

test("keeps two workspace sessions isolated by unpredictable paths and rejects crossed mutation cookies", async () => {
  const { service, workspace, opportunity, launcher } = await fixture();
  try {
    const other = await service.openWorkspace({ name: "Second workspace" });
    const firstSession = await authenticate(await launcher.urlFor(workspace.id));
    const secondSession = await authenticate(await launcher.urlFor(other.id));
    assert.notEqual(new URL(firstSession.cleanUrl).pathname, new URL(secondSession.cleanUrl).pathname);
    const firstSnapshot = await (await fetch(api(firstSession.cleanUrl, "snapshot"), { headers: { cookie: firstSession.cookie } })).json() as any;
    const secondSnapshot = await (await fetch(api(secondSession.cleanUrl, "snapshot"), { headers: { cookie: secondSession.cookie } })).json() as any;
    assert.equal(firstSnapshot.workspace.id, workspace.id);
    assert.equal(secondSnapshot.workspace.id, other.id);
    assert.equal((await fetch(api(firstSession.cleanUrl, "feedback"), { method: "POST", headers: { cookie: secondSession.cookie, origin: new URL(firstSession.cleanUrl).origin, "content-type": "application/json" }, body: JSON.stringify({ opportunityId: opportunity.id, disposition: "interested" }) })).status, 401);
  } finally { await launcher.close(); service.close(); }
});
