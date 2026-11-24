"""Measured question difficulty: easy / medium / hard learned from how students really answer, not from what a teacher typed.

Pure Python (no Django, no numpy), so it is easy to test:   python -m unittest questions.test_calibration

1. RASCH MODEL (item response theory). Every student has an ability and every question a difficulty, both on one "logit" scale,
   and the chance of a right answer is  sigmoid(ability - difficulty).  Fitting both together matters: a hard question that only
   the strongest students were given would look easy from its raw percent-correct, but the model knows who answered it.
   Partial credit counts as a fraction. Priors (MAP) keep a question seen by a few students close to "average" instead of extreme.
2. CLASS LEVEL. The label is read for the form the question is for: the chance that an average student OF THAT FORM answers it right
   (easy >= EASY_P, hard < HARD_P, else medium). The same question is easier for Form 4 than for Form 1, and the label says so.
3. COLD START. A question nobody has answered yet gets a predicted difficulty from its wording (type, length, numbers, options,
   topic), using a ridge regression trained on the questions that were measured. It is used ONLY if, in cross-validation, it beats
   guessing "the average" by a clear margin; otherwise those questions stay unlabelled.
"""
import math

EASY_P, HARD_P = 0.72, 0.42     # expected % right for an average student of the form
MIN_RESPONSES = 8               # fewer answers than this: not enough to call it measured
MIN_STUDENT_RESPONSES = 3
SD_THETA, SD_B = 2.0, 1.5       # priors
ITERATIONS = 40
QTYPES = ["mcq_single", "mcq_multi", "true_false", "matching", "fill_blank", "fill_multi", "ordering"]


def sigmoid(x):
    return 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, x))))


def label_for(p):
    return "easy" if p >= EASY_P else "hard" if p < HARD_P else "medium"


# ---------------------------------------------------------------- Rasch

def _components(responses):
    """Students and questions that are linked by answers form one scale; separate groups cannot be compared, so each is centred alone."""
    parent = {}

    def find(x):
        while parent.setdefault(x, x) != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for s, q, _ in responses:
        parent[find(("s", s))] = find(("q", q))
    return find


def fit_rasch(responses, iterations=ITERATIONS):
    """responses: [(student, question, fraction 0..1)], one per student and question.
    Returns (theta {student: ability}, items {question: {"b", "se", "n", "p_obs", "comp"}}, comp_of_student {student: comp})."""
    by_s, by_q = {}, {}
    for s, q, f in responses:
        f = max(0.0, min(1.0, float(f)))
        by_s.setdefault(s, []).append((q, f))
        by_q.setdefault(q, []).append((s, f))
    theta = {s: 0.0 for s in by_s}
    b = {q: 0.0 for q in by_q}
    find = _components(responses)
    comp_q = {q: find(("q", q)) for q in by_q}
    comp_s = {s: find(("s", s)) for s in by_s}
    members, students_in = {}, {}
    for q, c in comp_q.items():
        members.setdefault(c, []).append(q)
    for s, c in comp_s.items():
        students_in.setdefault(c, []).append(s)
    for _ in range(iterations):
        for s, rows in by_s.items():
            g, h = -theta[s] / SD_THETA ** 2, 1.0 / SD_THETA ** 2
            for q, f in rows:
                p = sigmoid(theta[s] - b[q])
                g += f - p
                h += p * (1 - p)
            theta[s] = max(-6.0, min(6.0, theta[s] + g / h))
        for q, rows in by_q.items():
            g, h = -b[q] / SD_B ** 2, 1.0 / SD_B ** 2
            for s, f in rows:
                p = sigmoid(theta[s] - b[q])
                g += p - f
                h += p * (1 - p)
            b[q] = max(-6.0, min(6.0, b[q] + g / h))
        for c, qs in members.items():  # anchor each linked group: average question difficulty = 0
            m = sum(b[q] for q in qs) / len(qs)
            for q in qs:
                b[q] -= m
            for s in students_in.get(c, ()):
                theta[s] -= m
    items = {}
    for q, rows in by_q.items():
        info = sum(sigmoid(theta[s] - b[q]) * (1 - sigmoid(theta[s] - b[q])) for s, _ in rows) + 1.0 / SD_B ** 2
        items[q] = {"b": b[q], "se": 1.0 / math.sqrt(info), "n": len(rows), "p_obs": sum(f for _, f in rows) / len(rows), "comp": comp_q[q]}
    return theta, items, comp_s


def cohort_p(b, thetas):
    """Expected share right for a question of difficulty b among students with these abilities."""
    return sum(sigmoid(t - b) for t in thetas) / len(thetas) if thetas else None


# ---------------------------------------------------------------- cold start (wording -> difficulty)

def features(q, topic_mean=0.0):
    """q: {"qtype", "prompt", "marks", "form_level", "n_options"}. A short, honest feature list (no word lists, so it works in Swahili too)."""
    text = str(q.get("prompt") or "")
    words = len(text.split())
    digits = sum(c.isdigit() for c in text)
    ops = sum(text.count(c) for c in "+-*/=^<>%√π∑∫")
    row = [1.0, math.log1p(words), math.log1p(digits), math.log1p(ops), float(q.get("n_options") or 0) / 5.0,
           min(float(q.get("marks") or 1), 10.0) / 5.0, float(q.get("form_level") or 0) / 4.0, 1.0 if "<img" in text else 0.0, topic_mean]
    row += [1.0 if q.get("qtype") == t else 0.0 for t in QTYPES[1:]]
    return row


def _solve(a, y):
    n = len(a)
    m = [row[:] + [y[i]] for i, row in enumerate(a)]
    for c in range(n):
        piv = max(range(c, n), key=lambda r: abs(m[r][c]))
        m[c], m[piv] = m[piv], m[c]
        d = m[c][c] or 1e-12
        for r in range(n):
            if r != c:
                f = m[r][c] / d
                for k in range(c, n + 1):
                    m[r][k] -= f * m[c][k]
    return [m[i][n] / (m[i][i] or 1e-12) for i in range(n)]


def ridge(xs, ys, lam=3.0):
    k = len(xs[0])
    a = [[sum(x[i] * x[j] for x in xs) + (lam if i == j and i > 0 else 0.0) for j in range(k)] for i in range(k)]
    return _solve(a, [sum(x[i] * y for x, y in zip(xs, ys)) for i in range(k)])


def predict(w, x):
    return sum(a * b for a, b in zip(w, x))


def _topic_means(rows, exclude=None):
    """Average measured difficulty of each topic; a question never contributes to its own topic value (leave-one-out)."""
    tot = {}
    for i, r in enumerate(rows):
        if i == exclude:
            continue
        t = tot.setdefault((r["topic"] or "").strip().lower(), [0.0, 0])
        t[0] += r["b"]
        t[1] += 1
    return tot


def _topic_value(tot, topic, prior=3.0, grand=0.0):
    t = tot.get((topic or "").strip().lower(), [0.0, 0])
    return (t[0] + prior * grand) / (t[1] + prior)


def train_predictor(rows, folds=5, min_rows=40):
    """rows: measured questions [{"b", "topic", "qtype", "prompt", "marks", "form_level", "n_options"}].
    Returns {"w", "topic_tot", "grand", "mae", "baseline_mae", "n", "usable"}; usable only if it beats 'always guess the average'."""
    n = len(rows)
    if n < min_rows:
        return {"usable": False, "n": n, "reason": f"needs at least {min_rows} measured questions"}
    grand = sum(r["b"] for r in rows) / n

    order = list(range(n))
    err = base = 0.0
    for f in range(folds):
        test = [i for i in order if i % folds == f]
        train = [i for i in order if i % folds != f]
        tr_rows = [rows[j] for j in train]
        tot = _topic_means(tr_rows)
        xs = []
        for pos, j in enumerate(train):  # leave-one-out topic value for training rows so the target cannot leak in
            t = _topic_means(tr_rows, exclude=pos)
            xs.append(features(rows[j], _topic_value(t, rows[j]["topic"], grand=grand)))
        w = ridge(xs, [rows[j]["b"] for j in train])
        mean_tr = sum(rows[j]["b"] for j in train) / len(train)
        for i in test:
            x = features(rows[i], _topic_value(tot, rows[i]["topic"], grand=grand))
            err += abs(predict(w, x) - rows[i]["b"])
            base += abs(mean_tr - rows[i]["b"])
    mae, bmae = err / n, base / n
    tot = _topic_means(rows)
    xs = []
    for i in range(n):
        t = _topic_means(rows, exclude=i)
        xs.append(features(rows[i], _topic_value(t, rows[i]["topic"], grand=grand)))
    w = ridge(xs, [r["b"] for r in rows])
    return {"w": w, "topic_tot": tot, "grand": grand, "mae": mae, "baseline_mae": bmae, "n": n, "usable": mae < 0.95 * bmae}


def predict_difficulty(model, q):
    return predict(model["w"], features(q, _topic_value(model["topic_tot"], q.get("topic"), grand=model["grand"])))
