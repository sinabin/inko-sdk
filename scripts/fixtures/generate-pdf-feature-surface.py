"""Generate the deterministic PDF.js text/annotation/AcroForm fixture.

The output is source-owned synthetic test data. It intentionally contains no
customer data, third-party prose, images, or fonts.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas


PAGE_WIDTH, PAGE_HEIGHT = A4
NAVY = HexColor("#0D1B3E")
AMBER = HexColor("#E8A045")
INK = HexColor("#263247")
MUTED = HexColor("#667085")
LINE = HexColor("#D7DCE5")
PALE = HexColor("#F7F3EC")


def draw_header(pdf: canvas.Canvas, page_number: int, title: str) -> None:
    pdf.setFillColor(NAVY)
    pdf.setFont("Helvetica-Bold", 20)
    pdf.drawString(48, PAGE_HEIGHT - 62, title)
    pdf.setFillColor(AMBER)
    pdf.rect(48, PAGE_HEIGHT - 76, 96, 3, fill=1, stroke=0)
    pdf.setStrokeColor(LINE)
    pdf.line(48, 40, PAGE_WIDTH - 48, 40)
    pdf.setFillColor(MUTED)
    pdf.setFont("Helvetica", 8)
    pdf.drawString(48, 25, "INKO-FEATURE-001 | Synthetic fixture | No customer data")
    pdf.drawRightString(PAGE_WIDTH - 48, 25, f"Page {page_number} of 8")


def draw_first_page(pdf: canvas.Canvas) -> None:
    draw_header(pdf, 1, "PDF.js feature surface")

    pdf.setFillColor(INK)
    pdf.setFont("Helvetica", 12)
    pdf.drawString(48, PAGE_HEIGHT - 118, "Select and copy the exact token below:")
    pdf.setFont("Courier-Bold", 13)
    pdf.drawString(48, PAGE_HEIGHT - 145, "INKO_COPY_TOKEN_001")

    pdf.setFont("Helvetica", 10)
    pdf.drawString(48, PAGE_HEIGHT - 184, "Native text annotation (open the note icon):")
    pdf.textAnnotation(
        "INKO_NATIVE_NOTE_001",
        Rect=(330, PAGE_HEIGHT - 204, 354, PAGE_HEIGHT - 180),
        name="inko-native-note-001",
    )

    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(48, PAGE_HEIGHT - 242, "AcroForm fields")
    pdf.setFont("Helvetica", 9)
    pdf.drawString(48, PAGE_HEIGHT - 270, "Reviewer name")
    pdf.acroForm.textfield(
        name="inko.reviewerName",
        tooltip="Reviewer name",
        x=150,
        y=PAGE_HEIGHT - 285,
        width=220,
        height=24,
        value="",
        borderColor=AMBER,
        fillColor=white,
        textColor=INK,
        fontName="Helvetica",
        fontSize=10,
        forceBorder=True,
    )
    pdf.acroForm.checkbox(
        name="inko.approved",
        tooltip="Approved",
        x=150,
        y=PAGE_HEIGHT - 326,
        size=18,
        checked=False,
        borderColor=AMBER,
        fillColor=white,
        textColor=NAVY,
        fieldFlags="",
        forceBorder=True,
    )
    pdf.drawString(176, PAGE_HEIGHT - 320, "Approved")
    pdf.drawString(48, PAGE_HEIGHT - 364, "Decision")
    pdf.acroForm.choice(
        name="inko.decision",
        tooltip="Review decision",
        x=150,
        y=PAGE_HEIGHT - 378,
        width=220,
        height=24,
        value="Pending",
        options=["Pending", "Accepted", "Rejected"],
        borderColor=AMBER,
        fillColor=white,
        textColor=INK,
        fontName="Helvetica",
        fontSize=10,
        forceBorder=True,
    )

    pdf.setFillColor(NAVY)
    pdf.setFont("Helvetica-Bold", 10)
    pdf.drawString(48, PAGE_HEIGHT - 432, "INKO_EXTERNAL_LINK_001")
    pdf.linkURL(
        "https://nexth.co.kr/inko",
        (48, PAGE_HEIGHT - 438, 205, PAGE_HEIGHT - 423),
        relative=0,
        thickness=1,
        color=AMBER,
    )
    pdf.drawString(48, PAGE_HEIGHT - 466, "INKO_INTERNAL_LINK_TO_PAGE_8")
    pdf.linkRect(
        "Open the offscreen search target",
        "search-target",
        Rect=(48, PAGE_HEIGHT - 472, 242, PAGE_HEIGHT - 457),
        relative=0,
        thickness=1,
        color=AMBER,
    )


def draw_middle_page(pdf: canvas.Canvas, page_number: int) -> None:
    draw_header(pdf, page_number, f"Virtualized page {page_number}")
    pdf.setFillColor(PALE)
    pdf.rect(48, PAGE_HEIGHT - 240, PAGE_WIDTH - 96, 112, fill=1, stroke=0)
    pdf.setFillColor(INK)
    pdf.setFont("Helvetica", 11)
    pdf.drawString(68, PAGE_HEIGHT - 166, f"INKO_PAGE_TOKEN_{page_number:03d}")
    pdf.setFillColor(MUTED)
    pdf.setFont("Helvetica", 9)
    pdf.drawString(68, PAGE_HEIGHT - 194, "This page exists to exercise offscreen indexing and layer disposal.")


def draw_search_page(pdf: canvas.Canvas) -> None:
    pdf.bookmarkPage("search-target")
    draw_header(pdf, 8, "Offscreen search target")
    pdf.setFillColor(INK)
    pdf.setFont("Helvetica", 11)
    pdf.drawString(48, PAGE_HEIGHT - 126, "The unique document-wide search token is:")
    pdf.setFont("Courier-Bold", 14)
    pdf.drawString(48, PAGE_HEIGHT - 162, "INKO_SEARCH_TARGET_008")


def generate(output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(
        str(output),
        pagesize=A4,
        pageCompression=1,
        invariant=1,
    )
    pdf.setTitle("Inko PDF.js Feature Surface Fixture")
    pdf.setAuthor("NextH")
    pdf.setSubject("Synthetic text, native annotation, link, and AcroForm fixture")
    pdf.setKeywords("Inko, NextH, PDF.js, TextLayer, AnnotationLayer, AcroForm")
    pdf.setCreator("NextH Inko feature fixture generator")

    draw_first_page(pdf)
    pdf.showPage()
    for page_number in range(2, 8):
        draw_middle_page(pdf, page_number)
        pdf.showPage()
    draw_search_page(pdf)
    pdf.save()


def main() -> None:
    default_output = (
        Path(__file__).resolve().parents[2]
        / "public"
        / "samples"
        / "inko-feature-surface.pdf"
    )
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=default_output)
    args = parser.parse_args()
    generate(args.output.resolve())
    print(args.output.resolve())


if __name__ == "__main__":
    main()
