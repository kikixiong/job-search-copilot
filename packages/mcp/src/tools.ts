import {
  eligibilitySchema,
  evidenceStatusSchema,
  feedbackDispositionSchema,
  JobSearchService,
  opportunityInputSchema,
  opportunityKindSchema,
  preferenceSnapshotDataSchema,
  profileDataSchema,
  searchBriefDataSchema
} from "@kikixiong/job-search-copilot-core";
import { z } from "zod";

export const TOOL_NAMES = [
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

export type ToolName = (typeof TOOL_NAMES)[number];

export interface ViewerLauncher {
  urlFor(workspaceId: string): Promise<string>;
  open(url: string): Promise<void>;
}

export interface ToolRegistryOptions {
  service: JobSearchService;
  viewerLauncher?: ViewerLauncher;
}

type ToolDefinition = {
  name: ToolName;
  description: string;
  schema: z.ZodObject;
  handle(input: never): Promise<unknown>;
};

const workspaceId = z.uuid();
const packetProvenance = z.object({ source: z.enum(["profile", "resume", "user_confirmed", "official", "unknown"]), locator: z.string().trim().min(1), reviewed: z.boolean(), sensitive: z.boolean() }).strict();
const packetFields = z.array(z.object({ key: z.string().trim().min(1), label: z.string().trim().min(1), value: z.string(), provenance: packetProvenance.optional() }).strict());
const packetAudit = z.object({ version: z.number().int().positive(), retrievedAt: z.iso.datetime(), destinationUrl: z.url(), status: z.enum(["verified", "failed"]) }).strict();
const packetAttachments = z.array(z.object({ name: z.string().trim().min(1), status: z.enum(["ready", "missing", "manual_only"]), locator: z.string().trim().min(1).optional() }).strict());

function isLoopback(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
}

export function createToolRegistry({ service, viewerLauncher }: ToolRegistryOptions) {
  const definitions: ToolDefinition[] = [
    {
      name: "workspace_open",
      description: "Open or create an isolated local job-search workspace.",
      schema: z.object({ name: z.string().trim().min(1) }).strict(),
      handle: (input: { name: string }) => service.openWorkspace(input)
    },
    {
      name: "resume_import",
      description: "Copy and extract a supported resume into a workspace.",
      schema: z.object({ workspaceId, sourcePath: z.string().trim().min(1) }).strict(),
      handle: (input: { workspaceId: string; sourcePath: string }) => service.importResume(input)
    },
    {
      name: "profile_commit",
      description: "Commit a candidate profile using optimistic version control.",
      schema: z.object({ workspaceId, baseVersion: z.number().int().positive().nullable(), profile: profileDataSchema }).strict(),
      handle: (input: Parameters<JobSearchService["commitProfile"]>[0]) => service.commitProfile(input)
    },
    {
      name: "search_run_begin",
      description: "Create a search brief version and begin a snapshot-bound search run.",
      schema: z.object({ workspaceId, profileVersion: z.number().int().positive(), searchBrief: searchBriefDataSchema, preferenceVersion: z.number().int().positive().nullable() }).strict(),
      handle: (input: Parameters<JobSearchService["beginSearchRun"]>[0]) => service.beginSearchRun(input)
    },
    {
      name: "search_record_batch",
      description: "Transactionally record a query event and a batch of deduplicated opportunities.",
      schema: z.object({ workspaceId, runId: z.uuid(), query: z.object({ text: z.string().trim().min(1), source: z.string().trim().min(1) }).strict().optional(), opportunities: z.array(opportunityInputSchema) }).strict(),
      handle: (input: Parameters<JobSearchService["recordSearchBatch"]>[0]) => service.recordSearchBatch(input)
    },
    {
      name: "search_run_finish",
      description: "Finish a search run as completed or failed.",
      schema: z.object({ workspaceId, runId: z.uuid(), status: z.enum(["completed", "failed"]).optional() }).strict(),
      handle: (input: Parameters<JobSearchService["finishSearchRun"]>[0]) => service.finishSearchRun(input)
    },
    {
      name: "opportunities_query",
      description: "Query structured opportunities in a workspace.",
      schema: z.object({ workspaceId, kind: opportunityKindSchema.optional(), eligibility: eligibilitySchema.optional(), evidenceStatus: evidenceStatusSchema.optional(), limit: z.number().int().positive().max(1000).optional() }).strict(),
      handle: (input: Parameters<JobSearchService["queryOpportunities"]>[0]) => service.queryOpportunities(input)
    },
    {
      name: "feedback_record",
      description: "Record a disposition and optionally commit an explicitly confirmed preference snapshot.",
      schema: z.object({ workspaceId, opportunityId: z.uuid(), disposition: feedbackDispositionSchema, reason: z.string().trim().min(1).max(1000).optional(), confirmedPreferenceSnapshot: preferenceSnapshotDataSchema.optional(), preferenceBaseVersion: z.number().int().positive().nullable().optional() }).strict(),
      handle: (input: Parameters<JobSearchService["recordFeedback"]>[0]) => service.recordFeedback(input)
    },
    {
      name: "application_packet_upsert",
      description: "Create or update a local application packet without submitting it.",
      schema: z.object({ workspaceId, packetId: z.uuid().optional(), opportunityId: z.uuid().optional(), status: z.enum(["draft", "reviewed"]), fields: packetFields, audit: packetAudit.optional(), attachments: packetAttachments.optional(), unknowns: z.array(z.string().trim().min(1)).optional() }).strict(),
      handle: (input: Parameters<JobSearchService["upsertApplicationPacket"]>[0]) => service.upsertApplicationPacket(input)
    },
    {
      name: "application_packet_review",
      description: "Review a packet and mark it ready for prefill, never submitted.",
      schema: z.object({ workspaceId, packetId: z.uuid(), revision: z.number().int().positive(), acknowledgedFieldIds: z.array(z.uuid()).max(100) }).strict(),
      handle: (input: Parameters<JobSearchService["reviewApplicationPacket"]>[0]) => service.reviewApplicationPacket(input)
    },
    {
      name: "workspace_export",
      description: "Export workspace data as JSON, Markdown, or CSV beneath its export directory; JSON can explicitly include a redacted recovery snapshot.",
      schema: z.object({ workspaceId, format: z.enum(["json", "markdown", "csv"]), includeContent: z.boolean().optional() }).strict(),
      handle: (input: Parameters<JobSearchService["exportWorkspace"]>[0]) => service.exportWorkspace(input)
    },
    {
      name: "viewer_open",
      description: "Open the local Viewer when a safe Task 4 launcher is installed.",
      schema: z.object({ workspaceId }).strict(),
      handle: async (input: { workspaceId: string }) => {
        await service.queryOpportunities({ workspaceId: input.workspaceId, limit: 0 });
        if (!viewerLauncher) return { available: false, reason: "Viewer launcher is not installed." };
        const url = await viewerLauncher.urlFor(input.workspaceId);
        if (!isLoopback(url)) return { available: false, reason: "Viewer launcher refused a non-loopback URL." };
        await viewerLauncher.open(url);
        return { available: true, url };
      }
    }
  ];

  const byName = new Map(definitions.map((definition) => [definition.name, definition]));
  return {
    definitions,
    async invoke(name: ToolName, input: unknown): Promise<any> {
      const definition = byName.get(name);
      if (!definition) throw new Error(`Unknown tool: ${name}`);
      return definition.handle(definition.schema.parse(input) as never);
    }
  };
}
