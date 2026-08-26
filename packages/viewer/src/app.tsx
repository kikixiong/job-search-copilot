import React, { useEffect, useMemo, useState } from "react";
import type { FeedbackDisposition, Opportunity, WorkspaceRecoverySnapshot } from "@kikixiong/job-search-copilot-core";
import { applicationGuidanceMode } from "./policy.js";

type Area = "opportunities" | "profile" | "runs" | "application";
type Snapshot = Omit<WorkspaceRecoverySnapshot, "trace"> & { trace: Array<{ id: string; runId: string | null; name: string; startedAt: string; endedAt: string | null; status: "unset" | "ok" | "error"; fields: Record<string, string | number | boolean | null> }> };

const areaLabels: Record<Area, string> = { opportunities: "机会对比", profile: "候选人档案", runs: "搜索记录", application: "申请准备" };
const dispositionLabels: Record<FeedbackDisposition, string> = { interested: "感兴趣", later: "稍后看", rejected: "不考虑", information_error: "信息有误", closed: "职位关闭", applied: "已申请" };
const negative = new Set<FeedbackDisposition>(["rejected", "information_error", "closed"]);
const classLabels = { safe: "安全字段", confirm: "需要确认", manual_only: "仅手动填写" } as const;

function useEnvironment() {
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 760);
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  useEffect(() => {
    const update = () => setMobile(window.innerWidth < 760);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return { mobile, reduced };
}

function groupFor(opportunity: Opportunity) {
  if (opportunity.evidenceStatus === "verified_open" && opportunity.eligibility === "eligible") return "worth";
  if (opportunity.evidenceStatus === "community_lead") return "lead";
  return "verify";
}

function EvidenceRail({ opportunity, reduced }: { opportunity: Opportunity; reduced: boolean }) {
  const lead = opportunity.sourceObservations.find(({ sourceType }) => sourceType === "community");
  const officialObservations = opportunity.sourceObservations.filter(({ sourceType }) => sourceType === "official").sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const official = officialObservations.at(-1);
  const checked = official?.observedAt ?? opportunity.updatedAt;
  return <aside className="evidence-panel" aria-label={`证据轨：${opportunity.title}`}>
    <p className="eyebrow">EVIDENCE CHAIN</p><h2>从线索到判断</h2>
    <ol className={`evidence-rail ${reduced ? "motion-off" : "motion-on"}`}>
      <li className={lead ? "node known" : "node unknown"}><span>社区线索</span><strong>{lead ? "已发现" : "未记录"}</strong></li>
      <li className={official ? "node verified" : "node unknown"}><span>官方来源</span><strong>{official ? (official.status === "open" ? "招聘中" : official.status === "closed" ? "已关闭" : "待确认") : "尚未核验"}</strong></li>
      <li className="node checked"><span>核验时间</span><strong>{new Date(checked).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" })}</strong></li>
      <li className={`node decision ${opportunity.evidenceStatus}`}><span>当前判断</span><strong>{opportunity.evidenceStatus === "verified_open" ? "值得申请" : opportunity.evidenceStatus === "community_lead" ? "仅为线索" : "需要核实"}</strong></li>
    </ol>
    <section className="observation-log" aria-label="全部来源观察">
      <h3>全部来源观察</h3>
      {opportunity.sourceObservations.map((observation) => <article key={observation.id}>
        <strong>{observation.sourceType === "official" ? "官方" : observation.sourceType === "community" ? "社区" : "聚合"} · {observation.status === "open" ? "开放" : observation.status === "closed" ? "关闭" : observation.status === "lead" ? "线索" : "未知"}</strong>
        <small>{observation.sourceUrl ?? "来源地址已省略"}</small>
        <span>{new Date(observation.observedAt).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" })}</span>
      </article>)}
      {opportunity.evidenceStatus === "conflict" ? <p className="conflict-note">来源观察存在冲突；以最新官方观察作为核验时间，但保留全部历史观察。</p> : null}
    </section>
    <dl className="rail-meta"><div><dt>资格</dt><dd>{opportunity.eligibility === "eligible" ? "符合" : opportunity.eligibility === "ineligible" ? "不符合" : "未知"}</dd></div><div><dt>最后核验</dt><dd>{checked.slice(0, 10)}</dd></div></dl>
  </aside>;
}

function Feedback({ opportunity }: { opportunity: Opportunity }) {
  const [selected, setSelected] = useState<FeedbackDisposition | null>(null);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  async function record(disposition: FeedbackDisposition) {
    setSelected(disposition);
    if (negative.has(disposition) && !reason.trim()) { setStatus("请先填写原因。这个反馈不会自动改变偏好。"); return; }
    const response = await fetch("api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ opportunityId: opportunity.id, disposition, ...(reason.trim() ? { reason: reason.trim() } : {}) }) });
    setStatus(response.ok ? "反馈已记录。偏好不会在这里自动更改。" : "反馈未记录，请检查后重试。");
  }
  return <section className="feedback" aria-label="记录机会反馈">
    <h3>你的判断</h3><p>这里只记录处置；偏好调整需回到 Codex 明确确认。</p>
    <div className="action-wrap">{(Object.keys(dispositionLabels) as FeedbackDisposition[]).map((item) => <button key={item} type="button" className={selected === item ? "selected" : "quiet"} onClick={() => void record(item)}>{dispositionLabels[item]}</button>)}</div>
    {selected && negative.has(selected) ? <label className="reason">原因（必填）<textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如：岗位方向不匹配" /></label> : null}
    <p role="status" aria-live="polite">{status}</p>
  </section>;
}

function Opportunities({ snapshot, reduced }: { snapshot: Snapshot; reduced: boolean }) {
  const [selectedId, setSelectedId] = useState(snapshot.opportunities[0]?.id ?? "");
  const selected = snapshot.opportunities.find(({ id }) => id === selectedId) ?? snapshot.opportunities[0];
  if (!selected) return <section className="zero-state"><p className="eyebrow">NEXT ACTION</p><h1>还没有可比较的机会</h1><p>回到 Codex 发起一次搜索并核验官方来源，结果会在这里按证据状态归组。</p></section>;
  const groups = [
    { key: "worth", label: "值得申请", items: snapshot.opportunities.filter((item) => groupFor(item) === "worth") },
    { key: "verify", label: "需要核实", items: snapshot.opportunities.filter((item) => groupFor(item) === "verify") },
    { key: "lead", label: "仅为线索", items: snapshot.opportunities.filter((item) => groupFor(item) === "lead") }
  ];
  return <><main className="results" id="main-content">
    <header className="section-heading"><div><p className="eyebrow">OPPORTUNITY DESK</p><h1>机会不是清单，是证据链</h1></div><p className="profile-chip">当前定位 · {snapshot.latestProfile?.headline ?? "尚未确认"}</p></header>
    {groups.map((group) => <section className="opportunity-group" key={group.key}><div className="group-heading"><h2>{group.label}</h2><span>{group.items.length}</span></div>{group.items.length ? group.items.map((item) => <button type="button" key={item.id} className={`opportunity-row ${selected.id === item.id ? "active" : ""}`} onClick={() => setSelectedId(item.id)} aria-pressed={selected.id === item.id}>
      <span><strong>{item.title}</strong><small>{item.company} · {item.location} · {item.kind === "job" ? "全职" : "实习"}</small></span><span className="row-score">{item.match ? item.match.score : "—"}<small>匹配</small></span>
    </button>) : <p className="empty-group">当前没有这一状态的机会。</p>}</section>)}
    <section className="detail"><h2>{selected.company} · {selected.title}</h2>{selected.match ? <><div className="factor-list">{Object.entries(selected.match.factors).map(([key, value]) => <span key={key}>{key} {value}</span>)}</div><div className="notes-grid"><div><h3>匹配理由</h3>{selected.match.reasons.map((item) => <p key={item}>{item}</p>)}</div><div><h3>差距</h3>{selected.match.gaps.map((item) => <p key={item}>{item}</p>)}</div><div><h3>未知项</h3>{selected.match.unknowns.map((item) => <p key={item}>{item}</p>)}</div></div></> : <p>尚无匹配评估；先核实官方职位要求。</p>}<Feedback opportunity={selected} /></section>
  </main><EvidenceRail opportunity={selected} reduced={reduced} /></>;
}

function Profile({ snapshot }: { snapshot: Snapshot }) {
  const profile = snapshot.latestProfile;
  if (!profile) return <main className="single-panel zero-state" id="main-content"><p className="eyebrow">NEXT ACTION</p><h1>先在 Codex 中确认求职定位</h1><p>确认目标岗位、限制条件与未知项后，这里才会显示可追溯的档案版本。</p></main>;
  return <main className="single-panel" id="main-content"><p className="eyebrow">PROFILE · V{profile.version}</p><h1>{profile.headline}</h1><div className="profile-grid"><section><h2>已确认技能</h2><div className="factor-list">{profile.skills.map((item) => <span key={item}>{item}</span>)}</div></section><section><h2>定位轨道</h2>{profile.positioningTracks.map((track) => <article key={track.name}><h3>{track.name}</h3><p>{track.summary}</p><small>{track.targetRoles.join(" / ")}</small></article>)}</section><section className="boundary"><h2>简历边界</h2><p>{snapshot.resumeImported ? "简历副本保存在本机工作区；Viewer 不返回简历正文、联系方式或本地路径。" : "尚未导入简历。导入前会说明本机保存与模型处理边界。"}</p></section><section><h2>约束与未知</h2><p>当前快照未确认的条件不会被推断；请在 Codex 中确认后生成新版本。</p></section></div></main>;
}

function Runs({ snapshot }: { snapshot: Snapshot }) {
  return <main className="single-panel" id="main-content"><p className="eyebrow">SEARCH PROVENANCE</p><h1>每次范围变化都留痕</h1>{snapshot.runs.length ? snapshot.runs.map((run) => { const failures = snapshot.trace.filter((event) => event.status === "error" && event.runId === run.id); return <article className="run-card" key={run.id}><header><div><strong>{run.searchBrief.keywords.join(" · ")}</strong><p>{run.searchBrief.locations.join(" · ") || "地点不限"}</p></div><span className={`run-status ${run.status}`}>{run.status === "completed" ? "已完成" : run.status === "failed" ? "失败" : "进行中"}</span></header><p className="mono">配置版本 {run.profileVersion} / {run.searchBriefVersion} / {run.preferenceVersion ?? "—"}</p><dl className="run-counts"><div><dt>查询</dt><dd>{run.summary.queryCount}</dd></div><div><dt>来源</dt><dd>{run.summary.sourceCount}</dd></div><div><dt>结果</dt><dd>{run.summary.opportunityCount}</dd></div></dl>{failures.map((failure) => <div className="failure" key={failure.id}><strong>{String(failure.fields.source ?? failure.name)}</strong><span>{String(failure.fields.beforeScope ?? "旧范围")} → {String(failure.fields.afterScope ?? "新范围")}</span></div>)}</article>; }) : <section className="zero-state"><h2>还没有搜索记录</h2><p>在 Codex 中开始一次搜索后，这里会显示绑定的版本、来源、结果和失败项。</p></section>}</main>;
}

function Application({ snapshot }: { snapshot: Snapshot }) {
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("");
  const packet = snapshot.applicationPackets[0];
  const opportunity = snapshot.opportunities.find(({ id }) => id === packet?.opportunityId);
  if (!packet) return <main className="single-panel zero-state" id="main-content"><p className="eyebrow">NEXT ACTION</p><h1>先选择机会并准备材料</h1><p>材料包由 Codex 生成；Viewer 只负责逐字段核对，不会提交申请。</p></main>;
  const mode = applicationGuidanceMode(opportunity, packet);
  async function copy(field: (typeof packet.fields)[number]) {
    const provenance = field.provenance;
    const guidance = `${field.label}\n来源：${provenance?.source ?? "未记录"}\n定位：${provenance?.locator ?? "未记录"}\n审核：${provenance?.reviewed ? "已审核" : "待审核"}\n请在目标页面核对后手动填写。`;
    try { await navigator.clipboard.writeText(guidance); setStatus(`已复制 ${field.label} 的来源指引。`); }
    catch { setStatus("复制失败，请手动选择填写指引。" ); }
  }
  async function review() {
    const response = await fetch("api/application/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ packetId: packet.id, revision: packet.revision, acknowledgedFieldIds: [...acknowledged] }) });
    setStatus(response.ok ? "材料包已审核，可按指引手动操作；最终提交仍由你完成。" : "仍有待确认字段，请逐项核对。" );
  }
  return <main className="single-panel" id="main-content"><p className="eyebrow">APPLICATION PACKET</p><h1>逐字段核对，不跨过人工边界</h1><div className={`policy ${mode}`}><strong>{mode === "reviewed" ? "已审核 ATS 域名" : "复制模式"}</strong><p>{mode === "reviewed" ? "当前官方页面与本材料包审核记录一致；仅提供已审核字段的手动填写指引。" : "审核记录缺失、过期、不一致或站点不在允许范围时，只提供逐字段复制指引。"}</p></div><p className="mono">材料包 {packet.id.slice(0, 8)} · 修订 {packet.revision} · {packet.status}</p>{packet.audit ? <dl className="packet-meta"><div><dt>页面审核</dt><dd>v{packet.audit.version} · {packet.audit.status}</dd></div><div><dt>核验时间</dt><dd>{new Date(packet.audit.retrievedAt).toLocaleString("zh-CN")}</dd></div><div><dt>目标页面</dt><dd>{packet.audit.destinationUrl ?? "未记录"}</dd></div></dl> : <p className="boundary-note">未记录目标页面审核。</p>}<section className="field-matrix" aria-label="申请字段分类">{packet.fields.map((field) => <article className={`field-row ${field.classification}`} key={field.id}><div><span className="classification">{classLabels[field.classification]}</span><h2>{field.label}</h2><p>{field.classification === "safe" ? "可依据已审核来源手动填写，完成后仍需核对。" : field.classification === "confirm" ? "内容可能变化，必须逐项确认。" : "保持空白并由你手动填写；不会被标记为自动填写。"}</p><dl className="provenance"><div><dt>来源</dt><dd>{field.provenance?.source ?? "未记录"}</dd></div><div><dt>定位</dt><dd>{field.provenance?.locator ?? "未记录"}</dd></div><div><dt>审核</dt><dd>{field.provenance?.reviewed ? "已审核" : "待审核"}</dd></div></dl></div><div className="field-actions">{field.classification === "confirm" ? <label><input type="checkbox" checked={acknowledged.has(field.id)} onChange={(event) => setAcknowledged((current) => { const next = new Set(current); event.target.checked ? next.add(field.id) : next.delete(field.id); return next; })} />我已核对</label> : null}{field.classification !== "manual_only" ? <button type="button" onClick={() => void copy(field)} aria-label={`复制 ${field.label} 填写指引`}>复制指引</button> : null}</div></article>)}</section><section className="packet-support"><div><h2>附件</h2>{packet.attachments.length ? packet.attachments.map((attachment) => <p key={`${attachment.name}:${attachment.locator}`}><strong>{attachment.name}</strong><span> · {attachment.status} · {attachment.locator}</span></p>) : <p>未记录附件。</p>}</div><div><h2>待确认问题</h2>{packet.unknowns.length ? packet.unknowns.map((unknown) => <p key={unknown}>{unknown}</p>) : <p>没有记录未知项。</p>}</div></section><button type="button" className="review-action" onClick={() => void review()}>完成材料审核</button><p className="boundary-note">附件、未知问题和敏感字段由你处理。这里没有登录、同意、签名、验证码、多因素认证或最终提交操作。</p><p role="status" aria-live="polite">{status}</p></main>;
}

export function ViewerApp({ initialSnapshot }: { initialSnapshot?: Snapshot }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(initialSnapshot ?? null);
  const [area, setArea] = useState<Area>(() => initialSnapshot?.latestProfile ? "opportunities" : "profile");
  const [error, setError] = useState("");
  const environment = useEnvironment();
  useEffect(() => { if (!initialSnapshot) fetch("api/snapshot").then(async (response) => { if (!response.ok) throw new Error("无法读取本机工作区。" ); setSnapshot(await response.json()); }).catch((reason: Error) => setError(reason.message)); }, [initialSnapshot]);
  const content = useMemo(() => {
    if (!snapshot) return null;
    if (area === "profile") return <Profile snapshot={snapshot} />;
    if (area === "runs") return <Runs snapshot={snapshot} />;
    if (area === "application") return <Application snapshot={snapshot} />;
    return <Opportunities snapshot={snapshot} reduced={environment.reduced} />;
  }, [area, environment.reduced, snapshot]);
  if (error) return <main className="fatal"><h1>Viewer 无法读取工作区</h1><p>{error}</p><p>回到 Codex 重新打开 Viewer。</p></main>;
  if (!snapshot) return <main className="loading" aria-busy="true">正在读取本机工作区…</main>;
  function activateFromKeyboard(event: React.KeyboardEvent<HTMLButtonElement>, item: Area) {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setArea(item); }
  }
  return <div className={`viewer-shell area-${area}`} data-testid="viewer-shell" data-layout={environment.mobile ? "mobile" : "desktop"} data-motion={environment.reduced ? "reduced" : "full"}><a className="skip-link" href="#main-content">跳到主要内容</a><header className="topbar"><div><span className="project-mark">求职证据台</span><strong>{snapshot.workspace.name}</strong></div><span className="mono">搜索版本 {snapshot.latestSearchBrief?.version ?? "—"}</span></header><nav className="sidebar" aria-label="查看区域">{(Object.keys(areaLabels) as Area[]).map((item) => <button key={item} type="button" onClick={() => setArea(item)} onKeyDown={(event) => activateFromKeyboard(event, item)} aria-current={area === item ? "page" : undefined}>{areaLabels[item]}</button>)}</nav><div className="workspace">{content}</div></div>;
}
