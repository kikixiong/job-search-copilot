import { z } from "zod";

export const opportunityKindSchema = z.enum(["job", "internship"]);
export const eligibilitySchema = z.enum(["eligible", "ineligible", "unknown"]);
export const evidenceStatusSchema = z.enum(["verified_open", "official_lead", "community_lead", "conflict", "closed"]);
export const feedbackDispositionSchema = z.enum(["interested", "later", "rejected", "information_error", "closed", "applied"]);
export const applicationFieldClassificationSchema = z.enum(["safe", "confirm", "manual_only"]);

const nonEmpty = z.string().trim().min(1);

export const targetingConstraintStatusSchema = z.enum(["confirmed", "unknown", "contradiction"]);
export const searchBreadthSchema = z.enum(["quick", "balanced", "deep"]);
export const employmentTypeSchema = z.enum(["full_time", "part_time", "contract", "temporary", "internship", "apprenticeship"]);
const targetingContradictionSchema = z.object({ field: nonEmpty, details: z.array(nonEmpty).min(1) }).strict();
const legacyUnknownTargetingConstraints = {
  schemaVersion: 1 as const,
  status: "unknown" as const,
  targetKinds: [] as Array<"job" | "internship">,
  employmentTypes: [] as Array<z.infer<typeof employmentTypeSchema>>,
  levels: [] as string[],
  domains: [] as string[],
  availability: null,
  workAuthorization: [] as string[],
  visa: null,
  timing: null,
  hardExclusions: [] as string[],
  breadth: "balanced" as const,
  unknowns: ["Legacy data did not record targeting constraints."],
  contradictions: [] as Array<{ field: string; details: string[] }>
};

export const targetingConstraintsSchema = z.object({
  schemaVersion: z.literal(1),
  status: targetingConstraintStatusSchema,
  targetKinds: z.array(opportunityKindSchema).max(2),
  employmentTypes: z.array(employmentTypeSchema),
  levels: z.array(nonEmpty),
  domains: z.array(nonEmpty),
  availability: nonEmpty.nullable(),
  workAuthorization: z.array(nonEmpty),
  visa: nonEmpty.nullable(),
  timing: nonEmpty.nullable(),
  hardExclusions: z.array(nonEmpty),
  breadth: searchBreadthSchema,
  unknowns: z.array(nonEmpty),
  contradictions: z.array(targetingContradictionSchema)
}).strict().superRefine((constraints, context) => {
  if (constraints.status === "confirmed" && constraints.targetKinds.length === 0) {
    context.addIssue({ code: "custom", message: "Confirmed targeting requires at least one target kind.", path: ["targetKinds"] });
  }
  if (constraints.status === "confirmed" && constraints.contradictions.length > 0) {
    context.addIssue({ code: "custom", message: "Confirmed targeting cannot retain contradictions.", path: ["contradictions"] });
  }
  if (constraints.status === "unknown" && constraints.unknowns.length === 0) {
    context.addIssue({ code: "custom", message: "Unknown targeting must identify at least one unknown.", path: ["unknowns"] });
  }
  if (constraints.status === "contradiction" && constraints.contradictions.length === 0) {
    context.addIssue({ code: "custom", message: "Contradictory targeting must identify at least one contradiction.", path: ["contradictions"] });
  }
});

export function safeUnknownTargetingConstraints() {
  return structuredClone(legacyUnknownTargetingConstraints);
}

export const profileDataSchema = z.object({
  headline: nonEmpty,
  skills: z.array(nonEmpty),
  positioningTracks: z.array(z.object({
    name: nonEmpty,
    summary: nonEmpty,
    targetRoles: z.array(nonEmpty)
  }).strict()),
  targetingConstraints: targetingConstraintsSchema.default(safeUnknownTargetingConstraints)
}).strict();

export const searchBriefDataSchema = z.object({
  keywords: z.array(nonEmpty).min(1),
  locations: z.array(nonEmpty),
  targetingConstraints: targetingConstraintsSchema.default(safeUnknownTargetingConstraints)
}).strict();

export const preferenceSnapshotDataSchema = z.object({
  preferredLocations: z.array(nonEmpty).default([]),
  preferredRoles: z.array(nonEmpty).default([]),
  notes: z.string().default("")
}).strict();

export const matchInputSchema = z.object({
  score: z.number().min(0).max(100),
  factors: z.record(z.string(), z.number()),
  reasons: z.array(z.string()),
  gaps: z.array(z.string()),
  unknowns: z.array(z.string())
}).strict();

export const sourceTierSchema = z.enum(["primary", "official_lead", "discovery"]);
export const sourceConfidenceSchema = z.enum(["high", "medium", "low", "unknown"]);
export const observationConflictSchema = z.object({
  kind: z.enum(["lifecycle", "identity", "deadline", "other"]),
  summary: nonEmpty,
  relatedLocator: nonEmpty.optional()
}).strict();

export const sourceObservationInputSchema = z.object({
  sourceUrl: z.url(),
  sourceType: z.enum(["official", "community"]),
  sourceTier: sourceTierSchema.optional(),
  status: z.enum(["open", "closed", "lead"]),
  observedAt: z.iso.datetime().optional(),
  retrievedAt: z.iso.datetime().optional(),
  locator: nonEmpty.optional(),
  confidence: sourceConfidenceSchema.default("unknown"),
  deadline: z.iso.datetime().nullable().optional(),
  conflict: observationConflictSchema.optional()
}).strict();

export const queryOutcomeStatusSchema = z.enum(["success", "no_results", "timeout", "blocked", "limited", "missing", "error"]);
export const queryFailureSchema = z.object({
  code: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/),
  summary: z.string().trim().min(1).max(500)
}).strict();
export const queryAttemptInputSchema = z.object({
  text: nonEmpty,
  source: nonEmpty,
  status: queryOutcomeStatusSchema.default("success"),
  retrievedAt: z.iso.datetime().optional(),
  locator: nonEmpty.optional(),
  sourceTier: sourceTierSchema.default("discovery"),
  failure: queryFailureSchema.optional()
}).strict().superRefine((attempt, context) => {
  if (!["success", "no_results"].includes(attempt.status) && !attempt.failure) {
    context.addIssue({ code: "custom", message: `Query outcome ${attempt.status} requires a public failure code and summary.`, path: ["failure"] });
  }
  if (["success", "no_results"].includes(attempt.status) && attempt.failure) {
    context.addIssue({ code: "custom", message: `Query outcome ${attempt.status} cannot include a failure.`, path: ["failure"] });
  }
});

export const opportunityInputSchema = z.object({
  kind: opportunityKindSchema,
  company: nonEmpty,
  title: nonEmpty,
  location: nonEmpty,
  canonicalApplyUrl: z.url().optional(),
  requisitionId: nonEmpty.optional(),
  eligibility: eligibilitySchema,
  evidence: sourceObservationInputSchema,
  match: matchInputSchema.optional()
}).strict();

export type ProfileData = z.infer<typeof profileDataSchema>;
export type SearchBriefData = z.infer<typeof searchBriefDataSchema>;
export type PreferenceSnapshotData = z.infer<typeof preferenceSnapshotDataSchema>;
export type OpportunityInput = z.infer<typeof opportunityInputSchema>;
export type FeedbackDisposition = z.infer<typeof feedbackDispositionSchema>;
export type EvidenceStatus = z.infer<typeof evidenceStatusSchema>;
export type Eligibility = z.infer<typeof eligibilitySchema>;
export type ApplicationFieldClassification = z.infer<typeof applicationFieldClassificationSchema>;
export type TargetingConstraints = z.infer<typeof targetingConstraintsSchema>;
export type SourceTier = z.infer<typeof sourceTierSchema>;
export type SourceConfidence = z.infer<typeof sourceConfidenceSchema>;
export type ObservationConflict = z.infer<typeof observationConflictSchema>;
export type QueryAttemptInput = z.infer<typeof queryAttemptInputSchema>;
export type QueryOutcomeStatus = z.infer<typeof queryOutcomeStatusSchema>;

export function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

const trackingParameters = new Set(["fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "ref", "referrer"]);

export function normalizeCanonicalUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || trackingParameters.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function opportunityKeys(input: OpportunityInput) {
  const company = normalizeText(input.company);
  return {
    normalizedUrl: input.canonicalApplyUrl ? normalizeCanonicalUrl(input.canonicalApplyUrl) : null,
    normalizedRequisition: input.requisitionId ? `${company}\u0000${normalizeText(input.requisitionId)}` : null,
    normalizedFallback: `${company}\u0000${normalizeText(input.title)}\u0000${normalizeText(input.location)}`
  };
}

export function deriveEvidenceStatus(observations: Array<{ sourceType: "official" | "community"; status: "open" | "closed" | "lead" }>): EvidenceStatus {
  const official = observations.filter(({ sourceType }) => sourceType === "official");
  const hasOpen = official.some(({ status }) => status === "open");
  const hasClosed = official.some(({ status }) => status === "closed");
  if (hasOpen && hasClosed) return "conflict";
  if (hasOpen) return "verified_open";
  if (hasClosed) return "closed";
  if (official.length > 0) return "official_lead";
  return "community_lead";
}

const manualFieldPattern = /(eeo|demographic|race|ethnicity|gender|disabilit|veteran|consent|attestation|declaration|agree.{0,24}terms|terms.{0,24}agree|electronic.{0,8}signature|e.{0,3}signature|signature|captcha|mfa|multi.{0,3}factor|submit|apply.{0,3}now)/i;
const manualFieldChinesePattern = /(同意.{0,6}(条款|协议|声明)|接受.{0,6}(条款|协议|声明)|电子签名|电子签署|签名|签署|最终提交|确认提交|提交(?:申请|应聘|材料)?|立即申请)/u;
const safeFieldPattern = /^(full[_ -]?name|first[_ -]?name|last[_ -]?name|email|phone|linkedin|portfolio|website|resume)$/i;

export function classifyApplicationField(key: string, label: string): ApplicationFieldClassification {
  const combined = `${key} ${label}`.normalize("NFKC").replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (manualFieldPattern.test(combined) || manualFieldChinesePattern.test(combined)) return "manual_only";
  if (safeFieldPattern.test(key)) return "safe";
  return "confirm";
}

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const phonePattern = /(?:\+?\d[\d .()-]{7,}\d)/;
const bearerPattern = /\bBearer\s+[-A-Z0-9._~+/=]+/i;
const jwtPattern = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/i;
const apiKeyPattern = /\b(?:sk|pk|api)[-_][A-Za-z0-9_-]{8,}\b/i;
const namedSecretPattern = /\b(?:cookie|session|credential|authorization|access[_-]?token|api[_-]?key|secret|password)\b\s*[:=]\s*[^\s,;]+/i;
const fileUrlPattern = /file:\/\/[^\s,;]+/i;
const uncPathPattern = /\\\\[^\\\s]+\\[^\s,;]+/;
const windowsDrivePathPattern = /[A-Za-z]:[\\/](?![\\/])[^\s,;]+/;
const posixAbsolutePathPattern = /(?<!\/)\/(?!\/)[^\s,;]+/u;

export function containsSensitivePublicText(value: string) {
  return emailPattern.test(value) || phonePattern.test(value) || bearerPattern.test(value) || jwtPattern.test(value) || apiKeyPattern.test(value) || namedSecretPattern.test(value) || fileUrlPattern.test(value) || uncPathPattern.test(value) || windowsDrivePathPattern.test(value) || posixAbsolutePathPattern.test(value);
}

export function redactPublicText(value: string) {
  return containsSensitivePublicText(value) ? "[REDACTED]" : value;
}

const sensitiveUrlKeyPattern = /(?:token|api[_-]?key|secret|signature|auth|credential|password|cookie|session)/i;
const sensitiveUrlPathPattern = /(?:^|\/)(?:token|api[_-]?key|secret|credential|password|cookie|session|auth)(?:\/|:|=)[^/]+/i;

export function redactPublicUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const pathname = decodeURIComponent(url.pathname);
    if (emailPattern.test(pathname) || phonePattern.test(pathname) || bearerPattern.test(pathname) || jwtPattern.test(pathname) || apiKeyPattern.test(pathname) || namedSecretPattern.test(pathname) || sensitiveUrlPathPattern.test(pathname)) return null;
    for (const [key, parameter] of url.searchParams) if (sensitiveUrlKeyPattern.test(key) || containsSensitivePublicText(parameter)) return null;
    if (url.hash && containsSensitivePublicText(decodeURIComponent(url.hash))) return null;
    url.hash = "";
    return url.toString();
  } catch { return null; }
}

function isSensitiveTracePath(path: string) {
  const semanticPath = path.toLowerCase().replace(/[^a-z0-9]/g, "");
  return /(email|phone|resumetext|cookie|authorization|bearer|token|password|secret|credential|apikey|privatekey|session|applicationanswers?|(?:local|artifact|stored|file)(?:path|directory)|(?:path|directory)$)/.test(semanticPath);
}

export function redactTraceAttributes(value: unknown, key = "", parentPath = ""): unknown {
  const path = parentPath ? `${parentPath}.${key}` : key;
  if (isSensitiveTracePath(path)) return "[REDACTED]";
  if (typeof value === "string") return redactPublicText(value);
  if (Array.isArray(value)) return value.map((item) => redactTraceAttributes(item, "", path));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([nestedKey, nestedValue]) => [nestedKey, redactTraceAttributes(nestedValue, nestedKey, path)]));
  }
  return value;
}
