import { constants, mkdirSync } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";

export const DATABASE_FILENAME = "job-search.sqlite";

export function defaultDataRoot() {
  if (process.env.JOB_SEARCH_COPILOT_DATA_DIR) return resolve(process.env.JOB_SEARCH_COPILOT_DATA_DIR);
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "job-search-copilot");
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "job-search-copilot");
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "job-search-copilot");
}

export function resolveInside(root: string, ...segments: string[]) {
  const parent = resolve(root);
  const candidate = resolve(parent, ...segments);
  const pathFromRoot = relative(parent, candidate);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || pathFromRoot.startsWith("/")) {
    throw new Error("Generated path would escape the Job Search Copilot data directory.");
  }
  return candidate;
}

function resolvedPathIsInside(root: string, candidate: string) {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !pathFromRoot.startsWith("/"));
}

export async function ensureGeneratedDirectory(dataRoot: string, directory: string) {
  const lexicalRoot = resolve(dataRoot);
  const lexicalDirectory = resolveInside(lexicalRoot, relative(lexicalRoot, resolve(directory)));
  const realRoot = await realpath(lexicalRoot);
  const segments = relative(lexicalRoot, lexicalDirectory).split(sep).filter(Boolean);
  let current = lexicalRoot;
  for (const segment of segments) {
    current = resolveInside(lexicalRoot, relative(lexicalRoot, current), segment);
    await mkdir(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) throw new Error(`Generated directory is a symlink and cannot be used safely: ${current}`);
    if (!metadata.isDirectory()) throw new Error(`Generated path is not a directory: ${current}`);
    const realCurrent = await realpath(current);
    if (!resolvedPathIsInside(realRoot, realCurrent)) throw new Error(`Generated directory resolves outside the data root: ${current}`);
  }
  return lexicalDirectory;
}

export async function writeGeneratedFile(dataRoot: string, destinationPath: string, contents: string | Buffer) {
  const lexicalRoot = resolve(dataRoot);
  const destination = resolveInside(lexicalRoot, relative(lexicalRoot, resolve(destinationPath)));
  await ensureGeneratedDirectory(lexicalRoot, dirname(destination));
  const handle = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(contents);
  } finally {
    await handle.close();
  }
  const [realRoot, realDestination] = await Promise.all([realpath(lexicalRoot), realpath(destination)]);
  if (!resolvedPathIsInside(realRoot, realDestination)) throw new Error(`Generated file resolves outside the data root: ${destination}`);
  return destination;
}

const migrations = [
  `
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE resumes (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      extracted_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(workspace_id, sha256)
    );
  `,
  `
    CREATE TABLE candidate_profile_versions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      headline TEXT NOT NULL,
      skills_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(workspace_id, version)
    );
    CREATE TABLE positioning_tracks (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      profile_version_id TEXT NOT NULL REFERENCES candidate_profile_versions(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      summary TEXT NOT NULL,
      target_roles_json TEXT NOT NULL
    );
    CREATE TABLE search_brief_versions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(workspace_id, version)
    );
    CREATE TABLE preference_snapshot_versions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(workspace_id, version)
    );
    CREATE TABLE search_runs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      profile_version INTEGER NOT NULL,
      search_brief_version INTEGER NOT NULL,
      preference_version INTEGER,
      status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
      started_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE TABLE query_events (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      search_run_id TEXT NOT NULL REFERENCES search_runs(id) ON DELETE CASCADE,
      query_text TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE opportunities (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('job', 'internship')),
      company TEXT NOT NULL,
      title TEXT NOT NULL,
      location TEXT NOT NULL,
      canonical_apply_url TEXT,
      requisition_id TEXT,
      normalized_url TEXT,
      normalized_requisition TEXT,
      normalized_fallback TEXT NOT NULL,
      eligibility TEXT NOT NULL CHECK(eligibility IN ('eligible', 'ineligible', 'unknown')),
      evidence_status TEXT NOT NULL CHECK(evidence_status IN ('verified_open', 'official_lead', 'community_lead', 'conflict', 'closed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX opportunities_url_idx ON opportunities(workspace_id, normalized_url);
    CREATE INDEX opportunities_req_idx ON opportunities(workspace_id, normalized_requisition);
    CREATE INDEX opportunities_fallback_idx ON opportunities(workspace_id, normalized_fallback);
    CREATE TABLE source_observations (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
      search_run_id TEXT NOT NULL REFERENCES search_runs(id) ON DELETE CASCADE,
      source_url TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK(source_type IN ('official', 'community')),
      status TEXT NOT NULL CHECK(status IN ('open', 'closed', 'lead')),
      observed_at TEXT NOT NULL
    );
    CREATE TABLE match_assessments (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
      search_run_id TEXT NOT NULL REFERENCES search_runs(id) ON DELETE CASCADE,
      score REAL NOT NULL CHECK(score >= 0 AND score <= 100),
      factors_json TEXT NOT NULL,
      reasons_json TEXT NOT NULL,
      gaps_json TEXT NOT NULL,
      unknowns_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE feedback (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
      disposition TEXT NOT NULL CHECK(disposition IN ('interested', 'later', 'rejected', 'information_error', 'closed', 'applied')),
      preference_version INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE application_packets (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK(status IN ('draft', 'reviewed', 'ready_for_prefill')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE application_fields (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      packet_id TEXT NOT NULL REFERENCES application_packets(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL,
      label TEXT NOT NULL,
      value TEXT NOT NULL,
      classification TEXT NOT NULL CHECK(classification IN ('safe', 'confirm', 'manual_only'))
    );
    CREATE TABLE trace_events (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      trace_id TEXT NOT NULL,
      span_id TEXT NOT NULL,
      parent_span_id TEXT,
      name TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL CHECK(status IN ('unset', 'ok', 'error')),
      attributes_json TEXT NOT NULL
    );
  `,
  `
    CREATE TABLE opportunity_aliases (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      key_type TEXT NOT NULL CHECK(key_type IN ('url', 'requisition', 'fallback')),
      normalized_value TEXT NOT NULL,
      opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY(workspace_id, key_type, normalized_value)
    );
    CREATE INDEX opportunity_aliases_opportunity_idx ON opportunity_aliases(workspace_id, opportunity_id);
    INSERT OR IGNORE INTO opportunity_aliases(workspace_id, key_type, normalized_value, opportunity_id, created_at)
      SELECT workspace_id, 'url', normalized_url, id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM opportunities WHERE normalized_url IS NOT NULL ORDER BY created_at, id;
    INSERT OR IGNORE INTO opportunity_aliases(workspace_id, key_type, normalized_value, opportunity_id, created_at)
      SELECT workspace_id, 'requisition', normalized_requisition, id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM opportunities WHERE normalized_requisition IS NOT NULL ORDER BY created_at, id;
    INSERT OR IGNORE INTO opportunity_aliases(workspace_id, key_type, normalized_value, opportunity_id, created_at)
      SELECT workspace_id, 'fallback', normalized_fallback, id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM opportunities ORDER BY created_at, id;
  `,
  `
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
      disposition TEXT NOT NULL CHECK(disposition IN ('interested', 'later', 'rejected', 'information_error', 'closed', 'applied')),
      preference_version INTEGER,
      created_at TEXT NOT NULL
    );
    ALTER TABLE feedback ADD COLUMN reason TEXT;
  `,
  `
    CREATE TABLE IF NOT EXISTS application_packets (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK(status IN ('draft', 'reviewed', 'ready_for_prefill')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS application_fields (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      packet_id TEXT NOT NULL REFERENCES application_packets(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL,
      label TEXT NOT NULL,
      value TEXT NOT NULL,
      classification TEXT NOT NULL CHECK(classification IN ('safe', 'confirm', 'manual_only'))
    );
    CREATE TABLE IF NOT EXISTS trace_events (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      trace_id TEXT NOT NULL,
      span_id TEXT NOT NULL,
      parent_span_id TEXT,
      name TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL CHECK(status IN ('unset', 'ok', 'error')),
      attributes_json TEXT NOT NULL
    );
    ALTER TABLE application_packets ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE application_packets ADD COLUMN audit_version INTEGER;
    ALTER TABLE application_packets ADD COLUMN audit_retrieved_at TEXT;
    ALTER TABLE application_packets ADD COLUMN audit_destination_url TEXT;
    ALTER TABLE application_packets ADD COLUMN audit_status TEXT CHECK(audit_status IN ('verified', 'failed'));
    ALTER TABLE application_packets ADD COLUMN attachments_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE application_packets ADD COLUMN unknowns_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE application_fields ADD COLUMN provenance_json TEXT;
    ALTER TABLE trace_events ADD COLUMN run_id TEXT REFERENCES search_runs(id) ON DELETE SET NULL;
    DELETE FROM application_fields
      WHERE rowid NOT IN (SELECT MIN(rowid) FROM application_fields GROUP BY workspace_id, packet_id, field_key);
    CREATE UNIQUE INDEX application_fields_packet_key_idx ON application_fields(workspace_id, packet_id, field_key);
  `,
  `
    UPDATE application_fields SET value = '' WHERE classification = 'manual_only' AND value <> '';
  `,
  `
    ALTER TABLE candidate_profile_versions ADD COLUMN targeting_constraints_json TEXT NOT NULL DEFAULT '{"schemaVersion":1,"status":"unknown","targetKinds":[],"employmentTypes":[],"levels":[],"domains":[],"availability":null,"workAuthorization":[],"visa":null,"timing":null,"hardExclusions":[],"breadth":"balanced","unknowns":["Legacy data did not record targeting constraints."],"contradictions":[]}';

    ALTER TABLE query_events ADD COLUMN outcome_status TEXT NOT NULL DEFAULT 'success'
      CHECK(outcome_status IN ('success', 'no_results', 'timeout', 'blocked', 'limited', 'missing', 'error'));
    ALTER TABLE query_events ADD COLUMN retrieved_at TEXT;
    ALTER TABLE query_events ADD COLUMN locator TEXT;
    ALTER TABLE query_events ADD COLUMN source_tier TEXT NOT NULL DEFAULT 'discovery'
      CHECK(source_tier IN ('primary', 'official_lead', 'discovery'));
    ALTER TABLE query_events ADD COLUMN failure_code TEXT;
    ALTER TABLE query_events ADD COLUMN failure_summary TEXT;
    UPDATE query_events SET retrieved_at = created_at, locator = source WHERE retrieved_at IS NULL OR locator IS NULL;

    ALTER TABLE source_observations ADD COLUMN source_tier TEXT
      CHECK(source_tier IN ('primary', 'official_lead', 'discovery'));
    ALTER TABLE source_observations ADD COLUMN retrieved_at TEXT;
    ALTER TABLE source_observations ADD COLUMN locator TEXT;
    ALTER TABLE source_observations ADD COLUMN confidence TEXT NOT NULL DEFAULT 'unknown'
      CHECK(confidence IN ('high', 'medium', 'low', 'unknown'));
    ALTER TABLE source_observations ADD COLUMN deadline TEXT;
    ALTER TABLE source_observations ADD COLUMN conflict_json TEXT;
    ALTER TABLE source_observations ADD COLUMN dedupe_decision_json TEXT NOT NULL DEFAULT '{"action":"legacy","matchedBy":"unknown","survivorOpportunityId":null,"mergedOpportunityIds":[]}';
    UPDATE source_observations
      SET source_tier = CASE source_type WHEN 'official' THEN 'primary' ELSE 'discovery' END,
          retrieved_at = observed_at,
          locator = source_url
      WHERE source_tier IS NULL OR retrieved_at IS NULL OR locator IS NULL;

    CREATE INDEX query_events_run_idx ON query_events(workspace_id, search_run_id);
    CREATE INDEX source_observations_run_idx ON source_observations(workspace_id, search_run_id);
    CREATE INDEX match_assessments_run_idx ON match_assessments(workspace_id, search_run_id);

    CREATE TRIGGER search_runs_terminal_immutable
      BEFORE UPDATE OF status ON search_runs
      WHEN OLD.status <> 'running' OR NEW.status NOT IN ('completed', 'failed')
      BEGIN SELECT RAISE(ABORT, 'Search run is closed or transition is invalid.'); END;
    CREATE TRIGGER query_events_require_running_run
      BEFORE INSERT ON query_events
      WHEN (SELECT status FROM search_runs WHERE id = NEW.search_run_id AND workspace_id = NEW.workspace_id) <> 'running'
      BEGIN SELECT RAISE(ABORT, 'Search run is closed.'); END;
    CREATE TRIGGER source_observations_require_running_run
      BEFORE INSERT ON source_observations
      WHEN (SELECT status FROM search_runs WHERE id = NEW.search_run_id AND workspace_id = NEW.workspace_id) <> 'running'
      BEGIN SELECT RAISE(ABORT, 'Search run is closed.'); END;
    CREATE TRIGGER match_assessments_require_running_run
      BEFORE INSERT ON match_assessments
      WHEN (SELECT status FROM search_runs WHERE id = NEW.search_run_id AND workspace_id = NEW.workspace_id) <> 'running'
      BEGIN SELECT RAISE(ABORT, 'Search run is closed.'); END;
    CREATE TRIGGER trace_events_require_running_run
      BEFORE INSERT ON trace_events
      WHEN NEW.run_id IS NOT NULL AND (SELECT status FROM search_runs WHERE id = NEW.run_id AND workspace_id = NEW.workspace_id) <> 'running'
      BEGIN SELECT RAISE(ABORT, 'Search run is closed.'); END;
  `,
  `
    UPDATE application_fields SET value = '' WHERE classification = 'manual_only' AND value <> '';
  `
];

export function openDatabase(dataRoot: string) {
  mkdirSync(dataRoot, { recursive: true, mode: 0o700 });
  const databasePath = resolveInside(dataRoot, DATABASE_FILENAME);
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  database.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version: number };
    if (current.version > migrations.length) {
      throw new Error(`Database schema version ${current.version} is newer than supported version ${migrations.length}.`);
    }
    for (let index = current.version; index < migrations.length; index += 1) {
      database.exec(migrations[index]);
      database.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(index + 1, new Date().toISOString());
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    database.close();
    throw error;
  }
  return { database, databasePath };
}
