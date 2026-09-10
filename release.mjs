#!/usr/bin/env node
/**
 * Creates/updates a GitHub release ("ns3-docs") and uploads the thesis
 * artifacts, using the `gh` CLI.
 *
 * Usage:
 *   node release.mjs [--tag <tag>] [--notes <text>] [--draft] [--dry-run]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the directory containing this script. */
const ROOT = path.dirname(fileURLToPath(import.meta.url));

/** Release title used for every upload. */
const RELEASE_NAME = 'ns3-docs';

/**
 * Repo-relative paths of the artifacts to upload. Asset names on GitHub are
 * derived from the file basename, so keep basenames ASCII-only.
 * @type {readonly string[]}
 */
const ARTIFACTS = [
  'docs/NJUPT_Professional_Thesis_draft1/NJUPT_Professional_Thesis_d1.pdf',
  'docs/thesis.pdf',
  'docs/nanjing-hangtiancheng-network-congestion-control.docx',
];

/** @type {string[]} Command-line arguments (excluding `node` and the script). */
const args = process.argv.slice(2);

/**
 * Reads a CLI flag value, falling back when the flag is absent.
 * @param {string} name - Flag name, e.g. '--tag'.
 * @param {string} fallback - Value returned when the flag is not present.
 * @returns {string}
 */
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const dryRun = args.includes('--dry-run');
const draft = args.includes('--draft');

const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
/** Release tag; defaults to `ns3-docs-<YYYYMMDD>`. @type {string} */
const tag = flag('--tag', `${RELEASE_NAME}-${today}`);

/**
 * Resolved absolute paths of the artifacts to upload.
 * @type {string[]}
 */
const files = ARTIFACTS.map((a) => path.join(ROOT, a));

/** Release notes; defaults to a bullet list of artifact filenames. @type {string} */
const notes = flag('--notes', ARTIFACTS.map((a) => `- ${path.basename(a)}`).join('\n'));

/**
 * Runs a `gh` CLI subcommand synchronously and returns trimmed stdout.
 * Throws when the command exits non-zero.
 * @param {...string} cmd - gh arguments, e.g. 'release', 'view', tag.
 * @returns {string}
 */
function gh(...cmd) {
  return execFileSync('gh', cmd, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

const missing = files.filter((f) => !existsSync(f));
if (missing.length) {
  console.error('Missing artifact files:\n' + missing.map((m) => `  ${m}`).join('\n'));
  process.exit(1);
}

const listing = files.map((f) => `${path.basename(f)} (${(statSync(f).size / 1024).toFixed(0)} KB)`);
console.log(`release ${RELEASE_NAME} / tag ${tag}\nUploading:\n  ${listing.join('\n  ')}`);

if (dryRun) {
  console.log('\n--dry-run: GitHub not contacted');
  process.exit(0);
}

try {
  gh('--version');
} catch {
  console.error('gh CLI not found. Install it first: brew install gh && gh auth login');
  process.exit(1);
}

// `gh release view` exits non-zero for an unknown tag, so probe via try/catch.
let exists = false;
try {
  gh('release', 'view', tag, '--json', 'tagName');
  exists = true;
} catch {}

if (exists) {
  console.log(`\ntag ${tag} already exists, overwriting same-named artifacts`);
} else {
  gh(
    'release',
    'create',
    tag,
    '--title',
    RELEASE_NAME,
    '--notes',
    notes,
    ...(draft ? ['--draft'] : []),
  );
  console.log(`\nCreated release ${tag}`);
}

gh('release', 'upload', tag, '--clobber', ...files);
console.log(`Uploaded ${files.length} artifacts`);
console.log(gh('release', 'view', tag, '--json', 'url', '--jq', '.url'));
