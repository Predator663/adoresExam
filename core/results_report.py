"""Full school results report as a professional PDF and Excel workbook (no Django imports).

`meta`    : {"school", "address", "contact", "logo" (bytes or None), "title", "filters": [(label, value)], "generated", "sort"}
`report`  : the dict made by analytics.fullreport.build(), plus report["students_sorted"] (display order)
`sections`: which parts to include, a subset of analytics.fullreport.SECTIONS

PDF layout rules (so nothing runs over anything else): every cell is a wrapped Paragraph with a fixed column width,
the school name is fitted into its own box beside the logo, and wide tables are split into column groups that repeat
the student's name on every group.
"""
import io
from xml.sax.saxutils import escape

from openpyxl import Workbook
from openpyxl.drawing.image import Image as XlImage
from openpyxl.formatting.rule import DataBarRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, NextPageTemplate, PageTemplate, Paragraph,
                                Spacer, Table, TableStyle)

BRAND = colors.HexColor("#1F6F5C")
BRAND_DARK = colors.HexColor("#14493D")
LIGHT = colors.HexColor("#EAF4F1")
LINE = colors.HexColor("#B7C9C4")
INK = colors.HexColor("#1B2B27")
MUTED = colors.HexColor("#5C6B67")
GRADE_HEX = ["2E9B6B", "5BA55B", "3F7FBF", "E0A100", "D1495B", "8A8A8A", "8A8A8A", "8A8A8A"]
DIV_HEX = ["2E9B6B", "5BA55B", "3F7FBF", "E0A100", "D1495B", "8A8A8A", "8A8A8A"]

PAGE = landscape(A4)
MARGIN = 14 * mm
USABLE = PAGE[0] - 2 * MARGIN
FIRST_TOP, LATER_TOP, BOTTOM = 44 * mm, 24 * mm, 17 * mm


def _style(name, **kw):
    base = dict(fontName="Helvetica", fontSize=8.5, leading=10.5, textColor=INK)
    base.update(kw)
    return ParagraphStyle(name, **base)


S_CELL = _style("cell")
S_CELL_C = _style("cellc", alignment=1)
S_CELL_B = _style("cellb", fontName="Helvetica-Bold")
S_HEAD = _style("head", fontName="Helvetica-Bold", textColor=colors.white, alignment=1, fontSize=8, leading=9.5)
S_HEAD_L = _style("headl", fontName="Helvetica-Bold", textColor=colors.white, fontSize=8, leading=9.5)
S_H2 = _style("h2", fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=BRAND, spaceBefore=8, spaceAfter=4)
S_NOTE = _style("note", fontSize=7.5, leading=9.5, textColor=MUTED)
S_INFO = _style("info", fontSize=8.5, leading=11)
S_KPI = _style("kpi", fontName="Helvetica-Bold", fontSize=17, leading=20, textColor=BRAND, alignment=1)
S_KPI_L = _style("kpil", fontSize=7.5, leading=9, textColor=MUTED, alignment=1)


def _p(text, style=S_CELL):
    return Paragraph(escape("" if text is None else str(text)), style)


def _num(v, digits=1):
    return "-" if v is None else f"{v:.{digits}f}"


def _range(d, unit=""):
    """\"7 - 17\"; a band with no real upper limit (the system stores 999) reads \"34 or more\"."""
    tail = f" {unit}" if unit else ""
    return f"{d['min']} or more{tail}" if d["max"] >= 900 else f"{d['min']} - {d['max']}{tail}"


def _pct(v):
    return "-" if v is None else f"{v:.1f}%"


def _gpa(v):
    return "-" if v is None else f"{v:.2f}"


# ------------------------------------------------------------------ PDF

class _Numbered(pdfcanvas.Canvas):
    """Adds 'Page x of y' once the page count is known."""

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self._saved = []

    def showPage(self):
        self._saved.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved)
        for state in self._saved:
            self.__dict__.update(state)
            self.setFont("Helvetica", 7.5)
            self.setFillColor(MUTED)
            self.drawRightString(PAGE[0] - MARGIN, 9 * mm, f"Page {self._pageNumber} of {total}")
            super().showPage()
        super().save()


def _fit_paragraph(c, text, x, y_top, width, max_height, font, sizes, color):
    """Draw text inside a box, shrinking the type until it fits (never spills out of the box)."""
    for size in sizes:
        st = ParagraphStyle("fit", fontName=font, fontSize=size, leading=size * 1.18, textColor=color)
        para = Paragraph(escape(text), st)
        _, h = para.wrap(width, max_height)
        if h <= max_height:
            break
    para.drawOn(c, x, y_top - h)
    return h


def _draw_header(c, meta, first):
    w, h = PAGE
    logo = meta.get("logo")
    c.saveState()
    left = MARGIN
    if logo:
        try:
            img = ImageReader(io.BytesIO(logo))
            iw, ih = img.getSize()
            box = (24 if first else 12) * mm
            scale = min(box / iw, box / ih)
            dw, dh = iw * scale, ih * scale
            top = h - (8 if first else 6) * mm
            c.drawImage(img, MARGIN, top - dh, dw, dh, mask="auto")
            left = MARGIN + box + 4 * mm
        except Exception:  # a broken logo file must never stop the report
            left = MARGIN
    right_w = 62 * mm
    text_w = w - MARGIN - right_w - 4 * mm - left
    if first:
        y = h - 9 * mm
        used = _fit_paragraph(c, meta["school"], left, y, text_w, 15 * mm, "Helvetica-Bold", (19, 17, 15, 13, 11), BRAND_DARK)
        y -= used + 1.5 * mm
        sub = " | ".join(x for x in (meta.get("address"), meta.get("contact")) if x)
        if sub:
            used = _fit_paragraph(c, sub, left, y, text_w, 8 * mm, "Helvetica", (8.5, 8, 7), MUTED)
            y -= used + 1.5 * mm
        _fit_paragraph(c, meta["title"], left, y, text_w, 8 * mm, "Helvetica-Bold", (13, 12, 10.5), BRAND)
        c.setFont("Helvetica", 8)
        c.setFillColor(MUTED)
        c.drawRightString(w - MARGIN, h - 12 * mm, "Generated")
        c.setFillColor(INK)
        c.setFont("Helvetica-Bold", 8.5)
        c.drawRightString(w - MARGIN, h - 16.5 * mm, meta["generated"])
        rule_y = h - 36 * mm
    else:
        _fit_paragraph(c, meta["school"], left, h - 7 * mm, text_w, 6 * mm, "Helvetica-Bold", (10.5, 9.5, 8.5), BRAND_DARK)
        _fit_paragraph(c, meta["title"], left, h - 13 * mm, text_w, 5 * mm, "Helvetica", (8.5, 7.5), MUTED)
        rule_y = h - 20 * mm
    c.setStrokeColor(BRAND)
    c.setLineWidth(1.4)
    c.line(MARGIN, rule_y, w - MARGIN, rule_y)
    c.setLineWidth(0.4)
    c.setStrokeColor(LINE)
    c.line(MARGIN, 13 * mm, w - MARGIN, 13 * mm)
    c.setFont("Helvetica", 7.5)
    c.setFillColor(MUTED)
    c.drawString(MARGIN, 9 * mm, f"{meta['school']} - confidential: for school administration use")
    c.restoreState()


def _grid(headers, rows, widths, aligns=None, head_style=S_HEAD, zebra=True, repeat=1, bold_first_col=False):
    aligns = aligns or ["L"] * len(headers)
    cell = {"L": S_CELL, "C": S_CELL_C}
    head = [_p(h, S_HEAD_L if a == "L" else S_HEAD) for h, a in zip(headers, aligns)]
    body = [[_p(v, S_CELL_B if (bold_first_col and i == 0) else cell[a]) for i, (v, a) in enumerate(zip(r, aligns))] for r in rows]
    t = Table([head] + body, colWidths=widths, repeatRows=repeat)
    st = [("BACKGROUND", (0, 0), (-1, 0), BRAND), ("GRID", (0, 0), (-1, -1), 0.25, LINE),
          ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
          ("LEFTPADDING", (0, 0), (-1, -1), 3.5), ("RIGHTPADDING", (0, 0), (-1, -1), 3.5)]
    if zebra:
        st.append(("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]))
    t.setStyle(TableStyle(st))
    return t


def _scaled(widths, total):
    s = sum(widths)
    return [w * total / s for w in widths]


def _bars(counts, hexes, width, height=34 * mm):
    """A small bar chart drawn with plain shapes. Count labels sit above the bars, names below."""
    keys = list(counts)
    d = Drawing(width, height)
    biggest = max(list(counts.values()) + [1])
    n = len(keys)
    gap = 5 * mm
    bw = max(6 * mm, (width - gap * (n + 1)) / max(n, 1))
    base, top_pad = 7 * mm, 6 * mm
    avail = height - base - top_pad
    for i, k in enumerate(keys):
        x = gap + i * (bw + gap)
        h = max(0.6, avail * counts[k] / biggest) if counts[k] else 0.6
        d.add(Rect(x, base, bw, h, fillColor=colors.HexColor("#" + hexes[min(i, len(hexes) - 1)]), strokeColor=None))
        d.add(String(x + bw / 2, base + h + 1.5 * mm, str(counts[k]), fontName="Helvetica-Bold", fontSize=8, fillColor=INK, textAnchor="middle"))
        d.add(String(x + bw / 2, 2 * mm, str(k), fontName="Helvetica-Bold", fontSize=8, fillColor=MUTED, textAnchor="middle"))
    return d


def _kpis(summary):
    items = [
        (f"{summary['students_with_results']}", "Students with results"),
        (f"{summary['results']}", f"Exam results ({summary['exams']} exams)"),
        (_pct(summary["average"]), "Average score"),
        (_pct(summary["pass_rate"]), "Pass rate"),
        (f"{_gpa(summary['gpa'])}", f"School GPA (out of {summary['gpa_out_of']})"),
        (f"{_num(summary['highest'])}% / {_num(summary['lowest'])}%" if summary["highest"] is not None else "-", "Highest / lowest score"),
    ]
    cells = [[Table([[Paragraph(escape(v), S_KPI)], [Paragraph(escape(l), S_KPI_L)]], colWidths=[USABLE / len(items) - 4 * mm],
                    style=[("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1)]) for v, l in items]]
    t = Table(cells, colWidths=[USABLE / len(items)] * len(items))
    t.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.6, BRAND), ("INNERGRID", (0, 0), (-1, -1), 0.3, LINE), ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
                           ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    return t


def _info_box(meta, summary):
    pairs = list(meta["filters"]) + [("Sorted by", meta["sort"])]
    if summary.get("students_without_results"):
        pairs.append(("No results yet", f"{summary['students_without_results']} student(s) in this view"))
    cells = [Paragraph(f"<font color='#5C6B67'>{escape(k)}:</font> <b>{escape(str(v))}</b>", S_INFO) for k, v in pairs]
    per_row = 3
    rows = [cells[i:i + per_row] + [""] * (per_row - len(cells[i:i + per_row])) for i in range(0, len(cells), per_row)]
    t = Table(rows, colWidths=[USABLE / per_row] * per_row)
    t.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.5, LINE), ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F7FAF9")),
                           ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
    return t


def _grades_block(report):
    scale, summary = report["scale"], report["summary"]
    counts = report["grade_counts"]
    total = max(1, sum(counts.values()))
    rows = [[g["grade"], f"{g['min']} - {g['max']}", g["meaning"], counts.get(g["grade"], 0), _pct(100 * counts.get(g["grade"], 0) / total)]
            for g in scale["grades"]]
    left_w = USABLE * 0.5 - 3 * mm
    grid = _grid(["Grade", "Marks", "Meaning", "Count", "Share"], rows, _scaled([13, 20, 40, 14, 16], left_w), ["C", "C", "L", "C", "C"], bold_first_col=False)
    chart = _bars(counts, GRADE_HEX, USABLE * 0.5 - 3 * mm)
    divs = report["division_counts"]
    dtotal = max(1, sum(divs.values()))
    drows = []
    meaning = {d["division"]: (_range(d, "pts"), d["meaning"]) for d in scale["divisions"]}
    for k, v in divs.items():
        rng, mean = meaning.get(k, ("-", f"Fewer than {summary['division_needs']} subjects"))
        drows.append([k, rng, mean, v, _pct(100 * v / dtotal)])
    dgrid = _grid(["Division", "Points", "Meaning", "Students", "Share"], drows, _scaled([15, 22, 40, 16, 14], left_w), ["C", "C", "L", "C", "C"])
    dchart = _bars(divs, DIV_HEX, USABLE * 0.5 - 3 * mm)
    left = [Paragraph("Grades: A, B, C, D, F", S_H2), grid, Spacer(1, 2 * mm), chart,
            Paragraph("Each student gets one grade per subject (her average in that subject). Counts are of those subject grades.", S_NOTE)]
    right = [Paragraph("Divisions", S_H2), dgrid, Spacer(1, 2 * mm), dchart,
             Paragraph(f"Division = points of the best {summary['division_needs']} subjects (lower is better). "
                       f"Students with fewer subjects are shown as Incomplete.", S_NOTE)]
    t = Table([[left, right]], colWidths=[USABLE / 2, USABLE / 2])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (0, 0), 3 * mm),
                           ("LEFTPADDING", (1, 0), (1, 0), 3 * mm), ("RIGHTPADDING", (1, 0), (1, 0), 0)]))
    return t


def _top_worst(report):
    half = USABLE / 2 - 3 * mm
    heads = ["#", "Name", "Class", "Avg %", "GPA", "Div"]
    al = ["C", "L", "L", "C", "C", "C"]
    wd = _scaled([8, 50, 24, 15, 13, 12], half)

    def rows(items):
        return [[p["rank"], p["name"], p["class_label"], _num(p["average"]), _gpa(p["gpa"]), p["division"] or "-"] for p in items]

    parts = []
    for title, items in ((f"Top {len(report['top'])} students", report["top"]),
                         (f"Bottom {len(report['worst'])} students (lowest first)", report["worst"])):
        parts.append([Paragraph(title, S_H2), _grid(heads, rows(items), wd, al) if items else Paragraph("Not enough students to list.", S_NOTE)])
    t = Table([parts], colWidths=[USABLE / 2, USABLE / 2])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (0, 0), 3 * mm),
                           ("LEFTPADDING", (1, 0), (1, 0), 3 * mm), ("RIGHTPADDING", (1, 0), (1, 0), 0)]))
    return t


def _subjects_table(report):
    g = list(report["grade_counts"])
    heads = ["Subject", "Students", "Avg %", "High", "Low", "Pass %", "GPA"] + g
    rows = [[s["subject"], s["students"], _num(s["average"]), _num(s["highest"]), _num(s["lowest"]), _num(s["pass_rate"]), _gpa(s["gpa"])]
            + [s["grades"].get(x, 0) for x in g] for s in report["subjects"]]
    return _grid(heads, rows, _scaled([62, 18, 16, 14, 14, 16, 14] + [11] * len(g), USABLE), ["L"] + ["C"] * (len(heads) - 1))


def _classes_table(report):
    g, dv = list(report["grade_counts"]), list(report["division_counts"])
    heads = ["Class", "Students", "Avg %", "GPA", "Pass %"] + g + ["No div." if d == "Incomplete" else f"Div {d}" for d in dv]
    rows = [[c["label"], c["students"], _num(c["average"]), _gpa(c["gpa"]), _num(c["pass_rate"])]
            + [c["grades"].get(x, 0) for x in g] + [c["divisions"].get(x, 0) for x in dv] for c in report["classes"]]
    return _grid(heads, rows, _scaled([34, 17, 15, 14, 15] + [10] * len(g) + [10] * len(dv), USABLE), ["L"] + ["C"] * (len(heads) - 1))


def _students_tables(report, meta):
    """The full list. Subject columns are split into groups that fit the page; every group repeats # and name."""
    people = report["students_sorted"]
    subs = report["subject_names"]
    fixed_left = [9, 44, 21]            # mm: #, name, class
    fixed_right = [13, 11, 10, 11]      # Avg, GPA, Pts, Div
    room = USABLE / mm - sum(fixed_left) - sum(fixed_right)

    def col_mm(label):                  # wide enough for the longest word in the heading, never less than a mark like "100.0 A"
        longest = max(stringWidth(w, "Helvetica-Bold", 8) for w in str(label).split() or [""])
        return max(14.5, (longest + 9) / mm)

    groups, cur, used = [], [], 0.0
    for sname in subs:
        w = col_mm(sname)
        if cur and used + w > room:
            groups.append(cur)
            cur, used = [], 0.0
        cur.append(sname)
        used += w
    if cur:
        groups.append(cur)
    groups = groups or [[]]
    out = []
    for gi, grp in enumerate(groups):
        heads = ["#", "Student", "Class"] + grp + ["Avg %", "GPA", "Pts", "Div"]
        widths = _scaled(fixed_left + [col_mm(x) for x in grp] + fixed_right, USABLE)
        rows = []
        for p in people:
            cells = [p["rank"] if p["rank"] is not None else "-", p["name"], p["class_label"]]
            for s in grp:
                m = p["marks"].get(s)
                cells.append(f"{_num(m['average'])} {m['grade']}" if m else "-")
            cells += [_num(p["average"]), _gpa(p["gpa"]), p["total_points"] if p["total_points"] is not None else "-", p["division"] or "-"]
            rows.append(cells)
        al = ["C", "L", "L"] + ["C"] * (len(grp) + 4)
        if len(groups) > 1:
            out.append(Paragraph(f"Subjects part {gi + 1} of {len(groups)}", S_NOTE))
        out.append(_grid(heads, rows, widths, al) if rows else Paragraph("No students in this view.", S_NOTE))
        out.append(Spacer(1, 4 * mm))
    return out


def _method_note(report):
    sc = report["scale"]
    grades = "; ".join(f"{g['grade']} = {g['min']}-{g['max']}% ({g['points']} pt)" for g in sc["grades"])
    gp = ", ".join(f"{k}={v}" for k, v in sc["gpa_points"].items())
    return [
        Paragraph("How these figures are worked out", S_H2),
        Paragraph(f"<b>Subject grade:</b> the student's average % over her exams in that subject, graded on the school scale: {escape(grades)}.", S_NOTE),
        Paragraph(f"<b>GPA:</b> grade points {escape(gp)}, averaged over the best {sc['subjects_counted']} subjects "
                  f"(all subjects when fewer were taken); the school GPA is the average of the students' GPAs.", S_NOTE),
        Paragraph(f"<b>Division:</b> the points of the best {sc['subjects_counted']} subjects added together (lower is better). "
                  f"<b>Rank:</b> by average %, then GPA; equal scores share a rank. Only published results are counted; "
                  f"a retake replaces the first attempt.", S_NOTE),
    ]


def results_pdf(meta, report, sections):
    buf = io.BytesIO()
    doc = BaseDocTemplate(buf, pagesize=PAGE, title=f"{meta['school']} - {meta['title']}", author=meta["school"],
                          leftMargin=MARGIN, rightMargin=MARGIN)
    w, h = PAGE
    first = PageTemplate(id="first", frames=[Frame(MARGIN, BOTTOM, USABLE, h - FIRST_TOP - BOTTOM, 0, 0, 0, 0, id="f1")],
                         onPage=lambda c, d: _draw_header(c, meta, True), autoNextPageTemplate="later")
    later = PageTemplate(id="later", frames=[Frame(MARGIN, BOTTOM, USABLE, h - LATER_TOP - BOTTOM, 0, 0, 0, 0, id="f2")],
                         onPage=lambda c, d: _draw_header(c, meta, False))
    doc.addPageTemplates([first, later])

    summary = report["summary"]
    story = [_info_box(meta, summary), Spacer(1, 4 * mm)]
    empty = summary["results"] == 0
    if empty:
        story.append(Paragraph("There are no published results for these filters yet.", S_H2))
    if "summary" in sections and not empty:
        story += [_kpis(summary), Spacer(1, 3 * mm), KeepTogether([_grades_block(report)])]
    if "top_worst" in sections and not empty:
        story += [Spacer(1, 3 * mm), KeepTogether([_top_worst(report)])]
    if "subjects" in sections and report["subjects"]:
        block = [Paragraph("Performance by subject", S_H2), _subjects_table(report), Spacer(1, 2 * mm)]
        story += [KeepTogether(block)] if len(report["subjects"]) <= 22 else block
    if "classes" in sections and report["classes"]:
        block = [Paragraph("Performance by class", S_H2), _classes_table(report), Spacer(1, 2 * mm)]
        story += [KeepTogether(block)] if len(report["classes"]) <= 22 else block
    if "students" in sections:
        story += [Paragraph("Full student results", S_H2),
                  Paragraph("Each subject shows the student's average % and grade. Avg % is across all her subjects; "
                            "Pts and Div come from her best subjects.", S_NOTE), Spacer(1, 1.5 * mm)]
        story += _students_tables(report, meta)
    if not empty:
        story += [KeepTogether(_method_note(report))]
    doc.build(story, canvasmaker=_Numbered)
    return buf.getvalue()


# ------------------------------------------------------------------ Excel

X_BRAND, X_LIGHT, X_LINE = "1F6F5C", "EAF4F1", "B7C9C4"
THIN = Side(style="thin", color=X_LINE)
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
GRADE_FILL = ["CDEFE0", "DDF0D3", "D6E6F7", "FBEBB5", "F6CDD3", "E4E4E4", "E4E4E4", "E4E4E4"]


def _text(cell, v):
    cell.value = v
    if isinstance(v, str):
        cell.data_type = "s"   # a name that starts with "=" can never run as a formula
    return cell


def _xl_header(ws, meta, widths, title, width_cols=None):
    """Logo + school name + title at the top of a sheet (column widths are set first so the text starts clear of the logo)."""
    _set_widths(ws, widths)
    ws.sheet_view.showGridLines = False
    ws.row_dimensions[1].height = 30
    ws.row_dimensions[2].height = 20
    first_text_col = 1
    if meta.get("logo"):
        try:
            img = XlImage(io.BytesIO(meta["logo"]))
            ratio = img.width / img.height if img.height else 1
            img.height, img.width = 58, int(58 * ratio)
            ws.add_image(img, "A1")
            px, first_text_col = 0, 1
            while px < img.width + 10 and first_text_col <= len(widths):
                px += widths[first_text_col - 1] * 7 + 5
                first_text_col += 1
        except Exception:
            first_text_col = 1
    last = max(width_cols or len(widths), first_text_col + 3)
    for r, (text, font, h) in enumerate([(meta["school"], Font(bold=True, size=17, color="14493D"), 30), (title, Font(bold=True, size=12, color=X_BRAND), 20),
                                         (" | ".join(x for x in (meta.get("address"), meta.get("contact")) if x), Font(size=9, color="5C6B67"), 15),
                                         (f"Generated {meta['generated']}", Font(size=9, color="5C6B67"), 15)], 1):
        ws.merge_cells(start_row=r, start_column=first_text_col, end_row=r, end_column=last)
        c = ws.cell(r, first_text_col)
        _text(c, text)
        c.font, c.alignment = font, Alignment(vertical="center", wrap_text=False)
        ws.row_dimensions[r].height = max(h, 15)
    for col in range(1, last + 1):
        ws.cell(5, col).border = Border(bottom=Side(style="medium", color=X_BRAND))
    ws.row_dimensions[5].height = 6
    return 7


def _xl_filters(ws, row, meta, cols):
    for k, v in list(meta["filters"]) + ([("Sorted by", meta["sort"])] if meta.get("sort") else []):
        _text(ws.cell(row, 1), k).font = Font(bold=True, color="5C6B67", size=9)
        ws.merge_cells(start_row=row, start_column=2, end_row=row, end_column=max(cols, 3))
        _text(ws.cell(row, 2), v).font = Font(size=10)
        row += 1
    return row + 1


def _xl_table(ws, row, headers, rows, aligns=None, fills=None, number_formats=None):
    """Write a styled table. Returns (first_data_row, last_row)."""
    for j, h in enumerate(headers, 1):
        c = _text(ws.cell(row, j), h)
        c.font, c.fill = Font(bold=True, color="FFFFFF"), PatternFill("solid", fgColor=X_BRAND)
        c.alignment, c.border = Alignment(horizontal="center" if j > 1 else "left", vertical="center", wrap_text=True), BORDER
    ws.row_dimensions[row].height = 30
    first = row + 1
    for i, r in enumerate(rows):
        for j, v in enumerate(r, 1):
            c = _text(ws.cell(first + i, j), v)
            c.border = BORDER
            a = (aligns or [])[j - 1] if aligns and j - 1 < len(aligns) else ("left" if j == 1 else "center")
            c.alignment = Alignment(horizontal=a, vertical="center", wrap_text=(a == "left"))
            if number_formats and number_formats.get(j) and isinstance(v, (int, float)):
                c.number_format = number_formats[j]
            if i % 2 == 1:
                c.fill = PatternFill("solid", fgColor="F4F9F8")
    return first, first + len(rows) - 1


def _set_widths(ws, widths):
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w


def _page_setup(ws, meta, title_rows=None):
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth, ws.page_setup.fitToHeight = 1, 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_margins.left = ws.page_margins.right = 0.4
    ws.oddFooter.left.text = f"{meta['school']} - confidential"
    ws.oddFooter.right.text = "Page &P of &N"
    if title_rows:
        ws.print_title_rows = title_rows


def _grade_fill(grade, order):
    i = order.index(grade) if grade in order else len(GRADE_FILL) - 1
    return PatternFill("solid", fgColor=GRADE_FILL[min(i, len(GRADE_FILL) - 1)])


def results_xlsx(meta, report, sections):
    wb = Workbook()
    wb.remove(wb.active)
    summary, scale = report["summary"], report["scale"]
    gorder = [g["grade"] for g in scale["grades"]]
    divs = list(report["division_counts"])
    empty = summary["results"] == 0

    # ---- Summary
    ws = wb.create_sheet("Summary")
    row = _xl_header(ws, meta, [30, 16, 34, 14, 14, 16, 16, 16], meta["title"])
    row = _xl_filters(ws, row, meta, 8)
    if empty:
        _text(ws.cell(row, 1), "There are no published results for these filters yet.").font = Font(bold=True, color="D1495B")
        _page_setup(ws, meta)
    elif "summary" in sections:
        kp = [("Students with results", summary["students_with_results"]), ("Exam results counted", summary["results"]),
              ("Exams", summary["exams"]), ("Subjects", summary["subjects"]), ("Average score %", summary["average"]),
              ("Pass rate %", summary["pass_rate"]), ("Highest score %", summary["highest"]), ("Lowest score %", summary["lowest"]),
              (f"School GPA (out of {summary['gpa_out_of']})", summary["gpa"])]
        if summary["students_without_results"]:
            kp.append(("Students without results", summary["students_without_results"]))
        _text(ws.cell(row, 1), "Key figures").font = Font(bold=True, size=12, color=X_BRAND)
        row += 1
        first, last = _xl_table(ws, row, ["Measure", "Value"], kp, ["left", "center"])
        row = last + 2

        total = max(1, sum(report["grade_counts"].values()))
        _text(ws.cell(row, 1), "Grades A, B, C, D, F (one grade per student per subject)").font = Font(bold=True, size=12, color=X_BRAND)
        row += 1
        grows = [[g["grade"], f"{g['min']} - {g['max']}", g["meaning"], report["grade_counts"].get(g["grade"], 0),
                  round(report["grade_counts"].get(g["grade"], 0) / total, 4)] for g in scale["grades"]]
        f, l = _xl_table(ws, row, ["Grade", "Marks %", "Meaning", "Count", "Share"], grows, ["center", "center", "left", "center", "center"],
                         number_formats={5: "0.0%"})
        for i in range(f, l + 1):
            ws.cell(i, 1).fill = _grade_fill(ws.cell(i, 1).value, gorder)
            ws.cell(i, 1).font = Font(bold=True)
        if l >= f:
            ws.conditional_formatting.add(f"D{f}:D{l}", DataBarRule(start_type="num", start_value=0, end_type="max", color="5BA55B", showValue=True))
        row = l + 2

        dtotal = max(1, sum(report["division_counts"].values()))
        _text(ws.cell(row, 1), "Divisions").font = Font(bold=True, size=12, color=X_BRAND)
        row += 1
        meaning = {d["division"]: (_range(d), d["meaning"]) for d in scale["divisions"]}
        drows = [[k, *meaning.get(k, ("-", f"Fewer than {summary['division_needs']} subjects")), v, round(v / dtotal, 4)]
                 for k, v in report["division_counts"].items()]
        f, l = _xl_table(ws, row, ["Division", "Points", "Meaning", "Students", "Share"], drows, ["center", "center", "left", "center", "center"],
                         number_formats={5: "0.0%"})
        if l >= f:
            ws.conditional_formatting.add(f"D{f}:D{l}", DataBarRule(start_type="num", start_value=0, end_type="max", color="3F7FBF", showValue=True))
        row = l + 2
        gp = ", ".join(f"{k}={v}" for k, v in scale["gpa_points"].items())
        for line in (f"GPA: grade points {gp}, averaged over each student's best {scale['subjects_counted']} subjects (all when fewer).",
                     f"Division: points of the best {scale['subjects_counted']} subjects added together (lower is better).",
                     "Only published results are counted; a retake replaces the first attempt."):
            ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=8)
            _text(ws.cell(row, 1), line).font = Font(size=9, color="5C6B67")
            row += 1
        _page_setup(ws, meta)
    else:
        _page_setup(ws, meta)

    # ---- Top and bottom
    if "top_worst" in sections and not empty:
        ws = wb.create_sheet("Top and bottom")
        row = _xl_header(ws, meta, [10, 34, 16, 13, 10, 10, 11], meta["title"])
        heads = ["Position", "Student", "Class", "Average %", "GPA", "Points", "Division"]
        for title, items in ((f"Top {len(report['top'])} students", report["top"]),
                             (f"Bottom {len(report['worst'])} students (lowest first)", report["worst"])):
            _text(ws.cell(row, 1), title).font = Font(bold=True, size=12, color=X_BRAND)
            row += 1
            rows = [[p["rank"], p["name"], p["class_label"], p["average"], p["gpa"], p["total_points"], p["division"] or "-"] for p in items]
            if rows:
                f, l = _xl_table(ws, row, heads, rows, ["center", "left", "left", "center", "center", "center", "center"],
                                 number_formats={4: "0.0", 5: "0.00"})
                row = l + 2
            else:
                _text(ws.cell(row, 1), "Not enough students to list.").font = Font(size=9, color="5C6B67")
                row += 2
        _page_setup(ws, meta)

    # ---- Subjects
    if "subjects" in sections and report["subjects"]:
        ws = wb.create_sheet("Subjects")
        heads = ["Subject", "Students", "Average %", "Highest %", "Lowest %", "Pass rate %", "GPA"] + gorder
        row = _xl_header(ws, meta, [30, 11, 12, 12, 12, 13, 9] + [8] * len(gorder), "Performance by subject")
        rows = [[s["subject"], s["students"], s["average"], s["highest"], s["lowest"], s["pass_rate"], s["gpa"]]
                + [s["grades"].get(g, 0) for g in gorder] for s in report["subjects"]]
        hdr_row = row
        f, l = _xl_table(ws, row, heads, rows, number_formats={3: "0.0", 4: "0.0", 5: "0.0", 6: "0.0", 7: "0.00"})
        ws.auto_filter.ref = f"A{hdr_row}:{get_column_letter(len(heads))}{l}"
        ws.freeze_panes = ws.cell(f, 2)
        _page_setup(ws, meta, f"{hdr_row}:{hdr_row}")

    # ---- Classes
    if "classes" in sections and report["classes"]:
        ws = wb.create_sheet("Classes")
        heads = ["Class", "Students", "Average %", "GPA", "Pass rate %"] + gorder + [f"Div {d}" for d in divs]
        row = _xl_header(ws, meta, [22, 11, 12, 9, 13] + [7] * (len(gorder) + len(divs)), "Performance by class")
        rows = [[c["label"], c["students"], c["average"], c["gpa"], c["pass_rate"]] + [c["grades"].get(g, 0) for g in gorder]
                + [c["divisions"].get(d, 0) for d in divs] for c in report["classes"]]
        hdr_row = row
        f, l = _xl_table(ws, row, heads, rows, number_formats={3: "0.0", 4: "0.00", 5: "0.0"})
        ws.auto_filter.ref = f"A{hdr_row}:{get_column_letter(len(heads))}{l}"
        ws.freeze_panes = ws.cell(f, 2)
        _page_setup(ws, meta, f"{hdr_row}:{hdr_row}")

    # ---- Students (full results)
    if "students" in sections:
        ws = wb.create_sheet("Students")
        subs = report["subject_names"]
        heads = ["Rank", "Class position", "Student", "Index number", "Class"] + subs + ["Subjects", "Average %", "Grade", "GPA", "Points", "Division"]
        row = _xl_header(ws, meta, [7, 10, 32, 15, 14] + [max(12, len(x) + 2) for x in subs] + [10, 11, 8, 8, 8, 11],
                         "Full student results (each subject: average %, coloured by grade)", width_cols=min(len(heads), 12))
        rows = []
        for p in report["students_sorted"]:
            rows.append([p["rank"], p["class_position"], p["name"], p["index_number"], p["class_label"]]
                        + [(p["marks"][s]["average"] if s in p["marks"] else None) for s in subs]
                        + [p["subjects_taken"], p["average"], p["overall_grade"], p["gpa"], p["total_points"], p["division"] or ("Incomplete" if p["has_results"] else "-")])
        hdr_row = row
        nf = {i: "0.0" for i in range(6, 6 + len(subs))}
        nf.update({7 + len(subs): "0.0", 9 + len(subs): "0.00"})
        f, l = _xl_table(ws, row, heads, rows, ["center", "center", "left", "center", "left"] + ["center"] * (len(heads) - 5), number_formats=nf)
        # colour every subject mark by its grade
        for i, p in enumerate(report["students_sorted"]):
            for j, s in enumerate(subs):
                m = p["marks"].get(s)
                if m:
                    ws.cell(f + i, 6 + j).fill = _grade_fill(m["grade"], gorder)
            if p["overall_grade"]:
                ws.cell(f + i, 8 + len(subs)).fill = _grade_fill(p["overall_grade"], gorder)
        ws.auto_filter.ref = f"A{hdr_row}:{get_column_letter(len(heads))}{l}"
        ws.freeze_panes = ws.cell(f, 4)
        _page_setup(ws, meta, f"{hdr_row}:{hdr_row}")

    if not wb.sheetnames:
        wb.create_sheet("Report")
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
