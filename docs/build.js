#!/usr/bin/env node
// @ts-check
/**
 * Copyright 2026 hangtiancheng
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * LaTeX build driver for the documents in this directory.
 *
 * JavaScript port of the former `build.py`. Targets, exit codes, and the console
 * output are unchanged:
 *
 *   node docs/build.js njupt    # NJUPT master's thesis (with BibTeX)
 *   node docs/build.js thesis   # Chinese conference paper
 *   node docs/build.js all      # both, in parallel
 *   node docs/build.js clean    # remove LaTeX auxiliary files
 */

import { spawnSync } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Absolute path of this script's directory. */
const DOCS_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Directory holding the NJUPT thesis sources. */
const THESIS_DIR = path.join(DOCS_DIR, "NJUPT_Professional_Thesis_draft1");

/**
 * Top-level auxiliary file suffixes removed by `clean`.
 *
 * The Python original keyed on the name ending with one of these, which also
 * catches compound suffixes such as `.run.xml`.
 */
const AUXILIARY_SUFFIXES = [
  ".aux",
  ".bbl",
  ".blg",
  ".lof",
  ".log",
  ".lot",
  ".toc",
  ".out",
];

/** Targets that are re-cleaned automatically once the build finishes. */
const AUTO_CLEAN_TARGETS = new Set(["njupt", "thesis", "all"]);

/**
 * Signals that a build already reported its own error and should unwind.
 */
class BuildAbort extends Error {
  constructor() {
    super("build aborted");
    this.name = "BuildAbort";
  }
}

/**
 * @param {string} message
 * @returns {void}
 */
function log(message) {
  console.log(`[BUILD] ${message}`);
}

/**
 * @param {string} message
 * @returns {void}
 */
function warn(message) {
  console.warn(`[WARN] ${message}`);
}

/**
 * @param {string} message
 * @returns {void}
 */
function err(message) {
  console.error(`[ERROR] ${message}`);
}

/**
 * Run a command, optionally tolerating failure.
 *
 * @param {string[]} command - Executable followed by its arguments.
 * @param {string} cwd - Working directory.
 * @param {boolean} [ignoreFailure] - Return `false` instead of throwing.
 * @returns {boolean} `true` when the command exited with status 0.
 * @throws {Error} On a missing executable or a non-zero exit, unless ignored.
 */
export function runCommand(command, cwd, ignoreFailure = false) {
  const [executable, ...args] = command;
  const result = spawnSync(executable, args, {
    cwd,
    stdio: "ignore",
  });
  if (result.error) {
    err(`Command not found: ${executable}`);
    if (ignoreFailure) return false;
    throw result.error;
  }
  if (result.status !== 0) {
    if (ignoreFailure) return false;
    const failure = new Error(
      `Command failed with exit code ${result.status}: ${command.join(" ")}`,
    );
    throw failure;
  }
  return true;
}

/**
 * Delete LaTeX auxiliary files produced while compiling a document tree.
 *
 * Mirrors the Python behaviour: every suffix-matching file directly inside
 * `directory` is removed, and `.aux` files are additionally removed up to two
 * levels deep (so `NJUPT_Professional_Thesis_draft1/chapters/*.aux` is caught
 * without touching nested asset directories).
 *
 * @param {string} [directory] - Root to clean; defaults to the docs directory.
 * @returns {Promise<void>}
 */
export async function cleanTrash(directory = DOCS_DIR) {
  /** @type {import("node:fs").Dirent[]} */
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (AUXILIARY_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) {
      await rm(path.join(directory, entry.name), { force: true });
    }
  }

  await removeNestedAux(directory, directory, 1);
}

/**
 * Recursively remove `.aux` files at most `depth` levels below `root`.
 *
 * @param {string} root
 * @param {string} current
 * @param {number} depth
 * @returns {Promise<void>}
 */
async function removeNestedAux(root, current, depth) {
  if (depth > 2) return;
  /** @type {import("node:fs").Dirent[]} */
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    if (entry.isFile() && entry.name.endsWith(".aux")) {
      await rm(full, { force: true });
      continue;
    }
    if (entry.isDirectory()) {
      const relative = path.relative(root, full);
      if (relative.split(path.sep).length <= 2) {
        await removeNestedAux(root, full, depth + 1);
      }
    }
  }
}

/**
 * Compile a document that uses BibTeX, from the docs directory.
 *
 * @param {string} tex - Source file name, e.g. `thesis.tex`.
 * @param {string} [compiler] - LaTeX engine.
 * @returns {Promise<void>}
 */
export async function buildConferenceWithBib(tex, compiler = "xelatex") {
  const name = tex.replace(/\.tex$/, "");
  log(`Compiling ${tex} (with BibTeX)...`);

  await runPass(compiler, tex, DOCS_DIR, `Pass 1 failed for ${tex}. Please check ${name}.log for details.`);

  try {
    runCommand(["bibtex", name], DOCS_DIR);
  } catch {
    err(`BibTeX failed for ${tex}. Please check ${name}.blg for details.`);
    process.exitCode = 1;
    throw new BuildAbort();
  }

  await runPass(compiler, tex, DOCS_DIR, `Pass 2 failed for ${tex}. Please check ${name}.log for details.`);
  await runPass(compiler, tex, DOCS_DIR, `Pass 3 failed for ${tex}. Please check ${name}.log for details.`);

  log(`${name}.pdf successfully generated ✓`);
}

/**
 * Compile the NJUPT thesis, where BibTeX warnings are tolerated.
 *
 * @param {string} tex - Source file name.
 * @returns {Promise<void>}
 */
export async function buildWithBib(tex) {
  const name = tex.replace(/\.tex$/, "");
  log(`Compiling ${tex} (with BibTeX)...`);

  await runPass("xelatex", tex, THESIS_DIR, `Pass 1 failed for ${tex}.`);

  if (!runCommand(["bibtex", name], THESIS_DIR, true)) {
    warn(`bibtex generated warnings for ${name}.`);
  }

  await runPass("xelatex", tex, THESIS_DIR, `Pass 2 failed for ${tex}.`);
  await runPass("xelatex", tex, THESIS_DIR, `Pass 3 failed for ${tex}.`);

  log(`${name}.pdf successfully generated ✓`);
}

/**
 * Run one compiler pass, converting a failure into the documented error message.
 *
 * @param {string} compiler
 * @param {string} tex
 * @param {string} cwd
 * @param {string} message - Message printed when the pass fails.
 * @returns {Promise<void>}
 */
async function runPass(compiler, tex, cwd, message) {
  const command = [compiler, "-interaction=nonstopmode", "-halt-on-error", tex];
  try {
    runCommand(command, cwd);
  } catch {
    err(message);
    process.exitCode = 1;
    throw new BuildAbort();
  }
}

/**
 * Print the command-line help.
 *
 * @returns {void}
 */
export function usage() {
  const program = path.basename(process.argv[1] ?? "build.js");
  console.log(`Usage: node ${program} <target...>`);
  console.log("");
  console.log("  njupt    Compile NJUPT master's thesis (with BibTeX)");
  console.log("  thesis   Compile Chinese conference paper (thesis.tex)");
  console.log("  all      Compile all targets above");
  console.log("  clean    Clean compilation auxiliary files");
}

/**
 * Remove auxiliary files from every document tree.
 *
 * @returns {Promise<void>}
 */
export async function cleanAll() {
  log("Cleaning auxiliary files...");
  await cleanTrash(DOCS_DIR);
  await cleanTrash(THESIS_DIR);
  await cleanTrash(path.join(THESIS_DIR, "chapters"));
  log("Cleanup complete ✓");
}

/**
 * Build both documents concurrently.
 *
 * @returns {Promise<void>}
 */
export async function buildAllParallel() {
  const targets = ["njupt", "thesis"];
  const results = await Promise.allSettled(
    targets.map((target) => doBuild(target)),
  );
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      err(`Parallel build failed for target: ${targets[index]}`);
      throw result.reason;
    }
  }
}

/**
 * Dispatch one build target.
 *
 * @param {string} target
 * @returns {Promise<void>}
 */
export async function doBuild(target) {
  if (target === "njupt") {
    await buildWithBib("NJUPT_Professional_Thesis_d1.tex");
    return;
  }
  if (target === "thesis") {
    await buildConferenceWithBib("thesis.tex", "xelatex");
    return;
  }
  if (target === "all") {
    await buildAllParallel();
    return;
  }
  if (target === "clean") {
    await cleanAll();
    return;
  }

  err(`Unknown target: ${target}`);
  usage();
  process.exitCode = 1;
  throw new BuildAbort();
}

/**
 * @param {string[]} [argv] - Arguments after the script name.
 * @returns {Promise<number>} Process exit code.
 */
export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 0) {
    usage();
    return 0;
  }

  try {
    for (const target of argv) {
      await doBuild(target);
      if (AUTO_CLEAN_TARGETS.has(target)) {
        await cleanAll();
      }
    }
  } catch (error) {
    if (error instanceof BuildAbort) return 1;
    throw error;
  }

  log("All tasks completed successfully ✓");
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
