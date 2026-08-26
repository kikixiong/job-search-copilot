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

test("search_record_batch keeps a rediscovered survivor scoped to the current run", async () => {
  await withRegistry(async (registry) => {
    const workspace = await registry.invoke("workspace_open", { name: "Batch run scope" });
    const profile = await registry.invoke("profile_commit", {
      workspaceId: workspace.id,
      baseVersion: null,
      profile: { headline: "Engineer", skills: ["TypeScript"], positioningTracks: [] }
    });
    const runA = await registry.invoke("search_run_begin", {
      workspaceId: workspace.id,
      profileVersion: profile.version,
      searchBrief: { keywords: ["engineer A"], locations: ["Remote"] },
      preferenceVersion: null
    });
    await registry.invoke("search_record_batch", {
      workspaceId: workspace.id,
      runId: runA.id,
      opportunities: [{
        kind: "job",
        company: "Scoped Synthetic",
        title: "Engineer",
        location: "Remote",
        canonicalApplyUrl: "https://jobs.example.test/scoped-survivor",
        eligibility: "eligible",
        evidence: { sourceUrl: "https://jobs.example.test/scoped-survivor", sourceType: "official", status: "open" },
        match: { score: 99, factors: { skills: 99 }, reasons: ["run A only"], gaps: [], unknowns: [] }
      }]
    });
    await registry.invoke("search_run_finish", { workspaceId: workspace.id, runId: runA.id });

    const runB = await registry.invoke("search_run_begin", {
      workspaceId: workspace.id,
      profileVersion: profile.version,
      searchBrief: { keywords: ["engineer B"], locations: ["Remote"] },
      preferenceVersion: null
    });
    const batchB = await registry.invoke("search_record_batch", {
      workspaceId: workspace.id,
      runId: runB.id,
      opportunities: [{
        kind: "job",
        company: "Scoped Synthetic",
        title: "Engineer",
        location: "Remote",
        canonicalApplyUrl: "https://jobs.example.test/scoped-survivor",
        eligibility: "eligible",
        evidence: { sourceUrl: "https://community.example.test/scoped-survivor", sourceType: "community", status: "lead" }
      }]
    });

    assert.equal(batchB.opportunities[0].evidenceStatus, "community_lead");
    assert.deepEqual(batchB.opportunities[0].sourceObservations.map((observation: { runId: string }) => observation.runId), [runB.id]);
    assert.equal(batchB.opportunities[0].match, null);
    const scopedB = await registry.invoke("opportunities_query", { workspaceId: workspace.id, runId: runB.id });
    assert.equal(scopedB[0].evidenceStatus, "community_lead");
    assert.deepEqual(scopedB[0].sourceObservations.map((observation: { runId: string }) => observation.runId), [runB.id]);
    assert.equal(scopedB[0].match, null);
    assert.deepEqual(TOOL_NAMES, expectedTools);
  });
});

test("persists structured source failures and exact-run provenance through MCP recovery and Viewer", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "job-search-mcp-provenance-"));
  const service = new JobSearchService({ dataRoot });
  const launcher = createViewerLauncher({ service, openBrowser: async () => {} });
  const registry = createToolRegistry({ service, viewerLauncher: launcher });
  try {
    const constraints = {
      schemaVersion: 1,
      status: "confirmed",
      targetKinds: ["internship"],
      employmentTypes: ["internship"],
      levels: ["entry"],
      domains: ["machine learning"],
      availability: "2026-09",
      workAuthorization: ["China"],
      visa: "not required",
      timing: "2026 autumn recruiting",
      hardExclusions: ["unpaid"],
      breadth: "balanced",
      unknowns: [],
      contradictions: []
    };
    const workspace = await registry.invoke("workspace_open", { name: "Vertical provenance" });
    const profile = await registry.invoke("profile_commit", {
      workspaceId: workspace.id,
      baseVersion: null,
      profile: { headline: "ML internship candidate", skills: ["Python"], positioningTracks: [], targetingConstraints: constraints }
    });
    const run = await registry.invoke("search_run_begin", {
      workspaceId: workspace.id,
      profileVersion: profile.version,
      searchBrief: { keywords: ["machine learning intern"], locations: ["Shanghai"], targetingConstraints: constraints },
      preferenceVersion: null
    });
    await registry.invoke("search_record_batch", {
      workspaceId: workspace.id,
      runId: run.id,
      query: { text: "site:careers.example.test ML intern", source: "Example careers", status: "timeout", retrievedAt: "2026-08-27T01:00:00.000Z", locator: "https://careers.example.test/search?q=ml", sourceTier: "primary", failure: { code: "TIMEOUT", summary: "Official lookup timed out" } },
      opportunities: []
    });
    await registry.invoke("search_record_batch", {
      workspaceId: workspace.id,
      runId: run.id,
      query: { text: "Example ATS ML intern", source: "Example ATS", status: "blocked", retrievedAt: "2026-08-27T01:01:00.000Z", locator: "https://ats.example.test/jobs", sourceTier: "primary", failure: { code: "HTTP_403", summary: "Official ATS returned 403" } },
      opportunities: []
    });
    const social = await registry.invoke("search_record_batch", {
      workspaceId: workspace.id,
      runId: run.id,
      query: { text: "Example ML internship lead", source: "Community index", status: "success", retrievedAt: "2026-08-27T01:02:00.000Z", locator: "https://community.example.test/posts/17", sourceTier: "discovery" },
      opportunities: [{ kind: "internship", company: "Example Research", title: "ML Intern", location: "Shanghai", canonicalApplyUrl: "https://jobs.example.test/ml-intern", eligibility: "eligible", evidence: { sourceUrl: "https://community.example.test/posts/17", sourceType: "community", sourceTier: "discovery", status: "lead", locator: "post#17", confidence: "low", retrievedAt: "2026-08-27T01:02:00.000Z", deadline: null }, match: { score: 75, factors: { skills: 75 }, reasons: ["Python"], gaps: [], unknowns: [] } }]
    });
    await registry.invoke("search_record_batch", {
      workspaceId: workspace.id,
      runId: run.id,
      query: { text: "Example Research ML Intern official", source: "Example ATS", status: "success", retrievedAt: "2026-08-27T01:03:00.000Z", locator: "https://jobs.example.test/ml-intern", sourceTier: "primary" },
      opportunities: [{ kind: "internship", company: "Example Research", title: "ML Intern", location: "Shanghai", canonicalApplyUrl: "https://jobs.example.test/ml-intern", eligibility: "eligible", evidence: { sourceUrl: "https://jobs.example.test/ml-intern", sourceType: "official", sourceTier: "primary", status: "open", locator: "main#job-description", confidence: "high", retrievedAt: "2026-08-27T01:03:00.000Z", deadline: "2026-09-30T23:59:59.000Z", conflict: { kind: "lifecycle", summary: "No conflicting official observation", relatedLocator: "post#17" } }, match: { score: 88, factors: { skills: 88 }, reasons: ["Official requirements match"], gaps: [], unknowns: [] } }]
    });
    await registry.invoke("search_run_finish", { workspaceId: workspace.id, runId: run.id });

    const exported = await registry.invoke("workspace_export", { workspaceId: workspace.id, format: "json", includeContent: true });
    const recoveredRun = exported.snapshot.runs.find((item: { id: string }) => item.id === run.id);
    assert.deepEqual(recoveredRun.queryAttempts.map((attempt: { status: string }) => attempt.status), ["timeout", "blocked", "success", "success"]);
    assert.deepEqual(recoveredRun.queryAttempts.slice(0, 2).map((attempt: { failure: { code: string } }) => attempt.failure.code), ["TIMEOUT", "HTTP_403"]);
    assert.deepEqual(recoveredRun.searchBrief.targetingConstraints, constraints);
    const recoveredOpportunity = exported.snapshot.opportunities.find((item: { id: string }) => item.id === social.opportunities[0].id);
    assert.deepEqual(recoveredOpportunity.sourceObservations.map((observation: { runId: string }) => observation.runId), [run.id, run.id]);
    assert.equal(recoveredOpportunity.sourceObservations[1].locator, "main#job-description");
    assert.equal(recoveredOpportunity.sourceObservations[1].sourceTier, "primary");
    assert.equal(recoveredOpportunity.sourceObservations[1].confidence, "high");
    assert.equal(recoveredOpportunity.sourceObservations[1].retrievedAt, "2026-08-27T01:03:00.000Z");
    assert.equal(recoveredOpportunity.sourceObservations[1].dedupeDecision.action, "matched");
    assert.equal(recoveredOpportunity.match.runId, run.id);

    const scoped = await registry.invoke("opportunities_query", { workspaceId: workspace.id, runId: run.id });
    assert.equal(scoped[0].match.runId, run.id);
    assert.deepEqual(scoped[0].sourceObservations.map((observation: { runId: string }) => observation.runId), [run.id, run.id]);

    const viewerLaunch = await registry.invoke("viewer_open", { workspaceId: workspace.id });
    const tokenResponse = await fetch(viewerLaunch.url, { redirect: "manual" });
    const cleanUrl = new URL(tokenResponse.headers.get("location")!, viewerLaunch.url);
    const cookie = tokenResponse.headers.get("set-cookie")!.split(";", 1)[0];
    const viewerSnapshot = await (await fetch(new URL("api/snapshot", cleanUrl), { headers: { cookie } })).json() as any;
    const viewerRun = viewerSnapshot.runs.find((item: { id: string }) => item.id === run.id);
    assert.deepEqual(viewerRun.queryAttempts.slice(0, 2).map((attempt: { status: string }) => attempt.status), ["timeout", "blocked"]);
    assert.equal(viewerSnapshot.opportunities[0].sourceObservations[1].runId, run.id);
    assert.equal(viewerSnapshot.opportunities[0].sourceObservations[1].locator, "main#job-description");
    assert.deepEqual(TOOL_NAMES, expectedTools);
  } finally {
    await launcher.close();
    service.close();
  }
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
    const rootHome = ["/ro", "ot"].join("");
    const bearer = ["Bear", "er opaque-session-value"].join("");
    const workspace = await registry.invoke("workspace_open", { name: `Recovery 路径：${rootHome}/private/resume.pdf,backup=/secure/private/resume.pdf` });
    const profile = await registry.invoke("profile_commit", { workspaceId: workspace.id, baseVersion: null, profile: { headline: bearer, skills: ["SQL", "cookie=session-value", "/data/private/a"], positioningTracks: [{ name: "Analytics", summary: "/workspace/private/a", targetRoles: [`路径:${rootHome}`, `参见${rootHome}/private/resume.pdf`, "Analyst,/secure/private"] }] } });
    const run = await registry.invoke("search_run_begin", { workspaceId: workspace.id, profileVersion: profile.version, searchBrief: { keywords: ["credential=private-value"], locations: ["Remote"] }, preferenceVersion: null });
    const batch = await registry.invoke("search_record_batch", { workspaceId: workspace.id, runId: run.id, opportunities: [{ kind: "job", company: "Synthetic", title: "Analyst", location: "Remote", canonicalApplyUrl: "https://example.test/jobs/private@example.test?keep=public", eligibility: "eligible", evidence: { sourceUrl: "https://user:pass@example.test/jobs/1?keep=public", sourceType: "official", status: "open" }, match: { score: 80, factors: { skills: 90 }, reasons: ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature"], gaps: ["session=hidden"], unknowns: [] } }] });
    await registry.invoke("feedback_record", { workspaceId: workspace.id, opportunityId: batch.opportunities[0].id, disposition: "interested", reason: "cookie=session-value" });
    await registry.invoke("application_packet_upsert", { workspaceId: workspace.id, opportunityId: batch.opportunities[0].id, status: "draft", fields: [{ key: "email", label: "Email", value: "private@example.test", provenance: { source: "profile", locator: `${rootHome}/profile/contact`, reviewed: true, sensitive: false } }] });
    const exported = await registry.invoke("workspace_export", { workspaceId: workspace.id, format: "json", includeContent: true });
    const serialized = JSON.stringify(exported.snapshot);
    const exportedFile = await readFile(exported.path, "utf8");
    for (const forbidden of [`路径:${rootHome}`, `路径：${rootHome}`, `参见${rootHome}`, rootHome, "/secure", "/data", "/workspace", "opaque-session-value", "cookie=session-value", "credential=private-value", "private@example.test", "user:pass", "eyJhbGciOiJIUzI1NiJ9", "session=hidden"]) {
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

test("viewer_open returns a structured unavailable result when the desktop opener is missing", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "job-search-mcp-missing-opener-"));
  const service = new JobSearchService({ dataRoot });
  try {
    const workspace = await service.openWorkspace({ name: "Missing opener" });
    const registry = createToolRegistry({
      service,
      viewerLauncher: {
        urlFor: async () => "http://127.0.0.1:4123/?token=" + "a".repeat(64),
        open: async () => { throw Object.assign(new Error("spawn xdg-open ENOENT"), { code: "ENOENT" }); }
      }
    });
    const result = await registry.invoke("viewer_open", { workspaceId: workspace.id });
    assert.deepEqual(result, { available: false, reason: "Desktop browser opener is unavailable.", code: "browser_open_failed" });
    assert.deepEqual(TOOL_NAMES, expectedTools);
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

test("MCP rejects populated multilingual consent, signature, and final-action fields", async () => {
  await withRegistry(async (registry) => {
    const workspace = await registry.invoke("workspace_open", { name: "MCP multilingual manual controls" });
    for (const field of [
      { key: "primary_action", label: "最终提交" },
      { key: "terms", label: "同意条款" },
      { key: "e_signature", label: "电子签名" },
      { key: "submit", label: "Submit" }
    ]) {
      await assert.rejects(registry.invoke("application_packet_upsert", { workspaceId: workspace.id, status: "draft", fields: [{ ...field, value: "must-not-persist" }] }), /manual.only|blank|手动/i);
    }
    assert.deepEqual(TOOL_NAMES, expectedTools);
  });
});
