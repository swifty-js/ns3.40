#!/usr/bin/env python3
"""Convert the bundled ns-3 tutorial PDF into Markdown.

The helper scripts in `.github/skills/pdf` do not include a dedicated
PDF-to-Markdown converter. This script still uses that provided toolchain:

- `extract_form_structure.py` supplies page metadata through pdfplumber.
- `convert_pdf_to_images.py` can render validation images when requested.

The Markdown output preserves page boundaries so the ns-3 skill can perform
precise tutorial lookups later.
"""

from __future__ import annotations

import argparse
import re
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

import pdfplumber

SCRIPT_DIR = Path(__file__).resolve().parent
PDF_SCRIPTS_DIR = SCRIPT_DIR / "pdf"
DEFAULT_INPUT_PDF = SCRIPT_DIR / "ns-3-tutorial.pdf"
DEFAULT_OUTPUT_MARKDOWN = SCRIPT_DIR / "ns3.40" / "reference" / "ns-3-tutorial.md"

sys.path.insert(0, str(PDF_SCRIPTS_DIR))

try:
    from convert_pdf_to_images import convert as convert_pdf_to_images
    from extract_form_structure import extract_form_structure
except ImportError as import_error:
    raise RuntimeError(
        f"Unable to load PDF helper scripts from {PDF_SCRIPTS_DIR}"
    ) from import_error

DOT_LEADER_PATTERN = re.compile(r"\s*\.\s*(?:\.\s*)+\s*")
PAGE_NUMBER_PATTERN = re.compile(r"^\s*\d+\s*$")
ROMAN_PAGE_NUMBER_PATTERN = re.compile(r"^[ivxlcdm]+$", re.IGNORECASE)
CONTENTS_FOOTER_PATTERN = re.compile(
    r"^(CONTENTS\s+\d+|\d+\s+CONTENTS)$", re.IGNORECASE
)
SECTION_HEADING_PATTERN = re.compile(r"^(\d+(?:\.\d+)*)\s+(.+)$")
SECTION_FOOTER_PATTERN = re.compile(r"^\d+(?:\.\d+)*\.\s+.+\s+\d+$")
TOC_ENTRY_PATTERN = re.compile(r"^(\d+(?:\.\d+)*)\s+(.+?)\s+(\d+)$")
UPPERCASE_HEADING_PATTERN = re.compile(r"^[A-Z][A-Z0-9\s\-:,()/.]+$")

CHAPTER_MARKER = "CHAPTER"
CHAPTER_NUMBER_WORDS = {
    "ONE",
    "TWO",
    "THREE",
    "FOUR",
    "FIVE",
    "SIX",
    "SEVEN",
    "EIGHT",
    "NINE",
    "TEN",
}

CODE_PREFIX_PATTERN = re.compile(
    r"^(#include|/\*|\*/|\*|//|using namespace|namespace\s+|class\s+|struct\s+|"
    r"template\s*<|int\s+main|int\s+\w+\s*\(|void\s+\w+\s*\(|static\s+|return\s+|"
    r"if\s*\(|for\s*\(|while\s*\(|else\b|LogComponentEnable|Config::|"
    r"Simulator::|CommandLine|NodeContainer|PointToPoint|NetDeviceContainer|"
    r"InternetStackHelper|Ipv4|UdpEcho|ApplicationContainer|AsciiTraceHelper|"
    r"Ptr<|TypeId|MakeCallback|std::|\{|\}|};)"
)
SHELL_PREFIX_PATTERN = re.compile(
    r"^(\$|\.\/ns3|\.\/waf|cd\s+|git\s+|python\s+|python3\s+|mkdir\s+|"
    r"export\s+|NS_LOG=|ls\s+|cp\s+)"
)


@dataclass
class ExtractedLine:
    raw_text: str
    text: str
    indent: int


@dataclass
class PageState:
    in_contents: bool = False
    contents_heading_written: bool = False
    waiting_for_chapter_number: bool = False
    waiting_for_chapter_title: bool = False


def normalize_extracted_line(raw_line: str) -> str:
    line = raw_line.replace("\u00a0", " ")
    line = DOT_LEADER_PATTERN.sub(" ", line)
    line = re.sub(r"\b([A-Za-z]+)-\s+([a-z])", r"\1-\2", line)
    return re.sub(r"[ \t]+", " ", line).strip()


def title_from_pdf_heading(line: str) -> str:
    if line.isupper():
        return line.title()
    return line


def should_skip_noise_line(line: str) -> bool:
    if not line:
        return True
    if line.startswith("ns-3 Tutorial, Release"):
        return True
    if PAGE_NUMBER_PATTERN.match(line) or ROMAN_PAGE_NUMBER_PATTERN.match(line):
        return True
    if CONTENTS_FOOTER_PATTERN.match(line):
        return True
    return SECTION_FOOTER_PATTERN.match(line) is not None


def get_heading(line: str) -> str | None:
    section_match = SECTION_HEADING_PATTERN.match(line)
    if section_match:
        section_number = section_match.group(1)
        title = section_match.group(2).strip()
        heading_depth = min(section_number.count(".") + 2, 6)
        return f"{'#' * heading_depth} {section_number} {title}"

    if UPPERCASE_HEADING_PATTERN.match(line) and len(line.split()) <= 8:
        return f"## {title_from_pdf_heading(line)}"

    return None


def extract_page_layout_lines(page: pdfplumber.page.Page) -> list[ExtractedLine]:
    page_text = page.extract_text(layout=True, x_tolerance=1.5, y_tolerance=3) or ""
    extracted_lines: list[ExtractedLine] = []

    for raw_line in page_text.splitlines():
        raw_text = raw_line.rstrip()
        stripped_text = raw_text.strip()
        indent = len(raw_text) - len(raw_text.lstrip())
        extracted_lines.append(
            ExtractedLine(
                raw_text=raw_text,
                text=normalize_extracted_line(stripped_text),
                indent=indent,
            )
        )

    return extracted_lines


def is_contents_page(
    page_number: int, page_lines: list[ExtractedLine], state: PageState
) -> bool:
    if any(line.text == "CONTENTS" for line in page_lines):
        state.in_contents = True
        return True
    return state.in_contents and page_number <= 4


def convert_contents_page(
    page_lines: list[ExtractedLine],
    state: PageState,
) -> list[str]:
    markdown_lines: list[str] = []

    if not state.contents_heading_written:
        markdown_lines.extend(["## Contents", ""])
        state.contents_heading_written = True

    for extracted_line in page_lines:
        line = extracted_line.text
        if should_skip_noise_line(line) or line == "CONTENTS":
            continue

        toc_match = TOC_ENTRY_PATTERN.match(line)
        if not toc_match:
            continue

        section_number = toc_match.group(1)
        title = toc_match.group(2).strip()
        page_reference = toc_match.group(3)
        indent = "  " * min(section_number.count("."), 2)
        markdown_lines.append(
            f"{indent}- {section_number} {title} — p. {page_reference}"
        )

    return markdown_lines


def is_file_listing_line(line: str) -> bool:
    tokens = line.split()
    if len(tokens) < 4:
        return False
    if line.endswith((".", ":", ";")):
        return False

    path_like_tokens = [
        token
        for token in tokens
        if re.search(r"[._/-]", token)
        or token.isupper()
        or token in {"src", "doc", "scratch", "utils"}
    ]
    return len(path_like_tokens) >= 2 and len(path_like_tokens) >= len(tokens) - 1


def is_code_like_line(extracted_line: ExtractedLine) -> bool:
    line = extracted_line.text
    if not line:
        return False
    if line.startswith("- ") or line.startswith("•"):
        return False
    if CODE_PREFIX_PATTERN.match(line) or SHELL_PREFIX_PATTERN.match(line):
        return True
    if is_file_listing_line(line):
        return True
    if line in {"{", "}", "};"}:
        return True
    if line.endswith(";") and ("(" in line or "::" in line or "=" in line):
        return True
    raw_columns = re.split(r"\s{2,}", extracted_line.raw_text.strip())
    if len(raw_columns) >= 3 and not line.endswith("."):
        return True
    return False


def get_code_text(extracted_line: ExtractedLine) -> str:
    return extracted_line.raw_text.strip()


def get_code_fence_language(code_lines: list[str]) -> str:
    joined_code = "\n".join(code_lines)
    cpp_tokens = ("#include", "::", "int main", "using namespace", "Ptr<", "NS_LOG")
    shell_tokens = ("./ns3", "./waf", "git ", "NS_LOG=", "$ ")

    if any(token in joined_code for token in cpp_tokens):
        return "cpp"
    if any(token in joined_code for token in shell_tokens):
        return "bash"
    return "text"


def join_paragraph_parts(paragraph_parts: list[str]) -> str:
    paragraph = paragraph_parts[0]
    for next_part in paragraph_parts[1:]:
        if paragraph.endswith("-") and next_part[:1].islower():
            paragraph = paragraph[:-1] + next_part
        else:
            paragraph += " " + next_part
    return paragraph


def should_start_new_paragraph(paragraph_parts: list[str], next_line: str) -> bool:
    if not paragraph_parts:
        return False
    previous_line = paragraph_parts[-1]
    if not re.search(r"[.!?)]$", previous_line):
        return False
    return next_line[:1].isupper() or next_line.startswith("ns-3")


def append_blank_line(markdown_lines: list[str]) -> None:
    if markdown_lines and markdown_lines[-1] != "":
        markdown_lines.append("")


def convert_body_page(page_lines: list[ExtractedLine], state: PageState) -> list[str]:
    markdown_lines: list[str] = []
    paragraph_parts: list[str] = []
    code_lines: list[str] = []
    last_list_item_index: int | None = None

    def flush_paragraph() -> None:
        nonlocal last_list_item_index
        if paragraph_parts:
            append_blank_line(markdown_lines)
            markdown_lines.append(join_paragraph_parts(paragraph_parts))
            paragraph_parts.clear()
            last_list_item_index = None

    def flush_code_block() -> None:
        nonlocal last_list_item_index
        if code_lines:
            append_blank_line(markdown_lines)
            language = get_code_fence_language(code_lines)
            markdown_lines.append(f"```{language}")
            markdown_lines.extend(code_lines)
            markdown_lines.append("```")
            code_lines.clear()
            last_list_item_index = None

    for extracted_line in page_lines:
        line = extracted_line.text
        if should_skip_noise_line(line):
            if not line:
                flush_paragraph()
                flush_code_block()
            continue

        upper_line = line.upper()
        if upper_line == CHAPTER_MARKER:
            flush_paragraph()
            flush_code_block()
            state.waiting_for_chapter_number = True
            state.waiting_for_chapter_title = False
            continue

        if state.waiting_for_chapter_number:
            if upper_line in CHAPTER_NUMBER_WORDS:
                state.waiting_for_chapter_number = False
                state.waiting_for_chapter_title = True
                continue
            state.waiting_for_chapter_number = False
            state.waiting_for_chapter_title = True

        if state.waiting_for_chapter_title:
            flush_paragraph()
            flush_code_block()
            markdown_lines.extend(["", f"## {title_from_pdf_heading(line)}", ""])
            state.waiting_for_chapter_title = False
            last_list_item_index = None
            continue

        heading = get_heading(line)
        if heading:
            flush_paragraph()
            flush_code_block()
            markdown_lines.extend(["", heading, ""])
            last_list_item_index = None
            continue

        if line.startswith("•"):
            flush_paragraph()
            flush_code_block()
            append_blank_line(markdown_lines)
            bullet_text = normalize_extracted_line(line[1:])
            markdown_lines.append(f"- {bullet_text}")
            last_list_item_index = len(markdown_lines) - 1
            continue

        if is_code_like_line(extracted_line):
            flush_paragraph()
            code_lines.append(get_code_text(extracted_line))
            last_list_item_index = None
            continue

        flush_code_block()
        if last_list_item_index is not None:
            current_item = markdown_lines[last_list_item_index].rstrip()
            if not current_item.endswith((".", ";")):
                markdown_lines[last_list_item_index] = current_item + " " + line
                continue
            last_list_item_index = None

        if should_start_new_paragraph(paragraph_parts, line):
            flush_paragraph()

        paragraph_parts.append(line)

    flush_paragraph()
    flush_code_block()
    return markdown_lines


def get_display_path(input_pdf: Path) -> str:
    try:
        return input_pdf.relative_to(SCRIPT_DIR.parent.parent).as_posix()
    except ValueError:
        return input_pdf.as_posix()


def convert_pdf_to_markdown(input_pdf: Path, output_markdown: Path) -> None:
    structure = extract_form_structure(str(input_pdf))
    page_count_from_structure = len(structure["pages"])

    markdown_lines = [
        "# ns-3 Tutorial",
        "",
        f"Source PDF: `{get_display_path(input_pdf)}`",
        "",
        "This Markdown file was generated from the bundled PDF and preserves page boundaries for lookup.",
        "",
    ]
    state = PageState()

    with pdfplumber.open(input_pdf) as pdf:
        if len(pdf.pages) != page_count_from_structure:
            raise RuntimeError(
                "Page count mismatch between pdfplumber extraction and helper structure extraction"
            )

        for page_number, page in enumerate(pdf.pages, start=1):
            page_lines = extract_page_layout_lines(page)
            markdown_lines.extend([f"<!-- page: {page_number} -->", ""])

            if is_contents_page(page_number, page_lines, state):
                markdown_lines.extend(convert_contents_page(page_lines, state))
            else:
                markdown_lines.extend(convert_body_page(page_lines, state))

            markdown_lines.append("")
            print(f"Extracted page {page_number}/{len(pdf.pages)}")

            if page_number >= 4:
                state.in_contents = False

    output_text = "\n".join(markdown_lines)
    output_text = re.sub(r"\n{3,}", "\n\n", output_text).rstrip() + "\n"

    output_markdown.parent.mkdir(parents=True, exist_ok=True)
    output_markdown.write_text(output_text, encoding="utf-8")


def render_validation_images(input_pdf: Path, page_count: int) -> None:
    if page_count <= 0:
        return

    with tempfile.TemporaryDirectory(prefix="ns3_tutorial_pages_") as temporary_dir:
        convert_pdf_to_images(str(input_pdf), temporary_dir)
        rendered_pages = sorted(Path(temporary_dir).glob("page_*.png"))[:page_count]
        print(
            f"Rendered {len(rendered_pages)} validation image(s) "
            "using .github/skills/pdf/convert_pdf_to_images.py"
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert the bundled ns-3 tutorial PDF to Markdown."
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_INPUT_PDF,
        help="Input PDF path.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_MARKDOWN,
        help="Output Markdown path.",
    )
    parser.add_argument(
        "--validation-images",
        type=int,
        default=0,
        help="Render this many page images through the provided PDF helper.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_pdf = args.input.resolve()
    output_markdown = args.output.resolve()

    if not input_pdf.exists():
        raise FileNotFoundError(f"Input PDF does not exist: {input_pdf}")

    render_validation_images(input_pdf, args.validation_images)
    convert_pdf_to_markdown(input_pdf, output_markdown)
    print(f"Wrote Markdown to {output_markdown}")


if __name__ == "__main__":
    main()
