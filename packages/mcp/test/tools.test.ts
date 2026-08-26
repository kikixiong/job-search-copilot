import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { JobSearchService } from "@kikixiong/job-search-copilot-core";
import { createViewerLauncher } from "@kikixiong/job-search-copilot-viewer";
import { createToolRegistry, TOOL_NAMES } from "../src/tools.js";

const expectedTools = [
  "workspace_open",
  "resume_import",
  "profile_commit",
  "search_run_begin",
  "search_record_batch",
  "search_run_finish",
  "opportunities_query",
  "feedback_record",
  "application_packet_upsert",
  "application_packet_review",
  "workspace_export",
  "viewer_open"
] as const;

async function withRegistry(run: (registry: ReturnType<typeof createToolRegistry>) => Promise<void>) {
  const dataRoot = await mkdtemp(join(tmpdir(), "job-search-mcp-"));
  const service = new JobSearchService({ dataRoot });
  try {
    await run(createToolRegistry({ service }));
  } finally {
    service.close();
  }
}

test("registers exactly the twelve public tools and no submit or account-action capability", () => {
  assert.deepEqual(TOOL_NAMES, expectedTools);
  assert.equal(TOOL_NAMES.length, 12);
  for (const forbidden of ["submit", "captcha", "cookie", "email", "message", "login"]) {
    assert.equal(TOOL_NAMES.some((name) => name.includes(forbidden)), false);
  }
});

test("rejects invalid tool input before calling the service", async () => {
  await withRegistry(async (registry) => {
    await assert.rejects(registry.invoke("workspace_open", { name: "", unexpected: true }), /too small|unrecognized/i);
    await assert.rejects(registry.invoke("search_record_batch", { workspaceId: "x", runId: "y", opportunities: [{ kind: "contract" }] }), /invalid|job|internship/i);
  });
});

test("runs a representative workspace-profile-search-opportunity vertical path through handlers", async () => {
  await withRegistry(async (registry) => {
    const workspace = await registry.invoke("workspace_open", { name: "Vertical" });
    const profile = await registry.invoke("profile_commit", {
      workspaceId: workspace.id,
      baseVersion: null,
      profile: { headline: "Analyst", skills: ["SQL"], positioningTracks: [] }
    });
    const run = await registry.invoke("search_run_begin", {
      workspaceId: workspace.id,
      profileVersion: profile.version,
      searchBrief: { keywords: ["analyst"], locations: ["Remote"] },
      preferenceVersion: null
    });
    await registry.invoke("search_record_batch", {
      workspaceId: workspace.id,
      runId: run.id,
      opportunities: [{
        kind: "job",
        company: "Synthetic Co",
        title: "Analyst",
        location: "Remote",
        eligibility: "unknown",
        evidence: { sourceUrl: "https://example.test/job", sourceType: "official", status: "open" }
      }]
    });
    const opportunities = await registry.invoke("opportunities_query", { workspaceId: workspace.id });
    assert.equal(opportunities.length, 1);
    assert.equal(opportunities[0].evidenceStatus, "verified_open");
    const finished = await registry.invoke("search_run_finish", { workspaceId: workspace.id, runId: run.id });
    assert.equal(finished.status, "completed");
  });
});

test("returns a redacted, versioned recovery snapshot through workspace_export without adding tools", async () => {
  await withRegistry(async (registry) => {
    const workspace = await registry.invoke("workspace_open", { name: "Snapshot MCP" });
    const profile = await registry.invoke("profile_commit", {
      workspaceId: workspace.id,
      baseVersion: null,
      profile: { headline: "Synthetic Analyst", skills: ["SQL"], positioningTracks: [{ name: "Analytics", summary: "Evidence", targetRoles: ["Analyst"] }] }
    });
    const firstRun = await registry.invoke("search_run_begin", {
      workspaceId: workspace.id,
      profileVersion: profile.version,
      searchBrief: { keywords: ["analyst"], locations: ["Remote"] },
      preferenceVersion: null
    });
    const batch = await registry.invoke("search_record_batch", {
      workspaceId: workspace.id,
      runId: firstRun.id,
      query: { text: "synthetic analyst", source: "test" },
      opportunities: [{ kind: "job", company: "Synthetic Co", title: "Analyst", location: "Remote", eligibility: "eligible", evidence: { sourceUrl: "https://example.test/job", sourceType: "official", status: "open" } }]
    });
    const feedback = await registry.invoke("feedback_record", {
      workspaceId: workspace.id,
      opportunityId: batch.opportunities[0].id,
      disposition: "interested",
      confirmedPreferenceSnapshot: { preferredLocations: ["Remote"], preferredRoles: ["Analyst"], notes: "Synthetic preference" },
      preferenceBaseVersion: null
    });
    const secondRun = await registry.invoke("search_run_begin", {
      workspaceId: workspace.id,
      profileVersion: profile.version,
      searchBrief: { keywords: ["product analyst"], locations: ["Remote"] },
      preferenceVersion: feedback.preferenceVersion
    });
    await registry.invoke("search_run_finish", { workspaceId: workspace.id, runId: secondRun.id });
    const packet = await registry.invoke("application_packet_upsert", {
      workspaceId: workspace.id,
      opportunityId: batch.opportunities[0].id,
      status: "draft",
      fields: [{ key: "email", label: "Email", value: "private@example.test" }, { key: "cover_letter", label: "Cover letter", value: "Private Cover Letter" }]
    });
    await registry.invoke("application_packet_review", { workspaceId: workspace.id, packetId: packet.id, revision: packet.revision, acknowledgedFieldIds: packet.fields.filter((field: { classification: string }) => field.classification === "confirm").map((field: { id: string }) => field.id) });

    const exported = await registry.invoke("workspace_export", { workspaceId: workspace.id, format: "json", includeContent: true });
    assert.deepEqual(TOOL_NAMES, expectedTools);
    assert.equal(exported.snapshot.workspace.id, workspace.id);
    assert.equal(exported.snapshot.latestProfile.positioningTracks[0].name, "Analytics");
    assert.equal(exported.snapshot.latestSearchBrief.version, 2);
    assert.equal(exported.snapshot.latestPreference.version, 1);
    assert.equal(exported.snapshot.runs.length, 2);
    assert.equal(exported.snapshot.runs.find((run: { id: string }) => run.id === firstRun.id).summary.opportunityCount, 1);
    assert.equal(exported.snapshot.feedback[0].reason, null);
    assert.equal(exported.snapshot.applicationPackets[0].status, "ready_for_prefill");
    const emailField = exported.snapshot.applicationPackets[0].fields.find((field: { key: string }) => field.key === "email");
    assert.deepEqual({ key: emailField.key, label: emailField.label, classification: emailField.classification, provenance: emailField.provenance }, { key: "email", label: "Email", classification: "safe", provenance: null });
    assert.match(emailField.id, /^[0-9a-f-]{36}$/i);
    const serialized = JSON.stringify(exported.snapshot);
    for (const secret of ["private@example.test", "Private Cover Letter"]) assert.equal(serialized.includes(secret), false);
  });
});

test("workspace_export public recovery projection fails closed on paths, credentials, and secret URLs", async () => {
  await withRegistry(async (registry) => {
    const workspace = await registry.invoke("workspace_open", { name: "Recovery 路径：/root/private/resume.pdf,backup=/secure/private/resume.pdf" });
    const profile = await registry.invoke("profile_commit", { workspaceId: workspace.id, baseVersion: null, profile: { headline: "Bearer opaque-session-value", skills: ["SQL", "cookie=session-value", "/data/private/a"], positioningTracks: [{ name: "Analytics", summary: "/workspace/private/a", targetRoles: ["路径:/root", "参见/root/private/resume.pdf", "Analyst,/secure/private"] }] } });
    const run = await registry.invoke("search_run_begin", { workspaceId: workspace.id, profileVersion: profile.version, searchBrief: { keywords: ["credential=private-value"], locations: ["Remote"] }, preferenceVersion: null });
    const batch = await registry.invoke("search_record_batch", { workspaceId: workspace.id, runId: run.id, opportunities: [{ kind: "job", company: "Synthetic", title: "Analyst", location: "Remote", canonicalApplyUrl: "https://example.test/jobs/private@example.test?keep=public", eligibility: "eligible", evidence: { sourceUrl: "https://user:pass@example.test/jobs/1?keep=public", sourceType: "official", status: "open" }, match: { score: 80, factors: { skills: 90 }, reasons: ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature"], gaps: ["session=hidden"], unknowns: [] } }] });
    await registry.invoke("feedback_record", { workspaceId: workspace.id, opportunityId: batch.opportunities[0].id, disposition: "interested", reason: "cookie=session-value" });
    await registry.invoke("application_packet_upsert", { workspaceId: workspace.id, opportunityId: batch.opportunities[0].id, status: "draft", fields: [{ key: "email", label: "Email", value: "private@example.test", provenance: { source: "profile", locator: "/root/profile/contact", reviewed: true, sensitive: false } }] });
    const exported = await registry.invoke("workspace_export", { workspaceId: workspace.id, format: "json", includeContent: true });
    const serialized = JSON.stringify(exported.snapshot);
    const exportedFile = await readFile(exported.path, "utf8");
    for (const forbidden of ["路径:/root", "路径：/root", "参见/root", "/root", "/secure", "/data", "/workspace", "opaque-session-value", "cookie=session-value", "credential=private-value", "private@example.test", "user:pass", "eyJhbGciOiJIUzI1NiJ9", "session=hidden"]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
      assert.equal(exportedFile.includes(forbidden), false, `file:${forbidden}`);
    }
    assert.equal(exported.snapshot.opportunities[0].canonicalApplyUrl, null);
    assert.equal(exported.snapshot.opportunities[0].sourceObservations[0].sourceUrl, null);
    assert.ok(serialized.includes("Analytics"));
    assert.deepEqual(TOOL_NAMES, expectedTools);
  });
});

test("viewer_open reports unavailable without Task 4 and refuses non-loopback launch URLs", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "job-search-mcp-viewer-"));
  const service = new JobSearchService({ dataRoot });
  try {
    const workspace = await service.openWorkspace({ name: "Viewer" });
    const unavailable = await createToolRegistry({ service }).invoke("viewer_open", { workspaceId: workspace.id });
    assert.deepEqual(unavailable, { available: false, reason: "Viewer launcher is not installed." });

    let opened = false;
    const unsafeRegistry = createToolRegistry({
      service,
      viewerLauncher: {
        urlFor: async () => "https://example.com/viewer",
        open: async () => { opened = true; }
      }
    });
    const unsafe = await unsafeRegistry.invoke("viewer_open", { workspaceId: workspace.id });
    assert.equal(unsafe.available, false);
    assert.match(unsafe.reason, /loopback/i);
    assert.equal(opened, false);
  } finally {
    service.close();
  }
});

test("viewer_open starts the real loopback launcher through an in-memory handler", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "job-search-mcp-real-viewer-"));
  const service = new JobSearchService({ dataRoot });
  let opened = "";
  const viewerLauncher = createViewerLauncher({ service, openBrowser: async (url) => { opened = url; } });
  try {
    const workspace = await service.openWorkspace({ name: "Real Viewer" });
    const result = await createToolRegistry({ service, viewerLauncher }).invoke("viewer_open", { workspaceId: workspace.id });
    assert.equal(result.available, true);
    assert.equal(opened, result.url);
    assert.equal(new URL(result.url).hostname, "127.0.0.1");
    assert.equal(new URL(result.url).protocol, "http:");
  } finally {
    await viewerLauncher.close();
    service.close();
  }
});

test("feedback_record preserves an optional reason without changing the twelve-tool contract", async () => {
  await withRegistry(async (registry) => {
    const workspace = await registry.invoke("workspace_open", { name: "Reason MCP" });
    const profile = await registry.invoke("profile_commit", { workspaceId: workspace.id, baseVersion: null, profile: { headline: "Engineer", skills: [], positioningTracks: [] } });
    const run = await registry.invoke("search_run_begin", { workspaceId: workspace.id, profileVersion: profile.version, searchBrief: { keywords: ["engineer"], locations: [] }, preferenceVersion: null });
    const batch = await registry.invoke("search_record_batch", { workspaceId: workspace.id, runId: run.id, opportunities: [{ kind: "job", company: "Synthetic", title: "Engineer", location: "Remote", eligibility: "unknown", evidence: { sourceUrl: "https://example.test/job", sourceType: "community", status: "lead" } }] });
    await assert.rejects(registry.invoke("feedback_record", { workspaceId: workspace.id, opportunityId: batch.opportunities[0].id, disposition: "information_error" }), /reason|required|原因/i);
    const feedback = await registry.invoke("feedback_record", { workspaceId: workspace.id, opportunityId: batch.opportunities[0].id, disposition: "information_error", reason: "来源信息不准确" });
    assert.equal(feedback.reason, "来源信息不准确");
    assert.equal(feedback.preferenceVersion, null);
    assert.deepEqual(TOOL_NAMES, expectedTools);
  });
});

test("MCP packet review uses the same revision and stable-field service invariant", async () => {
  await withRegistry(async (registry) => {
    const workspace = await registry.invoke("workspace_open", { name: "Packet MCP invariant" });
    await assert.rejects(registry.invoke("application_packet_upsert", { workspaceId: workspace.id, status: "draft", fields: [{ key: "signature", label: "签名", value: "not allowed" }] }), /manual.only|blank|手动/i);
    const packet = await registry.invoke("application_packet_upsert", {
      workspaceId: workspace.id,
      status: "draft",
      fields: [{ key: "salary", label: "期望薪资", value: "100", provenance: { source: "user_confirmed", locator: "conversation.salary", reviewed: true, sensitive: false } }],
      attachments: [], unknowns: []
    });
    const confirm = packet.fields[0];
    await assert.rejects(registry.invoke("application_packet_review", { workspaceId: workspace.id, packetId: packet.id }), /revision|acknowledged|invalid|required/i);
    const reviewed = await registry.invoke("application_packet_review", { workspaceId: workspace.id, packetId: packet.id, revision: packet.revision, acknowledgedFieldIds: [confirm.id] });
    assert.equal(reviewed.status, "ready_for_prefill");
    assert.equal(reviewed.revision, packet.revision + 1);
    assert.deepEqual(TOOL_NAMES, expectedTools);
  });
});
