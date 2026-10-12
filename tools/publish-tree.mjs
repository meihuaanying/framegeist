#!/usr/bin/env node
// Publish the committed tree of a local ref to a remote branch, through the Git
// Data API, and refuse to move the branch unless the result is provably correct.
//
// Why this exists instead of `git push`
// ------------------------------------
// On this machine github.com:443 is unreachable (every git remote operation dies
// trying to reach a local proxy), so the only way out is the Git Data API. That
// API makes it easy to publish a *partial* tree, which is exactly how v1.4.0 was
// shipped: the previous tool diffed against a local base that had never been
// pushed and read bytes from the working tree, so every published tree was the
// remote base plus an incomplete delta. The ref SHA, the deployments and all six
// workflow runs were individually correct, and 12 templates were missing.
//
// The invariants this tool enforces
// --------------------------------
//  * The remote base is read from the API, never assumed from a local commit.
//    A local commit is only used to decide *which paths* changed.
//  * Blob bytes come from `git cat-file blob <ref>:<path>`, never from the
//    working tree: on Windows the checkout has CRLF and the remote would receive
//    different bytes than the commit references.
//  * Unchanged directories are reused by SHA, so the number of API calls tracks
//    the size of the diff rather than the size of the repository.
//  * `.github/**` is not uploaded, because a tree entry under
//    `.github/workflows/` makes GitHub reject the whole commit with a bare 404
//    when the token lacks `workflow` scope. Equality is therefore asserted on
//    every path *except* that subtree.
//  * The branch only moves after the constructed root tree has been read back
//    and compared against `git rev-parse <ref>^{tree}`. Without this check a
//    partial publish is invisible.
//
// Usage
//   node tools/publish-tree.mjs <ref> <branch> <message-file> [--dry]
//
//   <ref>     local commit-ish to publish (e.g. HEAD)
//   <branch>  remote branch to move (e.g. main)
//   --dry     upload nothing and move nothing; report the plan only
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const REPO = process.env.FG_REPO ?? "meihuaanying/framegeist";
const [ref, branch, msgFile] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const DRY = process.argv.includes("--dry");

if (!ref || !branch) {
  console.error("usage: node tools/publish-tree.mjs <ref> <branch> <message-file> [--dry]");
  process.exit(2);
}

/** `.github` carries the workflow files the token cannot write. */
const EXCLUDED = (p) => p === ".github" || p.startsWith(".github/");

const git = (args, opts = {}) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, ...opts });
const gitBuf = (args) =>
  execFileSync("git", args, { maxBuffer: 512 * 1024 * 1024 });

const gh = (args, input) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    input,
    stdio: input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
  });
const api = (method, path, body) => {
  const args = ["api", "-X", method, path];
  if (body) args.push("--input", "-");
  return JSON.parse(gh(args, body ? JSON.stringify(body) : undefined));
};

// ---------------------------------------------------------------- local model
const target = git(["rev-parse", `${ref}^{commit}`]).trim();
const wantTree = git(["rev-parse", `${target}^{tree}`]).trim();
const local = new Map();
for (const line of git(["ls-tree", "-r", "-t", target]).split("\n")) {
  if (!line.trim()) continue;
  const m = /^(\d+) (\w+) (\w+)\t(.*)$/s.exec(line);
  if (!m) throw new Error(`unparseable ls-tree line: ${line}`);
  local.set(m[4], { type: m[2], sha: m[3], mode: m[1] });
}
console.log(`publishing ${target} (tree ${wantTree}) to ${branch}`);

// --------------------------------------------------------------- remote model
const head = api("GET", `repos/${REPO}/git/refs/heads/${branch}`).object.sha;
const baseTree = api("GET", `repos/${REPO}/git/commits/${head}`).tree.sha;
const base = new Map();
for (const e of api("GET", `repos/${REPO}/git/trees/${baseTree}?recursive=1`).tree ?? [])
  base.set(e.path, { type: e.type, sha: e.sha, mode: e.mode });
console.log(`remote ${branch} at ${head} (tree ${baseTree}, ${base.size} entries)`);

// ---------------------------------------------------------------------- delta
const upload = [];
const drop = [];
for (const [p, v] of local) {
  if (EXCLUDED(p)) continue;
  const r = base.get(p);
  if (!r) {
    if (v.type === "blob") upload.push(p);
  } else if (r.sha !== v.sha && v.type === "blob") {
    upload.push(p);
  }
}
for (const p of base.keys()) if (!local.has(p) && !EXCLUDED(p)) drop.push(p);

const changed = new Set([...upload, ...drop]);
const untouched = [...local.keys()].filter((p) => !EXCLUDED(p) && !changed.has(p));
const skipped = [...local.keys()].filter(EXCLUDED);
console.log(
  `plan: ${upload.length} blob(s) to upload, ${drop.length} to remove, ` +
    `${untouched.length} unchanged, ${skipped.length} skipped (.github)`,
);
if (DRY) {
  for (const p of upload.slice(0, 20)) console.log(`   + ${p}`);
  for (const p of drop.slice(0, 10)) console.log(`   - ${p}`);
  console.log("dry run: nothing uploaded, branch untouched");
  process.exit(0);
}

// ---------------------------------------------------------------------- blobs
const blobSha = new Map();
let n = 0;
for (const p of upload) {
  const bytes = gitBuf(["cat-file", "blob", `${target}:${p}`]);
  const { sha } = api("POST", `repos/${REPO}/git/blobs`, {
    content: bytes.toString("base64"),
    encoding: "base64",
  });
  blobSha.set(p, sha);
  if (++n % 25 === 0) console.log(`  blobs ${n}/${upload.length}`);
}
console.log(`blobs uploaded: ${n}`);

// ---------------------------------------------------------------------- trees
// Deepest first so a parent can reference its children's new SHAs.
const dirs = [...local.keys()]
  .filter((p) => local.get(p).type === "tree" && !EXCLUDED(p))
  .sort((a, b) => b.split("/").length - a.split("/").length);

const childrenOf = (dir) => {
  const prefix = dir ? `${dir}/` : "";
  const out = [];
  for (const [p, v] of local) {
    if (EXCLUDED(p) || !p.startsWith(prefix) || p.length === prefix.length) continue;
    if (p.slice(prefix.length).includes("/")) continue;
    out.push([p, v]);
  }
  return out;
};
const touched = (dir) => [...changed].some((p) => (dir ? p.startsWith(`${dir}/`) : true));

const treeSha = new Map();
let rebuilt = 0;
let reused = 0;
for (const dir of dirs) {
  if (!touched(dir)) {
    const r = base.get(dir);
    if (!r) throw new Error(`remote has no ${dir}; a full rebuild is needed`);
    treeSha.set(dir, r.sha);
    reused += 1;
    continue;
  }
  const kids = childrenOf(dir).filter(([p]) => !drop.includes(p));
  const entries = kids.map(([p, v]) => ({
    path: dir ? p.slice(dir.length + 1) : p,
    mode: v.mode,
    type: v.type,
    sha: v.type === "tree" ? treeSha.get(p) : blobSha.get(p) ?? v.sha,
  }));
  // `base_tree` can add or override but never remove, so a directory that lost a
  // path has to be rebuilt in full.
  const lost = drop.some((p) => (dir ? p.startsWith(`${dir}/`) : true));
  const body = { tree: entries };
  if (!lost && base.has(dir)) body.base_tree = base.get(dir).sha;
  treeSha.set(dir, api("POST", `repos/${REPO}/git/trees`, body).sha);
  rebuilt += 1;
}

const rootEntries = childrenOf("")
  .filter(([p]) => !EXCLUDED(p))
  .map(([p, v]) => ({
    path: p,
    mode: v.mode,
    type: v.type,
    sha: v.type === "tree" ? treeSha.get(p) : blobSha.get(p) ?? v.sha,
  }));
const root = api("POST", `repos/${REPO}/git/trees`, { tree: rootEntries, base_tree: baseTree }).sha;
console.log(`trees: rebuilt=${rebuilt} reused=${reused} root=${root}`);

// ------------------------------------------------------------------- verify
// Read the constructed tree back and compare it with the local one. This is the
// only check that can see a partial publish.
const check = api("GET", `repos/${REPO}/git/trees/${root}?recursive=1`);
if (check.truncated) throw new Error("constructed tree listing is truncated; cannot verify");
const got = new Map(check.tree.map((e) => [e.path, e.sha]));
const bad = [];
for (const [p, v] of local) {
  if (EXCLUDED(p)) continue;
  if (got.get(p) !== v.sha) bad.push(p);
}
for (const p of got.keys()) if (!local.has(p) && !EXCLUDED(p)) bad.push(p);
if (bad.length) {
  console.error(`constructed tree differs from ${target} on ${bad.length} path(s):`);
  for (const p of bad.slice(0, 20)) console.error(`   ${p}`);
  console.error("branch NOT moved");
  process.exit(3);
}
console.log(`verified: ${got.size} entries match ${target} on every non-.github path`);

// -------------------------------------------------------------------- commit
const message = readFileSync(msgFile, "utf8").replace(/^\uFEFF/, "");
const commit = api("POST", `repos/${REPO}/git/commits`, {
  message,
  tree: root,
  parents: [head],
}).sha;
api("PATCH", `repos/${REPO}/git/refs/heads/${branch}`, { sha: commit });
console.log(`${branch}: ${head} -> ${commit}`);
console.log(
  "note: a ref can only be moved to a commit this token created; pointing it at " +
    "an older commit returns a bare 404 even though the token can write refs",
);
