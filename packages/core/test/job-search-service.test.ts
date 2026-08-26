import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { JobSearchService } from "../src/index.js";
import { inspectResume, storeResumeCopy } from "../src/resume.js";

async function withService(run: (service: JobSearchService, root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "job-search-core-"));
  const service = new JobSearchService({ dataRoot: root });
  try {
    await run(service, root);
  } finally {
    service.close();
  }
}

function isInside(parent: string, child: string) {
  const candidate = relative(resolve(parent), resolve(child));
  return candidate !== ".." && !candidate.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
}

function crc32(input: Buffer) {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function syntheticDocx(text: string) {
  const files = new Map<string, Buffer>([
    ["[Content_Types].xml", Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')],
    ["_rels/.rels", Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')],
    ["word/document.xml", Buffer.from(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`)]
  ]);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, contents] of files) {
    const filename = Buffer.from(name);
    const crc = crc32(contents);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(contents.length, 18);
    local.writeUInt32LE(contents.length, 22);
    local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, contents);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(contents.length, 20);
    central.writeUInt32LE(contents.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, filename);
    offset += local.length + filename.length + contents.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function syntheticPdf(text: string) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${text.length + 31} >>\nstream\nBT /F1 12 Tf 20 100 Td (${text}) Tj ET\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map((value) => `${String(value).padStart(10, "0")} 00000 n \n`).join("");
  output += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}

test("initializes migrations and keeps generated workspace paths inside the data root", async () => {
  await withService(async (service, root) => {
    const workspace = await service.openWorkspace({ name: "Private search" });
    assert.equal(isInside(root, workspace.attachmentDirectory), true);
    assert.equal(isInside(root, workspace.exportDirectory), true);
    assert.equal((await stat(workspace.attachmentDirectory)).isDirectory(), true);
    assert.equal((await stat(workspace.exportDirectory)).isDirectory(), true);

    const database = new DatabaseSync(join(root, "job-search.sqlite"), { readOnly: true });
    const migration = database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number };
    assert.ok(migration.version >= 1);
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    assert.ok(tables.some(({ name }) => name === "workspaces"));
    database.close();
  });
});

test("imports and copies extractable TXT, Markdown, PDF, and DOCX resumes", async () => {
  await withService(async (service, root) => {
    const workspace = await service.openWorkspace({ name: "Formats" });
    const inputs = join(root, "inputs");
    await mkdir(inputs);
    const fixtures: Array<[string, Buffer | string, string]> = [
      ["resume.txt", "TXT product analyst", "TXT product analyst"],
      ["resume.md", "# Markdown researcher", "Markdown researcher"],
      ["resume.pdf", syntheticPdf("PDF data scientist"), "PDF data scientist"],
      ["resume.docx", syntheticDocx("DOCX ML engineer"), "DOCX ML engineer"]
    ];

    for (const [filename, contents, expected] of fixtures) {
      const source = join(inputs, filename);
      await writeFile(source, contents);
      const imported = await service.importResume({ workspaceId: workspace.id, sourcePath: source });
      assert.match(imported.extractedText, new RegExp(expected));
      assert.match(imported.sha256, /^[a-f0-9]{64}$/);
      assert.equal(isInside(workspace.attachmentDirectory, imported.storedPath), true);
      assert.deepEqual(await readFile(imported.storedPath), Buffer.isBuffer(contents) ? contents : Buffer.from(contents));
    }
  });
});

test("rejects unsafe, unsupported, oversized, and empty resume inputs with actionable errors", async () => {
  await withService(async (service, root) => {
    const workspace = await service.openWorkspace({ name: "Rejects" });
    const directory = join(root, "directory.txt");
    await mkdir(directory);
    await assert.rejects(
      service.importResume({ workspaceId: workspace.id, sourcePath: directory }),
      /regular file/i
    );

    const unsupported = join(root, "resume.rtf");
    await writeFile(unsupported, "unsupported");
    await assert.rejects(service.importResume({ workspaceId: workspace.id, sourcePath: unsupported }), /supported types/i);

    const oversized = join(root, "resume.txt");
    await writeFile(oversized, Buffer.alloc(20 * 1024 * 1024 + 1, 0x61));
    await assert.rejects(service.importResume({ workspaceId: workspace.id, sourcePath: oversized }), /20 MiB/i);

    const empty = join(root, "empty.md");
    await writeFile(empty, "   \n\t");
    await assert.rejects(service.importResume({ workspaceId: workspace.id, sourcePath: empty }), /extractable text/i);
  });
});

test("enforces profile base versions and keeps completed search runs bound to their original snapshots", async () => {
  await withService(async (service) => {
    const workspace = await service.openWorkspace({ name: "Versioning" });
    const first = await service.commitProfile({
      workspaceId: workspace.id,
      baseVersion: null,
      profile: {
        headline: "Product analyst",
        skills: ["SQL"],
        positioningTracks: [{ name: "Analytics", summary: "Product insights", targetRoles: ["Product Analyst"] }]
      }
    });
    await assert.rejects(
      service.commitProfile({ workspaceId: workspace.id, baseVersion: null, profile: { headline: "Stale", skills: [], positioningTracks: [] } }),
      /profile version conflict/i
    );
    const run = await service.beginSearchRun({
      workspaceId: workspace.id,
      profileVersion: first.version,
      searchBrief: { keywords: ["product analyst"], locations: ["Shanghai"] },
      preferenceVersion: null
    });
    const second = await service.commitProfile({
      workspaceId: workspace.id,
      baseVersion: first.version,
      profile: { headline: "Senior product analyst", skills: ["SQL", "Python"], positioningTracks: [] }
    });
    assert.equal(second.version, 2);
    const storedRun = await service.getSearchRun({ workspaceId: workspace.id, runId: run.id });
    assert.equal(storedRun.profileVersion, 1);
    assert.equal(storedRun.searchBriefVersion, 1);
    assert.equal(storedRun.preferenceVersion, null);
  });
});

test("deduplicates in URL, requisition, then fallback order while preserving sources and evidence precedence", async () => {
  await withService(async (service) => {
    const workspace = await service.openWorkspace({ name: "Evidence" });
    const profile = await service.commitProfile({
      workspaceId: workspace.id,
      baseVersion: null,
      profile: { headline: "Engineer", skills: ["TypeScript"], positioningTracks: [] }
    });
    const run = await service.beginSearchRun({
      workspaceId: workspace.id,
      profileVersion: profile.version,
      searchBrief: { keywords: ["engineer"], locations: [] },
      preferenceVersion: null
    });
    const match = { score: 99, factors: { skills: 40, role: 59 }, reasons: ["Strong fit"], gaps: [], unknowns: ["Work authorization"] };
    await service.recordSearchBatch({
      workspaceId: workspace.id,
      runId: run.id,
      query: { text: "engineer", source: "synthetic-1" },
      opportunities: [
        { kind: "job", company: "Acme", title: "Engineer", location: "Remote", canonicalApplyUrl: "https://jobs.example/acme/1?utm_source=test&a=1#apply", eligibility: "unknown", evidence: { sourceUrl: "https://community.example/1", sourceType: "community", status: "lead" }, match },
        { kind: "job", company: "Beta", title: "Analyst", location: "NYC", requisitionId: "REQ-7", eligibility: "eligible", evidence: { sourceUrl: "https://community.example/2", sourceType: "community", status: "lead" } },
        { kind: "internship", company: "Gamma", title: "ML Intern", location: "Boston", eligibility: "eligible", evidence: { sourceUrl: "https://official.example/gamma", sourceType: "official", status: "open" } },
        { kind: "job", company: "Delta", title: "Designer", location: "London", eligibility: "ineligible", evidence: { sourceUrl: "https://official.example/delta", sourceType: "official", status: "lead" } },
        { kind: "job", company: "Epsilon", title: "Researcher", location: "Paris", eligibility: "unknown", evidence: { sourceUrl: "https://community.example/5", sourceType: "community", status: "lead" } }
      ]
    });
    await service.recordSearchBatch({
      workspaceId: workspace.id,
      runId: run.id,
      opportunities: [
        { kind: "job", company: "ACME", title: "Engineer II", location: "Anywhere", canonicalApplyUrl: "https://jobs.example/acme/1?a=1&utm_medium=email", eligibility: "unknown", evidence: { sourceUrl: "https://jobs.example/acme/1", sourceType: "official", status: "open" } },
        { kind: "job", company: " beta ", title: "Different title", location: "Remote", requisitionId: "req-7", eligibility: "eligible", evidence: { sourceUrl: "https://official.example/beta", sourceType: "official", status: "closed" } },
        { kind: "internship", company: " gamma ", title: "ml intern", location: "BOSTON", eligibility: "eligible", evidence: { sourceUrl: "https://official.example/gamma/closed", sourceType: "official", status: "closed" } }
      ]
    });
    const results = await service.queryOpportunities({ workspaceId: workspace.id });
    assert.equal(results.length, 5);
    const byCompany = Object.fromEntries(results.map((opportunity) => [opportunity.company.toLowerCase(), opportunity]));
    assert.equal(byCompany.acme.canonicalApplyUrl, "https://jobs.example/acme/1?a=1");
    assert.equal(byCompany.acme.evidenceStatus, "verified_open");
    assert.equal(byCompany.acme.eligibility, "unknown");
    assert.equal(byCompany.acme.match?.score, 99);
    assert.equal(byCompany.acme.sourceObservations.length, 2);
    assert.equal(byCompany.beta.evidenceStatus, "closed");
    assert.equal(byCompany.beta.sourceObservations.length, 2);
    assert.equal(byCompany.gamma.evidenceStatus, "conflict");
    assert.equal(byCompany.gamma.sourceObservations.length, 2);
    assert.equal(byCompany.delta.evidenceStatus, "official_lead");
    assert.equal(byCompany.epsilon.evidenceStatus, "community_lead");
  });
});

test("rolls back an entire result batch when any opportunity is invalid", async () => {
  await withService(async (service) => {
    const workspace = await service.openWorkspace({ name: "Atomic" });
    const profile = await service.commitProfile({ workspaceId: workspace.id, baseVersion: null, profile: { headline: "A", skills: [], positioningTracks: [] } });
    const run = await service.beginSearchRun({ workspaceId: workspace.id, profileVersion: profile.version, searchBrief: { keywords: ["a"], locations: [] }, preferenceVersion: null });
    await assert.rejects(
      service.recordSearchBatch({
        workspaceId: workspace.id,
        runId: run.id,
        opportunities: [
          { kind: "job", company: "Valid", title: "Role", location: "Remote", eligibility: "eligible", evidence: { sourceUrl: "https://example/valid", sourceType: "community", status: "lead" } },
          { kind: "job", company: "Invalid", title: "", location: "Remote", eligibility: "eligible", evidence: { sourceUrl: "https://example/invalid", sourceType: "community", status: "lead" } }
        ]
      }),
      /title/i
    );
    assert.deepEqual(await service.queryOpportunities({ workspaceId: workspace.id }), []);
  });
});

test("updates preferences only from confirmed eligible feedback with the matching base and never rebinds old runs", async () => {
  await withService(async (service) => {
    const workspace = await service.openWorkspace({ name: "Feedback" });
    const profile = await service.commitProfile({ workspaceId: workspace.id, baseVersion: null, profile: { headline: "A", skills: [], positioningTracks: [] } });
    const run = await service.beginSearchRun({ workspaceId: workspace.id, profileVersion: profile.version, searchBrief: { keywords: ["a"], locations: [] }, preferenceVersion: null });
    const batch = await service.recordSearchBatch({
      workspaceId: workspace.id,
      runId: run.id,
      opportunities: [{ kind: "job", company: "A", title: "Role", location: "Remote", eligibility: "eligible", evidence: { sourceUrl: "https://example/a", sourceType: "community", status: "lead" } }]
    });
    const opportunityId = batch.opportunities[0].id;
    const ignored = await service.recordFeedback({ workspaceId: workspace.id, opportunityId, disposition: "information_error", confirmedPreferenceSnapshot: { preferredLocations: ["Remote"] }, preferenceBaseVersion: null });
    assert.equal(ignored.preferenceVersion, null);
    const unconfirmed = await service.recordFeedback({ workspaceId: workspace.id, opportunityId, disposition: "interested" });
    assert.equal(unconfirmed.preferenceVersion, null);
    const confirmed = await service.recordFeedback({ workspaceId: workspace.id, opportunityId, disposition: "interested", confirmedPreferenceSnapshot: { preferredLocations: ["Remote"] }, preferenceBaseVersion: null });
    assert.equal(confirmed.preferenceVersion, 1);
    await assert.rejects(
      service.recordFeedback({ workspaceId: workspace.id, opportunityId, disposition: "rejected", confirmedPreferenceSnapshot: { preferredLocations: ["London"] }, preferenceBaseVersion: null }),
      /preference version conflict/i
    );
    const oldRun = await service.getSearchRun({ workspaceId: workspace.id, runId: run.id });
    assert.equal(oldRun.preferenceVersion, null);
    const nextRun = await service.beginSearchRun({ workspaceId: workspace.id, profileVersion: profile.version, searchBrief: { keywords: ["a"], locations: [] }, preferenceVersion: 1 });
    assert.equal(nextRun.preferenceVersion, 1);
  });
});

test("classifies sensitive application fields and rejects any submitted packet status", async () => {
  await withService(async (service) => {
    const workspace = await service.openWorkspace({ name: "Packets" });
    const packet = await service.upsertApplicationPacket({
      workspaceId: workspace.id,
      status: "draft",
      fields: [
        { key: "full_name", label: "Full name", value: "Synthetic Person" },
        { key: "salary_expectation", label: "Salary expectation", value: "100" },
        { key: "eeo_gender", label: "EEO gender", value: "Prefer not to say" },
        { key: "disability_status", label: "Disability", value: "Prefer not to say" },
        { key: "veteran_status", label: "Veteran", value: "Prefer not to say" },
        { key: "legal_consent", label: "Legal consent", value: "yes" },
        { key: "signature", label: "Signature", value: "Synthetic Person" },
        { key: "captcha", label: "CAPTCHA", value: "answer" },
        { key: "mfa", label: "MFA", value: "123456" },
        { key: "final_submit", label: "Final submit", value: "yes" }
      ]
    });
    assert.equal(packet.fields.find(({ key }) => key === "full_name")?.classification, "safe");
    assert.equal(packet.fields.find(({ key }) => key === "salary_expectation")?.classification, "confirm");
    for (const key of ["eeo_gender", "disability_status", "veteran_status", "legal_consent", "signature", "captcha", "mfa", "final_submit"]) {
      assert.equal(packet.fields.find((field) => field.key === key)?.classification, "manual_only");
    }
    const reviewed = await service.reviewApplicationPacket({ workspaceId: workspace.id, packetId: packet.id });
    assert.equal(reviewed.status, "ready_for_prefill");
    await assert.rejects(
      service.upsertApplicationPacket({ workspaceId: workspace.id, packetId: packet.id, status: "submitted" as never, fields: [] }),
      /submitted/i
    );
  });
});

test("redacts PII and secret or answer bodies before persisting OTel-compatible trace events", async () => {
  await withService(async (service) => {
    const workspace = await service.openWorkspace({ name: "Tracing" });
    const event = await service.recordTraceEvent({
      workspaceId: workspace.id,
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      name: "application.packet.review",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:01.000Z",
      status: "ok",
      attributes: {
        email: "person@example.com",
        note: "Call +1 415-555-2671 or backup@example.org",
        resumeText: "private resume contents",
        cookie: "session=abc",
        accessToken: "secret-token",
        applicationAnswerBody: "private answer"
      }
    });
    assert.equal(event.name, "application.packet.review");
    const persisted = await service.getTraceEvents({ workspaceId: workspace.id });
    const serialized = JSON.stringify(persisted[0]);
    for (const secret of ["person@example.com", "backup@example.org", "415-555-2671", "private resume contents", "session=abc", "secret-token", "private answer"]) {
      assert.equal(serialized.includes(secret), false);
    }
    assert.match(serialized, /\[REDACTED\]/);
  });
});

test("exports JSON, Markdown, and CSV only beneath the workspace export directory", async () => {
  await withService(async (service) => {
    const workspace = await service.openWorkspace({ name: "Exports" });
    const profile = await service.commitProfile({ workspaceId: workspace.id, baseVersion: null, profile: { headline: "Analyst", skills: ["SQL"], positioningTracks: [] } });
    const run = await service.beginSearchRun({ workspaceId: workspace.id, profileVersion: profile.version, searchBrief: { keywords: ["analyst"], locations: [] }, preferenceVersion: null });
    await service.recordSearchBatch({ workspaceId: workspace.id, runId: run.id, opportunities: [{ kind: "job", company: "A, Inc.", title: "Analyst", location: "Remote", eligibility: "eligible", evidence: { sourceUrl: "https://example/a", sourceType: "official", status: "open" } }] });
    for (const format of ["json", "markdown", "csv"] as const) {
      const exported = await service.exportWorkspace({ workspaceId: workspace.id, format });
      assert.equal(isInside(workspace.exportDirectory, exported.path), true);
      const contents = await readFile(exported.path, "utf8");
      assert.ok(contents.includes("Analyst"));
      if (format === "csv") assert.ok(contents.includes('"A, Inc."'));
    }
  });
});

test("returns a redacted recovery snapshot only when a JSON export requests content", async () => {
  await withService(async (service) => {
    const workspace = await service.openWorkspace({ name: "Snapshot core" });
    const profile = await service.commitProfile({
      workspaceId: workspace.id,
      baseVersion: null,
      profile: { headline: "Synthetic Analyst", skills: ["SQL"], positioningTracks: [{ name: "Analytics", summary: "Evidence", targetRoles: ["Analyst"] }] }
    });
    const run = await service.beginSearchRun({ workspaceId: workspace.id, profileVersion: profile.version, searchBrief: { keywords: ["analyst"], locations: ["Remote"] }, preferenceVersion: null });
    const batch = await service.recordSearchBatch({
      workspaceId: workspace.id,
      runId: run.id,
      query: { text: "synthetic analyst", source: "test" },
      opportunities: [{ kind: "job", company: "Synthetic Co", title: "Analyst", location: "Remote", eligibility: "eligible", evidence: { sourceUrl: "https://example.test/job", sourceType: "official", status: "open" } }]
    });
    await service.recordFeedback({ workspaceId: workspace.id, opportunityId: batch.opportunities[0].id, disposition: "interested", confirmedPreferenceSnapshot: { preferredLocations: ["Remote"], preferredRoles: ["Analyst"], notes: "Synthetic preference" }, preferenceBaseVersion: null });
    const packet = await service.upsertApplicationPacket({
      workspaceId: workspace.id,
      opportunityId: batch.opportunities[0].id,
      status: "draft",
      fields: [{ key: "email", label: "Email", value: "private@example.test" }, { key: "cover_letter", label: "Cover letter", value: "Private Cover Letter" }]
    });
    await service.reviewApplicationPacket({ workspaceId: workspace.id, packetId: packet.id });

    const legacy = await service.exportWorkspace({ workspaceId: workspace.id, format: "json" });
    assert.equal("snapshot" in legacy, false);
    assert.ok((await readFile(legacy.path, "utf8")).includes("Synthetic Analyst"));

    const exported = await service.exportWorkspace({ workspaceId: workspace.id, format: "json", includeContent: true } as never) as { snapshot?: any };
    assert.equal(exported.snapshot.workspace.id, workspace.id);
    assert.equal(exported.snapshot.latestProfile.version, 1);
    assert.deepEqual(exported.snapshot.latestSearchBrief.data, { keywords: ["analyst"], locations: ["Remote"] });
    assert.equal(exported.snapshot.latestPreference.version, 1);
    assert.equal(exported.snapshot.runs[0].summary.queryCount, 1);
    assert.equal(exported.snapshot.feedback[0].disposition, "interested");
    assert.equal(exported.snapshot.feedback[0].reason, null);
    assert.equal(exported.snapshot.applicationPackets[0].status, "ready_for_prefill");
    assert.equal(exported.snapshot.applicationPackets[0].fields[0].value, undefined);
    const serialized = JSON.stringify(exported.snapshot);
    for (const secret of ["private@example.test", "Private Cover Letter"]) assert.equal(serialized.includes(secret), false);
  });
});

test("redacts authorization and application-answer containers including every descendant", async () => {
  await withService(async (service) => {
    const workspace = await service.openWorkspace({ name: "Nested trace secrets" });
    await service.recordTraceEvent({
      workspaceId: workspace.id,
      traceId: "1af7651916cd43dd8448eb211c80319c",
      spanId: "c7ad6b7169203331",
      name: "application.answers.prepare",
      startedAt: "2026-01-01T00:00:00.000Z",
      status: "ok",
      attributes: {
        authorization: "Bearer synthetic-bearer-secret",
        request: { headers: { Authorization: "Bearer nested-secret" } },
        credential: "Bearer generic-bearer-secret",
        applicationAnswers: { coverLetter: "synthetic-private-answer", nested: { phoneScreen: "nested-private-answer" } },
        application_answer: { body: "alternate-private-answer" },
        safe: "public-metric"
      }
    });
    const serialized = JSON.stringify((await service.getTraceEvents({ workspaceId: workspace.id }))[0]);
    for (const secret of ["synthetic-bearer-secret", "nested-secret", "generic-bearer-secret", "synthetic-private-answer", "nested-private-answer", "alternate-private-answer"]) {
      assert.equal(serialized.includes(secret), false);
    }
    assert.match(serialized, /public-metric/);
    assert.match(serialized, /\[REDACTED\]/);
  });
});

test("rejects export and attachment writes when workspace directories are symlinked outside the data root", async () => {
  await withService(async (service, root) => {
    const workspace = await service.openWorkspace({ name: "Symlink containment" });
    const outsideExports = await mkdtemp(join(tmpdir(), "job-search-outside-exports-"));
    await rm(workspace.exportDirectory, { recursive: true });
    await symlink(outsideExports, workspace.exportDirectory, "dir");
    await assert.rejects(service.exportWorkspace({ workspaceId: workspace.id, format: "json" }), /symlink|outside|data (?:root|directory)/i);
    assert.deepEqual(await readdir(outsideExports), []);

    const source = join(root, "safe-source.txt");
    await writeFile(source, "safe synthetic resume");
    const outsideAttachments = await mkdtemp(join(tmpdir(), "job-search-outside-attachments-"));
    await rm(workspace.attachmentDirectory, { recursive: true });
    await symlink(outsideAttachments, workspace.attachmentDirectory, "dir");
    await assert.rejects(service.importResume({ workspaceId: workspace.id, sourcePath: source }), /symlink|outside|data (?:root|directory)/i);
    assert.deepEqual(await readdir(outsideAttachments), []);
  });
});

test("merges bridged rows into the URL survivor and retains historical aliases for later observations", async () => {
  await withService(async (service) => {
    const workspace = await service.openWorkspace({ name: "Bridge dedup" });
    const profile = await service.commitProfile({ workspaceId: workspace.id, baseVersion: null, profile: { headline: "Engineer", skills: [], positioningTracks: [] } });
    const run = await service.beginSearchRun({ workspaceId: workspace.id, profileVersion: profile.version, searchBrief: { keywords: ["engineer"], locations: [] }, preferenceVersion: null });
    const requisitionBatch = await service.recordSearchBatch({
      workspaceId: workspace.id,
      runId: run.id,
      opportunities: [{ kind: "job", company: "Bridge Co", title: "Engineer A", location: "Remote", requisitionId: "R-42", eligibility: "eligible", evidence: { sourceUrl: "https://official.test/closed", sourceType: "official", status: "closed" }, match: { score: 70, factors: { role: 70 }, reasons: [], gaps: [], unknowns: [] } }]
    });
    const requisitionId = requisitionBatch.opportunities[0].id;
    await service.recordFeedback({ workspaceId: workspace.id, opportunityId: requisitionId, disposition: "interested" });
    await service.upsertApplicationPacket({ workspaceId: workspace.id, opportunityId: requisitionId, status: "draft", fields: [] });

    const urlBatch = await service.recordSearchBatch({
      workspaceId: workspace.id,
      runId: run.id,
      opportunities: [{ kind: "job", company: "Bridge Co", title: "Engineer B", location: "Onsite", canonicalApplyUrl: "https://jobs.test/bridge", eligibility: "unknown", evidence: { sourceUrl: "https://community.test/lead", sourceType: "community", status: "lead" }, match: { score: 80, factors: { role: 80 }, reasons: [], gaps: [], unknowns: [] } }]
    });
    const urlId = urlBatch.opportunities[0].id;
    assert.notEqual(urlId, requisitionId);

    await service.recordSearchBatch({
      workspaceId: workspace.id,
      runId: run.id,
      opportunities: [{ kind: "job", company: "Bridge Co", title: "Engineer bridge", location: "Hybrid", canonicalApplyUrl: "https://jobs.test/bridge?utm_source=bridge", requisitionId: "R-42", eligibility: "unknown", evidence: { sourceUrl: "https://official.test/open", sourceType: "official", status: "open" }, match: { score: 90, factors: { role: 90 }, reasons: [], gaps: [], unknowns: [] } }]
    });

    const opportunities = await service.queryOpportunities({ workspaceId: workspace.id });
    assert.equal(opportunities.length, 1);
    assert.equal(opportunities[0].id, urlId);
    assert.equal(opportunities[0].evidenceStatus, "conflict");
    assert.equal(opportunities[0].sourceObservations.length, 3);

    await service.recordSearchBatch({
      workspaceId: workspace.id,
      runId: run.id,
      opportunities: [{ kind: "job", company: "Bridge Co", title: "Engineer A", location: "Remote", eligibility: "eligible", evidence: { sourceUrl: "https://community.test/old-fallback", sourceType: "community", status: "lead" } }]
    });
    const afterOldFallback = await service.queryOpportunities({ workspaceId: workspace.id });
    assert.equal(afterOldFallback.length, 1);
    assert.equal(afterOldFallback[0].id, urlId);
    assert.equal(afterOldFallback[0].sourceObservations.length, 4);

    const database = new DatabaseSync(service.databasePath, { readOnly: true });
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM match_assessments WHERE opportunity_id = ?").get(urlId) as { count: number }).count, 3);
    assert.equal((database.prepare("SELECT opportunity_id FROM feedback").get() as { opportunity_id: string }).opportunity_id, urlId);
    assert.equal((database.prepare("SELECT opportunity_id FROM application_packets").get() as { opportunity_id: string }).opportunity_id, urlId);
    database.close();
  });
});

test("stores the inspected resume buffer even if the source changes before persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "job-search-resume-buffer-"));
  const source = join(root, "resume.txt");
  const destination = join(root, "stored.txt");
  await writeFile(source, "original inspected bytes");
  const inspected = await inspectResume(source);
  await writeFile(source, "changed source bytes");
  await storeResumeCopy(inspected.contents, destination, root);
  assert.deepEqual(await readFile(destination), Buffer.from("original inspected bytes"));
});

test("classifies common application-submit key and label variants as manual-only", async () => {
  await withService(async (service) => {
    const workspace = await service.openWorkspace({ name: "Submit variants" });
    const packet = await service.upsertApplicationPacket({
      workspaceId: workspace.id,
      status: "draft",
      fields: [
        { key: "submit_application", label: "Continue", value: "yes" },
        { key: "primary_action", label: "Submit application", value: "yes" },
        { key: "application-submit", label: "Apply now", value: "yes" }
      ]
    });
    assert.deepEqual(packet.fields.map(({ classification }) => classification), ["manual_only", "manual_only", "manual_only"]);
  });
});

test("serializes concurrent migration startup and rejects a database from a future schema version", async () => {
  const root = await mkdtemp(join(tmpdir(), "job-search-migration-lock-"));
  const databasePath = join(root, "job-search.sqlite");
  const lock = new DatabaseSync(databasePath);
  lock.exec("PRAGMA journal_mode = WAL; CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); BEGIN IMMEDIATE;");
  const fixture = join(import.meta.dirname, "fixtures", "open-service.mjs");
  const children = Array.from({ length: 4 }, (_, index) => new Promise<{ code: number | null; stderr: string }>((resolveChild) => {
    const child = spawn(process.execPath, [fixture, root, `Concurrent ${index}`], { env: { ...process.env, NODE_NO_WARNINGS: "1" } });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("exit", (code) => resolveChild({ code, stderr }));
  }));
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  lock.exec("COMMIT");
  lock.close();
  const results = await Promise.all(children);
  assert.deepEqual(results.map(({ code }) => code), [0, 0, 0, 0], results.map(({ stderr }) => stderr).join("\n"));

  const futureRoot = await mkdtemp(join(tmpdir(), "job-search-future-schema-"));
  const future = new DatabaseSync(join(futureRoot, "job-search.sqlite"));
  future.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  future.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(999, new Date().toISOString());
  future.close();
  assert.throws(() => new JobSearchService({ dataRoot: futureRoot }), /future|newer|unsupported/i);
});

test("upgrades a version 2 database and backfills opportunity aliases", async () => {
  const root = await mkdtemp(join(tmpdir(), "job-search-v2-alias-migration-"));
  const databasePath = join(root, "job-search.sqlite");
  const version2 = new DatabaseSync(databasePath);
  version2.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations(version, applied_at) VALUES (1, '2026-01-01T00:00:00.000Z'), (2, '2026-01-01T00:00:01.000Z');
    CREATE TABLE workspaces (id TEXT PRIMARY KEY);
    CREATE TABLE opportunities (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      normalized_url TEXT,
      normalized_requisition TEXT,
      normalized_fallback TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO workspaces(id) VALUES ('workspace-v2');
    INSERT INTO opportunities(id, workspace_id, normalized_url, normalized_requisition, normalized_fallback, created_at)
    VALUES ('opportunity-v2', 'workspace-v2', 'https://jobs.test/v2', 'company-v2' || char(0) || 'r-2', 'company-v2' || char(0) || 'engineer' || char(0) || 'remote', '2026-01-01T00:00:00.000Z');
  `);
  version2.close();

  const migrated = new JobSearchService({ dataRoot: root });
  migrated.close();
  const database = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version, 3);
  assert.equal((database.prepare("SELECT COUNT(*) AS count FROM opportunity_aliases WHERE workspace_id = ? AND opportunity_id = ?").get("workspace-v2", "opportunity-v2") as { count: number }).count, 3);
  database.close();
});
