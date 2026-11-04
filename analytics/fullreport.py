"""Full school results report: the numbers (no Django imports, so it is quick to test).

Everything here re-uses what the system already calculates:
  * a subject grade   = core.grading.grade_for(the student's average % in that subject, scale)
  * the division      = analytics.calc.report_card (best N subjects' points, core.grading.division_for)
  * pass / fail       = the `passed` flag stored on each result

The one new figure is GPA. The system keeps NECTA points (A=1 ... F=5, lower is better), so the GPA is the same
information turned the other way round, read from the school's own grading scale (so editing the scale changes it):

    grade points = (highest points in the scale + 1) - the grade's points     ->  A=5, B=4, C=3, D=2, F=1
    student GPA  = average grade points of her best N subjects (N = subjects counted for the division;
                   all her subjects when she took fewer than N)
    school GPA   = average of the students' GPAs

`rows` are the dicts made by analytics.views.to_rows (one per published result, retakes already resolved).
`students` is {student_id: {"name", "index_number", "class_id", "class_label", "form_level", "stream"}}.
"""
from collections import defaultdict

from core import grading
from . import calc

SORTS = {
    "rank": "Rank",
    "name": "Name",
    "class": "Class",
    "average": "Average %",
    "gpa": "GPA",
    "points": "Division points",
    "division": "Division",
}
SECTIONS = ("summary", "top_worst", "subjects", "classes", "students")


# ---------------------------------------------------------------- GPA

def grade_points_map(scale):
    """{grade letter: GPA points}, read from the scale: the best grade gets the most points."""
    top = max(g["points"] for g in scale["grades"])
    return {g["grade"]: top + 1 - g["points"] for g in scale["grades"]}


def gpa_scale_max(scale):
    return max(grade_points_map(scale).values())


def student_gpa(subject_grades, scale):
    """subject_grades: [(grade letter, necta points)]. Best N subjects count (all of them if fewer than N)."""
    if not subject_grades:
        return None
    gp = grade_points_map(scale)
    n = scale.get("subjects_counted", 7)
    best = sorted(subject_grades, key=lambda x: x[1])[:n]
    return round(sum(gp[g] for g, _ in best) / len(best), 2)


# ---------------------------------------------------------------- helpers

def _avg(values, digits=1):
    return round(sum(values) / len(values), digits) if values else None


def _rank_key(s):
    # best first: higher average, then higher GPA, then name (stable and predictable)
    return (-(s["average"] if s["average"] is not None else -1), -(s["gpa"] or 0), s["name"].lower(), s["student_id"])


def _grade_order(scale):
    return [g["grade"] for g in scale["grades"]]


def _division_order(scale):
    return [d["division"] for d in scale["divisions"]]


def _zero_counts(order):
    return {k: 0 for k in order}


def _competition_ranks(items, key):
    """1, 2, 2, 4 style: equal values share a rank."""
    ranks, prev, last_rank = [], object(), 0
    for i, it in enumerate(items, 1):
        k = key(it)
        if k != prev:
            last_rank, prev = i, k
        ranks.append(last_rank)
    return ranks


def pick_scale(rows, fallback):
    """The scale of the most recent result in view (same rule as the student's report card)."""
    dated = [r for r in rows if r.get("scale")]
    if not dated:
        return fallback
    stamp = lambda r: r["date"].timestamp() if r.get("date") else 0
    return max(dated, key=lambda r: (stamp(r), r["result_id"]))["scale"]


# ---------------------------------------------------------------- the report

def build(rows, students, scale, top_n=10, include_empty=False):
    """Return the whole report as plain data. Sorting for display is done by `sort_students`."""
    top_n = max(1, min(int(top_n or 10), 100))
    grade_order, div_order = _grade_order(scale), _division_order(scale)
    n_counted = scale.get("subjects_counted", 7)

    by_student = defaultdict(lambda: defaultdict(list))   # student -> subject -> [row]
    for r in rows:
        by_student[r["student_id"]][r["subject"]].append(r)

    subjects_seen = sorted({r["subject"] for r in rows})
    people = []
    for sid, per_subject in by_student.items():
        info = students.get(sid) or {"name": f"Student {sid}", "index_number": "", "class_id": None,
                                     "class_label": "-", "form_level": 0, "stream": ""}
        marks, averages = {}, {}
        for subj, rs in per_subject.items():
            avg = sum(r["percent"] for r in rs) / len(rs)
            averages[subj] = avg
            g = grading.grade_for(avg, scale)
            marks[subj] = {"average": round(avg, 1), "grade": g["grade"], "points": g["points"], "exams": len(rs)}
        card = calc.report_card(averages, scale)
        overall = round(sum(averages.values()) / len(averages), 1)
        overall_grade = grading.grade_for(overall, scale)["grade"]
        gpa = student_gpa([(m["grade"], m["points"]) for m in marks.values()], scale)
        all_rows = [r for rs in per_subject.values() for r in rs]
        people.append({
            "student_id": sid, "name": info["name"], "index_number": info.get("index_number", ""),
            "class_id": info.get("class_id"), "class_label": info.get("class_label", "-"),
            "form_level": info.get("form_level", 0), "stream": info.get("stream", ""),
            "subjects_taken": len(marks), "marks": marks,
            "exams_taken": len(all_rows), "average": overall, "overall_grade": overall_grade, "gpa": gpa,
            "total_points": card["total_points"], "division": card["division"], "division_meaning": card["meaning"],
            "passed_all": all(r["passed"] for r in all_rows), "has_results": True,
        })

    people.sort(key=_rank_key)
    for p, rk in zip(people, _competition_ranks(people, lambda s: (s["average"], s["gpa"]))):
        p["rank"] = rk
    by_class = defaultdict(list)
    for p in people:
        by_class[p["class_id"]].append(p)
    for group in by_class.values():
        for p, rk in zip(group, _competition_ranks(group, lambda s: (s["average"], s["gpa"]))):
            p["class_position"] = rk

    if include_empty:
        with_results = {p["student_id"] for p in people}
        for sid, info in students.items():
            if sid in with_results:
                continue
            people.append({
                "student_id": sid, "name": info["name"], "index_number": info.get("index_number", ""),
                "class_id": info.get("class_id"), "class_label": info.get("class_label", "-"),
                "form_level": info.get("form_level", 0), "stream": info.get("stream", ""),
                "subjects_taken": 0, "marks": {}, "exams_taken": 0, "average": None, "overall_grade": None, "gpa": None,
                "total_points": None, "division": None, "division_meaning": None, "passed_all": None,
                "has_results": False, "rank": None, "class_position": None,
            })

    ranked = [p for p in people if p["has_results"]]

    # counts of A, B, C ... : one grade per student per subject (the average of her exams in that subject)
    grade_counts = _zero_counts(grade_order)
    for p in ranked:
        for m in p["marks"].values():
            grade_counts[m["grade"]] = grade_counts.get(m["grade"], 0) + 1
    division_counts = _zero_counts(div_order)
    division_counts["Incomplete"] = 0   # fewer subjects than the division needs
    for p in ranked:
        key = p["division"] if p["division"] is not None else "Incomplete"
        division_counts[key] = division_counts.get(key, 0) + 1
    overall_counts = _zero_counts(grade_order)
    for p in ranked:
        overall_counts[p["overall_grade"]] = overall_counts.get(p["overall_grade"], 0) + 1

    percents = [r["percent"] for r in rows]
    gpas = [p["gpa"] for p in ranked if p["gpa"] is not None]
    exam_ids = {r["exam_id"] for r in rows}
    summary = {
        "students_in_scope": len(students), "students_with_results": len(ranked),
        "students_without_results": max(0, len(students) - len(ranked)) if students else 0,
        "results": len(rows), "exams": len(exam_ids), "subjects": len(subjects_seen),
        "average": _avg(percents), "highest": max(percents) if percents else None, "lowest": min(percents) if percents else None,
        "pass_rate": round(100 * sum(1 for r in rows if r["passed"]) / len(rows), 1) if rows else None,
        "gpa": _avg(gpas, 2), "gpa_out_of": gpa_scale_max(scale),
        "subject_grades": sum(grade_counts.values()),
        "division_needs": n_counted,
    }

    # subjects
    subj_rows = defaultdict(list)
    for r in rows:
        subj_rows[r["subject"]].append(r)
    subjects = []
    for name in subjects_seen:
        rs = subj_rows[name]
        counts = _zero_counts(grade_order)
        gps = []
        gp = grade_points_map(scale)
        for p in ranked:
            m = p["marks"].get(name)
            if m:
                counts[m["grade"]] = counts.get(m["grade"], 0) + 1
                gps.append(gp[m["grade"]])
        pcts = [r["percent"] for r in rs]
        subjects.append({
            "subject": name, "students": sum(counts.values()), "results": len(rs), "average": _avg(pcts),
            "highest": max(pcts), "lowest": min(pcts), "pass_rate": round(100 * sum(1 for r in rs if r["passed"]) / len(rs), 1),
            "gpa": _avg(gps, 2), "grades": counts,
        })
    subjects.sort(key=lambda s: (-(s["average"] or 0), s["subject"]))

    # classes
    classes = []
    for cid, group in by_class.items():
        counts = _zero_counts(grade_order)
        divs = _zero_counts(div_order)
        divs["Incomplete"] = 0
        for p in group:
            for m in p["marks"].values():
                counts[m["grade"]] = counts.get(m["grade"], 0) + 1
            divs[p["division"] if p["division"] is not None else "Incomplete"] += 1
        class_rows = [r for r in rows if r["class_id"] == cid]
        gs = [p["gpa"] for p in group if p["gpa"] is not None]
        classes.append({
            "class_id": cid, "label": group[0]["class_label"], "form_level": group[0]["form_level"], "students": len(group),
            "average": _avg([p["average"] for p in group]), "gpa": _avg(gs, 2),
            "pass_rate": round(100 * sum(1 for r in class_rows if r["passed"]) / len(class_rows), 1) if class_rows else None,
            "grades": counts, "divisions": divs,
        })
    classes.sort(key=lambda c: (c["form_level"], c["label"]))

    # top / worst. With fewer than 2 x N students the ranking is split in two halves, so both lists have names
    # and nobody appears in both.
    k = top_n if len(ranked) >= 2 * top_n else (len(ranked) + 1) // 2
    top = ranked[:k]
    worst = list(reversed(ranked[k:]))[:top_n]   # lowest first

    return {
        "summary": summary, "grade_counts": grade_counts, "overall_grade_counts": overall_counts,
        "division_counts": division_counts, "subjects": subjects, "classes": classes,
        "top": top, "worst": worst, "top_n": top_n, "students": people, "subject_names": subjects_seen,
        "scale": {"grades": scale["grades"], "divisions": scale["divisions"], "subjects_counted": n_counted,
                  "gpa_points": grade_points_map(scale)},
    }


# ---------------------------------------------------------------- sorting the full student list

def sort_students(people, sort="rank", direction="asc"):
    """Students with no value for the chosen column always go last, whatever the direction."""
    if sort not in SORTS:
        sort = "rank"
    reverse = direction == "desc"

    def key(p):
        if sort == "name":
            return p["name"].lower()
        if sort == "class":
            return (p["form_level"], p["class_label"], p["name"].lower())
        if sort == "average":
            return p["average"]
        if sort == "gpa":
            return p["gpa"]
        if sort in ("points", "division"):
            return p["total_points"]
        return p["rank"]

    have = [p for p in people if key(p) is not None]
    none = [p for p in people if key(p) is None]
    have.sort(key=lambda p: (key(p), p["name"].lower(), p["student_id"]), reverse=reverse)
    none.sort(key=lambda p: (p["name"].lower(), p["student_id"]))
    return have + none
