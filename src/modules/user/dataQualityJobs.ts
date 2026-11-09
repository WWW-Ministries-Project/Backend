// In-memory bulk-merge jobs for the Data Quality page.
//
// A bulk merge can touch dozens of pairs; doing it inline would hold the HTTP
// request open and block the user. Instead the controller starts a job here,
// returns a job id immediately, and the client polls for progress while the
// user carries on. Each pair is merged in its own transaction (see
// mergeChildRecords), so one failure never rolls back earlier successes.
//
// State lives in memory. Prod is a single EC2 instance, so a Map is enough; a
// restart mid-job drops the queue (already-merged pairs stay merged — they are
// simply no longer listed). Not meant to be a durable audit log.
import { randomUUID } from "crypto";
import { mergeChildRecords } from "./dataQualityService";

export type BulkMergePair = { keep_id: number; remove_id: number };

export type BulkMergeItemResult = {
  keep_id: number;
  remove_id: number;
  status: "merged" | "failed";
  edges_repointed?: number;
  error?: string;
};

export type BulkMergeJobStatus = "running" | "completed";

export type BulkMergeJob = {
  id: string;
  status: BulkMergeJobStatus;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  results: BulkMergeItemResult[];
  created_by: number | null;
  started_at: string;
  finished_at: string | null;
};

const jobs = new Map<string, BulkMergeJob>();

// Cap retained jobs so a long-lived process does not grow unbounded. Oldest
// finished jobs are dropped first; running jobs are always kept.
const MAX_JOBS = 50;
function evictOldFinished() {
  if (jobs.size <= MAX_JOBS) return;
  const finished = [...jobs.values()]
    .filter((j) => j.status === "completed")
    .sort((a, b) => (a.finished_at || "").localeCompare(b.finished_at || ""));
  for (const j of finished) {
    if (jobs.size <= MAX_JOBS) break;
    jobs.delete(j.id);
  }
}

export function getBulkMergeJob(id: string): BulkMergeJob | undefined {
  return jobs.get(id);
}

export function startBulkMergeJob(
  pairs: BulkMergePair[],
  createdBy: number | null,
): BulkMergeJob {
  const job: BulkMergeJob = {
    id: randomUUID(),
    status: "running",
    total: pairs.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    results: [],
    created_by: createdBy,
    started_at: new Date().toISOString(),
    finished_at: null,
  };
  jobs.set(job.id, job);
  evictOldFinished();

  // Fire and forget: run sequentially in the background, never await here.
  void runJob(job, pairs);
  return job;
}

async function runJob(job: BulkMergeJob, pairs: BulkMergePair[]) {
  for (const p of pairs) {
    try {
      const r = await mergeChildRecords(p.keep_id, p.remove_id);
      job.results.push({
        keep_id: p.keep_id,
        remove_id: p.remove_id,
        status: "merged",
        edges_repointed: r.edges_repointed,
      });
      job.succeeded++;
    } catch (e) {
      // A pair can fail because an earlier pair already removed one of its
      // records (chained duplicates A-B, B-C). That is expected — report it and
      // keep going; the user re-runs the detector to catch the remainder.
      job.results.push({
        keep_id: p.keep_id,
        remove_id: p.remove_id,
        status: "failed",
        error: e instanceof Error ? e.message : "Merge failed.",
      });
      job.failed++;
    }
    job.processed++;
  }
  job.status = "completed";
  job.finished_at = new Date().toISOString();
}
