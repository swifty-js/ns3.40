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
 * Path joining that matches `os.path.join` instead of `path.join`.
 *
 * The two differ in normalization: `path.join("./logs/real", "summary")`
 * collapses to `logs/real/summary`, while `os.path.join` keeps the `./` prefix
 * and yields `./logs/real/summary`. The path shows up verbatim in the summary
 * report's console output, so the Python behaviour is reproduced here.
 */

/**
 * Join path segments the way `posixpath.join` does.
 *
 * An absolute segment (one starting with `/`) discards everything before it, an
 * empty leading path is treated as absent, and no component is normalized.
 *
 * @param {...string} parts - Segments to join.
 * @returns {string}
 */
export function osPathJoin(...parts) {
  const [first = "", ...rest] = parts;
  let joined = first;
  for (const part of rest) {
    if (part.startsWith("/")) joined = part;
    else if (joined === "" || joined.endsWith("/")) joined += part;
    else joined += `/${part}`;
  }
  return joined;
}
