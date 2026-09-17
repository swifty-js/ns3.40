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
 * Minimal CSV reader/writer matching Python's `csv` module.
 *
 * The archived reports are compared byte-for-byte against regenerated output,
 * and CPython's `csv` module has two behaviours that a naive writer gets wrong:
 * quoting is minimal (a field is only quoted when it contains the delimiter, a
 * quote, or a line terminator) and the line terminator defaults to CRLF unless
 * the caller overrides it. Both are reproduced here.
 */

/**
 * Serialize a field using `csv.QUOTE_MINIMAL` rules.
 *
 * @param {string} value
 * @param {string} delimiter
 * @returns {string}
 */
export function quoteField(value, delimiter) {
  const needsQuotes =
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\r") ||
    value.includes("\n");
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Build a CSV document from a header and rows.
 *
 * @param {ReadonlyArray<string>} fieldnames - Column order.
 * @param {ReadonlyArray<Record<string, string | number | boolean | null>>} rows
 *   Row objects; missing keys become empty fields, like `DictWriter`'s `restval`.
 * @param {object} [options]
 * @param {string} [options.lineterminator] - Defaults to `"\r\n"`, as CPython
 *   does when `csv.writer` is not given an explicit terminator.
 * @param {string} [options.delimiter]
 * @returns {string}
 */
export function buildCsv(fieldnames, rows, options = {}) {
  const delimiter = options.delimiter ?? ",";
  const terminator = options.lineterminator ?? "\r\n";
  const lines = [
    fieldnames.map((name) => quoteField(name, delimiter)).join(delimiter),
  ];
  for (const row of rows) {
    lines.push(
      fieldnames
        .map((name) => {
          const value = row[name];
          return quoteField(value === undefined || value === null ? "" : String(value), delimiter);
        })
        .join(delimiter),
    );
  }
  return lines.join(terminator) + terminator;
}

/**
 * Parse a CSV document into row objects, mirroring `csv.DictReader`.
 *
 * @param {string} text
 * @param {string} [delimiter]
 * @returns {Record<string, string>[]}
 */
export function parseCsv(text, delimiter = ",") {
  const records = parseCsvRecords(text, delimiter);
  if (records.length === 0) return [];
  const [header, ...rows] = records;
  return rows.map((cells) => {
    /** @type {Record<string, string>} */
    const row = {};
    header.forEach((name, index) => {
      row[name] = cells[index] ?? "";
    });
    return row;
  });
}

/**
 * Split a CSV document into records, honouring quoted fields.
 *
 * @param {string} text
 * @param {string} delimiter
 * @returns {string[][]}
 */
function parseCsvRecords(text, delimiter) {
  /** @type {string[][]} */
  const records = [];
  /** @type {string[]} */
  let record = [];
  let field = "";
  let inQuotes = false;
  let index = 0;

  /** @returns {void} */
  const endField = () => {
    record.push(field);
    field = "";
  };
  /** @returns {void} */
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  while (index < text.length) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"' && field === "") {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === delimiter) {
      endField();
      index += 1;
      continue;
    }
    if (char === "\r" && text[index + 1] === "\n") {
      endRecord();
      index += 2;
      continue;
    }
    if (char === "\n") {
      endRecord();
      index += 1;
      continue;
    }
    field += char;
    index += 1;
  }

  // A trailing terminator does not open a new record; anything else does.
  if (field !== "" || record.length > 0) endRecord();
  return records.filter((cells) => !(cells.length === 1 && cells[0] === ""));
}
