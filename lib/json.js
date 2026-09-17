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
 * JSON serialization with CPython-compatible formatting.
 *
 * The provenance manifest is produced with `json.dump(..., indent=2,
 * sort_keys=True)` and `ensure_ascii` left at its default. `JSON.stringify`
 * differs from that in three ways the report pipeline cares about: it preserves
 * insertion order, it emits integral numbers without a decimal point, and it
 * does not escape non-ASCII characters. This module reproduces CPython's
 * behaviour so the manifest can be compared against the Python revision.
 */

/**
 * Escape a string the way `json.dumps` does with `ensure_ascii=True`.
 *
 * Control characters use the short forms CPython prefers (`\b`, `\f`, `\n`,
 * `\r`, `\t`), everything else below U+0020 becomes `\u00xx`, and code points
 * above U+007F are escaped as UTF-16 surrogate pairs.
 *
 * @param {string} value
 * @returns {string}
 */
function encodeString(value) {
  let out = '"';
  for (const character of value) {
    const code = /** @type {number} */ (character.codePointAt(0));
    switch (code) {
      case 0x08:
        out += "\\b";
        continue;
      case 0x09:
        out += "\\t";
        continue;
      case 0x0a:
        out += "\\n";
        continue;
      case 0x0c:
        out += "\\f";
        continue;
      case 0x0d:
        out += "\\r";
        continue;
      case 0x22:
        out += '\\"';
        continue;
      case 0x5c:
        out += "\\\\";
        continue;
      default:
        break;
    }
    if (code < 0x20 || code > 0x7e) {
      if (code > 0xffff) {
        const offset = code - 0x10000;
        const high = 0xd800 + (offset >> 10);
        const low = 0xdc00 + (offset & 0x3ff);
        out += `\\u${high.toString(16).padStart(4, "0")}`;
        out += `\\u${low.toString(16).padStart(4, "0")}`;
      } else {
        out += `\\u${code.toString(16).padStart(4, "0")}`;
      }
      continue;
    }
    out += character;
  }
  return `${out}"`;
}

/**
 * Render a number the way CPython's `json` encoder does.
 *
 * The manifest holds only integers and strings, so integers are written without
 * a decimal point, matching what CPython does for `int` values.
 *
 * @param {number} value
 * @returns {string}
 */
function encodeNumber(value) {
  if (!Number.isFinite(value)) {
    if (Number.isNaN(value)) return "NaN";
    return value > 0 ? "Infinity" : "-Infinity";
  }
  return String(value);
}

/**
 * Serialize a value with CPython's `json.dumps(indent=2, sort_keys=True)`.
 *
 * @param {unknown} value
 * @param {{ indent?: number, level?: number }} [options]
 * @returns {string}
 */
export function pyJsonDumps(value, options = {}) {
  const indent = options.indent ?? 0;
  const level = options.level ?? 0;
  const pad = " ".repeat(indent * level);
  const childPad = " ".repeat(indent * (level + 1));

  if (value === null || value === undefined) return "null";
  const type = typeof value;
  if (type === "boolean") return value ? "true" : "false";
  if (type === "number") {
    return encodeNumber(/** @type {number} */ (value));
  }
  if (type === "string") return encodeString(/** @type {string} */ (value));

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (indent === 0) {
      return `[${value.map((item) => pyJsonDumps(item, { indent, level })).join(",")}]`;
    }
    const items = value.map(
      (item) => childPad + pyJsonDumps(item, { indent, level: level + 1 }),
    );
    return `[\n${items.join(",\n")}\n${pad}]`;
  }

  const entries = Object.entries(/** @type {Record<string, unknown>} */ (value))
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length === 0) return "{}";
  if (indent === 0) {
    const pairs = entries.map(
      ([key, item]) =>
        `${encodeString(key)}:${pyJsonDumps(item, { indent, level })}`,
    );
    return `{${pairs.join(",")}}`;
  }
  const pairs = entries.map(
    ([key, item]) =>
      `${childPad}${encodeString(key)}: ${pyJsonDumps(item, {
        indent,
        level: level + 1,
      })}`,
  );
  return `{\n${pairs.join(",\n")}\n${pad}}`;
}

/**
 * `datetime.now(timezone.utc).isoformat()`.
 *
 * CPython renders six fractional digits and a `+00:00` offset, which
 * `_append_anomalies` then rewrites to a trailing `Z`. `toISOString` only
 * carries milliseconds, so the microseconds are padded explicitly.
 *
 * @param {Date} [date]
 * @returns {string} e.g. `2026-09-17T14:39:38.123456+00:00`.
 */
export function isoformatUtc(date = new Date()) {
  const pad = (/** @type {number} */ value, width = 2) =>
    String(value).padStart(width, "0");
  const base =
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  // Date only exposes milliseconds; pad the remaining three digits with zeros.
  const microseconds = `${pad(date.getUTCMilliseconds(), 3)}000`;
  return `${base}.${microseconds}+00:00`;
}
