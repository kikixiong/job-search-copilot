import { z } from "zod";

export const opportunityKindSchema = z.enum(["job", "internship"]);
export const eligibilitySchema = z.enum(["eligible", "ineligible", "unknown"]);
export const evidenceStatusSchema = z.enum(["verified_open", "official_lead", "community_lead", "conflict", "closed"]);
export const feedbackDispositionSchema = z.enum(["interested", "later", "rejected", "information_error", "closed", "applied"]);
export const applicationFieldClassificationSchema = z.enum(["safe", "confirm", "manual_only"]);

const nonEmpty = z.string().trim().min(1);

export const profileDataSchema = z.object({
  headline: nonEmpty,
  skills: z.array(nonEmpty),
  positioningTracks: z.array(z.object({
    name: nonEmpty,
    summary: nonEmpty,
    targetRoles: z.array(nonEmpty)
  }).strict())
}).strict();

export const searchBriefDataSchema = z.object({
  keywords: z.array(nonEmpty).min(1),
  locations: z.array(nonEmpty)
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

export const sourceObservationInputSchema = z.object({
  sourceUrl: z.url(),
  sourceType: z.enum(["official", "community"]),
  status: z.enum(["open", "closed", "lead"]),
  observedAt: z.iso.datetime().optional()
}).strict();

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

const manualFieldPattern = /(eeo|demographic|race|ethnicity|gender|disabilit|veteran|legal[_ -]?consent|signature|captcha|mfa|multi[_ -]?factor|final[_ -]?submit|submit[_ -]?application|application[_ -]?submit)/i;
const safeFieldPattern = /^(full[_ -]?name|first[_ -]?name|last[_ -]?name|email|phone|linkedin|portfolio|website|resume)$/i;

export function classifyApplicationField(key: string, label: string): ApplicationFieldClassification {
  const combined = `${key} ${label}`;
  if (manualFieldPattern.test(combined)) return "manual_only";
  if (safeFieldPattern.test(key)) return "safe";
  return "confirm";
}

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phonePattern = /(?:\+?\d[\d .()-]{7,}\d)/g;
const bearerPattern = /\bBearer\s+[-A-Z0-9._~+/=]+/gi;

function isSensitiveTracePath(path: string) {
  const semanticPath = path.toLowerCase().replace(/[^a-z0-9]/g, "");
  return /(email|phone|resumetext|cookie|authorization|bearer|token|applicationanswers?|(?:local|artifact|stored|file)(?:path|directory)|(?:path|directory)$)/.test(semanticPath);
}

export function redactTraceAttributes(value: unknown, key = "", parentPath = ""): unknown {
  const path = parentPath ? `${parentPath}.${key}` : key;
  if (isSensitiveTracePath(path)) return "[REDACTED]";
  if (typeof value === "string") return value.replace(emailPattern, "[REDACTED]").replace(phonePattern, "[REDACTED]").replace(bearerPattern, "[REDACTED]");
  if (Array.isArray(value)) return value.map((item) => redactTraceAttributes(item, "", path));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([nestedKey, nestedValue]) => [nestedKey, redactTraceAttributes(nestedValue, nestedKey, path)]));
  }
  return value;
}
