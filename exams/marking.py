"""Automatic marking (BR-01). Pure functions: easy to test, no database access."""


_PUNCT = str.maketrans("", "", ".,;:!?'\"’‘“”-–—()[]{}")


def _norm(s, case_sensitive=False, ignore_punct=False):
    s = str(s).replace("\u2212", "-")  # the "−" from the symbol pad is the same answer as a keyboard hyphen
    if ignore_punct:
        s = s.translate(_PUNCT)
    s = " ".join(s.split())
    return s if case_sensitive else s.lower()


def _num(s):
    """A typed number. A comma is a thousands separator ("1,500") only when exactly three digits follow it; otherwise it is a decimal comma ("2,5" is 2.5, not 25)."""
    import re
    t = str(s).replace("\u2212", "-").strip().replace(" ", "")
    if t.count(",") == 1 and not re.search(r",\d{3}(?!\d)", t):
        t = t.replace(",", ".")
    else:
        t = t.replace(",", "")
    try:
        return float(t)
    except (TypeError, ValueError):
        return None


def fraction_correct(payload, response, partial=False):
    """Return a value from 0.0 to 1.0 for how correct `response` is."""
    qtype, ans = payload["qtype"], payload["answer"]

    if response is None:
        return 0.0

    if qtype == "mcq_single":
        return 1.0 if response == ans["correct"] else 0.0

    if qtype == "mcq_multi":
        if not isinstance(response, list):
            return 0.0
        chosen, correct = set(response), set(ans["correct"])
        if chosen == correct:
            return 1.0
        if partial:  # right picks minus wrong picks, never below zero
            return max(0.0, (len(chosen & correct) - len(chosen - correct)) / len(correct))
        return 0.0

    if qtype == "true_false":
        if isinstance(response, str):
            response = {"true": True, "false": False}.get(response.strip().lower())
        return 1.0 if response is ans["correct"] else 0.0

    if qtype == "matching":
        if not isinstance(response, dict):
            return 0.0
        right = sum(1 for k, v in ans["pairs"].items() if response.get(k) == v)
        if right == len(ans["pairs"]):
            return 1.0
        own = ans.get("partial")  # the teacher can override the exam's setting for this question
        if own == "per_pair":
            partial = True
        elif own == "all":
            partial = False
        return right / len(ans["pairs"]) if partial else 0.0

    if qtype == "fill_blank":
        cs, ip = bool(ans.get("case_sensitive")), bool(ans.get("ignore_punct"))
        text = _norm(response, cs, ip)
        if any(text == _norm(a, cs, ip) for a in ans.get("accepted", [])):
            return 1.0
        n = ans.get("numeric")
        value = _num(response)
        if n and value is not None and abs(value - n["value"]) <= n["tolerance"] + 1e-9:
            return 1.0
        return 0.0

    if qtype == "fill_multi":
        return _fill_multi_fraction(payload, response, partial)

    if qtype == "ordering":
        if not isinstance(response, list):
            return 0.0
        correct = ans["order"]
        if response == correct:
            return 1.0
        if partial:
            same = sum(1 for a, b in zip(response, correct) if a == b)
            return same / len(correct)
        return 0.0

    return 0.0


def _fill_multi_fraction(payload, response, partial):
    """Several blanks in one passage. The response is {blank id: text}, or {blank id: word-bank id} when the words come from a bank."""
    ans = payload["answer"]
    if not isinstance(response, dict):
        return 0.0
    bank = {w["id"]: w["text"] for w in (payload.get("content") or {}).get("bank") or []}
    cs, ip = bool(ans.get("case_sensitive")), bool(ans.get("ignore_punct"))
    blanks = ans.get("blanks") or {}
    if not blanks:
        return 0.0
    right = 0
    for bid, spec in blanks.items():
        given = response.get(bid)
        if given is None or given == "":
            continue
        given = bank.get(given, given) if (payload.get("content") or {}).get("mode") == "bank" else given
        if any(_norm(given, cs, ip) == _norm(a, cs, ip) for a in spec.get("accepted", [])):
            right += 1
    if right == len(blanks):
        return 1.0
    own = ans.get("partial")  # the teacher can override the exam's setting for this question
    if own == "per_blank":
        partial = True
    elif own == "all":
        partial = False
    return right / len(blanks) if partial else 0.0


def marks_for(payload, response, *, partial, negative, negative_fraction):
    """Marks awarded for one answer. Unanswered/skipped is always 0 (never negative)."""
    base = payload["marks"]
    if response is None:
        return 0.0
    f = fraction_correct(payload, response, partial)
    if f > 0:
        return round(base * f, 2)
    if negative:
        return round(-base * negative_fraction, 2)
    return 0.0
