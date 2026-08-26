import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

import {
  classifyApplicationField,
  deriveEvidenceStatus,
  feedbackDispositionSchema,
  opportunityInputSchema,
  opportunityKeys,
  preferenceSnapshotDataSchema,
  profileDataSchema,
  redactTraceAttributes,
  searchBriefDataSchema,
  type ApplicationFieldClassification,
  type Eligibility,
  type EvidenceStatus,
  type FeedbackDisposition,
  type OpportunityInput,
  type PreferenceSnapshotData,
  type ProfileData,
  type SearchBriefData
} from "./domain.js";
import { inspectResume, storeResumeCopy } from "./resume.js";
import { defaultDataRoot, ensureGeneratedDirectory, openDatabase, resolveInside, writeGeneratedFile } from "./storage.js";

export interface JobSearchServiceOptions { dataRoot?: string }
export interface Workspace { id: string; name: string; attachmentDirectory: string; exportDirectory: string; createdAt: string }
export interface ImportedResume { id: string; workspaceId: string; originalName: string; storedPath: string; sha256: string; extractedText: string; createdAt: string }
export interface CandidateProfileVersion { id: string; workspaceId: string; version: number; profile: ProfileData; createdAt: string }
export interface SearchRun { id: string; workspaceId: string; profileVersion: number; searchBriefVersion: number; preferenceVersion: number | null; status: "running" | "completed" | "failed"; startedAt: string; finishedAt: string | null }
export interface SourceObservation { id: string; sourceUrl: string; sourceType: "official" | "community"; status: "open" | "closed" | "lead"; observedAt: string }
export interface MatchAssessment { score: number; factors: Record<string, number>; reasons: string[]; gaps: string[]; unknowns: string[] }
export interface Opportunity { id: string; workspaceId: string; kind: "job" | "internship"; company: string; title: string; location: string; canonicalApplyUrl: string | null; requisitionId: string | null; eligibility: Eligibility; evidenceStatus: EvidenceStatus; sourceObservations: SourceObservation[]; match: MatchAssessment | null; createdAt: string; updatedAt: string }
export interface ApplicationField { id: string; key: string; label: string; value: string; classification: ApplicationFieldClassification }
export interface ApplicationPacket { id: string; workspaceId: string; opportunityId: string | null; status: "draft" | "reviewed" | "ready_for_prefill"; fields: ApplicationField[]; createdAt: string; updatedAt: string }
export interface TraceEvent { id: string; workspaceId: string; traceId: string; spanId: string; parentSpanId: string | null; name: string; startedAt: string; endedAt: string | null; status: "unset" | "ok" | "error"; attributes: Record<string, unknown> }
export interface WorkspaceRecoverySnapshot {
  workspace: { id: string; name: string; createdAt: string };
  latestProfile: { version: number; headline: string; skills: string[]; positioningTracks: Array<{ name: string; summary: string; targetRoles: string[] }>; createdAt: string } | null;
  latestSearchBrief: { version: number; data: SearchBriefData; createdAt: string } | null;
  latestPreference: { version: number; data: Pick<PreferenceSnapshotData, "preferredLocations" | "preferredRoles">; createdAt: string } | null;
  runs: Array<SearchRun & { summary: { queryCount: number; opportunityCount: number } }>;
  feedback: Array<{ id: string; opportunityId: string; disposition: FeedbackDisposition; preferenceVersion: number | null; reason: null; createdAt: string }>;
  applicationPackets: Array<{ id: string; opportunityId: string | null; status: ApplicationPacket["status"]; fields: Array<Pick<ApplicationField, "key" | "label" | "classification">>; createdAt: string; updatedAt: string }>;
  opportunities: Array<Pick<Opportunity, "id" | "kind" | "company" | "title" | "location" | "canonicalApplyUrl" | "eligibility" | "evidenceStatus" | "updatedAt">>;
}

type WorkspaceRow = { id: string; name: string; created_at: string };
type ResumeRow = { id: string; workspace_id: string; original_name: string; stored_path: string; sha256: string; extracted_text: string; created_at: string };
type SearchRunRow = { id: string; workspace_id: string; profile_version: number; search_brief_version: number; preference_version: number | null; status: SearchRun["status"]; started_at: string; finished_at: string | null };
type OpportunityRow = { id: string; workspace_id: string; kind: Opportunity["kind"]; company: string; title: string; location: string; canonical_apply_url: string | null; requisition_id: string | null; eligibility: Eligibility; evidence_status: EvidenceStatus; created_at: string; updated_at: string };
type ObservationRow = { id: string; source_url: string; source_type: SourceObservation["sourceType"]; status: SourceObservation["status"]; observed_at: string };
type MatchRow = { score: number; factors_json: string; reasons_json: string; gaps_json: string; unknowns_json: string };
type PacketRow = { id: string; workspace_id: string; opportunity_id: string | null; status: ApplicationPacket["status"]; created_at: string; updated_at: string };
type FieldRow = { id: string; field_key: string; label: string; value: string; classification: ApplicationFieldClassification };
type TraceRow = { id: string; workspace_id: string; trace_id: string; span_id: string; parent_span_id: string | null; name: string; started_at: string; ended_at: string | null; status: TraceEvent["status"]; attributes_json: string };
type OpportunityAliasKeyType = "url" | "requisition" | "fallback";

const batchInputSchema = z.object({ query: z.object({ text: z.string().trim().min(1), source: z.string().trim().min(1) }).strict().optional(), opportunities: z.array(opportunityInputSchema) }).strict();
const applicationFieldInputSchema = z.object({ key: z.string().trim().min(1), label: z.string().trim().min(1), value: z.string() }).strict();
const traceInputSchema = z.object({
  traceId: z.string().regex(/^[a-f0-9]{32}$/i), spanId: z.string().regex(/^[a-f0-9]{16}$/i), parentSpanId: z.string().regex(/^[a-f0-9]{16}$/i).optional(),
  name: z.string().trim().min(1), startedAt: z.iso.datetime(), endedAt: z.iso.datetime().optional(), status: z.enum(["unset", "ok", "error"]), attributes: z.record(z.string(), z.unknown())
}).strict();

function parseJson<T>(value: string) { return JSON.parse(value) as T }
function csvCell(value: unknown) { return `"${String(value ?? "").replaceAll('"', '""')}"` }

export class JobSearchService {
  readonly dataRoot: string;
  readonly databasePath: string;
  private readonly database: DatabaseSync;

  constructor(options: JobSearchServiceOptions = {}) {
    this.dataRoot = resolve(options.dataRoot ?? defaultDataRoot());
    const opened = openDatabase(this.dataRoot);
    this.database = opened.database;
    this.databasePath = opened.databasePath;
  }

  close() { this.database.close() }

  async openWorkspace(input: { name: string }): Promise<Workspace> {
    const name = input.name.trim();
    if (!name) throw new Error("Workspace name is required.");
    let row = this.database.prepare("SELECT id, name, created_at FROM workspaces WHERE name = ?").get(name) as WorkspaceRow | undefined;
    if (!row) {
      row = { id: randomUUID(), name, created_at: new Date().toISOString() };
      this.database.prepare("INSERT INTO workspaces(id, name, created_at) VALUES (?, ?, ?)").run(row.id, row.name, row.created_at);
    }
    const workspace = this.workspaceFromRow(row);
    await this.ensureWorkspaceDirectories(workspace);
    return workspace;
  }

  async importResume(input: { workspaceId: string; sourcePath: string }): Promise<ImportedResume> {
    const workspace = await this.requireWorkspace(input.workspaceId);
    const inspected = await inspectResume(input.sourcePath);
    const existing = this.database.prepare("SELECT id, workspace_id, original_name, stored_path, sha256, extracted_text, created_at FROM resumes WHERE workspace_id = ? AND sha256 = ?").get(workspace.id, inspected.sha256) as ResumeRow | undefined;
    if (existing) return this.resumeFromRow(existing);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const storedPath = resolveInside(workspace.attachmentDirectory, `${inspected.sha256}${inspected.extension}`);
    await storeResumeCopy(inspected.contents, storedPath, this.dataRoot);
    this.database.prepare("INSERT INTO resumes(id, workspace_id, original_name, stored_path, sha256, extracted_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, workspace.id, basename(input.sourcePath), storedPath, inspected.sha256, inspected.extractedText, createdAt);
    return { id, workspaceId: workspace.id, originalName: basename(input.sourcePath), storedPath, sha256: inspected.sha256, extractedText: inspected.extractedText, createdAt };
  }

  async commitProfile(input: { workspaceId: string; baseVersion: number | null; profile: ProfileData }): Promise<CandidateProfileVersion> {
    await this.requireWorkspace(input.workspaceId);
    const profile = profileDataSchema.parse(input.profile);
    return this.transaction(() => {
      const current = this.currentVersion("candidate_profile_versions", input.workspaceId);
      if (current !== (input.baseVersion ?? 0)) throw new Error(`Profile version conflict: expected base ${current}, received ${input.baseVersion ?? "none"}.`);
      const id = randomUUID();
      const version = current + 1;
      const createdAt = new Date().toISOString();
      this.database.prepare("INSERT INTO candidate_profile_versions(id, workspace_id, version, headline, skills_json, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, input.workspaceId, version, profile.headline, JSON.stringify(profile.skills), createdAt);
      const insertTrack = this.database.prepare("INSERT INTO positioning_tracks(id, workspace_id, profile_version_id, name, summary, target_roles_json) VALUES (?, ?, ?, ?, ?, ?)");
      for (const track of profile.positioningTracks) insertTrack.run(randomUUID(), input.workspaceId, id, track.name, track.summary, JSON.stringify(track.targetRoles));
      return { id, workspaceId: input.workspaceId, version, profile, createdAt };
    });
  }

  async beginSearchRun(input: { workspaceId: string; profileVersion: number; searchBrief: SearchBriefData; preferenceVersion: number | null }): Promise<SearchRun> {
    await this.requireWorkspace(input.workspaceId);
    const searchBrief = searchBriefDataSchema.parse(input.searchBrief);
    this.requireVersion("candidate_profile_versions", input.workspaceId, input.profileVersion, "Profile");
    if (input.preferenceVersion !== null) this.requireVersion("preference_snapshot_versions", input.workspaceId, input.preferenceVersion, "Preference");
    return this.transaction(() => {
      const searchBriefVersion = this.currentVersion("search_brief_versions", input.workspaceId) + 1;
      const now = new Date().toISOString();
      this.database.prepare("INSERT INTO search_brief_versions(id, workspace_id, version, data_json, created_at) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), input.workspaceId, searchBriefVersion, JSON.stringify(searchBrief), now);
      const run: SearchRun = { id: randomUUID(), workspaceId: input.workspaceId, profileVersion: input.profileVersion, searchBriefVersion, preferenceVersion: input.preferenceVersion, status: "running", startedAt: now, finishedAt: null };
      this.database.prepare("INSERT INTO search_runs(id, workspace_id, profile_version, search_brief_version, preference_version, status, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(run.id, run.workspaceId, run.profileVersion, run.searchBriefVersion, run.preferenceVersion, run.status, run.startedAt, null);
      return run;
    });
  }

  async getSearchRun(input: { workspaceId: string; runId: string }): Promise<SearchRun> {
    await this.requireWorkspace(input.workspaceId);
    const row = this.database.prepare("SELECT * FROM search_runs WHERE workspace_id = ? AND id = ?").get(input.workspaceId, input.runId) as SearchRunRow | undefined;
    if (!row) throw new Error(`Search run not found: ${input.runId}`);
    return this.searchRunFromRow(row);
  }

  async finishSearchRun(input: { workspaceId: string; runId: string; status?: "completed" | "failed" }): Promise<SearchRun> {
    await this.getSearchRun(input);
    const status = input.status ?? "completed";
    this.database.prepare("UPDATE search_runs SET status = ?, finished_at = ? WHERE workspace_id = ? AND id = ?").run(status, new Date().toISOString(), input.workspaceId, input.runId);
    return this.getSearchRun(input);
  }

  async recordSearchBatch(input: { workspaceId: string; runId: string; query?: { text: string; source: string }; opportunities: OpportunityInput[] }) {
    await this.getSearchRun({ workspaceId: input.workspaceId, runId: input.runId });
    const parsed = batchInputSchema.parse({ query: input.query, opportunities: input.opportunities });
    const opportunityIds = this.transaction(() => {
      if (parsed.query) this.database.prepare("INSERT INTO query_events(id, workspace_id, search_run_id, query_text, source, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(randomUUID(), input.workspaceId, input.runId, parsed.query.text, parsed.query.source, new Date().toISOString());
      return [...new Set(parsed.opportunities.map((opportunity) => this.recordOpportunity(input.workspaceId, input.runId, opportunity)))];
    });
    return { recorded: parsed.opportunities.length, opportunities: opportunityIds.map((id) => this.readOpportunity(input.workspaceId, id)) };
  }

  async queryOpportunities(input: { workspaceId: string; kind?: Opportunity["kind"]; eligibility?: Eligibility; evidenceStatus?: EvidenceStatus; limit?: number }): Promise<Opportunity[]> {
    await this.requireWorkspace(input.workspaceId);
    let rows = this.database.prepare("SELECT * FROM opportunities WHERE workspace_id = ? ORDER BY updated_at DESC, id").all(input.workspaceId) as unknown as OpportunityRow[];
    if (input.kind) rows = rows.filter(({ kind }) => kind === input.kind);
    if (input.eligibility) rows = rows.filter(({ eligibility }) => eligibility === input.eligibility);
    if (input.evidenceStatus) rows = rows.filter(({ evidence_status }) => evidence_status === input.evidenceStatus);
    if (input.limit !== undefined) rows = rows.slice(0, input.limit);
    return rows.map((row) => this.opportunityFromRow(row));
  }

  async recordFeedback(input: { workspaceId: string; opportunityId: string; disposition: FeedbackDisposition; confirmedPreferenceSnapshot?: PreferenceSnapshotData; preferenceBaseVersion?: number | null }) {
    await this.requireWorkspace(input.workspaceId);
    this.requireOpportunity(input.workspaceId, input.opportunityId);
    const disposition = feedbackDispositionSchema.parse(input.disposition);
    const confirmed = input.confirmedPreferenceSnapshot ? preferenceSnapshotDataSchema.parse(input.confirmedPreferenceSnapshot) : undefined;
    return this.transaction(() => {
      let preferenceVersion: number | null = null;
      if (confirmed && disposition !== "information_error" && disposition !== "closed") {
        if (input.preferenceBaseVersion === undefined) throw new Error("A preference base version is required with a confirmed snapshot.");
        const current = this.currentVersion("preference_snapshot_versions", input.workspaceId);
        if (current !== (input.preferenceBaseVersion ?? 0)) throw new Error(`Preference version conflict: expected base ${current}, received ${input.preferenceBaseVersion ?? "none"}.`);
        preferenceVersion = current + 1;
        this.database.prepare("INSERT INTO preference_snapshot_versions(id, workspace_id, version, data_json, created_at) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), input.workspaceId, preferenceVersion, JSON.stringify(confirmed), new Date().toISOString());
      }
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      this.database.prepare("INSERT INTO feedback(id, workspace_id, opportunity_id, disposition, preference_version, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, input.workspaceId, input.opportunityId, disposition, preferenceVersion, createdAt);
      return { id, workspaceId: input.workspaceId, opportunityId: input.opportunityId, disposition, preferenceVersion, createdAt };
    });
  }

  async upsertApplicationPacket(input: { workspaceId: string; packetId?: string; opportunityId?: string; status: "draft" | "reviewed" | "ready_for_prefill"; fields: Array<{ key: string; label: string; value: string }> }): Promise<ApplicationPacket> {
    await this.requireWorkspace(input.workspaceId);
    if ((input.status as string) === "submitted") throw new Error("Application packets can never have submitted status; final submission is manual-only.");
    const status = z.enum(["draft", "reviewed", "ready_for_prefill"]).parse(input.status);
    const fields = z.array(applicationFieldInputSchema).parse(input.fields);
    if (input.opportunityId) this.requireOpportunity(input.workspaceId, input.opportunityId);
    const packetId = input.packetId ?? randomUUID();
    const existing = input.packetId ? this.database.prepare("SELECT * FROM application_packets WHERE workspace_id = ? AND id = ?").get(input.workspaceId, input.packetId) as PacketRow | undefined : undefined;
    if (input.packetId && !existing) throw new Error(`Application packet not found: ${input.packetId}`);
    this.transaction(() => {
      const now = new Date().toISOString();
      if (existing) {
        this.database.prepare("UPDATE application_packets SET opportunity_id = ?, status = ?, updated_at = ? WHERE workspace_id = ? AND id = ?").run(input.opportunityId ?? existing.opportunity_id, status, now, input.workspaceId, packetId);
        this.database.prepare("DELETE FROM application_fields WHERE workspace_id = ? AND packet_id = ?").run(input.workspaceId, packetId);
      } else this.database.prepare("INSERT INTO application_packets(id, workspace_id, opportunity_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(packetId, input.workspaceId, input.opportunityId ?? null, status, now, now);
      const insert = this.database.prepare("INSERT INTO application_fields(id, workspace_id, packet_id, field_key, label, value, classification) VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (const field of fields) insert.run(randomUUID(), input.workspaceId, packetId, field.key, field.label, field.value, classifyApplicationField(field.key, field.label));
    });
    return this.readApplicationPacket(input.workspaceId, packetId);
  }

  async reviewApplicationPacket(input: { workspaceId: string; packetId: string }): Promise<ApplicationPacket> {
    await this.requireWorkspace(input.workspaceId);
    this.readApplicationPacket(input.workspaceId, input.packetId);
    this.database.prepare("UPDATE application_packets SET status = 'ready_for_prefill', updated_at = ? WHERE workspace_id = ? AND id = ?").run(new Date().toISOString(), input.workspaceId, input.packetId);
    return this.readApplicationPacket(input.workspaceId, input.packetId);
  }

  async recordTraceEvent(input: { workspaceId: string; traceId: string; spanId: string; parentSpanId?: string; name: string; startedAt: string; endedAt?: string; status: "unset" | "ok" | "error"; attributes: Record<string, unknown> }): Promise<TraceEvent> {
    await this.requireWorkspace(input.workspaceId);
    const parsed = traceInputSchema.parse({ traceId: input.traceId, spanId: input.spanId, parentSpanId: input.parentSpanId, name: input.name, startedAt: input.startedAt, endedAt: input.endedAt, status: input.status, attributes: input.attributes });
    const event: TraceEvent = { id: randomUUID(), workspaceId: input.workspaceId, traceId: parsed.traceId, spanId: parsed.spanId, parentSpanId: parsed.parentSpanId ?? null, name: parsed.name, startedAt: parsed.startedAt, endedAt: parsed.endedAt ?? null, status: parsed.status, attributes: redactTraceAttributes(parsed.attributes) as Record<string, unknown> };
    this.database.prepare("INSERT INTO trace_events(id, workspace_id, trace_id, span_id, parent_span_id, name, started_at, ended_at, status, attributes_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(event.id, event.workspaceId, event.traceId, event.spanId, event.parentSpanId, event.name, event.startedAt, event.endedAt, event.status, JSON.stringify(event.attributes));
    return event;
  }

  async getTraceEvents(input: { workspaceId: string }): Promise<TraceEvent[]> {
    await this.requireWorkspace(input.workspaceId);
    const rows = this.database.prepare("SELECT * FROM trace_events WHERE workspace_id = ? ORDER BY started_at, id").all(input.workspaceId) as unknown as TraceRow[];
    return rows.map((row) => this.traceFromRow(row));
  }

  async exportWorkspace(input: { workspaceId: string; format: "json" | "markdown" | "csv"; includeContent?: boolean }) {
    const workspace = await this.requireWorkspace(input.workspaceId);
    if (input.includeContent && input.format !== "json") throw new Error("Structured content is available only for JSON exports.");
    const opportunities = await this.queryOpportunities({ workspaceId: input.workspaceId });
    const profiles = this.database.prepare("SELECT version, headline, skills_json, created_at FROM candidate_profile_versions WHERE workspace_id = ? ORDER BY version").all(input.workspaceId);
    const runs = this.database.prepare("SELECT id, profile_version, search_brief_version, preference_version, status, started_at, finished_at FROM search_runs WHERE workspace_id = ? ORDER BY started_at").all(input.workspaceId);
    let contents: string;
    let extension: string;
    if (input.format === "json") {
      extension = "json";
      contents = JSON.stringify({ workspace: { id: workspace.id, name: workspace.name, createdAt: workspace.createdAt }, profiles, runs, opportunities }, null, 2);
    } else if (input.format === "markdown") {
      extension = "md";
      contents = [`# ${workspace.name}`, "", "## Opportunities", "", ...opportunities.map((item) => `- **${item.title}** — ${item.company} (${item.location}); ${item.eligibility}; ${item.evidenceStatus}`), ""].join("\n");
    } else {
      extension = "csv";
      contents = [["id", "kind", "company", "title", "location", "eligibility", "evidence_status", "canonical_apply_url"], ...opportunities.map((item) => [item.id, item.kind, item.company, item.title, item.location, item.eligibility, item.evidenceStatus, item.canonicalApplyUrl ?? ""])].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
    }
    const path = resolveInside(workspace.exportDirectory, `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.${extension}`);
    await writeGeneratedFile(this.dataRoot, path, contents);
    if (!input.includeContent) return { format: input.format, path };
    return { format: input.format, path, snapshot: this.recoverySnapshot(workspace) };
  }

  private recoverySnapshot(workspace: Workspace): WorkspaceRecoverySnapshot {
    const latestProfile = this.database.prepare("SELECT id, version, headline, skills_json, created_at FROM candidate_profile_versions WHERE workspace_id = ? ORDER BY version DESC LIMIT 1").get(workspace.id) as { id: string; version: number; headline: string; skills_json: string; created_at: string } | undefined;
    const latestSearchBrief = this.database.prepare("SELECT version, data_json, created_at FROM search_brief_versions WHERE workspace_id = ? ORDER BY version DESC LIMIT 1").get(workspace.id) as { version: number; data_json: string; created_at: string } | undefined;
    const latestPreference = this.database.prepare("SELECT version, data_json, created_at FROM preference_snapshot_versions WHERE workspace_id = ? ORDER BY version DESC LIMIT 1").get(workspace.id) as { version: number; data_json: string; created_at: string } | undefined;
    const runs = this.database.prepare("SELECT * FROM search_runs WHERE workspace_id = ? ORDER BY started_at, id").all(workspace.id) as SearchRunRow[];
    const feedback = this.database.prepare("SELECT id, opportunity_id, disposition, preference_version, created_at FROM feedback WHERE workspace_id = ? ORDER BY created_at, id").all(workspace.id) as Array<{ id: string; opportunity_id: string; disposition: FeedbackDisposition; preference_version: number | null; created_at: string }>;
    const packets = this.database.prepare("SELECT * FROM application_packets WHERE workspace_id = ? ORDER BY updated_at, id").all(workspace.id) as PacketRow[];
    const opportunities = this.database.prepare("SELECT * FROM opportunities WHERE workspace_id = ? ORDER BY updated_at DESC, id").all(workspace.id) as OpportunityRow[];

    return {
      workspace: { id: workspace.id, name: workspace.name, createdAt: workspace.createdAt },
      latestProfile: latestProfile ? {
        version: latestProfile.version,
        headline: latestProfile.headline,
        skills: parseJson<string[]>(latestProfile.skills_json),
        positioningTracks: (this.database.prepare("SELECT name, summary, target_roles_json FROM positioning_tracks WHERE workspace_id = ? AND profile_version_id = ? ORDER BY id").all(workspace.id, latestProfile.id) as Array<{ name: string; summary: string; target_roles_json: string }>).map((track) => ({ name: track.name, summary: track.summary, targetRoles: parseJson<string[]>(track.target_roles_json) })),
        createdAt: latestProfile.created_at
      } : null,
      latestSearchBrief: latestSearchBrief ? { version: latestSearchBrief.version, data: parseJson<SearchBriefData>(latestSearchBrief.data_json), createdAt: latestSearchBrief.created_at } : null,
      latestPreference: latestPreference ? (() => {
        const preference = parseJson<PreferenceSnapshotData>(latestPreference.data_json);
        return { version: latestPreference.version, data: { preferredLocations: preference.preferredLocations, preferredRoles: preference.preferredRoles }, createdAt: latestPreference.created_at };
      })() : null,
      runs: runs.map((run) => ({
        ...this.searchRunFromRow(run),
        summary: {
          queryCount: (this.database.prepare("SELECT COUNT(*) AS count FROM query_events WHERE workspace_id = ? AND search_run_id = ?").get(workspace.id, run.id) as { count: number }).count,
          opportunityCount: (this.database.prepare("SELECT COUNT(DISTINCT opportunity_id) AS count FROM source_observations WHERE workspace_id = ? AND search_run_id = ?").get(workspace.id, run.id) as { count: number }).count
        }
      })),
      feedback: feedback.map((item) => ({ id: item.id, opportunityId: item.opportunity_id, disposition: item.disposition, preferenceVersion: item.preference_version, reason: null, createdAt: item.created_at })),
      applicationPackets: packets.map((packet) => ({
        id: packet.id,
        opportunityId: packet.opportunity_id,
        status: packet.status,
        fields: (this.database.prepare("SELECT field_key, label, classification FROM application_fields WHERE workspace_id = ? AND packet_id = ? ORDER BY id").all(workspace.id, packet.id) as Array<{ field_key: string; label: string; classification: ApplicationFieldClassification }>).map((field) => ({ key: field.field_key, label: field.label, classification: field.classification })),
        createdAt: packet.created_at,
        updatedAt: packet.updated_at
      })),
      opportunities: opportunities.map((row) => {
        const opportunity = this.opportunityFromRow(row);
        return { id: opportunity.id, kind: opportunity.kind, company: opportunity.company, title: opportunity.title, location: opportunity.location, canonicalApplyUrl: opportunity.canonicalApplyUrl, eligibility: opportunity.eligibility, evidenceStatus: opportunity.evidenceStatus, updatedAt: opportunity.updatedAt };
      })
    };
  }

  private recordOpportunity(workspaceId: string, runId: string, input: OpportunityInput) {
    const keys = opportunityKeys(input);
    const matches = this.findOpportunityMatches(workspaceId, keys);
    const row = matches[0];
    const now = new Date().toISOString();
    const opportunityId = row?.id ?? randomUUID();
    if (!row) {
      const initialEvidence = deriveEvidenceStatus([{ sourceType: input.evidence.sourceType, status: input.evidence.status }]);
      this.database.prepare("INSERT INTO opportunities(id, workspace_id, kind, company, title, location, canonical_apply_url, requisition_id, normalized_url, normalized_requisition, normalized_fallback, eligibility, evidence_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(opportunityId, workspaceId, input.kind, input.company.trim(), input.title.trim(), input.location.trim(), keys.normalizedUrl, input.requisitionId?.trim() ?? null, keys.normalizedUrl, keys.normalizedRequisition, keys.normalizedFallback, input.eligibility, initialEvidence, now, now);
    } else {
      for (const duplicate of matches.slice(1)) this.mergeOpportunityInto(workspaceId, opportunityId, duplicate.id);
      this.database.prepare("UPDATE opportunities SET canonical_apply_url = COALESCE(canonical_apply_url, ?), requisition_id = COALESCE(requisition_id, ?), normalized_url = COALESCE(normalized_url, ?), normalized_requisition = COALESCE(normalized_requisition, ?), updated_at = ? WHERE workspace_id = ? AND id = ?").run(keys.normalizedUrl, input.requisitionId?.trim() ?? null, keys.normalizedUrl, keys.normalizedRequisition, now, workspaceId, opportunityId);
    }
    this.registerOpportunityAliases(workspaceId, opportunityId, keys, now);
    this.database.prepare("INSERT INTO source_observations(id, workspace_id, opportunity_id, search_run_id, source_url, source_type, status, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), workspaceId, opportunityId, runId, input.evidence.sourceUrl, input.evidence.sourceType, input.evidence.status, input.evidence.observedAt ?? now);
    const observations = this.database.prepare("SELECT source_type, status FROM source_observations WHERE workspace_id = ? AND opportunity_id = ?").all(workspaceId, opportunityId) as unknown as Array<{ source_type: SourceObservation["sourceType"]; status: SourceObservation["status"] }>;
    this.database.prepare("UPDATE opportunities SET evidence_status = ?, updated_at = ? WHERE workspace_id = ? AND id = ?").run(deriveEvidenceStatus(observations.map((item) => ({ sourceType: item.source_type, status: item.status }))), now, workspaceId, opportunityId);
    if (input.match) this.database.prepare("INSERT INTO match_assessments(id, workspace_id, opportunity_id, search_run_id, score, factors_json, reasons_json, gaps_json, unknowns_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), workspaceId, opportunityId, runId, input.match.score, JSON.stringify(input.match.factors), JSON.stringify(input.match.reasons), JSON.stringify(input.match.gaps), JSON.stringify(input.match.unknowns), now);
    return opportunityId;
  }

  private findOpportunityMatches(workspaceId: string, keys: ReturnType<typeof opportunityKeys>) {
    const orderedKeys: Array<[OpportunityAliasKeyType, string | null]> = [
      ["url", keys.normalizedUrl],
      ["requisition", keys.normalizedRequisition],
      ["fallback", keys.normalizedFallback]
    ];
    const matches: OpportunityRow[] = [];
    const seen = new Set<string>();
    for (const [keyType, value] of orderedKeys) {
      if (!value) continue;
      const rows = this.database.prepare(`
        SELECT opportunity.*
        FROM opportunity_aliases AS alias
        JOIN opportunities AS opportunity
          ON opportunity.workspace_id = alias.workspace_id AND opportunity.id = alias.opportunity_id
        WHERE alias.workspace_id = ? AND alias.key_type = ? AND alias.normalized_value = ?
        ORDER BY opportunity.created_at, opportunity.id
      `).all(workspaceId, keyType, value) as unknown as OpportunityRow[];
      for (const row of rows) {
        if (!seen.has(row.id)) {
          matches.push(row);
          seen.add(row.id);
        }
      }
    }
    return matches;
  }

  private registerOpportunityAliases(workspaceId: string, opportunityId: string, keys: ReturnType<typeof opportunityKeys>, createdAt: string) {
    const aliases: Array<[OpportunityAliasKeyType, string | null]> = [
      ["url", keys.normalizedUrl],
      ["requisition", keys.normalizedRequisition],
      ["fallback", keys.normalizedFallback]
    ];
    const insert = this.database.prepare("INSERT OR IGNORE INTO opportunity_aliases(workspace_id, key_type, normalized_value, opportunity_id, created_at) VALUES (?, ?, ?, ?, ?)");
    for (const [keyType, value] of aliases) {
      if (value) insert.run(workspaceId, keyType, value, opportunityId, createdAt);
    }
  }

  private mergeOpportunityInto(workspaceId: string, survivorId: string, duplicateId: string) {
    this.database.prepare("UPDATE opportunity_aliases SET opportunity_id = ? WHERE workspace_id = ? AND opportunity_id = ?").run(survivorId, workspaceId, duplicateId);
    for (const table of ["source_observations", "match_assessments", "feedback", "application_packets"] as const) {
      this.database.prepare(`UPDATE ${table} SET opportunity_id = ? WHERE workspace_id = ? AND opportunity_id = ?`).run(survivorId, workspaceId, duplicateId);
    }
    this.database.prepare("DELETE FROM opportunities WHERE workspace_id = ? AND id = ?").run(workspaceId, duplicateId);
  }

  private readOpportunity(workspaceId: string, opportunityId: string) {
    const row = this.database.prepare("SELECT * FROM opportunities WHERE workspace_id = ? AND id = ?").get(workspaceId, opportunityId) as OpportunityRow | undefined;
    if (!row) throw new Error(`Opportunity not found: ${opportunityId}`);
    return this.opportunityFromRow(row);
  }

  private opportunityFromRow(row: OpportunityRow): Opportunity {
    const observationRows = this.database.prepare("SELECT id, source_url, source_type, status, observed_at FROM source_observations WHERE workspace_id = ? AND opportunity_id = ? ORDER BY observed_at, rowid").all(row.workspace_id, row.id) as unknown as ObservationRow[];
    const match = this.database.prepare("SELECT score, factors_json, reasons_json, gaps_json, unknowns_json FROM match_assessments WHERE workspace_id = ? AND opportunity_id = ? ORDER BY rowid DESC LIMIT 1").get(row.workspace_id, row.id) as MatchRow | undefined;
    return { id: row.id, workspaceId: row.workspace_id, kind: row.kind, company: row.company, title: row.title, location: row.location, canonicalApplyUrl: row.canonical_apply_url, requisitionId: row.requisition_id, eligibility: row.eligibility, evidenceStatus: row.evidence_status,
      sourceObservations: observationRows.map((item) => ({ id: item.id, sourceUrl: item.source_url, sourceType: item.source_type, status: item.status, observedAt: item.observed_at })),
      match: match ? { score: match.score, factors: parseJson(match.factors_json), reasons: parseJson(match.reasons_json), gaps: parseJson(match.gaps_json), unknowns: parseJson(match.unknowns_json) } : null, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  private readApplicationPacket(workspaceId: string, packetId: string): ApplicationPacket {
    const row = this.database.prepare("SELECT * FROM application_packets WHERE workspace_id = ? AND id = ?").get(workspaceId, packetId) as PacketRow | undefined;
    if (!row) throw new Error(`Application packet not found: ${packetId}`);
    const fields = this.database.prepare("SELECT id, field_key, label, value, classification FROM application_fields WHERE workspace_id = ? AND packet_id = ? ORDER BY rowid").all(workspaceId, packetId) as unknown as FieldRow[];
    return { id: row.id, workspaceId: row.workspace_id, opportunityId: row.opportunity_id, status: row.status, fields: fields.map((field) => ({ id: field.id, key: field.field_key, label: field.label, value: field.value, classification: field.classification })), createdAt: row.created_at, updatedAt: row.updated_at };
  }

  private requireOpportunity(workspaceId: string, opportunityId: string) {
    if (!this.database.prepare("SELECT id FROM opportunities WHERE workspace_id = ? AND id = ?").get(workspaceId, opportunityId)) throw new Error(`Opportunity not found: ${opportunityId}`);
  }

  private currentVersion(table: "candidate_profile_versions" | "search_brief_versions" | "preference_snapshot_versions", workspaceId: string) {
    return (this.database.prepare(`SELECT COALESCE(MAX(version), 0) AS version FROM ${table} WHERE workspace_id = ?`).get(workspaceId) as { version: number }).version;
  }

  private requireVersion(table: "candidate_profile_versions" | "preference_snapshot_versions", workspaceId: string, version: number, label: string) {
    if (!this.database.prepare(`SELECT id FROM ${table} WHERE workspace_id = ? AND version = ?`).get(workspaceId, version)) throw new Error(`${label} version not found: ${version}`);
  }

  private transaction<T>(run: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try { const result = run(); this.database.exec("COMMIT"); return result } catch (error) { this.database.exec("ROLLBACK"); throw error }
  }

  private async requireWorkspace(workspaceId: string) {
    const row = this.database.prepare("SELECT id, name, created_at FROM workspaces WHERE id = ?").get(workspaceId) as WorkspaceRow | undefined;
    if (!row) throw new Error(`Workspace not found: ${workspaceId}`);
    const workspace = this.workspaceFromRow(row);
    await this.ensureWorkspaceDirectories(workspace);
    return workspace;
  }

  private async ensureWorkspaceDirectories(workspace: Workspace) { await Promise.all([ensureGeneratedDirectory(this.dataRoot, workspace.attachmentDirectory), ensureGeneratedDirectory(this.dataRoot, workspace.exportDirectory)]) }
  private workspaceFromRow(row: WorkspaceRow): Workspace { const directory = resolveInside(this.dataRoot, "workspaces", row.id); return { id: row.id, name: row.name, attachmentDirectory: resolveInside(directory, "attachments"), exportDirectory: resolveInside(directory, "exports"), createdAt: row.created_at } }
  private resumeFromRow(row: ResumeRow): ImportedResume { return { id: row.id, workspaceId: row.workspace_id, originalName: row.original_name, storedPath: row.stored_path, sha256: row.sha256, extractedText: row.extracted_text, createdAt: row.created_at } }
  private searchRunFromRow(row: SearchRunRow): SearchRun { return { id: row.id, workspaceId: row.workspace_id, profileVersion: row.profile_version, searchBriefVersion: row.search_brief_version, preferenceVersion: row.preference_version, status: row.status, startedAt: row.started_at, finishedAt: row.finished_at } }
  private traceFromRow(row: TraceRow): TraceEvent { return { id: row.id, workspaceId: row.workspace_id, traceId: row.trace_id, spanId: row.span_id, parentSpanId: row.parent_span_id, name: row.name, startedAt: row.started_at, endedAt: row.ended_at, status: row.status, attributes: parseJson(row.attributes_json) } }
}
