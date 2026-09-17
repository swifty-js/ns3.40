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
 * Numeric helpers shared by the simulation driver and the figure pipeline.
 *
 * The Python original relied on NumPy (`np.mean`, `np.isnan`) and on Python's
 * number formatting when writing CSV/JSON. These helpers reproduce the parts of
 * that behaviour the reports depend on, so the JavaScript output stays
 * byte-compatible with the archived artifacts.
 */

/**
 * Arithmetic mean, matching `np.mean` for the empty case by returning `NaN`.
 *
 * @param {ReadonlyArray<number>} values
 * @returns {number} `NaN` when `values` is empty.
 */
export function mean(values) {
  if (values.length === 0) return Number.NaN;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

/**
 * Sum of a numeric list; `0` for an empty list, like Python's `sum`.
 *
 * @param {ReadonlyArray<number>} values
 * @returns {number}
 */
export function sum(values) {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/**
 * Python's `round(value, digits)`.
 *
 * Python rounds the exact binary value of the double half-to-even, whereas
 * `Math.round` rounds half away from zero. Ties are detected on the scaled
 * value; the scaling introduces a rounding error far below the precision of the
 * measurements, and exactly representable ties (such as `0.125`) are unaffected
 * because scaling by a power of ten is exact for them.
 *
 * @param {number} value
 * @param {number} digits - Number of decimal places; may be negative.
 * @returns {number}
 */
export function round(value, digits) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  const scaled = value * factor;
  if (!Number.isFinite(scaled)) return value;
  const floor = Math.floor(scaled);
  const fraction = scaled - floor;
  if (fraction > 0.5) return (floor + 1) / factor;
  if (fraction < 0.5) return floor / factor;
  return (floor % 2 === 0 ? floor : floor + 1) / factor;
}

/**
 * Python's `str()` for a float, as used by `csv.writer` and `json.dumps`.
 *
 * Integral floats keep their `.0` suffix (`1000.0`), and magnitudes outside
 * `[1e-4, 1e16)` switch to exponent notation with a two-digit, signed exponent
 * (`1e-05`), matching CPython's `repr`/`str` rules.
 *
 * @param {number} value
 * @returns {string}
 */
export function floatToString(value) {
  if (!Number.isFinite(value)) {
    if (Number.isNaN(value)) return "nan";
    return value > 0 ? "inf" : "-inf";
  }
  if (value === 0) return Object.is(value, -0) ? "-0.0" : "0.0";

  const magnitude = Math.abs(value);
  const needsExponent = magnitude < 1e-4 || magnitude >= 1e16;
  if (!needsExponent) {
    return Number.isInteger(value) ? `${value}.0` : String(value);
  }

  // Normalize into Python's mantissa/exponent form, which always carries a sign
  // on the exponent and at least two exponent digits.
  const [mantissa, exponent] = value.toExponential().split("e");
  const exponentValue = Number(exponent);
  const sign = exponentValue < 0 ? "-" : "+";
  return `${mantissa}e${sign}${String(Math.abs(exponentValue)).padStart(2, "0")}`;
}

/**
 * `true` when the value is a usable measurement, `false` for `null`/`NaN`.
 *
 * @param {number | null | undefined} value
 * @returns {boolean}
 */
export function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Sample standard deviation, matching `numpy.std(values, ddof=1)`.
 *
 * @param {ReadonlyArray<number>} values
 * @returns {number} `NaN` for fewer than two samples, like NumPy with `ddof=1`.
 */
export function sampleStdDev(values) {
  if (values.length < 2) return Number.NaN;
  const average = mean(values);
  const squaredDeviations = values.map((value) => (value - average) ** 2);
  return Math.sqrt(sum(squaredDeviations) / (values.length - 1));
}

/**
 * Two-sided 95% t critical values, indexed by degrees of freedom.
 *
 * Reproduces the lookup table used by the Python driver: the small-sample values
 * are carried explicitly and everything beyond them falls back to the normal
 * approximation.
 *
 * @type {Readonly<Record<number, number>>}
 */
const T_CRITICAL_95 = { 1: 12.706, 2: 4.303 };

/**
 * Mean, sample standard deviation, and 95% confidence interval half-width.
 *
 * @param {ReadonlyArray<number>} values
 * @returns {readonly [number, number, number]} `[mean, std, ci95]`; `std` and
 *   `ci95` are `0` for a single sample.
 */
export function metricSummary(values) {
  const average = mean(values);
  if (values.length < 2) return [average, 0, 0];
  const deviation = sampleStdDev(values);
  const tCritical = T_CRITICAL_95[values.length - 1] ?? 1.96;
  return [
    average,
    deviation,
    (tCritical * deviation) / Math.sqrt(values.length),
  ];
}
