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
  latestProfile: { version: 2, headline: "偏产品的前端工程师", skills: ["TypeScript", "React"], positioningTracks: [{ name: "产品工程", summary: "将复杂流程做成清晰产品", targetRoles: ["Product Engineer"] }], createdAt: "2026-01-02T00:00:00.000Z" },
  latestSearchBrief: { version: 3, data: { keywords: ["product engineer"], locations: ["Remote"] }, createdAt: "2026-01-03T00:00:00.000Z" },
  latestPreference: null,
  runs: [{ id: "20000000-0000-4000-8000-000000000000", workspaceId: "10000000-0000-4000-8000-000000000000", profileVersion: 2, searchBriefVersion: 3, preferenceVersion: null, status: "failed", startedAt: "2026-01-03T00:00:00.000Z", finishedAt: "2026-01-03T00:01:00.000Z", searchBrief: { keywords: ["product engineer"], locations: ["Remote"] }, summary: { queryCount: 2, sourceCount: 2, opportunityCount: 1 } }],
  feedback: [],
  opportunities: [
    { id: "30000000-0000-4000-8000-000000000000", workspaceId: "10000000-0000-4000-8000-000000000000", kind: "job", company: "合成科技", title: "Product Engineer", location: "Remote", canonicalApplyUrl: "https://boards.greenhouse.io/synthetic/jobs/1", requisitionId: "SYN-1", eligibility: "eligible", evidenceStatus: "verified_open", sourceObservations: [{ id: "o1", sourceUrl: "https://community.example/lead", sourceType: "community", status: "lead", observedAt: "2026-01-03T00:00:00.000Z" }, { id: "o2", sourceUrl: "https://boards.greenhouse.io/synthetic/jobs/1", sourceType: "official", status: "open", observedAt: "2026-01-03T00:01:00.000Z" }], match: { score: 91, factors: { 技能: 95, 地点: 100 }, reasons: ["技能高度匹配"], gaps: ["行业经验待补充"], unknowns: ["薪资范围未披露"] }, createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:01:00.000Z" },
    { id: "40000000-0000-4000-8000-000000000000", workspaceId: "10000000-0000-4000-8000-000000000000", kind: "job", company: "线索公司", title: "Frontend Engineer", location: "上海", canonicalApplyUrl: null, requisitionId: null, eligibility: "unknown", evidenceStatus: "community_lead", sourceObservations: [{ id: "o3", sourceUrl: "https://community.example/2", sourceType: "community", status: "lead", observedAt: "2026-01-03T00:00:00.000Z" }], match: null, createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z" }
  ],
  applicationPackets: [{ id: "50000000-0000-4000-8000-000000000000", opportunityId: "30000000-0000-4000-8000-000000000000", status: "draft", fields: [{ key: "email", label: "邮箱", classification: "safe" }, { key: "salary", label: "期望薪资", classification: "confirm" }, { key: "signature", label: "签名", classification: "manual_only" }], createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z" }],
  trace: [{ id: "t1", workspaceId: "10000000-0000-4000-8000-000000000000", traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331", parentSpanId: null, name: "search.source.failed", startedAt: "2026-01-03T00:00:00.000Z", endedAt: null, status: "error", attributes: { source: "Synthetic board", beforeScope: "前端", afterScope: "产品工程" } }]
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
  assert.equal(screen.queryByRole("button", { name: /提交申请/ }), null);
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

test("allows reviewed guidance only for exact HTTPS ATS hosts and fails closed for lookalikes", () => {
  const allowed = structuredClone(populatedSnapshot);
  render(<ViewerApp initialSnapshot={allowed} />);
  fireEvent.click(screen.getByRole("button", { name: "申请准备" }));
  assert.ok(screen.getByText("已审核 ATS 域名"));
  cleanup();

  const lookalike = structuredClone(populatedSnapshot);
  lookalike.opportunities[0].canonicalApplyUrl = "https://boards.greenhouse.io.evil.example/jobs/1";
  render(<ViewerApp initialSnapshot={lookalike} />);
  fireEvent.click(screen.getByRole("button", { name: "申请准备" }));
  assert.ok(screen.getByText("复制模式"));
});
