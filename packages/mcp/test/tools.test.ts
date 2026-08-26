import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { JobSearchService } from "@kikixiong/job-search-copilot-core";
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
    await registry.invoke("application_packet_review", { workspaceId: workspace.id, packetId: packet.id });

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
    assert.deepEqual(exported.snapshot.applicationPackets[0].fields.find((field: { key: string }) => field.key === "email"), { key: "email", label: "Email", classification: "safe" });
    const serialized = JSON.stringify(exported.snapshot);
    for (const secret of ["private@example.test", "Private Cover Letter"]) assert.equal(serialized.includes(secret), false);
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
