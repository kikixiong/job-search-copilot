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
  queryAttemptInputSchema,
  redactPublicText,
  redactPublicUrl,
  redactTraceAttributes,
  safeUnknownTargetingConstraints,
  searchBriefDataSchema,
  type ApplicationFieldClassification,
  type Eligibility,
  type EvidenceStatus,
  type FeedbackDisposition,
  type ObservationConflict,
  type OpportunityInput,
  type PreferenceSnapshotData,
  type ProfileData,
  type QueryOutcomeStatus,
  type SearchBriefData,
  type SourceConfidence,
  type SourceTier,
  type TargetingConstraints
} from "./domain.js";
import { inspectResume, storeResumeCopy } from "./resume.js";
import { defaultDataRoot, ensureGeneratedDirectory, openDatabase, resolveInside, writeGeneratedFile } from "./storage.js";

export interface JobSearchServiceOptions { dataRoot?: string }
export interface Workspace { id: string; name: string; attachmentDirectory: string; exportDirectory: string; createdAt: string }
export interface ImportedResume { id: string; workspaceId: string; originalName: string; storedPath: string; sha256: string; extractedText: string; createdAt: string }
export interface CandidateProfileVersion { id: string; workspaceId: string; version: number; profile: ProfileData; createdAt: string }
export interface SearchRun { id: string; workspaceId: string; profileVersion: number; searchBriefVersion: number; preferenceVersion: number | null; status: "running" | "completed" | "failed"; startedAt: string; finishedAt: string | null }
export interface QueryAttempt { id: string; runId: string; text: string; source: string; status: QueryOutcomeStatus; retrievedAt: string; locator: string; sourceTier: SourceTier; failure: { code: string; summary: string } | null }
export interface DedupeDecision { action: "created" | "matched" | "merged" | "legacy"; matchedBy: OpportunityAliasKeyType | "none" | "unknown"; survivorOpportunityId: string | null; mergedOpportunityIds: string[] }
export interface SourceObservation { id: string; runId: string; sourceUrl: string; sourceType: "official" | "community"; sourceTier: SourceTier; status: "open" | "closed" | "lead"; observedAt: string; retrievedAt: string; locator: string; confidence: SourceConfidence; deadline: string | null; conflict: ObservationConflict | null; dedupeDecision: DedupeDecision }
export interface MatchAssessment { runId: string; score: number; factors: Record<string, number>; reasons: string[]; gaps: string[]; unknowns: string[] }
export interface Opportunity { id: string; workspaceId: string; kind: "job" | "internship"; company: string; title: string; location: string; canonicalApplyUrl: string | null; requisitionId: string | null; eligibility: Eligibility; evidenceStatus: EvidenceStatus; sourceObservations: SourceObservation[]; match: MatchAssessment | null; createdAt: string; updatedAt: string }
export interface ApplicationFieldProvenance { source: "profile" | "resume" | "user_confirmed" | "official" | "unknown"; locator: string; reviewed: boolean; sensitive: boolean }
export interface ApplicationField { id: string; key: string; label: string; value: string; classification: ApplicationFieldClassification; provenance: ApplicationFieldProvenance | null }
export interface ApplicationAudit { version: number; retrievedAt: string; destinationUrl: string; status: "verified" | "failed" }
export interface ApplicationAttachment { name: string; status: "ready" | "missing" | "manual_only"; locator: string | null }
export interface ApplicationPacket { id: string; workspaceId: string; opportunityId: string | null; status: "draft" | "reviewed" | "ready_for_prefill"; revision: number; audit: ApplicationAudit | null; attachments: ApplicationAttachment[]; unknowns: string[]; fields: ApplicationField[]; createdAt: string; updatedAt: string }
export interface TraceEvent { id: string; workspaceId: string; runId: string | null; traceId: string; spanId: string; parentSpanId: string | null; name: string; startedAt: string; endedAt: string | null; status: "unset" | "ok" | "error"; attributes: Record<string, unknown> }
export interface ApplicationGuidanceDecision { mode: "reviewed" | "copy"; reasons: string[]; auditVersion: number | null }
export type PublicSourceObservation = Omit<SourceObservation, "sourceUrl"> & { sourceUrl: string | null };
export type PublicOpportunity = Omit<Opportunity, "canonicalApplyUrl" | "sourceObservations"> & { canonicalApplyUrl: string | null; sourceObservations: PublicSourceObservation[] };
export interface RecoveryApplicationPacket { id: string; opportunityId: string | null; status: ApplicationPacket["status"]; revision: number; audit: (Omit<ApplicationAudit, "destinationUrl"> & { destinationUrl: string | null }) | null; guidance: ApplicationGuidanceDecision; attachments: ApplicationAttachment[]; unknowns: string[]; fields: Array<Pick<ApplicationField, "id" | "key" | "label" | "classification" | "provenance">>; createdAt: string; updatedAt: string }
export interface WorkspaceRecoverySnapshot {
  workspace: { id: string; name: string; createdAt: string };
  latestProfile: { version: number; headline: string; skills: string[]; positioningTracks: Array<{ name: string; summary: string; targetRoles: string[] }>; targetingConstraints: TargetingConstraints; createdAt: string } | null;
  latestSearchBrief: { version: number; data: SearchBriefData; createdAt: string } | null;
  latestPreference: { version: number; data: Pick<PreferenceSnapshotData, "preferredLocations" | "preferredRoles">; createdAt: string } | null;
  resumeImported: boolean;
  runs: Array<SearchRun & { searchBrief: SearchBriefData; queryAttempts: QueryAttempt[]; summary: { queryCount: number; sourceCount: number; opportunityCount: number } }>;
  feedback: Array<{ id: string; opportunityId: string; disposition: FeedbackDisposition; preferenceVersion: number | null; reason: string | null; createdAt: string }>;
  applicationPackets: RecoveryApplicationPacket[];
  opportunities: PublicOpportunity[];
  trace: TraceEvent[];
}
type InternalRecoveryApplicationPacket = Omit<RecoveryApplicationPacket, "audit" | "guidance"> & { audit: ApplicationAudit | null };
type InternalWorkspaceRecoverySnapshot = Omit<WorkspaceRecoverySnapshot, "applicationPackets" | "opportunities"> & { applicationPackets: InternalRecoveryApplicationPacket[]; opportunities: Opportunity[] };

type WorkspaceRow = { id: string; name: string; created_at: string };
type ResumeRow = { id: string; workspace_id: string; original_name: string; stored_path: string; sha256: string; extracted_text: string; created_at: string };
type SearchRunRow = { id: string; workspace_id: string; profile_version: number; search_brief_version: number; preference_version: number | null; status: SearchRun["status"]; started_at: string; finished_at: string | null };
type OpportunityRow = { id: string; workspace_id: string; kind: Opportunity["kind"]; company: string; title: string; location: string; canonical_apply_url: string | null; requisition_id: string | null; eligibility: Eligibility; evidence_status: EvidenceStatus; created_at: string; updated_at: string };
type QueryAttemptRow = { id: string; search_run_id: string; query_text: string; source: string; outcome_status: QueryOutcomeStatus; retrieved_at: string | null; locator: string | null; source_tier: SourceTier; failure_code: string | null; failure_summary: string | null; created_at: string };
type ObservationRow = { id: string; search_run_id: string; source_url: string; source_type: SourceObservation["sourceType"]; source_tier: SourceTier | null; status: SourceObservation["status"]; observed_at: string; retrieved_at: string | null; locator: string | null; confidence: SourceConfidence; deadline: string | null; conflict_json: string | null; dedupe_decision_json: string };
type MatchRow = { search_run_id: string; score: number; factors_json: string; reasons_json: string; gaps_json: string; unknowns_json: string };
type PacketRow = { id: string; workspace_id: string; opportunity_id: string | null; status: ApplicationPacket["status"]; revision: number; audit_version: number | null; audit_retrieved_at: string | null; audit_destination_url: string | null; audit_status: ApplicationAudit["status"] | null; attachments_json: string; unknowns_json: string; created_at: string; updated_at: string };
type FieldRow = { id: string; field_key: string; label: string; value: string; classification: ApplicationFieldClassification; provenance_json: string | null };
type TraceRow = { id: string; workspace_id: string; run_id: string | null; trace_id: string; span_id: string; parent_span_id: string | null; name: string; started_at: string; ended_at: string | null; status: TraceEvent["status"]; attributes_json: string };
type OpportunityAliasKeyType = "url" | "requisition" | "fallback";

const batchInputSchema = z.object({ query: queryAttemptInputSchema.optional(), opportunities: z.array(opportunityInputSchema) }).strict();
const applicationFieldProvenanceSchema = z.object({ source: z.enum(["profile", "resume", "user_confirmed", "official", "unknown"]), locator: z.string().trim().min(1), reviewed: z.boolean(), sensitive: z.boolean() }).strict();
const applicationFieldInputSchema = z.object({ key: z.string().trim().min(1), label: z.string().trim().min(1), value: z.string(), provenance: applicationFieldProvenanceSchema.optional() }).strict();
const applicationAuditSchema = z.object({ version: z.number().int().positive(), retrievedAt: z.iso.datetime(), destinationUrl: z.url(), status: z.enum(["verified", "failed"]) }).strict();
const applicationAttachmentSchema = z.object({ name: z.string().trim().min(1), status: z.enum(["ready", "missing", "manual_only"]), locator: z.string().trim().min(1).optional() }).strict();
const traceInputSchema = z.object({
  runId: z.uuid().optional(), traceId: z.string().regex(/^[a-f0-9]{32}$/i), spanId: z.string().regex(/^[a-f0-9]{16}$/i), parentSpanId: z.string().regex(/^[a-f0-9]{16}$/i).optional(),
  name: z.string().trim().min(1), startedAt: z.iso.datetime(), endedAt: z.iso.datetime().optional(), status: z.enum(["unset", "ok", "error"]), attributes: z.record(z.string(), z.unknown())
}).strict();

function parseJson<T>(value: string) { return JSON.parse(value) as T }
export function csvCell(value: unknown) {
  const text = String(value ?? "");
  let prefixIndex = 0;
  let spreadsheetFormula = false;
  while (prefixIndex < text.length) {
    const code = text.charCodeAt(prefixIndex);
    if (code === 0x09 || code === 0x0d) { spreadsheetFormula = true; break; }
    const leadingControlOrSpace = code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x20);
    if (!leadingControlOrSpace) { spreadsheetFormula = "=+-@".includes(text[prefixIndex]); break; }
    prefixIndex += 1;
  }
  const neutralized = spreadsheetFormula ? `'${text}` : text;
  return `"${neutralized.replaceAll('"', '""')}"`;
}
const publicTraceFields = new Set(["queryText", "source", "retrievedAt", "sourceTier", "sourceUrl", "locator", "lifecycle", "confidence", "dedupDecision", "eligibility", "matchExplanation", "failure", "queryCount", "sourceCount", "resultCount", "beforeScope", "afterScope"]);
const reviewedAtsHosts = new Set(["boards.greenhouse.io", "jobs.lever.co", "jobs.ashbyhq.com"]);

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
      this.database.prepare("INSERT INTO candidate_profile_versions(id, workspace_id, version, headline, skills_json, targeting_constraints_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, input.workspaceId, version, profile.headline, JSON.stringify(profile.skills), JSON.stringify(profile.targetingConstraints), createdAt);
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
    await this.requireWorkspace(input.workspaceId);
    const status = input.status ?? "completed";
    return this.transaction(() => {
      this.requireRunningSearchRun(input.workspaceId, input.runId);
      const finishedAt = new Date().toISOString();
      const result = this.database.prepare("UPDATE search_runs SET status = ?, finished_at = ? WHERE workspace_id = ? AND id = ? AND status = 'running'").run(status, finishedAt, input.workspaceId, input.runId);
      if (result.changes !== 1) throw new Error(`Search run is closed: ${input.runId}`);
      return this.searchRunFromRow(this.database.prepare("SELECT * FROM search_runs WHERE workspace_id = ? AND id = ?").get(input.workspaceId, input.runId) as SearchRunRow);
    });
  }

  async recordSearchBatch(input: { workspaceId: string; runId: string; query?: z.input<typeof queryAttemptInputSchema>; opportunities: OpportunityInput[] }) {
    await this.requireWorkspace(input.workspaceId);
    const parsed = batchInputSchema.parse({ query: input.query, opportunities: input.opportunities });
    const recorded = this.transaction(() => {
      this.requireRunningSearchRun(input.workspaceId, input.runId);
      let queryAttempt: QueryAttempt | null = null;
      if (parsed.query) {
        const now = new Date().toISOString();
        const id = randomUUID();
        const retrievedAt = parsed.query.retrievedAt ?? now;
        const locator = parsed.query.locator ?? parsed.query.source;
        const failure = parsed.query.failure ? { code: parsed.query.failure.code, summary: redactPublicText(parsed.query.failure.summary) } : null;
        this.database.prepare("INSERT INTO query_events(id, workspace_id, search_run_id, query_text, source, created_at, outcome_status, retrieved_at, locator, source_tier, failure_code, failure_summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, input.workspaceId, input.runId, parsed.query.text, parsed.query.source, now, parsed.query.status, retrievedAt, locator, parsed.query.sourceTier, failure?.code ?? null, failure?.summary ?? null);
        queryAttempt = { id, runId: input.runId, text: parsed.query.text, source: parsed.query.source, status: parsed.query.status, retrievedAt, locator, sourceTier: parsed.query.sourceTier, failure };
      }
      const opportunityIds = [...new Set(parsed.opportunities.map((opportunity) => this.recordOpportunity(input.workspaceId, input.runId, opportunity)))];
      return { queryAttempt, opportunityIds };
    });
    return { recorded: parsed.opportunities.length, query: recorded.queryAttempt ? this.publicQueryAttempt(recorded.queryAttempt) : null, opportunities: recorded.opportunityIds.map((id) => this.publicOpportunity(this.readOpportunity(input.workspaceId, id, input.runId))) };
  }

  async queryOpportunities(input: { workspaceId: string; runId?: string; kind?: Opportunity["kind"]; eligibility?: Eligibility; evidenceStatus?: EvidenceStatus; limit?: number }): Promise<PublicOpportunity[]> {
    await this.requireWorkspace(input.workspaceId);
    if (input.runId) this.requireSearchRun(input.workspaceId, input.runId);
    let rows = (input.runId
      ? this.database.prepare("SELECT opportunity.* FROM opportunities AS opportunity WHERE opportunity.workspace_id = ? AND EXISTS (SELECT 1 FROM source_observations AS observation WHERE observation.workspace_id = opportunity.workspace_id AND observation.opportunity_id = opportunity.id AND observation.search_run_id = ?) ORDER BY opportunity.updated_at DESC, opportunity.id").all(input.workspaceId, input.runId)
      : this.database.prepare("SELECT * FROM opportunities WHERE workspace_id = ? ORDER BY updated_at DESC, id").all(input.workspaceId)) as unknown as OpportunityRow[];
    if (input.kind) rows = rows.filter(({ kind }) => kind === input.kind);
    if (input.eligibility) rows = rows.filter(({ eligibility }) => eligibility === input.eligibility);
    let opportunities = rows.map((row) => this.opportunityFromRow(row, input.runId));
    if (input.evidenceStatus) opportunities = opportunities.filter(({ evidenceStatus }) => evidenceStatus === input.evidenceStatus);
    if (input.limit !== undefined) opportunities = opportunities.slice(0, input.limit);
    return opportunities.map((opportunity) => this.publicOpportunity(opportunity));
  }

  async recordFeedback(input: { workspaceId: string; opportunityId: string; disposition: FeedbackDisposition; reason?: string; confirmedPreferenceSnapshot?: PreferenceSnapshotData; preferenceBaseVersion?: number | null }) {
    await this.requireWorkspace(input.workspaceId);
    const disposition = feedbackDispositionSchema.parse(input.disposition);
    const reason = input.reason === undefined ? null : z.string().trim().min(1).max(1000).parse(input.reason);
    const confirmed = input.confirmedPreferenceSnapshot ? preferenceSnapshotDataSchema.parse(input.confirmedPreferenceSnapshot) : undefined;
    return this.transaction(() => {
      this.requireOpportunity(input.workspaceId, input.opportunityId);
      if (["rejected", "information_error", "closed"].includes(disposition) && reason === null) throw new Error(`A non-empty reason is required for ${disposition} feedback.`);
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
      this.database.prepare("INSERT INTO feedback(id, workspace_id, opportunity_id, disposition, preference_version, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, input.workspaceId, input.opportunityId, disposition, preferenceVersion, reason, createdAt);
      return { id, workspaceId: input.workspaceId, opportunityId: input.opportunityId, disposition, preferenceVersion, reason, createdAt };
    });
  }

  async upsertApplicationPacket(input: { workspaceId: string; packetId?: string; opportunityId?: string; status: "draft" | "reviewed" | "ready_for_prefill"; fields: Array<{ key: string; label: string; value: string; provenance?: ApplicationFieldProvenance }>; audit?: ApplicationAudit; attachments?: Array<{ name: string; status: ApplicationAttachment["status"]; locator?: string }>; unknowns?: string[] }): Promise<ApplicationPacket> {
    await this.requireWorkspace(input.workspaceId);
    if ((input.status as string) === "submitted") throw new Error("Application packets can never have submitted status; final submission is manual-only.");
    const status = z.enum(["draft", "reviewed"]).parse(input.status);
    const fields = z.array(applicationFieldInputSchema).parse(input.fields);
    const audit = input.audit ? applicationAuditSchema.parse(input.audit) : null;
    const attachments: ApplicationAttachment[] = z.array(applicationAttachmentSchema).parse(input.attachments ?? []).map((attachment) => ({ ...attachment, locator: attachment.locator ?? null }));
    const unknowns = z.array(z.string().trim().min(1)).parse(input.unknowns ?? []);
    const duplicateKey = fields.find((field, index) => fields.findIndex((candidate) => candidate.key === field.key) !== index)?.key;
    if (duplicateKey) throw new Error(`Application field keys must be unique; duplicate key: ${duplicateKey}`);
    const classified = fields.map((field) => ({ ...field, classification: classifyApplicationField(field.key, field.label) }));
    const populatedManual = classified.find((field) => field.classification === "manual_only" && field.value.length > 0);
    if (populatedManual) throw new Error(`Manual-only field must remain blank: ${populatedManual.key}`);
    if (input.opportunityId) this.requireOpportunity(input.workspaceId, input.opportunityId);
    const packetId = input.packetId ?? randomUUID();
    const existing = input.packetId ? this.database.prepare("SELECT * FROM application_packets WHERE workspace_id = ? AND id = ?").get(input.workspaceId, input.packetId) as PacketRow | undefined : undefined;
    if (input.packetId && !existing) throw new Error(`Application packet not found: ${input.packetId}`);
    this.transaction(() => {
      const now = new Date().toISOString();
      const revision = existing ? existing.revision + 1 : 1;
      const existingFields = existing ? this.database.prepare("SELECT id, field_key FROM application_fields WHERE workspace_id = ? AND packet_id = ?").all(input.workspaceId, packetId) as Array<{ id: string; field_key: string }> : [];
      const stableIds = new Map(existingFields.map((field) => [field.field_key, field.id]));
      if (existing) {
        this.database.prepare("UPDATE application_packets SET opportunity_id = ?, status = ?, revision = ?, audit_version = ?, audit_retrieved_at = ?, audit_destination_url = ?, audit_status = ?, attachments_json = ?, unknowns_json = ?, updated_at = ? WHERE workspace_id = ? AND id = ?").run(input.opportunityId ?? existing.opportunity_id, status, revision, audit?.version ?? null, audit?.retrievedAt ?? null, audit?.destinationUrl ?? null, audit?.status ?? null, JSON.stringify(attachments), JSON.stringify(unknowns), now, input.workspaceId, packetId);
        this.database.prepare("DELETE FROM application_fields WHERE workspace_id = ? AND packet_id = ?").run(input.workspaceId, packetId);
      } else this.database.prepare("INSERT INTO application_packets(id, workspace_id, opportunity_id, status, revision, audit_version, audit_retrieved_at, audit_destination_url, audit_status, attachments_json, unknowns_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(packetId, input.workspaceId, input.opportunityId ?? null, status, revision, audit?.version ?? null, audit?.retrievedAt ?? null, audit?.destinationUrl ?? null, audit?.status ?? null, JSON.stringify(attachments), JSON.stringify(unknowns), now, now);
      const insert = this.database.prepare("INSERT INTO application_fields(id, workspace_id, packet_id, field_key, label, value, classification, provenance_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      for (const field of classified) insert.run(stableIds.get(field.key) ?? randomUUID(), input.workspaceId, packetId, field.key, field.label, field.value, field.classification, field.provenance ? JSON.stringify(field.provenance) : null);
    });
    return this.readApplicationPacket(input.workspaceId, packetId);
  }

  async reviewApplicationPacket(input: { workspaceId: string; packetId: string; revision: number; acknowledgedFieldIds: string[] }): Promise<ApplicationPacket> {
    await this.requireWorkspace(input.workspaceId);
    z.object({ revision: z.number().int().positive(), acknowledgedFieldIds: z.array(z.uuid()).max(100) }).parse({ revision: input.revision, acknowledgedFieldIds: input.acknowledgedFieldIds });
    return this.transaction(() => {
      const packet = this.readApplicationPacket(input.workspaceId, input.packetId);
      if (packet.revision !== input.revision) throw new Error(`Application packet revision conflict: current ${packet.revision}, received ${input.revision}.`);
      if (packet.fields.some((field) => field.classification === "manual_only" && field.value.length > 0)) throw new Error("Manual-only fields must remain blank before review.");
      const confirmIds = new Set(packet.fields.filter(({ classification }) => classification === "confirm").map(({ id }) => id));
      const acknowledged = new Set(input.acknowledgedFieldIds);
      if ([...confirmIds].some((id) => !acknowledged.has(id)) || [...acknowledged].some((id) => !confirmIds.has(id))) throw new Error("Every confirm field must be acknowledged by its current field ID.");
      const nextRevision = packet.revision + 1;
      this.database.prepare("UPDATE application_packets SET status = 'ready_for_prefill', revision = ?, updated_at = ? WHERE workspace_id = ? AND id = ? AND revision = ?").run(nextRevision, new Date().toISOString(), input.workspaceId, input.packetId, packet.revision);
      return this.readApplicationPacket(input.workspaceId, input.packetId);
    });
  }

  async recordTraceEvent(input: { workspaceId: string; runId?: string; traceId: string; spanId: string; parentSpanId?: string; name: string; startedAt: string; endedAt?: string; status: "unset" | "ok" | "error"; attributes: Record<string, unknown> }): Promise<TraceEvent> {
    await this.requireWorkspace(input.workspaceId);
    const parsed = traceInputSchema.parse({ runId: input.runId, traceId: input.traceId, spanId: input.spanId, parentSpanId: input.parentSpanId, name: input.name, startedAt: input.startedAt, endedAt: input.endedAt, status: input.status, attributes: input.attributes });
    const event: TraceEvent = { id: randomUUID(), workspaceId: input.workspaceId, runId: parsed.runId ?? null, traceId: parsed.traceId, spanId: parsed.spanId, parentSpanId: parsed.parentSpanId ?? null, name: parsed.name, startedAt: parsed.startedAt, endedAt: parsed.endedAt ?? null, status: parsed.status, attributes: redactTraceAttributes(parsed.attributes) as Record<string, unknown> };
    return this.transaction(() => {
      if (parsed.runId) this.requireRunningSearchRun(input.workspaceId, parsed.runId);
      this.database.prepare("INSERT INTO trace_events(id, workspace_id, run_id, trace_id, span_id, parent_span_id, name, started_at, ended_at, status, attributes_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(event.id, event.workspaceId, event.runId, event.traceId, event.spanId, event.parentSpanId, event.name, event.startedAt, event.endedAt, event.status, JSON.stringify(event.attributes));
      return event;
    });
  }

  async getTraceEvents(input: { workspaceId: string }): Promise<TraceEvent[]> {
    await this.requireWorkspace(input.workspaceId);
    const rows = this.database.prepare("SELECT * FROM trace_events WHERE workspace_id = ? ORDER BY started_at, id").all(input.workspaceId) as unknown as TraceRow[];
    return rows.map((row) => this.traceFromRow(row));
  }

  async getWorkspaceSnapshot(input: { workspaceId: string }): Promise<WorkspaceRecoverySnapshot> {
    const workspace = await this.requireWorkspace(input.workspaceId);
    return this.publicRecoverySnapshot(this.internalRecoverySnapshot(workspace));
  }

  async exportWorkspace(input: { workspaceId: string; format: "json" | "markdown" | "csv"; includeContent?: boolean }) {
    const workspace = await this.requireWorkspace(input.workspaceId);
    if (input.includeContent && input.format !== "json") throw new Error("Structured content is available only for JSON exports.");
    const opportunities = await this.queryOpportunities({ workspaceId: input.workspaceId });
    let contents: string;
    let extension: string;
    let publicSnapshot: WorkspaceRecoverySnapshot | undefined;
    if (input.format === "json") {
      extension = "json";
      publicSnapshot = this.publicRecoverySnapshot(this.internalRecoverySnapshot(workspace));
      contents = JSON.stringify(publicSnapshot, null, 2);
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
    return { format: input.format, path, snapshot: publicSnapshot! };
  }

  private internalRecoverySnapshot(workspace: Workspace): InternalWorkspaceRecoverySnapshot {
    const latestProfile = this.database.prepare("SELECT id, version, headline, skills_json, targeting_constraints_json, created_at FROM candidate_profile_versions WHERE workspace_id = ? ORDER BY version DESC LIMIT 1").get(workspace.id) as { id: string; version: number; headline: string; skills_json: string; targeting_constraints_json: string | null; created_at: string } | undefined;
    const latestSearchBrief = this.database.prepare("SELECT version, data_json, created_at FROM search_brief_versions WHERE workspace_id = ? ORDER BY version DESC LIMIT 1").get(workspace.id) as { version: number; data_json: string; created_at: string } | undefined;
    const latestPreference = this.database.prepare("SELECT version, data_json, created_at FROM preference_snapshot_versions WHERE workspace_id = ? ORDER BY version DESC LIMIT 1").get(workspace.id) as { version: number; data_json: string; created_at: string } | undefined;
    const runs = this.database.prepare("SELECT * FROM search_runs WHERE workspace_id = ? ORDER BY started_at, id").all(workspace.id) as SearchRunRow[];
    const feedback = this.database.prepare("SELECT id, opportunity_id, disposition, preference_version, reason, created_at FROM feedback WHERE workspace_id = ? ORDER BY created_at, id").all(workspace.id) as Array<{ id: string; opportunity_id: string; disposition: FeedbackDisposition; preference_version: number | null; reason: string | null; created_at: string }>;
    const packets = this.database.prepare("SELECT * FROM application_packets WHERE workspace_id = ? ORDER BY updated_at DESC, id DESC").all(workspace.id) as PacketRow[];
    const opportunities = this.database.prepare("SELECT * FROM opportunities WHERE workspace_id = ? ORDER BY updated_at DESC, id").all(workspace.id) as OpportunityRow[];

    return {
      workspace: { id: workspace.id, name: workspace.name, createdAt: workspace.createdAt },
      resumeImported: Boolean(this.database.prepare("SELECT id FROM resumes WHERE workspace_id = ? LIMIT 1").get(workspace.id)),
      latestProfile: latestProfile ? {
        version: latestProfile.version,
        headline: latestProfile.headline,
        skills: parseJson<string[]>(latestProfile.skills_json),
        positioningTracks: (this.database.prepare("SELECT name, summary, target_roles_json FROM positioning_tracks WHERE workspace_id = ? AND profile_version_id = ? ORDER BY id").all(workspace.id, latestProfile.id) as Array<{ name: string; summary: string; target_roles_json: string }>).map((track) => ({ name: track.name, summary: track.summary, targetRoles: parseJson<string[]>(track.target_roles_json) })),
        targetingConstraints: this.parseTargetingConstraints(latestProfile.targeting_constraints_json),
        createdAt: latestProfile.created_at
      } : null,
      latestSearchBrief: latestSearchBrief ? { version: latestSearchBrief.version, data: this.parseSearchBrief(latestSearchBrief.data_json), createdAt: latestSearchBrief.created_at } : null,
      latestPreference: latestPreference ? (() => {
        const preference = parseJson<PreferenceSnapshotData>(latestPreference.data_json);
        return { version: latestPreference.version, data: { preferredLocations: preference.preferredLocations, preferredRoles: preference.preferredRoles }, createdAt: latestPreference.created_at };
      })() : null,
      runs: runs.map((run) => ({
        ...this.searchRunFromRow(run),
        searchBrief: this.parseSearchBrief((this.database.prepare("SELECT data_json FROM search_brief_versions WHERE workspace_id = ? AND version = ?").get(workspace.id, run.search_brief_version) as { data_json: string }).data_json),
        queryAttempts: (this.database.prepare("SELECT * FROM query_events WHERE workspace_id = ? AND search_run_id = ? ORDER BY created_at, rowid").all(workspace.id, run.id) as unknown as QueryAttemptRow[]).map((row) => this.queryAttemptFromRow(row)),
        summary: {
          queryCount: (this.database.prepare("SELECT COUNT(*) AS count FROM query_events WHERE workspace_id = ? AND search_run_id = ?").get(workspace.id, run.id) as { count: number }).count,
          sourceCount: (this.database.prepare("SELECT COUNT(DISTINCT source) AS count FROM query_events WHERE workspace_id = ? AND search_run_id = ?").get(workspace.id, run.id) as { count: number }).count,
          opportunityCount: (this.database.prepare("SELECT COUNT(DISTINCT opportunity_id) AS count FROM source_observations WHERE workspace_id = ? AND search_run_id = ?").get(workspace.id, run.id) as { count: number }).count
        }
      })),
      feedback: feedback.map((item) => ({ id: item.id, opportunityId: item.opportunity_id, disposition: item.disposition, preferenceVersion: item.preference_version, reason: item.reason, createdAt: item.created_at })),
      applicationPackets: packets.map((packet) => ({
        id: packet.id,
        opportunityId: packet.opportunity_id,
        status: packet.status,
        revision: packet.revision,
        audit: this.auditFromRow(packet),
        attachments: parseJson<ApplicationAttachment[]>(packet.attachments_json),
        unknowns: parseJson<string[]>(packet.unknowns_json),
        fields: (this.database.prepare("SELECT id, field_key, label, classification, provenance_json FROM application_fields WHERE workspace_id = ? AND packet_id = ? ORDER BY id").all(workspace.id, packet.id) as Array<{ id: string; field_key: string; label: string; classification: ApplicationFieldClassification; provenance_json: string | null }>).map((field) => ({ id: field.id, key: field.field_key, label: field.label, classification: field.classification, provenance: field.provenance_json ? parseJson<ApplicationFieldProvenance>(field.provenance_json) : null })),
        createdAt: packet.created_at,
        updatedAt: packet.updated_at
      })),
      opportunities: opportunities.map((row) => this.opportunityFromRow(row)),
      trace: (this.database.prepare("SELECT * FROM trace_events WHERE workspace_id = ? ORDER BY started_at, id").all(workspace.id) as unknown as TraceRow[]).map((row) => this.traceFromRow(row))
    };
  }

  private applicationGuidance(packet: InternalRecoveryApplicationPacket, opportunity: Opportunity | undefined, now = Date.now()): ApplicationGuidanceDecision {
    const reasons: string[] = [];
    if (!opportunity || packet.opportunityId !== opportunity.id) reasons.push("opportunity_mismatch");
    if (opportunity?.evidenceStatus !== "verified_open") reasons.push("opportunity_not_verified_open");
    if (!packet.audit || packet.audit.status !== "verified") reasons.push("audit_not_verified");
    const retrievedAt = packet.audit ? Date.parse(packet.audit.retrievedAt) : Number.NaN;
    if (!Number.isFinite(retrievedAt) || retrievedAt > now || now - retrievedAt > 24 * 60 * 60 * 1000) reasons.push("audit_not_current");
    const latestOfficial = opportunity?.sourceObservations.filter(({ sourceType }) => sourceType === "official").sort((a, b) => a.observedAt.localeCompare(b.observedAt)).at(-1);
    if (!latestOfficial || latestOfficial.status !== "open") reasons.push("official_observation_not_open");
    let canonical: URL | null = null;
    let official: URL | null = null;
    let audited: URL | null = null;
    try {
      canonical = opportunity?.canonicalApplyUrl ? new URL(opportunity.canonicalApplyUrl) : null;
      official = latestOfficial ? new URL(latestOfficial.sourceUrl) : null;
      audited = packet.audit ? new URL(packet.audit.destinationUrl) : null;
    } catch { reasons.push("destination_invalid"); }
    if (!canonical || !official || !audited) {
      if (!reasons.includes("destination_invalid")) reasons.push("destination_invalid");
    } else {
      if (canonical.protocol !== "https:" || !reviewedAtsHosts.has(canonical.hostname)) reasons.push("ats_not_reviewed");
      if (canonical.toString() !== official.toString() || canonical.toString() !== audited.toString()) reasons.push("destination_mismatch");
    }
    if (!packet.fields.filter(({ classification }) => classification !== "manual_only").every(({ provenance }) => provenance?.reviewed === true && provenance.sensitive === false)) reasons.push("field_provenance_not_reviewed");
    return { mode: reasons.length ? "copy" : "reviewed", reasons: [...new Set(reasons)], auditVersion: packet.audit?.version ?? null };
  }

  private publicRecoverySnapshot(snapshot: InternalWorkspaceRecoverySnapshot): WorkspaceRecoverySnapshot {
    const opportunities = snapshot.opportunities.map((item) => this.publicOpportunity(item));
    return {
      workspace: { ...snapshot.workspace, name: redactPublicText(snapshot.workspace.name) },
      resumeImported: snapshot.resumeImported,
      latestProfile: snapshot.latestProfile ? { ...snapshot.latestProfile, headline: redactPublicText(snapshot.latestProfile.headline), skills: snapshot.latestProfile.skills.map(redactPublicText), positioningTracks: snapshot.latestProfile.positioningTracks.map((track) => ({ name: redactPublicText(track.name), summary: redactPublicText(track.summary), targetRoles: track.targetRoles.map(redactPublicText) })), targetingConstraints: this.publicTargetingConstraints(snapshot.latestProfile.targetingConstraints) } : null,
      latestSearchBrief: snapshot.latestSearchBrief ? { ...snapshot.latestSearchBrief, data: { keywords: snapshot.latestSearchBrief.data.keywords.map(redactPublicText), locations: snapshot.latestSearchBrief.data.locations.map(redactPublicText), targetingConstraints: this.publicTargetingConstraints(snapshot.latestSearchBrief.data.targetingConstraints) } } : null,
      latestPreference: snapshot.latestPreference ? { ...snapshot.latestPreference, data: { preferredLocations: snapshot.latestPreference.data.preferredLocations.map(redactPublicText), preferredRoles: snapshot.latestPreference.data.preferredRoles.map(redactPublicText) } } : null,
      runs: snapshot.runs.map((run) => ({ ...run, searchBrief: { keywords: run.searchBrief.keywords.map(redactPublicText), locations: run.searchBrief.locations.map(redactPublicText), targetingConstraints: this.publicTargetingConstraints(run.searchBrief.targetingConstraints) }, queryAttempts: run.queryAttempts.map((attempt) => this.publicQueryAttempt(attempt)) })),
      feedback: snapshot.feedback.map((item) => ({ ...item, reason: item.reason ? redactPublicText(item.reason) : null })),
      applicationPackets: snapshot.applicationPackets.map((packet) => ({ ...packet, audit: packet.audit ? { ...packet.audit, destinationUrl: redactPublicUrl(packet.audit.destinationUrl) } : null, guidance: this.applicationGuidance(packet, snapshot.opportunities.find(({ id }) => id === packet.opportunityId)), attachments: packet.attachments.map((item) => ({ ...item, name: redactPublicText(item.name), locator: item.locator ? redactPublicText(item.locator) : null })), unknowns: packet.unknowns.map(redactPublicText), fields: packet.fields.map((field) => ({ ...field, key: redactPublicText(field.key), label: redactPublicText(field.label), provenance: field.provenance ? { ...field.provenance, locator: redactPublicText(field.provenance.locator) } : null })) })),
      opportunities,
      trace: snapshot.trace.map((event) => {
        const attributes: Record<string, string | number | boolean | null> = {};
        for (const [key, value] of Object.entries(event.attributes)) {
          if (!publicTraceFields.has(key)) continue;
          if (key === "sourceUrl") attributes[key] = typeof value === "string" ? redactPublicUrl(value) : null;
          else if (typeof value === "string") attributes[key] = redactPublicText(value);
          else if (typeof value === "number" || typeof value === "boolean" || value === null) attributes[key] = value;
        }
        return { ...event, name: redactPublicText(event.name), attributes };
      })
    };
  }

  private publicOpportunity(item: Opportunity): PublicOpportunity {
    return {
      ...item,
      company: redactPublicText(item.company), title: redactPublicText(item.title), location: redactPublicText(item.location),
      canonicalApplyUrl: redactPublicUrl(item.canonicalApplyUrl), requisitionId: item.requisitionId ? redactPublicText(item.requisitionId) : null,
      sourceObservations: item.sourceObservations.map((observation) => ({ ...observation, sourceUrl: redactPublicUrl(observation.sourceUrl), locator: this.publicLocator(observation.locator), conflict: observation.conflict ? { ...observation.conflict, summary: redactPublicText(observation.conflict.summary), relatedLocator: observation.conflict.relatedLocator ? this.publicLocator(observation.conflict.relatedLocator) : undefined } : null })),
      match: item.match ? { runId: item.match.runId, score: item.match.score, factors: Object.fromEntries(Object.entries(item.match.factors).map(([key, value]) => [redactPublicText(key), value])), reasons: item.match.reasons.map(redactPublicText), gaps: item.match.gaps.map(redactPublicText), unknowns: item.match.unknowns.map(redactPublicText) } : null
    };
  }

  private recordOpportunity(workspaceId: string, runId: string, input: OpportunityInput) {
    const keys = opportunityKeys(input);
    const { matches, matchedBy } = this.findOpportunityMatches(workspaceId, keys);
    const row = matches[0];
    const now = new Date().toISOString();
    const opportunityId = row?.id ?? randomUUID();
    const mergedOpportunityIds = matches.slice(1).map(({ id }) => id);
    if (!row) {
      const initialEvidence = deriveEvidenceStatus([{ sourceType: input.evidence.sourceType, status: input.evidence.status }]);
      this.database.prepare("INSERT INTO opportunities(id, workspace_id, kind, company, title, location, canonical_apply_url, requisition_id, normalized_url, normalized_requisition, normalized_fallback, eligibility, evidence_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(opportunityId, workspaceId, input.kind, input.company.trim(), input.title.trim(), input.location.trim(), keys.normalizedUrl, input.requisitionId?.trim() ?? null, keys.normalizedUrl, keys.normalizedRequisition, keys.normalizedFallback, input.eligibility, initialEvidence, now, now);
    } else {
      for (const duplicate of matches.slice(1)) this.mergeOpportunityInto(workspaceId, opportunityId, duplicate.id);
      this.database.prepare("UPDATE opportunities SET canonical_apply_url = COALESCE(canonical_apply_url, ?), requisition_id = COALESCE(requisition_id, ?), normalized_url = COALESCE(normalized_url, ?), normalized_requisition = COALESCE(normalized_requisition, ?), updated_at = ? WHERE workspace_id = ? AND id = ?").run(keys.normalizedUrl, input.requisitionId?.trim() ?? null, keys.normalizedUrl, keys.normalizedRequisition, now, workspaceId, opportunityId);
    }
    this.registerOpportunityAliases(workspaceId, opportunityId, keys, now);
    const retrievedAt = input.evidence.retrievedAt ?? input.evidence.observedAt ?? now;
    const observedAt = input.evidence.observedAt ?? retrievedAt;
    const sourceTier = input.evidence.sourceTier ?? (input.evidence.sourceType === "official" ? "primary" : "discovery");
    const locator = input.evidence.locator ?? input.evidence.sourceUrl;
    const dedupeDecision: DedupeDecision = {
      action: !row ? "created" : mergedOpportunityIds.length ? "merged" : "matched",
      matchedBy: matchedBy ?? "none",
      survivorOpportunityId: opportunityId,
      mergedOpportunityIds
    };
    this.database.prepare("INSERT INTO source_observations(id, workspace_id, opportunity_id, search_run_id, source_url, source_type, status, observed_at, source_tier, retrieved_at, locator, confidence, deadline, conflict_json, dedupe_decision_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), workspaceId, opportunityId, runId, input.evidence.sourceUrl, input.evidence.sourceType, input.evidence.status, observedAt, sourceTier, retrievedAt, locator, input.evidence.confidence, input.evidence.deadline ?? null, input.evidence.conflict ? JSON.stringify(input.evidence.conflict) : null, JSON.stringify(dedupeDecision));
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
    let matchedBy: OpportunityAliasKeyType | undefined;
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
          matchedBy ??= keyType;
        }
      }
    }
    return { matches, matchedBy };
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

  private readOpportunity(workspaceId: string, opportunityId: string, runId?: string) {
    const row = this.database.prepare("SELECT * FROM opportunities WHERE workspace_id = ? AND id = ?").get(workspaceId, opportunityId) as OpportunityRow | undefined;
    if (!row) throw new Error(`Opportunity not found: ${opportunityId}`);
    return this.opportunityFromRow(row, runId);
  }

  private opportunityFromRow(row: OpportunityRow, runId?: string): Opportunity {
    const observationRows = (runId
      ? this.database.prepare("SELECT * FROM source_observations WHERE workspace_id = ? AND opportunity_id = ? AND search_run_id = ? ORDER BY observed_at, rowid").all(row.workspace_id, row.id, runId)
      : this.database.prepare("SELECT * FROM source_observations WHERE workspace_id = ? AND opportunity_id = ? ORDER BY observed_at, rowid").all(row.workspace_id, row.id)) as unknown as ObservationRow[];
    const match = (runId
      ? this.database.prepare("SELECT * FROM match_assessments WHERE workspace_id = ? AND opportunity_id = ? AND search_run_id = ? ORDER BY rowid DESC LIMIT 1").get(row.workspace_id, row.id, runId)
      : this.database.prepare("SELECT * FROM match_assessments WHERE workspace_id = ? AND opportunity_id = ? ORDER BY rowid DESC LIMIT 1").get(row.workspace_id, row.id)) as MatchRow | undefined;
    const evidenceStatus = runId ? deriveEvidenceStatus(observationRows.map((item) => ({ sourceType: item.source_type, status: item.status }))) : row.evidence_status;
    return { id: row.id, workspaceId: row.workspace_id, kind: row.kind, company: row.company, title: row.title, location: row.location, canonicalApplyUrl: row.canonical_apply_url, requisitionId: row.requisition_id, eligibility: row.eligibility, evidenceStatus,
      sourceObservations: observationRows.map((item) => ({ id: item.id, runId: item.search_run_id, sourceUrl: item.source_url, sourceType: item.source_type, sourceTier: item.source_tier ?? (item.source_type === "official" ? "primary" : "discovery"), status: item.status, observedAt: item.observed_at, retrievedAt: item.retrieved_at ?? item.observed_at, locator: item.locator ?? item.source_url, confidence: item.confidence, deadline: item.deadline, conflict: item.conflict_json ? parseJson<ObservationConflict>(item.conflict_json) : null, dedupeDecision: parseJson<DedupeDecision>(item.dedupe_decision_json) })),
      match: match ? { runId: match.search_run_id, score: match.score, factors: parseJson(match.factors_json), reasons: parseJson(match.reasons_json), gaps: parseJson(match.gaps_json), unknowns: parseJson(match.unknowns_json) } : null, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  private readApplicationPacket(workspaceId: string, packetId: string): ApplicationPacket {
    const row = this.database.prepare("SELECT * FROM application_packets WHERE workspace_id = ? AND id = ?").get(workspaceId, packetId) as PacketRow | undefined;
    if (!row) throw new Error(`Application packet not found: ${packetId}`);
    const fields = this.database.prepare("SELECT id, field_key, label, value, classification, provenance_json FROM application_fields WHERE workspace_id = ? AND packet_id = ? ORDER BY rowid").all(workspaceId, packetId) as unknown as FieldRow[];
    return { id: row.id, workspaceId: row.workspace_id, opportunityId: row.opportunity_id, status: row.status, revision: row.revision, audit: this.auditFromRow(row), attachments: parseJson<ApplicationAttachment[]>(row.attachments_json), unknowns: parseJson<string[]>(row.unknowns_json), fields: fields.map((field) => ({ id: field.id, key: field.field_key, label: field.label, value: field.value, classification: field.classification, provenance: field.provenance_json ? parseJson<ApplicationFieldProvenance>(field.provenance_json) : null })), createdAt: row.created_at, updatedAt: row.updated_at };
  }

  private auditFromRow(row: PacketRow): ApplicationAudit | null {
    return row.audit_version && row.audit_retrieved_at && row.audit_destination_url && row.audit_status ? { version: row.audit_version, retrievedAt: row.audit_retrieved_at, destinationUrl: row.audit_destination_url, status: row.audit_status } : null;
  }

  private requireOpportunity(workspaceId: string, opportunityId: string) {
    if (!this.database.prepare("SELECT id FROM opportunities WHERE workspace_id = ? AND id = ?").get(workspaceId, opportunityId)) throw new Error(`Opportunity not found: ${opportunityId}`);
  }

  private requireSearchRun(workspaceId: string, runId: string) {
    const row = this.database.prepare("SELECT * FROM search_runs WHERE workspace_id = ? AND id = ?").get(workspaceId, runId) as SearchRunRow | undefined;
    if (!row) throw new Error(`Search run not found: ${runId}`);
    return row;
  }

  private requireRunningSearchRun(workspaceId: string, runId: string) {
    const row = this.requireSearchRun(workspaceId, runId);
    if (row.status !== "running") throw new Error(`Search run is closed (${row.status}): ${runId}`);
    return row;
  }

  private parseTargetingConstraints(value: string | null | undefined) {
    if (!value) return safeUnknownTargetingConstraints();
    return profileDataSchema.shape.targetingConstraints.parse(parseJson(value));
  }

  private parseSearchBrief(value: string) {
    return searchBriefDataSchema.parse(parseJson(value));
  }

  private publicTargetingConstraints(constraints: TargetingConstraints): TargetingConstraints {
    return {
      ...constraints,
      levels: constraints.levels.map(redactPublicText),
      domains: constraints.domains.map(redactPublicText),
      availability: constraints.availability ? redactPublicText(constraints.availability) : null,
      workAuthorization: constraints.workAuthorization.map(redactPublicText),
      visa: constraints.visa ? redactPublicText(constraints.visa) : null,
      timing: constraints.timing ? redactPublicText(constraints.timing) : null,
      hardExclusions: constraints.hardExclusions.map(redactPublicText),
      unknowns: constraints.unknowns.map(redactPublicText),
      contradictions: constraints.contradictions.map((item) => ({ field: redactPublicText(item.field), details: item.details.map(redactPublicText) }))
    };
  }

  private publicLocator(value: string) {
    try {
      const url = new URL(value);
      if (["http:", "https:"].includes(url.protocol)) return redactPublicUrl(value) ?? "[REDACTED]";
    } catch { /* Locator may be a public page section or selector rather than a URL. */ }
    return redactPublicText(value);
  }

  private queryAttemptFromRow(row: QueryAttemptRow): QueryAttempt {
    return {
      id: row.id,
      runId: row.search_run_id,
      text: row.query_text,
      source: row.source,
      status: row.outcome_status,
      retrievedAt: row.retrieved_at ?? row.created_at,
      locator: row.locator ?? row.source,
      sourceTier: row.source_tier,
      failure: row.failure_code && row.failure_summary ? { code: row.failure_code, summary: row.failure_summary } : null
    };
  }

  private publicQueryAttempt(attempt: QueryAttempt): QueryAttempt {
    return {
      ...attempt,
      text: redactPublicText(attempt.text),
      source: redactPublicText(attempt.source),
      locator: this.publicLocator(attempt.locator),
      failure: attempt.failure ? { code: attempt.failure.code, summary: redactPublicText(attempt.failure.summary) } : null
    };
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
  private traceFromRow(row: TraceRow): TraceEvent { return { id: row.id, workspaceId: row.workspace_id, runId: row.run_id, traceId: row.trace_id, spanId: row.span_id, parentSpanId: row.parent_span_id, name: row.name, startedAt: row.started_at, endedAt: row.ended_at, status: row.status, attributes: parseJson(row.attributes_json) } }
}
