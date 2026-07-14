---
name: convert-ns3.40-docs
description: Convert the Tcp/ns-3.40 documentation artifacts from LaTeX, Markdown, and PDF into Microsoft Word `.docx` files. Use this skill whenever the user asks to create, refresh, synchronize, validate, or polish `docs/thesis.docx`, the Chinese invention patent Word file, or `docs/NJUPT_Professional_Thesis_draft1.docx` from `docs/thesis.tex`, `docs/thesis.pdf`, `docs/patent.md`, or the NJUPT thesis PDF. This skill should be used together with the pdf and docx skills whenever PDF extraction, Word reconstruction, templates, or layout validation are involved.
---

# convert-ns3.40-docs

You are a document-conversion specialist for the TcpSwift3.40 documentation set. Convert the source artifacts into Microsoft Word files in a controlled order, preserving technical meaning, Chinese wording, equations, figures, references, and visual layout.

The skill itself is written in English. Target documents may be Chinese. Preserve the source language and local academic or patent conventions unless the user explicitly asks for translation or rewriting.

## Required source and target inventory

All paths are relative to repository root.

| Artifact                       | Source                                                                   | Target                                                  |
| ------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| Conference paper               | `docs/thesis.tex` and `docs/thesis.pdf`                                  | `docs/thesis.docx`                                      |
| Conference paper Word template | `docs/thesis_template.docx`                                              | Use as strict reference document for `docs/thesis.docx` |
| Invention patent               | `docs/patent.md`                                                         | `docs/南京-杭天铖-YYYY-MM-DD-计算机网络拥塞控制.docx`   |
| Graduate thesis                | `docs/NJUPT_Professional_Thesis_draft1/NJUPT_Professional_Thesis_d1.pdf` | `docs/NJUPT_Professional_Thesis_draft1.docx`            |

For the patent target name, replace `YYYY-MM-DD` with the current local date unless the user provides a specific date.

## Companion skills

Use the `pdf` skill when you need to extract text, images, page snapshots, tables, or layout cues from PDF files.

Use the `docx` skill when you need to create, inspect, repair, or validate `.docx` files, apply templates, manipulate styles, insert images, create tables, update fields, or verify the package structure.

If those skills are available, read them before performing PDF-heavy or Word-heavy work. Do not reinvent their utility scripts when they already solve the needed task.

## Conversion order

Follow this order unless the user explicitly changes it:

1. Convert the conference paper to `docs/thesis.docx`.
2. Convert the invention patent to the dated Word file.
3. Convert the graduate thesis to `docs/NJUPT_Professional_Thesis_draft1.docx`.

This order is intentional: the conference paper stabilizes the technical narrative, the patent reuses that terminology in legal form, and the graduate thesis conversion can be validated against the most complete visual PDF.

## General workflow

1. Verify that each source file exists before editing or generating targets.
2. Inspect existing target files, if present, to understand prior formatting. Replace them only after a new valid file is generated.
3. Work in a temporary directory for extracted assets and intermediate files. Remove disposable temporary files at the end unless they are useful evidence the user asked to keep.
4. Prefer deterministic conversions. If a converter loses equations, figures, tables, Chinese text, captions, or references, rebuild those parts explicitly with Word tooling.
5. Keep source artifacts unchanged unless the user separately asks for source edits.
6. Preserve all technical claims and values exactly. A conversion task is not a research-update task.
7. Validate each generated `.docx` before moving to the next artifact.

## Artifact 1: Conference paper Word conversion

Target: `docs/thesis.docx`

Primary sources:

- `docs/thesis.tex`
- `docs/thesis.pdf`
- `docs/thesis_template.docx`

Expected result: a Word file that follows `docs/thesis_template.docx` as closely as practical in styles, margins, title block, abstract, keywords, section headings, body text, captions, references, and page layout.

Recommended approach:

1. Inspect `docs/thesis_template.docx` with the docx skill or Word package tools. Identify style names, page margins, font families, heading levels, caption style, reference style, table style, and spacing.
2. Convert `docs/thesis.tex` to a draft Word document using Pandoc or another available converter, applying the template as the reference document when possible.
3. Use `docs/thesis.pdf` as the visual truth for content order and rendered math. The LaTeX file is the semantic truth for source text, labels, citations, and figure paths.
4. Repair conversion defects:
   - map title, authors, affiliations, abstract, and keywords to template-compatible styles;
   - preserve Chinese punctuation and full-width typography where present;
   - convert LaTeX equations into Word equations or clear equation images when native equations are not reliable;
   - insert figures at the corresponding positions with captions;
   - rebuild tables when converter output is over-wide or visually broken;
   - keep citation and reference numbering consistent with the PDF.
5. Open or inspect the generated `.docx` package to ensure it is valid and not an empty shell.

Validation checklist:

- `docs/thesis.docx` exists and can be opened or parsed.
- The style source is `docs/thesis_template.docx`, not a generic Word default.
- The first page matches the template structure.
- Abstract, keywords, headings, figures, tables, equations, and references are present.
- Chinese text is not garbled.
- No unresolved LaTeX commands such as `\cite`, `\ref`, `\begin`, or `\end` remain in visible body text unless they are intentionally discussed as code.

## Artifact 2: Chinese invention patent Word conversion

Target: `docs/南京-杭天铖-YYYY-MM-DD-计算机网络拥塞控制.docx`

Primary source:

- `docs/patent.md`

Expected result: a Word file formatted like a China mainland invention-patent submission draft. Preserve the Chinese technical content while presenting it in a clear patent-document structure.

Recommended approach:

1. Parse `docs/patent.md` into logical patent sections before generating Word:
   - title or invention name;
   - technical field;
   - background;
   - summary of the invention;
   - description of drawings;
   - detailed embodiments;
   - claims;
   - abstract;
   - abstract drawing, if available.
2. Use Chinese patent drafting conventions:
   - keep claims in a dedicated `权利要求书` section;
   - number claims clearly and preserve dependency relationships;
   - keep the abstract concise and separate from claims;
   - use formal, neutral patent language;
   - avoid marketing claims and unsupported performance promises.
3. Use clean Word formatting suitable for mainland patent review:
   - A4 pages;
   - readable Chinese fonts such as 宋体 or 仿宋, according to local convention or existing examples;
   - consistent paragraph indentation and line spacing;
   - hierarchical headings with predictable numbering;
   - figure references and descriptions aligned with the source material.
4. Generate the target filename with the current date in ISO form, for example `docs/南京-杭天铖-2026-06-11-计算机网络拥塞控制.docx`.

Validation checklist:

- The target file name contains the intended date and Chinese title.
- `权利要求书`, `说明书`, and `摘要` are clearly separated when the source contains those materials.
- Claim numbers are sequential and dependency references remain valid.
- Paragraphs are not merged into unreadable blocks.
- Chinese text is not garbled.
- The file can be opened or parsed as a valid `.docx`.

## Artifact 3: Graduate thesis Word conversion

Target: `docs/NJUPT_Professional_Thesis_draft1.docx`

Primary source:

- `docs/NJUPT_Professional_Thesis_draft1/NJUPT_Professional_Thesis_d1.pdf`

Expected result: a Word reconstruction that visually aligns with the original graduate thesis PDF as closely as practical, including front matter, chapters, figures, tables, equations, references, appendices, and page order.

Recommended approach:

1. Use the pdf skill to extract text and render page images from the PDF. Treat the PDF as the layout source of truth.
2. Inspect the thesis directory for source assets, figures, or LaTeX files if they help recover high-quality images or equations. Do not assume they exist.
3. Rebuild the Word document in page order:
   - cover and title pages;
   - originality or authorization statements, if present;
   - Chinese and English abstracts;
   - table of contents and lists, if present;
   - chapter body;
   - figures, tables, equations, and captions;
   - references;
   - acknowledgements, appendices, or author biography sections, if present.
4. Prefer editable Word text for body content. Use images only for elements that cannot be reliably reconstructed, such as complex seals, forms, signatures, unusual equations, or exact page decorations.
5. Preserve the original thesis language, numbering, caption text, references, and page order.
6. If Word pagination cannot exactly match the PDF, prioritize semantic completeness and stable formatting over forced fragile spacing.

Validation checklist:

- `docs/NJUPT_Professional_Thesis_draft1.docx` exists and can be opened or parsed.
- Text order matches the PDF page order.
- Front matter, abstracts, chapter headings, figures, tables, equations, references, and appendices are present when visible in the PDF.
- Major page-layout elements are visually aligned with the PDF.
- Chinese and English text extraction did not introduce obvious mojibake or broken line order.
- Images are not missing, duplicated, or severely degraded.

## Quality gate before final response

Before reporting completion:

1. Confirm the exact targets created or updated.
2. Validate every `.docx` as a ZIP package containing `word/document.xml`.
3. Use the docx skill or a package parser to confirm that visible text is non-empty.
4. For PDF-derived conversions, compare representative pages or extracted text against the source PDF.
5. For the conference paper, compare `docs/thesis.docx` against both `docs/thesis.pdf` and `docs/thesis_template.docx`.
6. For the patent, verify date substitution and patent-section order.
7. Summarize any limitations, such as equations converted as images, unavailable fonts, or unavoidable pagination differences.

## When to ask the user

Ask only when a decision affects the legal, academic, or visual outcome and cannot be inferred from the files. Examples:

- the date to use in the patent filename if it should not be the current date;
- whether to favor exact visual fidelity or editable Word text when they conflict;
- whether to keep existing target files as backups when they are outside version control.
control.
