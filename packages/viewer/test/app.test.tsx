import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { JSDOM } from "jsdom";
import React from "react";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:1234/" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
Object.defineProperty(window, "matchMedia", { configurable: true, value: (query: string) => ({ matches: query.includes("reduced-motion"), media: query, addEventListener() {}, removeEventListener() {} }) });
const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { ViewerApp } = await import("../src/app.js");
afterEach(() => cleanup());

const emptySnapshot = {
  workspace: { id: "10000000-0000-4000-8000-000000000000", name: "合成工作区", createdAt: "2026-01-01T00:00:00.000Z" },
  resumeImported: false, latestProfile: null, latestSearchBrief: null, latestPreference: null, runs: [], feedback: [], applicationPackets: [], opportunities: [], trace: []
} as any;

const populatedSnapshot = {
  workspace: { id: "10000000-0000-4000-8000-000000000000", name: "技术岗位核验", createdAt: "2026-01-01T00:00:00.000Z" },
  resumeImported: true,
  latestProfile: { version: 2, headline: "偏产品的前端工程师", skills: ["TypeScript", "React"], positioningTracks: [{ name: "产品工程", summary: "将复杂流程做成清晰产品", targetRoles: ["Product Engineer"] }], targetingConstraints: { schemaVersion: 1, status: "confirmed", targetKinds: ["internship"], employmentTypes: ["internship"], levels: ["entry"], domains: ["machine learning"], availability: "2026-09", workAuthorization: ["China"], visa: "not required", timing: "2026 autumn", hardExclusions: ["unpaid"], breadth: "balanced", unknowns: [], contradictions: [] }, createdAt: "2026-01-02T00:00:00.000Z" },
  latestSearchBrief: { version: 3, data: { keywords: ["product engineer"], locations: ["Remote"], targetingConstraints: { schemaVersion: 1, status: "confirmed", targetKinds: ["internship"], employmentTypes: ["internship"], levels: ["entry"], domains: ["machine learning"], availability: "2026-09", workAuthorization: ["China"], visa: "not required", timing: "2026 autumn", hardExclusions: ["unpaid"], breadth: "balanced", unknowns: [], contradictions: [] } }, createdAt: "2026-01-03T00:00:00.000Z" },
  latestPreference: null,
  runs: [{ id: "20000000-0000-4000-8000-000000000000", workspaceId: "10000000-0000-4000-8000-000000000000", profileVersion: 2, searchBriefVersion: 3, preferenceVersion: null, status: "failed", startedAt: "2026-01-03T00:00:00.000Z", finishedAt: "2026-01-03T00:01:00.000Z", searchBrief: { keywords: ["product engineer"], locations: ["Remote"], targetingConstraints: { schemaVersion: 1, status: "confirmed", targetKinds: ["internship"], employmentTypes: ["internship"], levels: ["entry"], domains: ["machine learning"], availability: "2026-09", workAuthorization: ["China"], visa: "not required", timing: "2026 autumn", hardExclusions: ["unpaid"], breadth: "balanced", unknowns: [], contradictions: [] } }, queryAttempts: [{ id: "q1", runId: "20000000-0000-4000-8000-000000000000", text: "official Product Engineer", source: "Synthetic board", status: "timeout", retrievedAt: "2026-01-03T00:00:30.000Z", locator: "https://boards.example.test/jobs", sourceTier: "primary", failure: { code: "TIMEOUT", summary: "Official lookup timed out" } }], summary: { queryCount: 2, sourceCount: 2, opportunityCount: 1 } }],
  feedback: [],
  opportunities: [
    { id: "30000000-0000-4000-8000-000000000000", workspaceId: "10000000-0000-4000-8000-000000000000", kind: "job", company: "合成科技", title: "Product Engineer", location: "Remote", canonicalApplyUrl: "https://boards.greenhouse.io/synthetic/jobs/1", requisitionId: "SYN-1", eligibility: "eligible", evidenceStatus: "verified_open", sourceObservations: [{ id: "o1", runId: "20000000-0000-4000-8000-000000000000", sourceUrl: "https://community.example/lead", sourceType: "community", sourceTier: "discovery", status: "lead", observedAt: "2026-01-03T00:00:00.000Z", retrievedAt: "2026-01-03T00:00:00.000Z", locator: "post#lead", confidence: "low", deadline: null, conflict: null, dedupeDecision: { action: "created", matchedBy: "none", survivorOpportunityId: "30000000-0000-4000-8000-000000000000", mergedOpportunityIds: [] } }, { id: "o2", runId: "20000000-0000-4000-8000-000000000000", sourceUrl: "https://boards.greenhouse.io/synthetic/jobs/1", sourceType: "official", sourceTier: "primary", status: "open", observedAt: "2026-01-03T00:01:00.000Z", retrievedAt: "2026-01-03T00:01:00.000Z", locator: "main#job-description", confidence: "high", deadline: "2026-02-01T00:00:00.000Z", conflict: null, dedupeDecision: { action: "matched", matchedBy: "url", survivorOpportunityId: "30000000-0000-4000-8000-000000000000", mergedOpportunityIds: [] } }], match: { runId: "20000000-0000-4000-8000-000000000000", score: 91, factors: { 技能: 95, 地点: 100 }, reasons: ["技能高度匹配"], gaps: ["行业经验待补充"], unknowns: ["薪资范围未披露"] }, createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:01:00.000Z" },
    { id: "40000000-0000-4000-8000-000000000000", workspaceId: "10000000-0000-4000-8000-000000000000", kind: "job", company: "线索公司", title: "Frontend Engineer", location: "上海", canonicalApplyUrl: null, requisitionId: null, eligibility: "unknown", evidenceStatus: "community_lead", sourceObservations: [{ id: "o3", sourceUrl: "https://community.example/2", sourceType: "community", status: "lead", observedAt: "2026-01-03T00:00:00.000Z" }], match: null, createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z" }
  ],
  applicationPackets: [{ id: "50000000-0000-4000-8000-000000000000", opportunityId: "30000000-0000-4000-8000-000000000000", status: "draft", revision: 4, audit: { version: 3, retrievedAt: new Date().toISOString(), destinationUrl: "https://boards.greenhouse.io/synthetic/jobs/1", status: "verified" }, guidance: { mode: "reviewed", reasons: [], auditVersion: 3 }, attachments: [{ name: "resume.pdf", status: "ready", locator: "packet.attachments.resume" }], unknowns: ["推荐人要求待核实"], fields: [{ id: "51000000-0000-4000-8000-000000000000", key: "email", label: "邮箱", classification: "safe", provenance: { source: "profile", locator: "profile.contact.email", reviewed: true, sensitive: false } }, { id: "52000000-0000-4000-8000-000000000000", key: "salary", label: "期望薪资", classification: "confirm", provenance: { source: "user_confirmed", locator: "conversation.salary", reviewed: true, sensitive: false } }, { id: "53000000-0000-4000-8000-000000000000", key: "signature", label: "签名", classification: "manual_only", provenance: { source: "unknown", locator: "live-form.signature", reviewed: false, sensitive: true } }], createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z" }],
  trace: [{ id: "t1", runId: "20000000-0000-4000-8000-000000000000", name: "search.source.failed", startedAt: "2026-01-03T00:00:00.000Z", endedAt: null, status: "error", fields: { source: "Synthetic board", beforeScope: "前端", afterScope: "产品工程" } }]
} as any;

test("zero state explains the next action instead of showing an empty dashboard", () => {
  render(<ViewerApp initialSnapshot={emptySnapshot} />);
  assert.ok(screen.getByText("先在 Codex 中确认求职定位"));
  assert.ok(screen.getByRole("navigation", { name: "查看区域" }));
});

test("renders profile, grouped opportunities, evidence rail, run provenance, and field classes", () => {
  render(<ViewerApp initialSnapshot={populatedSnapshot} />);
  assert.ok(screen.getByText(/偏产品的前端工程师/));
  assert.ok(screen.getByRole("heading", { name: "值得申请" }));
  assert.ok(screen.getByRole("heading", { name: "仅为线索" }));
  assert.ok(screen.getByLabelText("证据轨：Product Engineer"));
  fireEvent.click(screen.getByRole("button", { name: "搜索记录" }));
  assert.ok(screen.getByText("配置版本 2 / 3 / —"));
  assert.ok(screen.getByText("Synthetic board"));
  assert.ok(screen.getByText("前端 → 产品工程"));
  fireEvent.click(screen.getByRole("button", { name: "申请准备" }));
  assert.ok(screen.getByText("安全字段"));
  assert.ok(screen.getByText("需要确认"));
  assert.ok(screen.getByText("仅手动填写"));
  assert.ok(screen.getByText("profile.contact.email"));
  assert.ok(screen.getByText("resume.pdf"));
  assert.ok(screen.getByText("推荐人要求待核实"));
  assert.equal(screen.queryByRole("button", { name: /提交申请/ }), null);
});

test("renders confirmed targeting, structured query failures, and complete source provenance", () => {
  render(<ViewerApp initialSnapshot={populatedSnapshot} />);
  const rail = screen.getByLabelText("证据轨：Product Engineer");
  assert.ok(rail.textContent?.includes("main#job-description"));
  assert.ok(rail.textContent?.includes("primary · high"));
  assert.ok(rail.textContent?.includes("20000000-0000-4000-8000-000000000000"));
  assert.ok(rail.textContent?.includes("matched · url"));

  fireEvent.click(screen.getByRole("button", { name: "候选人档案" }));
  assert.ok(screen.getByText("machine learning"));
  assert.ok(screen.getByText("2026-09"));
  assert.ok(screen.getByText("unpaid"));

  fireEvent.click(screen.getByRole("button", { name: "搜索记录" }));
  assert.ok(screen.getByRole("heading", { name: "固定运行范围" }));
  assert.ok(screen.getByText("2026 autumn"));
  assert.ok(screen.getByText("China"));
  assert.ok(screen.getByText("Official lookup timed out"));
  assert.ok(screen.getByText(/timeout · TIMEOUT/));
  assert.ok(screen.getByText(/https:\/\/boards\.example\.test\/jobs/));
});

test("labels every displayed match score with its assessment run identity", () => {
  render(<ViewerApp initialSnapshot={populatedSnapshot} />);
  const opportunity = screen.getByRole("button", { name: /Product Engineer/ });
  assert.ok(opportunity.textContent?.includes("91"));
  assert.ok(opportunity.textContent?.includes("run 20000000-0000-4000-8000-000000000000"));
});

test("supports mobile/reduced-motion state, named keyboard controls, and click-only clipboard feedback", async () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  const writes: string[] = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { writes.push(text); } } });
  render(<ViewerApp initialSnapshot={populatedSnapshot} />);
  const shell = screen.getByTestId("viewer-shell");
  assert.equal(shell.getAttribute("data-layout"), "mobile");
  assert.equal(shell.getAttribute("data-motion"), "reduced");
  fireEvent.click(screen.getByRole("button", { name: "申请准备" }));
  const copy = screen.getByRole("button", { name: "复制 邮箱 填写指引" });
  assert.equal(copy.getAttribute("tabindex"), null);
  assert.equal(writes.length, 0);
  fireEvent.click(copy);
  await waitFor(() => assert.equal(writes.length, 1));
  assert.ok(screen.getByRole("status").textContent?.includes("已复制"));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } });
  fireEvent.click(screen.getByRole("button", { name: "复制 期望薪资 填写指引" }));
  await waitFor(() => assert.ok(screen.getByRole("status").textContent?.includes("复制失败")));
});

test("renders only the server-side ATS guidance decision, not a client URL decision", () => {
  const allowed = structuredClone(populatedSnapshot);
  render(<ViewerApp initialSnapshot={allowed} />);
  fireEvent.click(screen.getByRole("button", { name: "申请准备" }));
  assert.ok(screen.getByText("已审核 ATS 域名"));
  cleanup();

  const lookalike = structuredClone(populatedSnapshot);
  lookalike.opportunities[0].canonicalApplyUrl = "https://boards.greenhouse.io.evil.example/jobs/1";
  lookalike.applicationPackets[0].guidance = { mode: "copy", reasons: ["ats_not_reviewed"], auditVersion: 3 };
  render(<ViewerApp initialSnapshot={lookalike} />);
  fireEvent.click(screen.getByRole("button", { name: "申请准备" }));
  assert.ok(screen.getByText("复制模式"));
});

test("renders every fail-closed ATS reason as copy mode", () => {
  for (const reason of ["audit_not_verified", "audit_not_current", "destination_mismatch", "official_observation_not_open", "field_provenance_not_reviewed"]) {
    const snapshot = structuredClone(populatedSnapshot);
    snapshot.applicationPackets[0].guidance = { mode: "copy", reasons: [reason], auditVersion: 3 };
    render(<ViewerApp initialSnapshot={snapshot} />);
    fireEvent.click(screen.getByRole("button", { name: "申请准备" }));
    assert.ok(screen.getByText("复制模式"));
    cleanup();
  }
});

test("gates negative feedback reason and binds application confirmation to revision plus stable field ID", async () => {
  const requests: Array<{ url: string; body: any }> = [];
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (url: string, init: RequestInit) => { requests.push({ url, body: JSON.parse(String(init.body)) }); return new Response("{}", { status: 200, headers: { "content-type": "application/json" } }); } });
  render(<ViewerApp initialSnapshot={populatedSnapshot} />);
  fireEvent.click(screen.getByRole("button", { name: "不考虑" }));
  assert.equal(requests.length, 0);
  assert.ok(screen.getByRole("status").textContent?.includes("填写原因"));
  fireEvent.change(screen.getByRole("textbox", { name: /原因/ }), { target: { value: "岗位方向不匹配" } });
  fireEvent.click(screen.getByRole("button", { name: "不考虑" }));
  await waitFor(() => assert.equal(requests.length, 1));
  assert.deepEqual(requests[0].body, { opportunityId: "30000000-0000-4000-8000-000000000000", disposition: "rejected", reason: "岗位方向不匹配" });

  fireEvent.click(screen.getByRole("button", { name: "申请准备" }));
  assert.equal(screen.getAllByRole("checkbox").length, 1);
  assert.equal(screen.queryByRole("button", { name: "复制 签名 填写指引" }), null);
  fireEvent.click(screen.getByRole("checkbox", { name: "我已核对" }));
  fireEvent.click(screen.getByRole("button", { name: "完成材料审核" }));
  await waitFor(() => assert.equal(requests.length, 2));
  assert.deepEqual(requests[1].body, { packetId: "50000000-0000-4000-8000-000000000000", revision: 4, acknowledgedFieldIds: ["52000000-0000-4000-8000-000000000000"] });
});

test("selects the newest application packet and adopts the review response before another click", async () => {
  const snapshot = structuredClone(populatedSnapshot);
  const older = structuredClone(snapshot.applicationPackets[0]);
  older.id = "60000000-0000-4000-8000-000000000000";
  older.revision = 1;
  older.updatedAt = "2026-01-01T00:00:00.000Z";
  older.fields = [];
  snapshot.applicationPackets = [older, snapshot.applicationPackets[0]];
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: async () => new Response(JSON.stringify({ id: "50000000-0000-4000-8000-000000000000", status: "ready_for_prefill", revision: 5 }), { status: 200, headers: { "content-type": "application/json" } }) });

  render(<ViewerApp initialSnapshot={snapshot} />);
  fireEvent.click(screen.getByRole("button", { name: "申请准备" }));
  const selector = screen.getByRole("combobox", { name: "材料包选择" }) as HTMLSelectElement;
  assert.equal(selector.value, "50000000-0000-4000-8000-000000000000");
  fireEvent.click(screen.getByRole("checkbox", { name: "我已核对" }));
  fireEvent.click(screen.getByRole("button", { name: "完成材料审核" }));
  await waitFor(() => assert.equal(screen.getAllByText(/修订 5 · ready_for_prefill/).length, 2));
  assert.equal((screen.getByRole("button", { name: "完成材料审核" }) as HTMLButtonElement).disabled, true);
});

test("uses latest official evidence, lists every observation, and associates failures by exact run ID", () => {
  const snapshot = structuredClone(populatedSnapshot);
  snapshot.opportunities[0].evidenceStatus = "conflict";
  snapshot.opportunities[0].sourceObservations.push({ id: "o4", sourceUrl: "https://boards.greenhouse.io/synthetic/jobs/1", sourceType: "official", status: "closed", observedAt: "2026-01-04T00:00:00.000Z" });
  snapshot.runs.push({ ...snapshot.runs[0], id: "21000000-0000-4000-8000-000000000000", status: "failed", startedAt: "2026-01-04T00:00:00.000Z" });
  snapshot.trace = [{ ...snapshot.trace[0], id: "t2", runId: "21000000-0000-4000-8000-000000000000", startedAt: "2026-01-04T00:00:00.000Z", fields: { source: "Run two source", beforeScope: "旧", afterScope: "新" } }];
  render(<ViewerApp initialSnapshot={snapshot} />);
  assert.ok(screen.getByText("已关闭"));
  assert.equal(screen.getAllByText(/官方 ·/).length, 2);
  assert.equal(screen.getAllByText("https://boards.greenhouse.io/synthetic/jobs/1").length, 2);
  assert.ok(screen.getByText(/冲突/));
  fireEvent.click(screen.getByRole("button", { name: "搜索记录" }));
  assert.equal(screen.getAllByText("Run two source").length, 1);
});

test("labels community discovery separately and never presents updatedAt as official verification", () => {
  render(<ViewerApp initialSnapshot={populatedSnapshot} />);
  fireEvent.click(screen.getByRole("button", { name: /Frontend Engineer/ }));
  const rail = screen.getByLabelText("证据轨：Frontend Engineer");
  assert.ok(rail.textContent?.includes("尚未官方核验"));
  assert.ok(rail.textContent?.includes("线索发现时间"));
  assert.equal(rail.textContent?.includes("最后核验"), false);
  assert.equal(rail.textContent?.includes("核验时间"), false);
});

test("activates navigation from keyboard Enter and Space", () => {
  render(<ViewerApp initialSnapshot={populatedSnapshot} />);
  const profile = screen.getByRole("button", { name: "候选人档案" });
  profile.focus();
  fireEvent.keyDown(profile, { key: "Enter" });
  assert.ok(screen.getByText("已确认技能"));
  const runs = screen.getByRole("button", { name: "搜索记录" });
  runs.focus();
  fireEvent.keyDown(runs, { key: " " });
  assert.ok(screen.getByText("每次范围变化都留痕"));
});
