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
 * Command-line parsing with argparse-compatible conveniences.
 *
 * `node:util`'s `parseArgs` only supports repeated flags for multi-value
 * options, while the migrated scripts accept space-separated lists
 * (`--scenario wifi_ac lte_good`, argparse's `nargs="+"`). This module keeps
 * that interface so existing invocations, the Makefile, and the documented
 * examples continue to work unchanged.
 */

/**
 * A value an option can hold.
 *
 * @typedef {string | number | boolean | string[]} OptionValue
 */

/**
 * @typedef {object} OptionSpec
 * @property {"boolean" | "string" | "int" | "list"} type
 * @property {string} [help]
 * @property {OptionValue} [default]
 * @property {Record<string, OptionValue>} [defaultByCommand] - Overrides
 *   `default` for the listed subcommands, mirroring how argparse gives each
 *   subparser its own defaults for a flag of the same name.
 *
 * @typedef {Record<string, OptionValue | undefined>} ParsedOptions
 */

/**
 * A small, schema-driven argument parser.
 */
export class ArgumentParser {
  /** @type {string} */
  #program;
  /** @type {string} */
  #description;
  /** @type {string} */
  #epilog;
  /** @type {Map<string, OptionSpec>} */
  #options = new Map();

  /**
   * @param {object} init
   * @param {string} init.program - Program name shown in usage output.
   * @param {string} [init.description]
   * @param {string} [init.epilog] - Appended verbatim after the option list.
   */
  constructor(init) {
    this.#program = init.program;
    this.#description = init.description ?? "";
    this.#epilog = init.epilog ?? "";
  }

  /**
   * Declare an option.
   *
   * @param {string} flag - Long flag including the leading dashes.
   * @param {OptionSpec} spec
   * @returns {this}
   */
  addOption(flag, spec) {
    this.#options.set(flag, spec);
    return this;
  }

  /** @returns {string} Multi-line usage text. */
  usage() {
    const lines = [];
    if (this.#description) lines.push(this.#description, "");
    lines.push(`Usage: node ${this.#program} <command> [options]`, "");
    lines.push("Options:");
    for (const [flag, spec] of this.#options) {
      const placeholder =
        spec.type === "boolean"
          ? ""
          : spec.type === "list"
            ? " <value...>"
            : " <value>";
      const overrides = Object.entries(spec.defaultByCommand ?? {})
        .map(([name, value]) => `${name}: ${JSON.stringify(value)}`)
        .join(", ");
      const fallback =
        spec.default === undefined ? "" : ` (default: ${JSON.stringify(spec.default)})`;
      const suffix = overrides ? `${fallback}, ${overrides}`.replace(" ()", " (") : fallback;
      lines.push(`  ${flag}${placeholder}`.padEnd(30) + `${spec.help ?? ""}${suffix}`);
    }
    if (this.#epilog) lines.push("", this.#epilog);
    return lines.join("\n");
  }

  /**
   * Parse an argument vector.
   *
   * @param {string[]} argv - Arguments after the script name.
   * @returns {{ command: string | null, options: ParsedOptions, positionals: string[] }}
   * @throws {Error} On an unknown flag or a missing option value.
   */
  parse(argv) {
    // argparse resolves subcommand options after the command token, so the
    // command is always the first positional.
    const leading = argv[0];
    const command =
      leading !== undefined && !leading.startsWith("-") ? leading : null;

    /** @type {ParsedOptions} */
    const options = {};
    for (const [flag, spec] of this.#options) {
      const override = command ? spec.defaultByCommand?.[command] : undefined;
      if (override !== undefined) options[flag] = override;
      else if (spec.default !== undefined) options[flag] = spec.default;
    }

    /** @type {string[]} */
    const positionals = [];
    let index = 0;
    while (index < argv.length) {
      const token = argv[index];
      const spec = this.#options.get(token);
      if (!spec) {
        if (token.startsWith("-") && token !== "-") {
          throw new Error(`unrecognized argument: ${token}`);
        }
        positionals.push(token);
        index += 1;
        continue;
      }

      if (spec.type === "boolean") {
        options[token] = true;
        index += 1;
        continue;
      }

      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`argument ${token}: expected a value`);
      }
      if (spec.type === "int") {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed)) {
          throw new Error(`argument ${token}: invalid int value: '${value}'`);
        }
        options[token] = parsed;
        index += 2;
        continue;
      }
      if (spec.type === "list") {
        // argparse's `nargs="+"`: consume every following token that is not a
        // flag. Commas are also accepted as separators, which lets the same
        // option be written as `--scenario wifi_ac,lte_good`.
        const values = [];
        let cursor = index + 1;
        while (cursor < argv.length && !argv[cursor].startsWith("-")) {
          values.push(argv[cursor]);
          cursor += 1;
        }
        if (values.length === 0) {
          throw new Error(`argument ${token}: expected at least one value`);
        }
        options[token] = values.flatMap((part) => part.split(",")).filter(Boolean);
        index = cursor;
        continue;
      }
      options[token] = value;
      index += 2;
    }

    const [resolvedCommand, ...rest] = positionals;
    return { command: resolvedCommand ?? null, options, positionals: rest };
  }
}

/**
 * Read a parsed option as a string.
 *
 * @param {ParsedOptions} options
 * @param {string} flag
 * @returns {string | null}
 */
export function optionString(options, flag) {
  const value = options[flag];
  return typeof value === "string" ? value : null;
}

/**
 * Read a parsed option as an integer, or `undefined` when unset.
 *
 * @param {ParsedOptions} options
 * @param {string} flag
 * @returns {number | undefined}
 */
export function optionInt(options, flag) {
  const value = options[flag];
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * Read a parsed option as a list.
 *
 * The Python CLI used `nargs="+"`, so `--scenario a b` arrives as two
 * positional-looking tokens. Values consumed by the list option at parse time
 * are split on whitespace and commas, which covers both spellings.
 *
 * @param {ParsedOptions} options
 * @param {string} flag
 * @returns {string[]}
 */
export function optionList(options, flag) {
  const value = options[flag];
  return Array.isArray(value) ? value : [];
}
