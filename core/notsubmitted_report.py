"""PDF and Excel for the admin "Not submitted" list (no Django imports). Same look as the results report:
school name and logo on top, wrapped cells in fixed columns, page numbers, a blank Remarks column to write in by hand.

`meta` : school, address, contact, logo (bytes or None), title, filters [(label, value)], generated
`ctx`  : rows, summary, classes, with_parents (see exams.notsubmitted.collect)
"""
import io
from xml.sax.saxutils import escape

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import BaseDocTemplate, Frame, KeepTogether, PageTemplate, Paragraph, Spacer, Table, TableStyle

from . import results_report as rr

STATUS_FILL = {"none": "F6CDD3", "writing": "FBEBB5", "auto": "D6E6F7"}


def _parents_text(row):
    return "\n".join(f"{p['name']}{f' ({p['relationship']})' if p['relationship'] else ''}: {p['phone']}" for p in row["parents"]) or "-"


def _kpis(summary):
    items = [(summary["eligible"], "Expected to sit"), (summary["submitted"], "Submitted"), (summary["not_submitted"], "Not submitted"),
             (summary["none"], "Did not sit"), (summary["writing"], "Still writing"),
             ("-" if summary["pct_submitted"] is None else f"{summary['pct_submitted']:.1f}%", "Submitted (share)")]
    cells = [[Table([[Paragraph(escape(str(v)), rr.S_KPI)], [Paragraph(escape(l), rr.S_KPI_L)]], colWidths=[rr.USABLE / len(items) - 4 * mm],
                    style=[("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1)]) for v, l in items]]
    t = Table(cells, colWidths=[rr.USABLE / len(items)] * len(items))
    t.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.6, rr.BRAND), ("INNERGRID", (0, 0), (-1, -1), 0.3, rr.LINE), ("BACKGROUND", (0, 0), (-1, -1), rr.LIGHT),
                           ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    return t


def _info(meta):
    cells = [Paragraph(f"<font color='#5C6B67'>{escape(k)}:</font> <b>{escape(str(v))}</b>", rr.S_INFO) for k, v in meta["filters"]]
    per = 3
    rows = [cells[i:i + per] + [""] * (per - len(cells[i:i + per])) for i in range(0, len(cells), per)]
    t = Table(rows, colWidths=[rr.USABLE / per] * per)
    t.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.5, rr.LINE), ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F7FAF9")),
                           ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
    return t


def pdf(meta, ctx):
    buf = io.BytesIO()
    doc = BaseDocTemplate(buf, pagesize=rr.PAGE, title=f"{meta['school']} - {meta['title']}", author=meta["school"], leftMargin=rr.MARGIN, rightMargin=rr.MARGIN)
    w, h = rr.PAGE
    first = PageTemplate(id="first", frames=[Frame(rr.MARGIN, rr.BOTTOM, rr.USABLE, h - rr.FIRST_TOP - rr.BOTTOM, 0, 0, 0, 0)],
                         onPage=lambda c, d: rr._draw_header(c, meta, True), autoNextPageTemplate="later")
    later = PageTemplate(id="later", frames=[Frame(rr.MARGIN, rr.BOTTOM, rr.USABLE, h - rr.LATER_TOP - rr.BOTTOM, 0, 0, 0, 0)],
                         onPage=lambda c, d: rr._draw_header(c, meta, False))
    doc.addPageTemplates([first, later])

    s, rows = ctx["summary"], ctx["rows"]
    story = [_info(meta), Spacer(1, 4 * mm), _kpis(s), Spacer(1, 3 * mm)]
    if len(ctx["classes"]) > 1:
        cr = [[c["class"], c["eligible"], c["not_submitted"], f"{100 * (c['eligible'] - c['not_submitted']) / c['eligible']:.0f}%" if c["eligible"] else "-"] for c in ctx["classes"]]
        story += [KeepTogether([Paragraph("By class", rr.S_H2), rr._grid(["Class", "Expected", "Not submitted", "Submitted"], cr, rr._scaled([50, 24, 28, 24], rr.USABLE * 0.5), ["L", "C", "C", "C"])])]
    story.append(Paragraph(f"Students listed ({len(rows)})", rr.S_H2))
    if not rows:
        story.append(Paragraph("Nobody matches these filters. Everyone expected has submitted, or the filters are too narrow.", rr.S_NOTE))
    else:
        withp = ctx["with_parents"]
        heads = ["#", "Student", "Index no.", "Class", "Status", "Started"] + (["Parent / guardian"] if withp else []) + ["Remarks"]
        widths = rr._scaled([8, 46, 22, 20, 30, 20] + ([58] if withp else []) + [42 if not withp else 36], rr.USABLE)
        aligns = ["C", "L", "L", "L", "L", "L"] + (["L"] if withp else []) + ["L"]
        body = []
        for i, r in enumerate(rows, 1):
            line = [i, r["name"], r["index"] or "-", r["class"], r["status_label"], r["started_text"]]
            if withp:
                line.append(None)
            line.append("")
            body.append(line)
        t = rr._grid(heads, [[("" if v is None else v) for v in b] for b in body], widths, aligns, repeat=1)
        if withp:  # parents: one line each, wrapped inside the column (replace the empty cell with a Paragraph)
            col = 6
            for i, r in enumerate(rows, 1):
                t._cellvalues[i][col] = Paragraph("<br/>".join(escape(x) for x in _parents_text(r).split("\n")), rr.S_CELL)
        t.setStyle(TableStyle([("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, rr.LIGHT]), ("TOPPADDING", (0, 1), (-1, -1), 5), ("BOTTOMPADDING", (0, 1), (-1, -1), 5)]))
        story.append(t)
    story += [Spacer(1, 3 * mm), Paragraph("Did not sit: never opened the exam. Still writing: started and has not pressed Submit yet. "
                                           "Not submitted, time ran out: the system submitted for her when the time ended.", rr.S_NOTE)]
    doc.build(story, canvasmaker=rr._Numbered)
    return buf.getvalue()


def xlsx(meta, ctx):
    wb = Workbook()
    ws = wb.active
    ws.title = "Not submitted"
    rows, s = ctx["rows"], ctx["summary"]
    withp = ctx["with_parents"]
    heads = ["#", "Student", "Index number", "Class", "Status", "Started"] + (["Parent / guardian"] if withp else []) + ["Remarks"]
    widths = [6, 32, 16, 14, 26, 16] + ([44] if withp else []) + [34]
    row = rr._xl_header(ws, meta, widths, meta["title"])
    row = rr._xl_filters(ws, row, {"filters": meta["filters"], "sort": ""}, 6)
    for label, val in (("Expected to sit", s["eligible"]), ("Submitted", s["submitted"]), ("Not submitted", s["not_submitted"]),
                       ("Did not sit", s["none"]), ("Still writing", s["writing"]), ("Time ran out (auto-submitted)", s["auto"])):
        rr._text(ws.cell(row, 1), label).font = Font(bold=True, color="5C6B67", size=9)
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=2)
        ws.cell(row, 3).value = val
        ws.cell(row, 3).alignment = Alignment(horizontal="left")
        row += 1
    row += 1
    hdr = row
    data = [[i, r["name"], r["index"] or "-", r["class"], r["status_label"], r["started_text"]]
            + ([_parents_text(r)] if withp else []) + [""] for i, r in enumerate(rows, 1)]
    if data:
        f, l = rr._xl_table(ws, hdr, heads, data, ["center", "left", "left", "left", "left", "left"] + (["left"] if withp else []) + ["left"])
        for i, r in enumerate(rows):
            ws.cell(f + i, 5).fill = PatternFill("solid", fgColor=STATUS_FILL.get(r["status"], "FFFFFF"))
        ws.auto_filter.ref = f"A{hdr}:{get_column_letter(len(heads))}{l}"
        ws.freeze_panes = ws.cell(f, 3)
    else:
        rr._text(ws.cell(hdr, 1), "Nobody matches these filters.").font = Font(bold=True, color="5C6B67")
    rr._page_setup(ws, meta, f"{hdr}:{hdr}")
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
