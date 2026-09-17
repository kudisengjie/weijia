#!/usr/bin/env node
// One-command self-heal for the recurring branch-ref loss on this machine.
//
// An external process periodically restores/rewrites files inside
// E:/codex/weijia/.git (root cause confirmed 2026-09-17: same-content rewrite
// of existing objects/reflogs is not something git ever does). When its
// snapshot is stale, the loose ref refs/heads/feat/static-geo-model-catalog
// disappears while commits stay intact. Commits are always safe on GitHub;
// only the local pointer needs re-attaching. This script does exactly that.
//
// Resolution order for the restored SHA:
//   1. refs/remotes/origin/feat/static-geo-model-catalog (after a fetch) —
//      the pushed branch is the source of truth
//   2. the `canonical-head:` marker line at the top of E:/codex/GEO-RESUME.md
//      (offline fallback; never trust a random 40-hex found in the log body —
//      older entries carry stale SHAs)
//   3. the branch reflog, newest first, accepting only entries whose commit
//      descends from the remote/canonical head — this recovers a fresh
//      UNPUSHED commit whose ref was lost (reflog entries always survive;
//      the anomaly's garbage root commits fail the ancestry check).
//
// Usage:
//   node tools/repair-geo-branch.mjs --check   # report only, change nothing
//   node tools/repair-geo-branch.mjs           # report and repair if needed

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BRANCH = "feat/static-geo-model-catalog";
const REF = `refs/heads/${BRANCH}`;
const REMOTE_REF = `refs/remotes/origin/${BRANCH}`;
const RESUME_PATH = "E:/codex/GEO-RESUME.md";
const CHECK_ONLY = process.argv.includes("--check");

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function git(args, options = {}) {
  return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", ...options }).trim();
}

function revParseCommit(ref) {
  try {
    const sha = git(["rev-parse", "--verify", `${ref}^{commit}`]);
    return /^[0-9a-f]{40}$/.test(sha) ? sha : "";
  } catch {
    return "";
  }
}

function anchorSha() {
  try {
    const text = readFileSync(RESUME_PATH, "utf8");
    const marker = text.match(/^canonical-head:\s*([0-9a-f]{40})\s*$/m);
    if (marker) {
      return { sha: marker[1], source: `GEO-RESUME.md canonical-head marker (${RESUME_PATH})` };
    }
  } catch {
    // anchor file unreadable; fall through
  }
  return { sha: "", source: "none" };
}

function isCommit(sha) {
  try {
    return git(["cat-file", "-t", sha]) === "commit";
  } catch {
    return false;
  }
}

function isDescendantOf(candidate, base) {
  if (!base || base === candidate) {
    return true;
  }
  try {
    git(["merge-base", "--is-ancestor", base, candidate]);
    return true;
  } catch {
    return false;
  }
}

// Newest-first reflog recovery for a fresh unpushed commit: the reflog file
// always survives the anomaly while the loose ref does not. Entries with an
// "(initial)" message are the anomaly's garbage root commits and fail the
// ancestry check against the base head.
function reflogCandidate(baseSha) {
  const logPath = resolve(git(["rev-parse", "--git-common-dir"]), "logs", ...REF.split("/"));
  let text = "";
  try {
    text = readFileSync(logPath, "utf8");
  } catch {
    return { sha: "", source: "none" };
  }
  const lines = text.trimEnd().split("\n").reverse();
  for (const line of lines) {
    const fields = line.split(" ");
    const sha = fields[1];
    if (!/^[0-9a-f]{40}$/.test(sha) || /\(initial\)/.test(line)) {
      continue;
    }
    if (!isCommit(sha)) {
      continue;
    }
    if (isDescendantOf(sha, baseSha)) {
      return { sha, source: "branch reflog (ancestry-verified against base head)" };
    }
  }
  return { sha: "", source: "none" };
}

let status = revParseCommit(REF);
if (status) {
  console.log(`OK ${REF} -> ${status}`);
  process.exit(0);
}

if (CHECK_ONLY) {
  console.log(`MISSING ${REF} (run without --check to repair)`);
  process.exit(1);
}

// Make sure objects and the remote-tracking ref exist before writing the ref.
try {
  git(["fetch", "origin", BRANCH], { stdio: ["ignore", "pipe", "pipe"] });
} catch (error) {
  console.error(`fetch failed: ${error.message?.split("\n")[0] ?? error}`);
}

const baseSha = revParseCommit(REMOTE_REF) || anchorSha().sha;
let candidate = { sha: revParseCommit(REMOTE_REF), source: "origin remote-tracking ref" };
if (!candidate.sha && baseSha) {
  candidate = { sha: baseSha, source: `GEO-RESUME.md canonical-head marker (${RESUME_PATH})` };
}
if (candidate.sha) {
  const fromReflog = reflogCandidate(candidate.sha);
  if (fromReflog.sha && isDescendantOf(fromReflog.sha, candidate.sha)) {
    candidate = fromReflog;
  }
} else {
  candidate = reflogCandidate("");
}
if (!candidate.sha) {
  console.error("REPAIR FAILED: no candidate SHA from origin ref, canonical-head marker, or reflog");
  process.exit(1);
}

if (!isCommit(candidate.sha)) {
  console.error(`REPAIR FAILED: candidate ${candidate.sha} not found locally (source: ${candidate.source})`);
  process.exit(1);
}

const commonDir = git(["rev-parse", "--git-common-dir"]);
const refPath = resolve(commonDir, REF);
mkdirSync(dirname(refPath), { recursive: true });
writeFileSync(refPath, `${candidate.sha}\n`);

status = revParseCommit(REF);
if (!status) {
  console.error("REPAIR FAILED: ref still not resolvable after write");
  process.exit(1);
}

console.log(`REPAIRED ${REF} -> ${status}`);
console.log(`source: ${candidate.source}`);
console.log(`head: ${git(["log", "-1", "--oneline", REF])}`);
