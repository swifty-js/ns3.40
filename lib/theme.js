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
 * Shared presentation conventions for the plotly figures.
 *
 * The values mirror the matplotlib configuration the Python scripts applied
 * (`plt.rcParams`), so the migrated figures keep the original typography: the
 * same font stack with CJK fallbacks, the same grid treatment, and no top/right
 * spines.
 */

/** @import { Layout } from "plotly.js-dist-min" */

/** PostScript points per inch; figure sizes are declared in these units. */
export const POINTS_PER_INCH = 72;

/** Font stack with CJK fallbacks, matching the matplotlib font list. */
export const FONT_FAMILY =
  "Helvetica, Arial, 'Helvetica Neue', 'DejaVu Sans', 'PingFang SC', 'Songti SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";

/** Grid line colour at the alpha used by the matplotlib originals. */
export const GRID_COLOR = "#d9d9d9";

/** Axis line colour. */
export const AXIS_COLOR = "#333333";

/** Fill used to flag a missing measurement. */
export const MISSING_LABEL_COLOR = "#555555";

/**
 * Convert an inch measurement into points.
 *
 * @param {number} inches
 * @returns {number}
 */
export function inches(inches) {
  return inches * POINTS_PER_INCH;
}

/**
 * Build the base layout every figure starts from.
 *
 * @param {object} options
 * @param {number} options.width - Figure width in points.
 * @param {number} options.height - Figure height in points.
 * @param {number} [options.baseFontSize] - Base font size in points.
 * @param {{ top?: number, right?: number, bottom?: number, left?: number }} [options.margin]
 *   Margins in points; `undefined` keeps plotly's own autosizing.
 * @returns {Partial<Layout>}
 */
export function baseLayout(options) {
  const {
    width,
    height,
    baseFontSize = 9,
    margin,
  } = options;

  return {
    width,
    height,
    font: { family: FONT_FAMILY, size: baseFontSize, color: "#111111" },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    showlegend: true,
    ...(margin
      ? {
          margin: {
            t: margin.top ?? 0,
            r: margin.right ?? 0,
            b: margin.bottom ?? 0,
            l: margin.left ?? 0,
            autoexpand: false,
          },
        }
      : {}),
  };
}

/**
 * Configure an axis the way matplotlib's default style renders it: horizontal
 * grid lines only, no top/right spines, ticks outside.
 *
 * @param {object} [options]
 * @param {string} [options.title] - Axis label.
 * @param {number} [options.titleSize] - Label font size in points.
 * @param {number} [options.tickSize] - Tick label font size in points.
 * @param {boolean} [options.grid] - Draw grid lines.
 * @param {boolean} [options.log] - Use a logarithmic scale.
 * @returns {Partial<Layout["yaxis"]>}
 */
export function axisStyle(options = {}) {
  const { title, titleSize = 9, tickSize = 8, grid = true, log = false } = options;
  return {
    type: log ? "log" : "linear",
    showgrid: grid,
    gridcolor: GRID_COLOR,
    gridwidth: 0.6,
    zeroline: false,
    showline: false,
    ticks: "outside",
    ticklen: 4,
    tickcolor: AXIS_COLOR,
    tickfont: { size: tickSize },
    title: title
      ? { text: title, font: { size: titleSize }, standoff: 8 }
      : undefined,
    automargin: true,
  };
}

/**
 * Format a numeric tick label without exponent clutter, the way matplotlib's
 * scalar formatter does for the value ranges these charts use.
 *
 * @param {number} value
 * @param {number} [digits] - Maximum number of significant decimals.
 * @returns {string}
 */
export function tickLabel(value, digits = 4) {
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  if (magnitude >= 1e5 || magnitude < 1e-3) {
    return value.toExponential(0).replace("e+", "e");
  }
  const decimals = magnitude >= 100 ? 0 : magnitude >= 1 ? 1 : digits;
  const text = value.toFixed(decimals);
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}
