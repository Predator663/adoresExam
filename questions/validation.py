"""Server-side validation of a question before it is saved (QB-08)."""
import re
import uuid

from rest_framework.exceptions import ValidationError

from core.sanitize import clean_html

TEXT_LIMIT = 2000

# Layout choices a teacher can make on matching and fill-in-the-blank questions (shown to students, so they live in `content`).
LEFT_STYLES = ("roman", "ROMAN", "number")      # (i) (ii) (iii)  /  (I) (II)  /  (1) (2)
RIGHT_STYLES = ("LETTER", "letter", "number")   # A B C  /  a b c  /  1 2 3
FILL_WIDTHS = ("short", "medium", "long")


def _short(value, limit):
    """Plain text only (no tags) for small labels such as column titles, units and hints."""
    return re.sub(r"<[^>]+>", "", str(value or "")).strip()[:limit]


def _items(content, key, minimum, maximum=None):
    items = content.get(key)
    if not isinstance(items, list) or len(items) < minimum or (maximum and len(items) > maximum):
        rng = f"{minimum} to {maximum}" if maximum else f"at least {minimum}"
        raise ValidationError({"content": f"'{key}' needs {rng} entries."})
    out, ids = [], set()
    for it in items:
        text = clean_html(str(it.get("text", "")))[:TEXT_LIMIT]
        image = it.get("image") or None
        if not text and not image:
            raise ValidationError({"content": f"Every entry in '{key}' needs text or an image."})
        if image and not str(it.get("alt_text", "")).strip():
            raise ValidationError({"content": "Every image needs a short description (alt text)."})
        iid = str(it.get("id") or uuid.uuid4().hex[:8])
        if iid in ids:
            raise ValidationError({"content": f"Duplicate id '{iid}' in '{key}'."})
        ids.add(iid)
        out.append({"id": iid, "text": text, "image": image, "alt_text": it.get("alt_text", "")})
    return out


def validate_question(qtype, content, answer, prompt=""):
    """Return (clean_content, clean_answer) or raise ValidationError. `prompt` is needed by fill_multi (its blanks are marked in the text)."""
    content, answer = content or {}, answer or {}

    if qtype in ("mcq_single", "mcq_multi"):
        opts = _items(content, "options", 2)
        ids = {o["id"] for o in opts}
        if qtype == "mcq_single":
            c = answer.get("correct")
            if c not in ids:
                raise ValidationError({"answer": "Choose exactly one correct option."})
            return {"options": opts}, {"correct": c}
        c = answer.get("correct")
        if not isinstance(c, list) or not c or not set(c) <= ids:
            raise ValidationError({"answer": "Choose at least one correct option."})
        return {"options": opts}, {"correct": sorted(set(c))}

    if qtype == "true_false":
        if not isinstance(answer.get("correct"), bool):
            raise ValidationError({"answer": "Say whether the statement is true or false."})
        return {}, {"correct": answer["correct"]}

    if qtype == "matching":
        left, right = _items(content, "left", 2), _items(content, "right", 2)
        pairs = answer.get("pairs")
        lids, rids = {x["id"] for x in left}, {x["id"] for x in right}
        if not isinstance(pairs, dict) or set(pairs) != lids or not set(pairs.values()) <= rids:
            raise ValidationError({"answer": "Every item on the left must be matched to an item on the right."})
        lay = content.get("layout") if isinstance(content.get("layout"), dict) else {}
        layout = {
            "left_style": lay.get("left_style") if lay.get("left_style") in LEFT_STYLES else "roman",
            "right_style": lay.get("right_style") if lay.get("right_style") in RIGHT_STYLES else "LETTER",
            "left_title": _short(lay.get("left_title"), 60), "right_title": _short(lay.get("right_title"), 60),
            "shuffle_right": lay.get("shuffle_right") is not False,   # on unless the teacher switched it off
            "unique": lay.get("unique") is True,                      # each right item may be used once only
        }
        if layout["unique"] and len(set(pairs.values())) != len(pairs):
            raise ValidationError({"answer": "You chose 'each right item once only', but two left items have the same match."})
        partial = answer.get("partial") if answer.get("partial") in ("all", "per_pair") else None  # None = follow the exam's setting
        return {"left": left, "right": right, "layout": layout}, {"pairs": pairs, "partial": partial}

    if qtype == "fill_blank":
        accepted = [str(a).strip() for a in (answer.get("accepted") or []) if str(a).strip()]
        numeric = answer.get("numeric")
        if numeric is not None:
            try:
                numeric = {"value": float(numeric["value"]), "tolerance": abs(float(numeric.get("tolerance", 0)))}
            except (KeyError, TypeError, ValueError):
                raise ValidationError({"answer": "Numeric answer needs a value and a tolerance."})
        if not accepted and numeric is None:
            raise ValidationError({"answer": "Give at least one accepted answer."})
        layout = {"unit": _short(content.get("unit"), 20), "hint": _short(content.get("hint"), 120),
                  "input": "number" if content.get("input") == "number" else "text",
                  "width": content.get("width") if content.get("width") in FILL_WIDTHS else "medium"}
        return layout, {"accepted": accepted, "numeric": numeric,
                        "case_sensitive": answer.get("case_sensitive") is True, "ignore_punct": answer.get("ignore_punct") is True}

    if qtype == "fill_multi":
        return _fill_multi(content, answer, prompt)

    if qtype == "ordering":
        items = _items(content, "items", 2)  # authored in the correct order
        return {"items": items}, {"order": [i["id"] for i in items]}

    raise ValidationError({"qtype": "Unknown question type."})


def clean_prompt(prompt):
    prompt = clean_html(prompt)
    if not re.sub(r"<[^>]+>|\s", "", prompt):
        raise ValidationError({"prompt": "The question text is empty."})
    return prompt[:5000]


BLANK_TOKEN = re.compile(r"\[\[(\d{1,2})\]\]")
MAX_BLANKS, MAX_WORDS, WORD_LIMIT = 20, 12, 80
FILL_PARTIAL = ("all", "per_blank")


def _word_key(s):
    return " ".join(str(s).lower().split())


def _fill_multi(content, answer, prompt):
    """Several blanks in one passage. The prompt marks them as [[1]] [[2]] ... (the editor turns the teacher's ____ into these).
    answer.blanks = {"1": {"accepted": ["walking", "walk"]}, ...}; answer.distractors = extra wrong words for the word bank.
    content.mode "bank": students drag words into the blanks, from a bank made of the first accepted answer of every blank plus the distractors."""
    ids = BLANK_TOKEN.findall(prompt or "")
    if not ids:
        raise ValidationError({"prompt": "Mark each blank in the question text with ____ (underscores)."})
    if len(set(ids)) != len(ids):
        raise ValidationError({"prompt": "Each blank needs its own number."})
    if len(ids) > MAX_BLANKS:
        raise ValidationError({"prompt": f"Use at most {MAX_BLANKS} blanks in one question."})
    given = answer.get("blanks") if isinstance(answer.get("blanks"), dict) else {}
    blanks, allowed = {}, set()
    for n, i in enumerate(ids, 1):
        raw = given.get(i, {}).get("accepted") if isinstance(given.get(i), dict) else None
        acc, seen = [], set()
        for a in raw if isinstance(raw, list) else []:
            a = str(a).strip()[:WORD_LIMIT]
            if a and _word_key(a) not in seen:
                seen.add(_word_key(a))
                acc.append(a)
        if not acc:
            raise ValidationError({"answer": f"Blank {n} needs at least one accepted answer."})
        blanks[i] = {"accepted": acc[:10]}
        allowed |= {_word_key(a) for a in acc}
    mode = "bank" if content.get("mode") == "bank" else "type"
    extra, bank = [], []
    if mode == "bank":
        seen = set()
        for w in answer.get("distractors") or []:
            w = str(w).strip()[:WORD_LIMIT]
            if not w or _word_key(w) in seen:
                continue
            if _word_key(w) in allowed:
                raise ValidationError({"answer": f"'{w}' is an accepted answer, so it cannot also be a wrong word."})
            seen.add(_word_key(w))
            extra.append(w)
        if len(extra) > MAX_WORDS:
            raise ValidationError({"answer": f"Use at most {MAX_WORDS} extra wrong words."})
        words = [blanks[i]["accepted"][0] for i in ids] + extra
        bank = [{"id": f"w{k}", "text": w} for k, w in enumerate(words, 1)]
    partial = answer.get("partial") if answer.get("partial") in FILL_PARTIAL else None  # None = follow the exam's setting
    return ({"blanks": [{"id": i} for i in ids], "mode": mode, "bank": bank, "hint": _short(content.get("hint"), 120),
             "width": content.get("width") if content.get("width") in FILL_WIDTHS else "medium"},
            {"blanks": blanks, "distractors": extra, "case_sensitive": answer.get("case_sensitive") is True,
             "ignore_punct": answer.get("ignore_punct") is True, "partial": partial})

