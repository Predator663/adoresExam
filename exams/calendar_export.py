"""Exam calendar downloads: a designed PDF timetable and an .ics file that phones, Google Calendar and Outlook can import.

No Django imports here: the views collect the exams and hand over plain dicts.

`meta`   : school, address, contact, logo (bytes or None), audience (who the calendar is for), tz_label, generated, host
`events` : list of dicts with id, title, subject, start, end (aware datetimes in the school's time zone), duration, marks,
           questions, classes (list of names; empty for a student's own calendar), status
"""
import calendar as _cal
import io
from datetime import datetime, timezone as _utc

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

# ------------------------------------------------------------------------------------------------ .ics


def _esc(s):
    return str(s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\r\n", "\\n").replace("\n", "\\n")


def _fold(line):
    """RFC 5545: lines are at most 75 octets; continuation lines start with one space. Never cut inside a UTF-8 character."""
    raw, out = line.encode("utf-8"), []
    while len(raw) > 75:
        cut = 75
        while cut > 0 and (raw[cut] & 0xC0) == 0x80:
            cut -= 1
        out.append(raw[:cut].decode("utf-8"))
        raw = b" " + raw[cut:]
    out.append(raw.decode("utf-8"))
    return "\r\n".join(out)


def _z(dt):
    return dt.astimezone(_utc.utc).strftime("%Y%m%dT%H%M%SZ")


def ics(meta, events):
    now = _z(datetime.now(_utc.utc))
    host = meta.get("host") or "exams.local"
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//" + _esc(meta["school"]) + "//Exam Calendar//EN", "CALSCALE:GREGORIAN",
             "METHOD:PUBLISH", "X-WR-CALNAME:" + _esc(f"{meta['school']} exams"), "X-WR-TIMEZONE:" + meta.get("tz_name", "Africa/Dar_es_Salaam")]
    for e in events:
        desc = [f"Subject: {e['subject']}", f"Exam: {e['title']}", f"Time allowed: {e['duration']} minutes"]
        if e.get("questions"):
            desc.append(f"{e['questions']} questions, {e['marks']:g} marks")
        if e.get("classes"):
            desc.append("Classes: " + ", ".join(e["classes"]))
        desc.append("Arrive early and bring your own pens. Good luck!")
        lines += ["BEGIN:VEVENT", f"UID:exam-{e['id']}@{host}", f"DTSTAMP:{now}", f"DTSTART:{_z(e['start'])}", f"DTEND:{_z(e['end'])}",
                  "SUMMARY:" + _esc(f"{e['subject']} exam: {e['title']}" if e["subject"].lower() not in e["title"].lower() else f"Exam: {e['title']}"),
                  "DESCRIPTION:" + _esc("\n".join(desc)), "LOCATION:" + _esc(", ".join(x for x in (meta["school"], meta.get("address")) if x)),
                  "CATEGORIES:Exam", "STATUS:CONFIRMED", "TRANSP:OPAQUE",
                  "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", "DESCRIPTION:" + _esc(f"Tomorrow: {e['subject']} exam"), "END:VALARM",
                  "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", "DESCRIPTION:" + _esc(f"In one hour: {e['subject']} exam"), "END:VALARM",
                  "END:VEVENT"]
    lines.append("END:VCALENDAR")
    return ("\r\n".join(_fold(x) for x in lines) + "\r\n").encode("utf-8")


# ------------------------------------------------------------------------------------------------ PDF

W, H = landscape(A4)
M, FOOT = 30, 34
HEAD_FULL, HEAD_SLIM = 98, 48
DARK, BRAND, SOFT = colors.HexColor("#0F4C3F"), colors.HexColor("#1F6F5C"), colors.HexColor("#EAF4F1")
INK, MUTED, LINE = colors.HexColor("#1B2B27"), colors.HexColor("#60706B"), colors.HexColor("#D5E2DD")
AMBER = colors.HexColor("#F59E0B")
PALETTE = ["#1F6F5C", "#2E6FD8", "#C2410C", "#7C3AED", "#BE185D", "#0E7490", "#A16207", "#4D7C0F", "#B91C1C", "#475569"]
B, R = "Helvetica-Bold", "Helvetica"


def _tint(c, k=0.86):
    """The colour mixed with white (k = how much white)."""
    return colors.Color(c.red + (1 - c.red) * k, c.green + (1 - c.green) * k, c.blue + (1 - c.blue) * k)


def _fit(s, font, size, width):
    s = str(s or "")
    if stringWidth(s, font, size) <= width:
        return s
    while s and stringWidth(s + "...", font, size) > width:
        s = s[:-1]
    return s.rstrip() + "..."


def _wrap(s, font, size, width, lines):
    words, out, cur = str(s or "").split(), [], ""
    for w in words:
        t = f"{cur} {w}".strip()
        if stringWidth(t, font, size) <= width or not cur:
            cur = t
        else:
            out.append(cur)
            cur = w
    if cur:
        out.append(cur)
    if len(out) > lines:
        out = out[:lines]
        out[-1] = _fit(out[-1] + " ...", font, size, width)
    return [_fit(x, font, size, width) for x in out]


def _header(c, meta, slim, title_right=""):
    h = HEAD_SLIM if slim else HEAD_FULL
    c.setFillColor(DARK)
    c.rect(0, H - h, W, h, stroke=0, fill=1)
    c.saveState()
    c.setFillColor(colors.Color(1, 1, 1, alpha=0.07))  # the alpha must ride on the colour: setFillColor resets a separate setFillAlpha
    c.circle(W - 70, H - 8, 96 if not slim else 60, stroke=0, fill=1)
    c.circle(W - 210, H - h + 6, 52 if not slim else 34, stroke=0, fill=1)
    c.circle(310, H + 18, 70 if not slim else 40, stroke=0, fill=1)
    c.restoreState()
    c.setFillColor(AMBER)
    c.rect(0, H - h - 3, W, 3, stroke=0, fill=1)
    x = M
    if meta.get("logo"):
        try:
            r = 15 if slim else 29
            c.setFillColor(colors.white)
            c.circle(x + r, H - h / 2, r, stroke=0, fill=1)
            c.saveState()
            p = c.beginPath()
            p.circle(x + r, H - h / 2, r - 2)
            c.clipPath(p, stroke=0, fill=0)
            c.drawImage(ImageReader(io.BytesIO(meta["logo"])), x + 2, H - h / 2 - r + 2, 2 * r - 4, 2 * r - 4, preserveAspectRatio=True, mask="auto", anchor="c")
            c.restoreState()
            x += 2 * r + 14
        except Exception:  # an unreadable logo must never stop the calendar
            pass
    c.setFillColor(colors.HexColor("#BFE3D8"))
    if slim:
        c.setFont(B, 7.5)
        c.drawString(x, H - 19, _fit(meta["school"].upper(), B, 7.5, 360))
        c.setFillColor(colors.white)
        c.setFont(B, 15)
        c.drawString(x, H - 37, "Exam Calendar")
    else:
        c.setFont(B, 9)
        c.drawString(x, H - 33, _fit(meta["school"].upper(), B, 9, 430))
        c.setFillColor(colors.white)
        c.setFont(B, 31)
        c.drawString(x, H - 66, "Exam Calendar")
        c.setFillColor(colors.HexColor("#CDE7DF"))
        c.setFont(R, 10.5)
        c.drawString(x, H - 84, _fit(meta["audience"], R, 10.5, 470))
    if title_right:  # a chip on the right: the period, or "continued"
        c.setFont(B, 9 if slim else 10)
        tw = stringWidth(title_right, B, 9 if slim else 10) + 22
        cy = H - (h / 2) - (0 if slim else 4)
        c.setFillColor(colors.Color(1, 1, 1, alpha=0.16))
        c.roundRect(W - M - tw, cy - 12, tw, 24, 12, stroke=0, fill=1)
        c.setFillColor(colors.white)
        c.drawString(W - M - tw + 11, cy - 3.5, title_right)
    return H - h - 3


def _footer(c, meta, page, pages):
    c.setStrokeColor(LINE)
    c.setLineWidth(0.6)
    c.line(M, FOOT - 6, W - M, FOOT - 6)
    c.setFillColor(MUTED)
    c.setFont(R, 7)
    left = " · ".join(x for x in (meta["school"], meta.get("address"), meta.get("contact")) if x)
    c.drawString(M, FOOT - 17, _fit(left, R, 7, 430))
    c.drawRightString(W - M, FOOT - 17, f"Generated {meta['generated']}  ·  {meta['tz_label']}  ·  Page {page} of {pages}")
    c.setFillColor(BRAND)
    c.rect(0, 0, W, 4, stroke=0, fill=1)


def _colour_map(events):
    subs = sorted({e["subject"] for e in events})
    return {s: colors.HexColor(PALETTE[i % len(PALETTE)]) for i, s in enumerate(subs)}


def _card(c, x, y, w, h, e, col, staff):
    """One exam: a coloured date block and its details. (x, y) is the card's top-left corner."""
    c.setFillColor(colors.white)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.7)
    c.roundRect(x, y - h, w, h, 9, stroke=1, fill=1)
    bw = 46
    c.saveState()
    p = c.beginPath()
    p.roundRect(x, y - h, w, h, 9)
    c.clipPath(p, stroke=0, fill=0)
    c.setFillColor(col)
    c.rect(x, y - h, bw, h, stroke=0, fill=1)
    c.restoreState()
    c.setFillColor(colors.white)
    c.setFont(B, 7.5)
    c.drawCentredString(x + bw / 2, y - 14, e["start"].strftime("%a").upper())
    c.setFont(B, 20)
    c.drawCentredString(x + bw / 2, y - 35, f"{e['start'].day}")
    c.setFont(R, 7)
    c.drawCentredString(x + bw / 2, y - 47, e["start"].strftime("%b").upper())
    tx, tw = x + bw + 9, w - bw - 16
    lines = _wrap(e["title"], B, 9, tw, 2)
    ty = y - 14
    c.setFillColor(INK)
    c.setFont(B, 9)
    for ln in lines:
        c.drawString(tx, ty, ln)
        ty -= 10.5
    c.setFillColor(col)
    c.setFont(B, 7.8)
    c.drawString(tx, ty - 1, _fit(e["subject"], B, 7.8, tw))
    ty -= 11
    c.setFillColor(MUTED)
    c.setFont(R, 7.6)
    when = f"{e['start']:%H:%M} - {e['end']:%H:%M}   {e['duration']} min"
    if e.get("questions"):
        when += f"   {e['marks']:g} marks"
    c.drawString(tx, ty - 1, _fit(when, R, 7.6, tw))
    if staff and e.get("classes") and ty - 11 > y - h + 4:
        c.setFont(R, 7)
        c.drawString(tx, ty - 11, _fit(", ".join(e["classes"]), R, 7, tw))


def _month_grid(c, x, top, width, avail, year, month, by_day, cmap, today):
    weeks = _cal.Calendar(firstweekday=0).monthdayscalendar(year, month)
    head, cw = 17, width / 7
    rh = min(74, (avail - head) / len(weeks))
    c.setFillColor(colors.white)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.8)
    c.roundRect(x, top - head - rh * len(weeks), width, head + rh * len(weeks), 10, stroke=1, fill=1)
    c.saveState()
    p = c.beginPath()
    p.roundRect(x, top - head - rh * len(weeks), width, head + rh * len(weeks), 10)
    c.clipPath(p, stroke=0, fill=0)
    c.setFillColor(SOFT)
    c.rect(x, top - head, width, head, stroke=0, fill=1)
    for i, d in enumerate(("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")):
        c.setFillColor(colors.HexColor("#B45309") if i >= 5 else BRAND)
        c.setFont(B, 7.2)
        c.drawCentredString(x + cw * i + cw / 2, top - 11.5, d)
    for r, wk in enumerate(weeks):
        for i, day in enumerate(wk):
            cx, cy = x + cw * i, top - head - rh * (r + 1)
            if day == 0 or i >= 5:
                c.setFillColor(colors.HexColor("#F6F8F7") if day == 0 else colors.HexColor("#FBF7EE"))
                c.rect(cx, cy, cw, rh, stroke=0, fill=1)
            c.setStrokeColor(LINE)
            c.setLineWidth(0.4)
            c.rect(cx, cy, cw, rh, stroke=1, fill=0)
            if not day:
                continue
            items = by_day.get(day, [])
            is_today = today.year == year and today.month == month and today.day == day
            nx, ny = cx + 11, cy + rh - 11
            if items:
                c.setFillColor(DARK)
                c.circle(nx, ny, 7.4, stroke=0, fill=1)
                c.setFillColor(colors.white)
            else:
                c.setFillColor(MUTED)
            if is_today:
                c.setStrokeColor(AMBER)
                c.setLineWidth(1.6)
                c.circle(nx, ny, 8.4, stroke=1, fill=0)
            c.setFont(B, 7.6)
            c.drawCentredString(nx, ny - 2.7, str(day))
            cap = max(1, int((rh - 22) // 11.5))
            shown = items if len(items) <= cap else items[:cap - 1]
            yy = cy + rh - 24
            for e in shown:
                col = cmap[e["subject"]]
                c.setFillColor(_tint(col, 0.82))
                c.roundRect(cx + 3, yy - 8.5, cw - 6, 10.4, 2.5, stroke=0, fill=1)
                c.setFillColor(col)
                c.rect(cx + 3, yy - 8.5, 2.4, 10.4, stroke=0, fill=1)
                c.setFillColor(INK)
                c.setFont(R, 6.3)
                c.drawString(cx + 8, yy - 5.2, _fit(f"{e['start']:%H:%M} {e['subject']}", R, 6.3, cw - 14))
                yy -= 11.5
            if len(items) > len(shown):
                c.setFillColor(MUTED)
                c.setFont(B, 6.3)
                c.drawString(cx + 6, yy - 5.2, f"+{len(items) - len(shown)} more")
    c.restoreState()
    return top - head - rh * len(weeks)


def pdf(meta, events, today):
    staff = any(e.get("classes") for e in events)
    cmap = _colour_map(events)
    months = {}
    for e in sorted(events, key=lambda e: e["start"]):
        months.setdefault((e["start"].year, e["start"].month), []).append(e)
    CARD_H, GAP, PANEL_W = 56, 7, 246
    # ---- plan the pages first, so every footer can say "Page x of y"
    pages = []
    for (y, m), items in months.items():
        first_slim = bool(pages)
        top = H - (HEAD_SLIM if first_slim else HEAD_FULL) - 3 - 14
        panel_h = top - 26 - FOOT - 10
        fit = len(items) if len(items) * (CARD_H + GAP) - GAP <= panel_h else max(1, int((panel_h - 14 + GAP) // (CARD_H + GAP)))  # room for the "more on the next page" note
        pages.append({"y": y, "m": m, "items": items, "panel": items[:fit], "cont": False})
        rest = items[fit:]
        cols = 3
        rows = max(1, int((H - HEAD_SLIM - 3 - 14 - 30 - FOOT - 10 + GAP) // (CARD_H + GAP)))
        while rest:
            pages.append({"y": y, "m": m, "items": items, "panel": rest[:cols * rows], "cont": True})
            rest = rest[cols * rows:]
    if not pages:
        pages.append({"empty": True})
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=landscape(A4))
    c.setTitle(f"Exam calendar - {meta['school']}")
    c.setAuthor(meta["school"])
    n = len(pages)
    for i, pg in enumerate(pages):
        slim = i > 0
        if pg.get("empty"):
            _header(c, meta, False)
            c.setFillColor(BRAND)
            c.setFont(B, 20)
            c.drawCentredString(W / 2, H / 2 + 10, "No exams are scheduled yet")
            c.setFillColor(MUTED)
            c.setFont(R, 11)
            c.drawCentredString(W / 2, H / 2 - 12, "When exams are scheduled they will appear here. Download this calendar again later.")
            _footer(c, meta, 1, 1)
            c.showPage()
            continue
        y, m, items = pg["y"], pg["m"], pg["items"]
        period = ""
        if i == 0:
            a, z = min(e["start"] for e in events), max(e["start"] for e in events)
            period = f"{a:%d %b %Y} - {z:%d %b %Y}  ·  {len(events)} exam{'s' if len(events) != 1 else ''}"
        top = _header(c, meta, slim, period if i == 0 else f"{_cal.month_name[m]} {y}")
        top -= 14
        c.setFillColor(DARK)
        c.setFont(B, 21)
        c.drawString(M, top - 20, f"{_cal.month_name[m]} {y}" + ("  (continued)" if pg["cont"] else ""))
        c.setFillColor(BRAND)
        c.setFont(B, 8.5)
        cnt = f"{len(items)} exam{'s' if len(items) != 1 else ''} this month"
        c.drawString(M + stringWidth(f"{_cal.month_name[m]} {y}" + ("  (continued)" if pg["cont"] else ""), B, 21) + 12, top - 19, cnt)
        content_top = top - 30
        if not pg["cont"]:
            grid_w = W - 2 * M - PANEL_W - 18
            by_day = {}
            for e in items:
                by_day.setdefault(e["start"].day, []).append(e)
            _month_grid(c, M, content_top, grid_w, content_top - FOOT - 10, y, m, by_day, cmap, today)
            px = M + grid_w + 18
            c.setFillColor(MUTED)
            c.setFont(B, 7.5)
            c.drawString(px, content_top - 8, "SCHEDULE")
            yy = content_top - 16
            for e in pg["panel"]:
                _card(c, px, yy, PANEL_W, CARD_H, e, cmap[e["subject"]], staff)
                yy -= CARD_H + GAP
            if len(items) > len(pg["panel"]):
                c.setFillColor(MUTED)
                c.setFont(R, 7.5)
                c.drawString(px, yy + GAP - 10, f"+ {len(items) - len(pg['panel'])} more on the next page")
        else:
            cols, gap = 3, 14
            cw = (W - 2 * M - gap * (cols - 1)) / cols
            rows = max(1, int((content_top - FOOT - 10 + GAP) // (CARD_H + GAP)))
            rows = min(rows, -(-len(pg["panel"]) // cols))  # spread a short list over the three columns instead of one tall column
            for k, e in enumerate(pg["panel"]):
                col_i, row_i = k // rows, k % rows
                _card(c, M + col_i * (cw + gap), content_top - row_i * (CARD_H + GAP), cw, CARD_H, e, cmap[e["subject"]], staff)
        # legend of subject colours (first page of each month only)
        if not pg["cont"]:
            subs = sorted({e["subject"] for e in items})
            lx = M
            c.setFont(R, 7)
            for s in subs:
                wlab = stringWidth(s, R, 7) + 16
                if lx + wlab > M + (W - 2 * M - PANEL_W - 18):
                    break
                c.setFillColor(cmap[s])
                c.circle(lx + 3.5, FOOT + 1.5, 3, stroke=0, fill=1)
                c.setFillColor(MUTED)
                c.drawString(lx + 10, FOOT - 1, s)
                lx += wlab + 6
        _footer(c, meta, i + 1, n)
        c.showPage()
    c.save()
    return buf.getvalue()
