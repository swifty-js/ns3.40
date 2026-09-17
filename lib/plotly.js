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
 * Headless rendering backend for the figure pipeline.
 *
 * Figures are described with plotly.js traces/layout only, and this module turns
 * one description into the three output formats the reports need:
 *
 * - PNG  via `Plotly.toImage`, re-rendered at the requested pixel scale so text
 *   stays crisp at print resolutions.
 * - SVG  via `Plotly.toImage`, re-tagged to point units so the file is
 *   physically sized (a 691.2pt figure is 9.6in wide, like matplotlib's).
 * - PDF  via Chromium's print pipeline on the live DOM, which keeps every glyph
 *   and stroke as vectors and embeds the fonts. LaTeX includes this format, so
 *   it must not be a rasterized image.
 *
 * Geometry is expressed in PostScript points (1/72 inch), the unit the original
 * matplotlib code used for `figsize`. The PDF page is therefore `width / 72`
 * inches with a `96 / 72` print scale, which maps the CSS-pixel layout onto the
 * physical page exactly.
 */

import path from "node:path";
import { createRequire } from "node:module";
import { accessSync, constants, readFileSync } from "node:fs";
import { chromium } from "playwright";

/** @import { Data, Layout, Config } from "plotly.js-dist-min" */
/** @import { Browser, Page } from "playwright" */

const require = createRequire(import.meta.url);

/** CSS pixels per inch, the unit Chromium prints in. */
const CSS_PX_PER_INCH = 96;

/** PostScript points per inch. */
const POINTS_PER_INCH = 72;

/** Print scale that maps a CSS-pixel layout onto its point dimensions. */
const PRINT_SCALE = CSS_PX_PER_INCH / POINTS_PER_INCH;

/** Identifier of the container element the figures are drawn into. */
const FIGURE_ID = "figure";

/**
 * The subset of the plotly.js browser API this module calls. The library is
 * injected into the page as a classic script, so the global is typed by hand
 * instead of imported.
 *
 * @typedef {object} PlotlyApi
 * @property {(gd: string, data: unknown, layout: unknown, config: unknown) => Promise<void>} newPlot
 * @property {(gd: unknown, options: { format: string, width: number, height: number, scale?: number }) => Promise<string>} toImage
 * @property {(gd: unknown) => void} purge
 * @property {string} version
 */

/**
 * Description of one figure to render.
 *
 * @typedef {object} FigureSpec
 * @property {string} name - Output file stem, e.g. `fig01_goodput_clean`.
 * @property {number} width - Figure width in points.
 * @property {number} height - Figure height in points.
 * @property {Partial<Data>[]} data - plotly traces.
 * @property {Partial<Layout>} layout - plotly layout; `width` and `height` are
 *   set by the renderer from `width`/`height`.
 */

/**
 * Output formats to produce for a figure.
 *
 * @typedef {object} OutputFormats
 * @property {boolean} [png]
 * @property {boolean} [pdf]
 * @property {boolean} [svg]
 */

/**
 * Rendered figure bytes, keyed by format.
 *
 * @typedef {object} RenderedFigure
 * @property {Buffer} [png]
 * @property {Buffer} [pdf]
 * @property {string} [svg]
 */

/**
 * @typedef {object} RendererOptions
 * @property {string} [plotlyBundle] - Path to `plotly.min.js`; resolved from the
 *   `plotly.js-dist-min` dependency by default.
 * @property {boolean} [verbose] - Report the plotly version on startup.
 */

/**
 * Resolve the plotly browser bundle injected into the page.
 *
 * @returns {string} Absolute path to `plotly.min.js`.
 */
function resolvePlotlyBundle() {
  const entry = require.resolve("plotly.js-dist-min");
  return path.join(path.dirname(entry), "plotly.min.js");
}

/**
 * Read the plotly browser bundle, with an actionable error when it is missing.
 *
 * @param {string} bundle
 * @returns {string}
 */
function readBundle(bundle) {
  try {
    accessSync(bundle, constants.R_OK);
  } catch {
    throw new Error(
      `plotly bundle not readable at ${bundle}; run "pnpm install" to restore it`,
    );
  }
  return readFileSync(bundle, "utf8");
}

/**
 * Decode a `data:` URL produced by `Plotly.toImage`.
 *
 * Plotly returns base64 for raster formats but a percent-encoded payload for
 * SVG, so both encodings have to be handled.
 *
 * @param {string} dataUrl
 * @returns {Buffer}
 */
function decodeDataUrl(dataUrl) {
  const separator = dataUrl.indexOf(",");
  if (separator < 0) {
    throw new Error(`unexpected data URL from Plotly.toImage: ${dataUrl.slice(0, 40)}`);
  }
  const header = dataUrl.slice(0, separator);
  const payload = dataUrl.slice(separator + 1);
  if (header.includes(";base64")) return Buffer.from(payload, "base64");
  return Buffer.from(decodeURIComponent(payload), "utf8");
}

/**
 * Rewrite the root `<svg>` tag of a plotly SVG so it is sized in points.
 *
 * `Plotly.toImage` emits `width="Npx"`, which browsers and vector editors read
 * at 96dpi. The figures are laid out in points, so re-tagging preserves the
 * physical size and the aspect ratio in LaTeX and Inkscape.
 *
 * @param {string} svg
 * @param {number} width
 * @param {number} height
 * @returns {string}
 */
export function retagSvgToPoints(svg, width, height) {
  return svg.replace(
    /<svg([^>]*?)\swidth="[^"]*"\sheight="[^"]*"/,
    `<svg$1 width="${width}pt" height="${height}pt"`,
  );
}

/**
 * Plots figures with plotly.js inside a single headless Chromium instance.
 *
 * One browser and one page are reused for every figure. The plotly bundle is
 * injected once; each render purges the previous figure so traces cannot leak
 * between figures.
 */
export class FigureRenderer {
  /** @type {Browser} */
  #browser;
  /** @type {string} */
  #bundleSource;
  /** @type {Page | null} */
  #page = null;
  /** @type {boolean} */
  #closed = false;

  /**
   * @param {Browser} browser
   * @param {string} bundleSource - Source text of the plotly browser bundle.
   */
  constructor(browser, bundleSource) {
    this.#browser = browser;
    this.#bundleSource = bundleSource;
  }

  /**
   * Start a browser and return a renderer bound to it.
   *
   * @param {RendererOptions} [options]
   * @returns {Promise<FigureRenderer>}
   */
  static async open(options = {}) {
    const bundle = options.plotlyBundle ?? resolvePlotlyBundle();
    const source = readBundle(bundle);
    const browser = await chromium.launch();
    const renderer = new FigureRenderer(browser, source);
    if (options.verbose) {
      const page = await renderer.#ensurePage(800, 600);
      console.log(`[INFO] Rendering with plotly.js ${await renderer.#version(page)}`);
    }
    return renderer;
  }

  /**
   * Get the shared page, creating and priming it on first use.
   *
   * @param {number} width
   * @param {number} height
   * @returns {Promise<Page>}
   */
  async #ensurePage(width, height) {
    const viewport = {
      width: Math.max(1, Math.ceil(width)),
      height: Math.max(1, Math.ceil(height)),
    };
    if (this.#page) {
      await this.#page.setViewportSize(viewport);
      return this.#page;
    }
    const page = await this.#browser.newPage({ viewport });
    await page.setContent(
      '<!doctype html><html><head><meta charset="utf-8"></head>' +
        `<body style="margin:0;padding:0;background:#ffffff"><div id="${FIGURE_ID}"></div></body></html>`,
    );
    await page.addScriptTag({ content: this.#bundleSource });
    this.#page = page;
    return page;
  }

  /**
   * Read the injected library's version string.
   *
   * @param {Page} page
   * @returns {Promise<string>}
   */
  #version(page) {
    return page.evaluate(() => {
      const global = /** @type {Record<string, unknown>} */ (
        /** @type {unknown} */ (globalThis)
      );
      return /** @type {PlotlyApi} */ (global.Plotly).version;
    });
  }

  /**
   * Drop the previous figure and start from a clean container.
   *
   * @param {Page} page
   * @returns {Promise<void>}
   */
  #reset(page) {
    return page.evaluate((args) => {
      const global = /** @type {Record<string, unknown>} */ (
        /** @type {unknown} */ (globalThis)
      );
      const plotly = /** @type {PlotlyApi} */ (global.Plotly);
      const document = /** @type {DocumentLike} */ (global.document);
      const existing = document.getElementById(args.figureId);
      if (existing) plotly.purge(existing);
      const replacement = document.createElement("div");
      replacement.id = args.figureId;
      document.body.replaceChildren(replacement);
    }, { figureId: FIGURE_ID });
  }

  /**
   * Draw the figure and wait until fonts and layout have settled.
   *
   * @param {Page} page
   * @param {FigureSpec} spec
   * @returns {Promise<void>}
   */
  async #draw(page, spec) {
    await this.#reset(page);
    const layout = {
      ...spec.layout,
      width: spec.width,
      height: spec.height,
      autosize: false,
    };
    /** @type {Partial<Config>} */
    const config = { staticPlot: true, displayModeBar: false, responsive: false };
    await page.evaluate(
      (args) => {
        const global = /** @type {Record<string, unknown>} */ (
          /** @type {unknown} */ (globalThis)
        );
        const plotly = /** @type {PlotlyApi} */ (global.Plotly);
        return plotly.newPlot(
          args.figureId,
          args.data,
          args.layout,
          args.config,
        );
      },
      { figureId: FIGURE_ID, data: spec.data, layout, config },
    );
    // Await webfonts so PDF and SVG output use the final font metrics.
    await page.evaluate(() => {
      const global = /** @type {Record<string, unknown>} */ (
        /** @type {unknown} */ (globalThis)
      );
      const document = /** @type {DocumentLike} */ (global.document);
      return document.fonts?.ready ?? Promise.resolve();
    });
  }

  /**
   * Render one figure into the requested formats.
   *
   * @param {FigureSpec} spec
   * @param {OutputFormats} [formats] - Defaults to PNG only.
   * @param {number} [pngScale] - PNG pixel multiplier; `dpi / 72` reproduces a
   *   matplotlib `dpi` setting.
   * @returns {Promise<RenderedFigure>}
   */
  async render(spec, formats = { png: true }, pngScale = 1) {
    if (this.#closed) throw new Error("renderer is closed");
    const page = await this.#ensurePage(spec.width, spec.height);
    await this.#draw(page, spec);

    /** @type {RenderedFigure} */
    const output = {};

    if (formats.png === true) {
      const dataUrl = await this.#toImage(page, "png", spec, pngScale);
      output.png = decodeDataUrl(dataUrl);
    }

    if (formats.svg === true) {
      const dataUrl = await this.#toImage(page, "svg", spec, 1);
      output.svg = retagSvgToPoints(
        decodeDataUrl(dataUrl).toString("utf8"),
        spec.width,
        spec.height,
      );
    }

    if (formats.pdf === true) {
      output.pdf = await page.pdf({
        width: `${spec.width / POINTS_PER_INCH}in`,
        height: `${spec.height / POINTS_PER_INCH}in`,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        printBackground: true,
        scale: PRINT_SCALE,
      });
    }

    return output;
  }

  /**
   * Call `Plotly.toImage` for the current figure.
   *
   * @param {Page} page
   * @param {"png" | "svg"} format
   * @param {FigureSpec} spec
   * @param {number} scale
   * @returns {Promise<string>} A `data:` URL.
   */
  #toImage(page, format, spec, scale) {
    return page.evaluate(
      (args) => {
        const global = /** @type {Record<string, unknown>} */ (
          /** @type {unknown} */ (globalThis)
        );
        const plotly = /** @type {PlotlyApi} */ (global.Plotly);
        const document = /** @type {DocumentLike} */ (global.document);
        return plotly.toImage(document.getElementById(args.figureId), {
          format: args.format,
          width: args.width,
          height: args.height,
          scale: args.scale,
        });
      },
      {
        figureId: FIGURE_ID,
        format,
        width: spec.width,
        height: spec.height,
        scale,
      },
    );
  }

  /**
   * Close the browser. Safe to call more than once.
   *
   * @returns {Promise<void>}
   */
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#page = null;
    await this.#browser.close();
  }
}

/**
 * The slice of the DOM this module relies on inside `page.evaluate` callbacks.
 *
 * The project's `tsconfig.json` omits the DOM library on purpose — these scripts
 * run in Node — so the page-side globals are described explicitly instead of
 * pulling in browser typings globally.
 *
 * @typedef {object} DocumentLike
 * @property {(id: string) => { id: string } | null} getElementById
 * @property {(tagName: string) => { id: string }} createElement
 * @property {ElementContainerLike} body
 * @property {{ ready?: Promise<unknown> }} [fonts]
 */

/**
 * @typedef {object} ElementContainerLike
 * @property {(nodes: unknown) => void} replaceChildren
 */

/**
 * Open a renderer for the duration of a callback and always close it.
 *
 * @template T
 * @param {RendererOptions} options
 * @param {(renderer: FigureRenderer) => Promise<T>} run
 * @returns {Promise<T>}
 */
export async function withRenderer(options, run) {
  const renderer = await FigureRenderer.open(options);
  try {
    return await run(renderer);
  } finally {
    await renderer.close();
  }
}
