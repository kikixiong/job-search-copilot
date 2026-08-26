import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { JobSearchService } from "@kikixiong/job-search-copilot-core";
import { createViewerLauncher } from "../src/index.js";

async function fixture(tokenTtlMs?: number) {
  const dataRoot = await mkdtemp(join(tmpdir(), "viewer-data-"));
  const staticDirectory = await mkdtemp(join(tmpdir(), "viewer-static-"));
  await writeFile(join(staticDirectory, "index.html"), "<!doctype html><main>求职证据台</main>");
  const service = new JobSearchService({ dataRoot });
  const workspace = await service.openWorkspace({ name: "Synthetic Viewer" });
  const profile = await service.commitProfile({ workspaceId: workspace.id, baseVersion: null, profile: { headline: "Product Engineer", skills: ["TypeScript"], positioningTracks: [] } });
  const run = await service.beginSearchRun({ workspaceId: workspace.id, profileVersion: profile.version, searchBrief: { keywords: ["product engineer"], locations: ["Remote"] }, preferenceVersion: null });
  const batch = await service.recordSearchBatch({
    workspaceId: workspace.id,
    runId: run.id,
    query: { text: "product engineer", source: "synthetic" },
    opportunities: [{ kind: "job", company: "Synthetic Co", title: "Product Engineer", location: "Remote", eligibility: "eligible", evidence: { sourceUrl: "https://boards.greenhouse.io/synthetic/jobs/1", sourceType: "official", status: "open" }, match: { score: 91, factors: { skills: 95 }, reasons: ["技能匹配"], gaps: [], unknowns: [] } }]
  });
  const packet = await service.upsertApplicationPacket({ workspaceId: workspace.id, opportunityId: batch.opportunities[0].id, status: "draft", fields: [{ key: "email", label: "邮箱", value: "private@example.test" }, { key: "salary", label: "期望薪资", value: "100" }, { key: "signature", label: "签名", value: "Private Name" }] });
  await service.recordTraceEvent({ workspaceId: workspace.id, traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331", name: "viewer.synthetic", startedAt: "2026-01-01T00:00:00.000Z", status: "ok", attributes: { artifactPath: join(dataRoot, "private.txt"), note: join(dataRoot, "also-private.txt") } });
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
    const outgoing = request({ hostname: parsed.hostname, port: parsed.port, path: "/api/snapshot", headers: { host: "evil.example" } }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

test("binds an OS-selected loopback port and exchanges a one-use token for a strict cookie", async () => {
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
    assert.equal(new URL(cleanUrl).search, "");
    assert.equal((await fetch(url, { redirect: "manual" })).status, 401);
    assert.equal((await fetch(`${new URL(url).origin}/api/snapshot`, { headers: { cookie } })).status, 200);
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
    const { cookie } = await authenticate(url);
    const origin = new URL(url).origin;
    assert.equal((await fetch(`${origin}/api/snapshot`)).status, 401);
    assert.equal(await hostileHostStatus(url), 403);
    assert.equal((await fetch(`${origin}/api/feedback`, { method: "POST", headers: { cookie, origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ opportunityId: opportunity.id, disposition: "interested" }) })).status, 403);
  } finally { await launcher.close(); service.close(); }
});

test("serves a workspace-scoped redacted snapshot without values, secrets, tokens, or local paths", async () => {
  const { service, workspace, launcher } = await fixture();
  try {
    const url = await launcher.urlFor(workspace.id);
    const { cookie } = await authenticate(url);
    const response = await fetch(`${new URL(url).origin}/api/snapshot`, { headers: { cookie } });
    const snapshot = await response.json() as any;
    assert.equal(snapshot.workspace.id, workspace.id);
    assert.equal(snapshot.applicationPackets[0].fields.find((field: any) => field.key === "email").value, undefined);
    const serialized = JSON.stringify(snapshot);
    for (const forbidden of ["private@example.test", "Private Name", "viewer-data-", "token", "storedPath", "extractedText"]) assert.equal(serialized.includes(forbidden), false, forbidden);
  } finally { await launcher.close(); service.close(); }
});

test("records every disposition, requires reasons for negative corrections, and never creates preferences", async () => {
  const { service, workspace, opportunity, launcher } = await fixture();
  try {
    const url = await launcher.urlFor(workspace.id);
    const { cookie } = await authenticate(url);
    const origin = new URL(url).origin;
    const post = (body: object) => fetch(`${origin}/api/feedback`, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify(body) });
    for (const disposition of ["interested", "later", "applied"]) assert.equal((await post({ opportunityId: opportunity.id, disposition })).status, 200);
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
    const { cookie } = await authenticate(url);
    const origin = new URL(url).origin;
    const request = (body: object) => fetch(`${origin}/api/application/review`, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await request({ packetId: packet.id, acknowledgedConfirmFields: [] })).status, 400);
    assert.equal((await request({ packetId: "00000000-0000-4000-8000-000000000000", acknowledgedConfirmFields: ["salary"] })).status, 404);
    assert.equal((await request({ packetId: packet.id, acknowledgedConfirmFields: ["salary"] })).status, 200);
    assert.equal((await fetch(`${origin}/api/application/submit`, { method: "POST", headers: { cookie, origin } })).status, 404);
  } finally { await launcher.close(); service.close(); }
});
