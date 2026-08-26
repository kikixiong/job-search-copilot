const reviewedAtsHosts = new Set(["boards.greenhouse.io", "jobs.lever.co", "jobs.ashbyhq.com"]);
const auditTtlMs = 24 * 60 * 60 * 1000;

type GuidanceOpportunity = { id: string; canonicalApplyUrl: string | null; evidenceStatus: string; sourceObservations: Array<{ sourceUrl: string | null; sourceType: string; status: string; observedAt: string }> };
type GuidancePacket = { opportunityId: string | null; audit: { version: number; retrievedAt: string; destinationUrl: string | null; status: string } | null; fields: Array<{ classification: string; provenance: { reviewed: boolean; sensitive: boolean } | null }> };

export function applicationGuidanceMode(opportunity: GuidanceOpportunity | undefined, packet: GuidancePacket, now = Date.now()): "reviewed" | "copy" {
  const value = opportunity?.canonicalApplyUrl;
  if (!value || !opportunity || packet.opportunityId !== opportunity.id || opportunity.evidenceStatus !== "verified_open" || !packet.audit || packet.audit.status !== "verified" || !packet.audit.destinationUrl) return "copy";
  try {
    const url = new URL(value);
    const audited = new URL(packet.audit.destinationUrl);
    const retrievedAt = Date.parse(packet.audit.retrievedAt);
    const latestOfficial = opportunity.sourceObservations.filter(({ sourceType }) => sourceType === "official").sort((a, b) => a.observedAt.localeCompare(b.observedAt)).at(-1);
    const officialMatches = latestOfficial?.status === "open" && latestOfficial.sourceUrl !== null && new URL(latestOfficial.sourceUrl).toString() === url.toString();
    const fieldsReviewed = packet.fields.filter(({ classification }) => classification !== "manual_only").every(({ provenance }) => provenance?.reviewed === true && provenance.sensitive === false);
    const currentAudit = Number.isFinite(retrievedAt) && retrievedAt <= now && now - retrievedAt <= auditTtlMs;
    return url.protocol === "https:" && reviewedAtsHosts.has(url.hostname) && url.toString() === audited.toString() && officialMatches && currentAudit && fieldsReviewed ? "reviewed" : "copy";
  } catch { return "copy"; }
}
