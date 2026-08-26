const reviewedAtsHosts = new Set(["boards.greenhouse.io", "jobs.lever.co", "jobs.ashbyhq.com"]);

export function applicationGuidanceMode(value: string | null | undefined): "reviewed" | "copy" {
  if (!value) return "copy";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && reviewedAtsHosts.has(url.hostname) ? "reviewed" : "copy";
  } catch { return "copy"; }
}
