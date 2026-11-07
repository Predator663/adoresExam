# Technical Documentation: Online Exams (multi-school)

> Django REST API + Next.js static web app (installable PWA) for secondary-school online exams in Tanzania.
> One deployment serves many schools; each school's data lives in its own PostgreSQL schema.
> Diagrams are written in Mermaid: GitHub, GitLab, VS Code (Markdown Preview Mermaid Support) and most Markdown viewers draw them.
> Requirement codes such as `BR-03`, `EXM-04`, `RES-01` refer to the SRS v1.1 and appear in the code comments.

## Contents
1. [System overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [Repository layout](#3-repository-layout)
4. [Multi-school design (tenancy)](#4-multi-school-design-tenancy)
5. [Users, roles and authentication](#5-users-roles-and-authentication)
6. [Data model](#6-data-model)
7. [Exam lifecycle](#7-exam-lifecycle)
8. [Taking an exam: request flow](#8-taking-an-exam-request-flow)
9. [Marking, grading and result release](#9-marking-grading-and-result-release)
10. [Question bank](#10-question-bank)
11. [Gamification and practice mode](#11-gamification-and-practice-mode)
12. [Notifications, announcements and messages](#12-notifications-announcements-and-messages)
13. [Parents and SMS gateway](#13-parents-and-sms-gateway)
14. [Anti-cheat and proctoring](#14-anti-cheat-and-proctoring)
15. [Analytics and exports](#15-analytics-and-exports)
16. [Web app (frontend)](#16-web-app-frontend)
17. [PWA and offline use](#17-pwa-and-offline-use)
18. [Error handling](#18-error-handling)
19. [API reference](#19-api-reference)
20. [Configuration](#20-configuration)
21. [Deployment on Render](#21-deployment-on-render)
22. [Security](#22-security)
23. [Testing](#23-testing)
24. [Operations and troubleshooting](#24-operations-and-troubleshooting)
25. [Conventions for developers](#25-conventions-for-developers)

---

## 1. System overview

**Purpose.** Students sit timed exams on their phones; teachers build questions and exams; administrators schedule exams,
watch them live and publish results. Around the exam sit practice quizzes, XP/badges, analytics, parent SMS and anti-cheat tools.

**Main capabilities**

| Area | What it does |
|---|---|
| Exams | Scheduled exams, server-owned clock, shuffled questions and options, auto-submit, late entry, retakes, extra time, voided questions |
| Question types | Single choice, multiple choice, true/false, matching, fill in the blank, ordering |
| Results | NECTA O-Level grades and divisions, results hidden until a release time, PDF slips, report card |
| Practice | Self-marked quizzes from approved questions, XP, offline packs |
| Gamification | XP, levels, streaks with freezes, badges with tiers, leaderboard |
| Staff portals | Question bank with approval, exam builder, people management, analytics, audit log, live monitor |
| Parents | Encrypted guardian records and login details delivered by SMS through an Android phone |
| Anti-cheat | Live GPS proximity alerts, screen-leave locking, integrity flags (device change, spoofed location) |
| PWA | Installable, push notifications, offline answer queue, downloadable offline content |
| Platform | Many schools in one deployment, maintenance mode and a "God's Eye" owner console |

**Technology**

| Layer | Technology |
|---|---|
| API | Python 3.12, Django 5.1/5.2, Django REST Framework 3.15, `django-tenants` 3.7 |
| Database | PostgreSQL (required: one schema per school) |
| Cache | Redis when `REDIS_URL` is set, otherwise per-process memory |
| Web app | Next.js 14 (static export), React 18, TypeScript 5.5, no UI framework |
| Hosting | Render: Web Service (API), Static Site (web app), Cron Jobs |
| Files | PDF (ReportLab), Excel (openpyxl), images (Pillow), HTML sanitising (bleach), encryption (cryptography) |
| Push | Web Push (optional `pywebpush`, VAPID keys) |
| SMS | An Android phone running `android-sms-sender` pairs with the API |

---

## 2. Architecture

```mermaid
flowchart LR
  subgraph Clients
    S["Student phone / PWA"]
    T["Teacher and admin browser"]
    P["Android SMS phone"]
    O["Owner: Control Room"]
  end
  subgraph Render
    ST["Static Site: Next.js export"]
    API["Web Service: Django + gunicorn"]
    CR["Cron: run_scheduler every minute"]
    DB[("PostgreSQL: one schema per school")]
    RD[("Redis, optional")]
    DK[("Disk: media files")]
  end
  S -->|"HTML, JS, CSS"| ST
  T -->|"HTML, JS, CSS"| ST
  S -->|"JSON over HTTPS + X-School header"| API
  T -->|"JSON over HTTPS + X-School header"| API
  P -->|"X-Device-Token: pull and report SMS jobs"| API
  O -->|"/controlroom/ pages"| API
  API --> DB
  API --> RD
  API --> DK
  CR --> DB
```

Key ideas

* **The web app is plain static files.** It never renders on a server. It talks to the API with `fetch`, sending
  `Authorization: Token <key>` and `X-School: <the web app's own host name>`.
* **One build serves every school.** The school is chosen by the host name the web app is opened from.
* **The server owns the clock.** The phone only measures how far its clock is from the server (`lib/clock.ts`) and displays the difference.
* **Correctness never depends on cron.** `sync_exam()` runs lazily on every relevant request as well as in the scheduler.

### Request pipeline

```mermaid
flowchart TD
  R["HTTP request"] --> C["CorsMiddleware"]
  C --> SM["SchoolMiddleware: pick the PostgreSQL schema"]
  SM --> MM["MaintenanceMiddleware: 503 unless owner"]
  MM --> SEC["Security, session, auth middleware"]
  SEC --> AUTH["ExpiringTokenAuthentication"]
  AUTH --> PERM["Permissions: role + NotForcedPasswordChange"]
  PERM --> TH["Throttle: login scope"]
  TH --> V["View / service function"]
  V -->|"unhandled exception"| EH["friendly_exception_handler: generic JSON 500, details to log"]
  V --> RESP["JSON response"]
```

---

## 3. Repository layout

```
manage.py
config/            settings.py, urls.py, wsgi.py
schools/           School (tenant) and Domain models, tenant middleware, per-school file storage, create_school command
accounts/          User model, login, lockout, bulk student upload, credentials PDFs, temp passwords
academics/         Classes, subjects, teacher assignments, academic years, terms
questions/         Question bank, versions, images, approval workflow
exams/             Exams, attempts, answers, results, marking, grants, scheduler command
gamification/      XP, levels, streaks, badges, leaderboard, practice mode, offline practice packs
notifications/     In-app notifications, announcements, admin messages, Web Push
analytics/         Teacher dashboards, student analytics, report card, exports, PDF slips
guardians/         Parents, encrypted contacts, SMS jobs, SMS device API
proctoring/        Live location, proximity alerts, integrity flags, student relations
controlroom/       Owner console: maintenance mode, God's Eye data browser
core/              School settings, audit log, grading, i18n catalog, reports (PDF/Excel), pagination, exception handler
android-sms-sender/  Android app that sends the SMS
loadtest/          Load-testing scripts
docs/              Guides, runbooks and this document
frontend/          Next.js web app (see section 16)
```

Every Django app follows the same shape: `models.py` (data), `services.py` (business rules, no HTTP), `views.py` (DRF views that call
services), `urls.py`, `tests.py`. Pure rules with no database live in files such as `gamification/rules.py`, `analytics/calc.py`,
`core/grading.py` and `exams/marking.py` so they can be tested quickly.

---

## 4. Multi-school design (tenancy)

Each school is a row in `schools.School` (a `django-tenants` tenant) with its own PostgreSQL **schema**. Shared apps live in the `public`
schema (school list, platform admin); school apps (accounts, exams, questions, ...) are created inside every school schema.

```mermaid
flowchart TD
  REQ["Incoming request"] --> H{"X-School header?"}
  H -->|yes| D["Look up Domain by host"]
  H -->|no| T{"X-Device-Token?"}
  T -->|yes| SCH["Token starts with schema name, e.g. amani.abc..."]
  T -->|no| A{"/django-admin/ or /controlroom/ in a browser?"}
  A -->|yes| CK["?school= or 8-hour cookie"]
  A -->|no| HOST{"Host is a registered Domain?"}
  HOST -->|yes| D
  HOST -->|no| LEG{"LEGACY_SCHOOL_SCHEMA set?"}
  LEG -->|yes| SCH2["That schema"]
  LEG -->|no| PUB["public schema: platform"]
  D --> F{"Found?"}
  F -->|no| E404["404 unknown_school"]
  F -->|yes| ACT{"School active?"}
  ACT -->|no| E403["403 school_suspended"]
  ACT -->|yes| OK["SET search_path to the school's schema"]
```

* Uploaded files go to one folder per school (`schools.storage.SchoolFileSystemStorage`); the cache key function (`schools.cache.make_key`) is school-aware.
* Management commands that must run for every school use `python manage.py for_each_school <command>`.
* Create a school: `python manage.py create_school "Name" --domain exams.school.ac.tz` (prints the first logins).
* More detail: `docs/MULTI_SCHOOL.md`.

---

## 5. Users, roles and authentication

### Roles

| Role | Can do |
|---|---|
| `student` | Take exams, see own published results, practice, badges, leaderboard, notifications |
| `teacher` | Write questions for assigned subjects, build draft exams, see analytics for assigned subject and class, published results only |
| `admin` | Everything a teacher can, plus schedule and close exams, people, settings, monitor, grants, anti-cheat, parents |
| `super_admin` | Admin plus management of admin accounts |

Permission classes (`accounts/permissions.py`): `IsStudent`, `IsStaffUser` (teacher, admin, super admin), `IsAdminRole`, `IsSuperAdmin`,
`IsAnyUser`. The default permissions are `IsAuthenticated` + `NotForcedPasswordChange`.

The **platform owner** is separate: names listed in `CONTROLROOM_OWNERS` may use `/controlroom/` and keep access during maintenance.

### Login flow

```mermaid
sequenceDiagram
  participant U as User
  participant W as Web app
  participant A as API
  participant DB as Database
  U->>W: user name + password
  W->>A: POST /api/auth/login/ (X-School)
  A->>A: Throttle: 10 per minute per user name, 600 per minute per address
  A->>DB: find user in the school schema
  alt wrong password
    A->>DB: failed_logins += 1, lock 15 min after 5
    A-->>W: 400 plain message
  else locked
    A-->>W: 429 too many attempts, try again in N minutes
  else correct
    A->>DB: reset counters, create or reuse Token
    A-->>W: token + user (must_change_password flag)
  end
  W->>W: store token in localStorage
  alt must_change_password
    W->>U: /change-password/
  else
    W->>U: home
  end
```

* Tokens expire `TOKEN_TTL_HOURS` (default 12) after login (`accounts/authentication.py`).
* After **5** failed logins the account is locked for **15 minutes**; the same limit is also tracked per client in the cache.
* Students get a starting password and must change it on first login (`must_change_password`). Starting passwords are generated by
  `accounts/temp_password.py` and delivered on a PDF credentials sheet or by SMS.
* Passwords are hashed with PBKDF2-SHA256 (600,000 iterations). Old hashes upgrade on the next login.
* When the API answers 401 the web app clears the session and returns to the login page.

---

## 6. Data model

### 6.1 People and academics

```mermaid
erDiagram
  SCHOOL ||--o{ DOMAIN : "has addresses"
  USER }o--|| SCHOOLCLASS : "student belongs to"
  USER ||--o{ TEACHERASSIGNMENT : "teaches"
  SUBJECT ||--o{ TEACHERASSIGNMENT : "assigned"
  SCHOOLCLASS ||--o{ TEACHERASSIGNMENT : "for class"
  ACADEMICYEAR ||--o{ TERM : "contains"
  USER {
    string role
    string index_number
    bool must_change_password
    int failed_logins
    datetime locked_until
    string language
    string theme
    bool is_archived
  }
  SCHOOLCLASS {
    string name
    int form_level
    string stream
  }
  SUBJECT {
    string name
    string language
    bool practice_enabled
  }
```

### 6.2 Questions, exams and results

```mermaid
erDiagram
  SUBJECT ||--o{ QUESTION : "has"
  QUESTION ||--o{ QUESTIONVERSION : "history"
  EXAM }o--|| SUBJECT : "of"
  EXAM }o--o{ SCHOOLCLASS : "for classes"
  EXAM }o--o{ USER : "individual students"
  EXAM ||--o{ EXAMQUESTION : "paper"
  QUESTION ||--o{ EXAMQUESTION : "copied from"
  EXAM ||--o{ ATTEMPT : "taken as"
  USER ||--o{ ATTEMPT : "student"
  ATTEMPT ||--o{ ANSWER : "contains"
  EXAMQUESTION ||--o{ ANSWER : "answered"
  ATTEMPT ||--|| RESULT : "marked as"
  EXAM ||--o{ EXAMGRANT : "retake or extra time"
  ATTEMPT ||--o{ ATTEMPTEVENT : "left or returned"
  EXAM {
    string status
    datetime start_at
    datetime end_at
    int duration_minutes
    float pass_mark_percent
    bool shuffle_questions
    bool shuffle_options
    bool allow_skip
    bool partial_marks
    bool negative_marking
  }
  EXAMQUESTION {
    int position
    json payload
    bool voided
  }
  ATTEMPT {
    int attempt_no
    string status
    datetime started_at
    datetime deadline_at
    json order
    int current_index
    int seed
    string screen_lock
  }
  RESULT {
    float score
    float total
    float percent
    string grade
    int points
    bool passed
    json scale_snapshot
    json topic_stats
  }
```

Design decisions worth knowing

* **An exam owns a frozen copy of each question** (`ExamQuestion.payload`: type, prompt, content, answer, marks, explanation, topic). Editing the
  bank later never changes an exam already built or its results. `source` keeps the link to the bank question.
* **Correct answers never leave the server** during an exam: `Question.answer` and the payload's answer are not part of the student's question view.
* **Results keep a snapshot of the grading scale** (`scale_snapshot`, GRD-04) so changing the scale never changes old results.
* **`Attempt.order`** stores this student's question order; `seed` makes option shuffling reproducible; `current_index` is how far she has progressed.
  Exams are answered **one question at a time, in order**.
* A unique constraint stops a second attempt row for the same exam and student number, so a double tap on START returns the same attempt.

### 6.3 Platform, settings and logs

| Model | Purpose |
|---|---|
| `core.SchoolSettings` | One row per school: name, contact, result delay, late-entry minutes, grading scale, logo, rules text, anti-cheat settings, defaults |
| `core.AuditLog` | Who did what: actor, action, target, detail, time |
| `controlroom.SiteControl` | Maintenance switch, message and "back at" text |
| `controlroom.ControlEvent` | Owner actions with IP |
| `accounts.BulkUploadBatch` | Validated student rows waiting for confirmation |

### 6.4 Gamification, notifications, guardians, proctoring

```mermaid
erDiagram
  USER ||--|| PROFILE : "avatar and display name"
  USER ||--o{ XPEVENT : "ledger"
  USER ||--o{ ACTIVITYDAY : "streak days"
  USER ||--o{ BADGEAWARD : "badges"
  USER ||--o{ PRACTICESESSION : "quizzes"
  ATTEMPT ||--o| REVIEWPROGRESS : "review of wrong answers"
  USER ||--o{ NOTIFICATION : "inbox"
  USER ||--o{ PUSHSUBSCRIPTION : "devices"
  GUARDIAN ||--o{ GUARDIANLINK : "parent of"
  USER ||--o{ GUARDIANLINK : "student"
  GUARDIAN ||--o{ SMSJOB : "messages"
  SMSDEVICE ||--o{ SMSJOB : "sends"
  ATTEMPT ||--o| LIVELOCATION : "latest position"
  EXAM ||--o{ PROXIMITYALERT : "two close students"
  EXAM ||--o{ INTEGRITYFLAG : "suspicious signals"
  USER ||--o{ STUDENTRELATION : "twins, same house, same room"
  USER ||--o{ LEGALACCEPTANCE : "terms accepted"
```

---

## 7. Exam lifecycle

```mermaid
stateDiagram-v2
  [*] --> draft: teacher or admin creates
  draft --> scheduled: admin sets start and end
  scheduled --> draft: unschedule
  scheduled --> live: clock reaches start_at
  live --> closed: clock passes end_at
  closed --> published: end_at + delay passed and no attempt in progress
  published --> [*]
```

* `status` moves forward from the clock in `exams.services.sync_exam()`. It is called by the scheduler command **and lazily by requests**.
* A teacher's draft has no dates until an administrator sets them (BR-09).
* `published` means results may be shown. The release time per attempt is `max(exam.end_at, attempt.deadline_at) + result_delay_minutes` (default 5, BR-06).
* When an exam reaches `published`, students are notified (`results_ready`); a notification failure never blocks publishing.
* An administrator can **void** a question (EXM-08): it then counts for nobody and results are recomputed.

### Attempt states

```mermaid
stateDiagram-v2
  [*] --> in_progress: start
  in_progress --> submitted: student finishes or answers last question
  in_progress --> auto_submitted: deadline passes
  submitted --> [*]
  auto_submitted --> [*]
```

Staff actions on an exam (`ExamViewSet`): `bank`, `pick`, `paper`, `paper_questions`, `submit` (a teacher submits a draft for admin review), `schedule`,
`unschedule`, `close`, `void_question`, `grant` (retake or extra minutes), `monitor`, `monitor_board`.

---

## 8. Taking an exam: request flow

```mermaid
sequenceDiagram
  participant S as Student app
  participant A as API
  participant DB as Database
  S->>A: GET /api/student/exams/
  A-->>S: exam cards with state and server_time
  S->>A: POST /api/student/exams/{id}/start/
  A->>A: sync_exam, check window and late entry
  A->>DB: create Attempt (deadline, shuffled order, seed)
  A-->>S: attempt id
  loop each question
    S->>A: GET /api/attempts/{id}/
    A-->>S: question (no answer), remaining_seconds, locked flag
    S->>S: save draft + queue answer on the phone
    S->>A: POST /api/attempts/{id}/answer/ (question id + response)
    alt accepted
      A->>DB: Answer saved, current_index + 1
      A-->>S: next state
      S->>S: remove from queue
    else offline or error
      S->>S: keep in queue, retry later
    end
  end
  S->>A: POST /api/attempts/{id}/finish/
  A->>DB: finalize_attempt: mark, store Result (hidden)
  A-->>S: finished message, results time, tips
```

**Rules enforced by `exams/services.py`**

| Rule | Behaviour |
|---|---|
| Start window | Before `start_at`: `too_early`. After `start_at + late_entry_minutes`: `too_late` |
| Late starter | Deadline is `min(now + duration, end_at)`: time is lost, never added (EXM-04) |
| Resume | Starting again while an attempt is in progress returns that attempt (EDAY-06) |
| Retake | A second attempt exists only if an admin granted a retake (BR-04) |
| Extra time | Unused `ExamGrant` minutes are added to the deadline |
| Answer order | Answer must be for the current question. A repeat of an earlier one is ignored (idempotent, BR-05); anything else is `out_of_order` |
| Time | Answers are accepted until the deadline plus a short grace (`ANSWER_GRACE_SECONDS`); then `time_over` |
| Skipping | Only if `allow_skip` is on |
| Empty / huge answers | Empty is refused; longer than 5,000 characters is refused |
| Locked screen | While locked (`423 locked`) the clock keeps running; the app keeps the answer and re-sends after the unlock |
| Finishing | Idempotent; marks the attempt and stores the result, which stays hidden until its release time |

**Phone-side protection (`lib/offlineQueue.ts`).** Every answer is written to `localStorage` (a queue plus a per-question draft) before it is sent, and removed
only when the server confirms. A refresh, a dropped network or a dead battery never loses an answer; the server ignores a repeated send.

---

## 9. Marking, grading and result release

### Marking (`exams/marking.py`)

| Type | Correct when | Partial marks |
|---|---|---|
| `mcq_single` | chosen option equals the correct one | none |
| `mcq_multi` | chosen set equals the correct set | `(right - wrong) / correct count`, never below 0 |
| `true_false` | boolean (or the text "true" / "false") matches | none |
| `matching` | every pair matches | fraction of pairs right |
| `fill_blank` | text equals an accepted answer (case and spaces ignored) or a number within tolerance | none |
| `ordering` | exact order | fraction of items in the right position |

Per exam: `partial_marks` (default on), `negative_marking` with `negative_fraction` (default 0.25 of a question's marks, off by default).
Scores never go below zero.

### Grading (`core/grading.py`, NECTA O-Level)

| Grade | Percent | Points |
|---|---|---|
| A | 75 to 100 | 1 |
| B | 65 to 74 | 2 |
| C | 45 to 64 | 3 |
| D | 30 to 44 | 4 |
| F | 0 to 29 | 5 |

Divisions use the best seven subjects (sum of points, lower is better): I = 7 to 17, II = 18 to 21, III = 22 to 25, IV = 26 to 33, 0 = 34 and above.
Percent is rounded half-up to a whole mark before the grade is looked up. The scale is editable data (`SchoolSettings.grade_scale`, validated by `validate_scale`).

### From submission to a visible result

```mermaid
flowchart TD
  A["Student submits or time runs out"] --> B["finalize_attempt: lock row, set status"]
  B --> C["compute_result: mark every answer, topic stats, grade, points"]
  C --> D["Result stored, hidden"]
  D --> E{"now >= max(end_at, deadline_at) + delay ?"}
  E -->|no| W["Student sees: results at HH:MM"]
  E -->|yes| V["Result visible: score, grade, slip, review"]
  V --> R["Review of wrong answers after release (QB-06)"]
  C --> G["Scheduler: reward_pending gives XP, streak, badges (BR-10)"]
```

Rewards never change marks (BR-10).

---

## 10. Question bank

```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> submitted: teacher submits
  submitted --> approved: admin approves
  submitted --> draft: admin rejects
  approved --> archived
```

* `question_approval_required` in school settings (QB-09) controls whether approval is needed.
* Every edit stores a `QuestionVersion` snapshot; `version` counts edits.
* The prompt is sanitised rich text (`core/sanitize.py`, bleach). Pictures are uploaded through `POST /api/question-images/` and **must have alt text** (QB-03).
* `practice_eligible` marks a question as usable in practice mode (new questions default to eligible; see section 11).
* The `content` field holds options, left/right lists or ordering items **without answers**; `answer` holds the correct answer(s).

---

## 11. Gamification and practice mode

### XP (`gamification/rules.py`, editable by an admin)

| Event | XP |
|---|---|
| Submit an exam | 50 |
| Finish before time runs out | 10 |
| Score | 1 per percent, up to 100 |
| Beat your previous score in the subject | 30 |
| Perfect score | 100 |
| Review your wrong answers (per exam) | 10 |
| Complete a practice quiz | 20 (up to 5 quizzes a day earn XP) |
| Streak milestones 3 / 7 / 14 / 30 days | 15 / 50 / 100 / 250 |

Levels: Beginner 0, Learner 200, Achiever 500, Scholar 1000, Star 2000, Champion 3500, Genius 5000 (Swahili names included).

**Streaks.** A day counts when the student finishes a practice quiz of 5 or more questions, sits an exam or reviews results. Days follow East Africa Time.
Each student has 2 streak freezes per month (configurable). **Badges** come in bronze, silver and gold tiers (for example First Steps, Perfect Score, Comeback Kid,
Steady Pace, Always On Time, All-Rounder, Practice Champion).

`gamification.services.reward_pending()` (called by the scheduler) processes published results exactly once per student and exam (`ExamRewardMark`), so XP is never double-counted.
The leaderboard is off by default (`leaderboard_enabled`) and each student can hide herself.

### Practice mode

```mermaid
flowchart TD
  P["GET /api/practice/subjects/"] --> L["Per subject: available_questions, can_start, reason"]
  L --> S["POST /api/practice/start/ (subject, count)"]
  S --> Q["practice_pool picks questions"]
  Q --> A["POST /api/practice/{id}/answer/"]
  A --> M["Server marks, returns correct answer and explanation"]
  M --> D{"All answered?"}
  D -->|no| A
  D -->|yes| X["Score, XP if under the daily limit"]
```

**Which questions are offered (`practice_pool`)**

1. Question is **approved** and **practice eligible**.
2. It is **never** a question that sits in an exam whose results are not published yet (so no exam is spoiled).
3. Student's own form first. If her form has fewer than 5 questions, questions from **lower** forms top it up; never from a higher form.
4. At least 5 questions are needed to start (`PRACTICE_MIN`). When a subject cannot start, the list says why: `none`, `not_shared`, `in_exams` or `few`.

Teachers can allow or stop a whole subject at once (`POST /api/practice/mark-eligible/` with `subject_id`) from the question bank.

### Offline practice packs

`GET /api/practice/pack/{subject_id}/` returns up to 60 questions **with answers and explanations** so the phone can mark quizzes without signal.
The phone asks in batches (`?limit=0` for the heading, then `?seed=..&offset=..&limit=10`) so a progress bar shows real progress; the same seed always picks the same questions.
Packs expire after 14 days. Offline quizzes never earn XP or streak days, and nothing is sent to the server.

---

## 12. Notifications, announcements and messages

| Feature | Notes |
|---|---|
| Notifications | In-app inbox (`Notification`); kinds: `exam_reminder`, `exam_start`, `results_ready`, `password_changed`, `announcement` |
| Reminders | Created by the scheduler: one 24 hours to 1 hour before the exam, one in the last hour (a student who logs in late gets only the latest), plus a start notice. Also ensured when a student opens the app (`ensure_for_student`), so a missed cron run is harmless |
| Announcements | Admin writes to all, a class, a form or chosen people; one `Notification` per recipient |
| Admin messages | A short private message to one person that appears as a banner until dismissed |
| Web Push | Optional: `PushSubscription` + VAPID keys + `pywebpush`; notifications also push when a subscription exists |

Messages are translated per user (English or Swahili) through `core/i18n.py` (`t(key, lang, **params)`); the web app has its own dictionary in `lib/i18n.ts`.

---

## 13. Parents and SMS gateway

Purpose: send each parent the student's login details (and custom messages) by SMS, using an Android phone with a normal SIM, with no SMS provider fees.

```mermaid
sequenceDiagram
  participant AD as Administrator
  participant API as API
  participant PH as Android SMS phone
  AD->>API: upload parents file (Excel/CSV)
  API->>API: validate, normalise phones, link to students
  AD->>API: POST /api/guardians/send/ (choose parents, optional note)
  API->>API: new starting password per student, build SMS, store SmsJob (encrypted)
  loop every few seconds
    PH->>API: POST /api/sms/pull/ (X-Device-Token)
    API-->>PH: next queued job (leased)
    PH->>PH: send SMS through the SIM
    PH->>API: POST /api/sms/report/ (sent / failed)
    API->>API: erase password text from the job
  end
```

* **Encryption.** Guardian name and phone are encrypted at rest (`name_enc`, `phone_enc`) with a key derived from `GUARDIAN_KEY`; `phone_idx` is a keyed hash used only to detect duplicates. Showing a full phone number is a separate, audited "reveal" action.
* **Passwords are never kept.** The job body that holds a password is erased as soon as the SMS is sent.
* **Pacing** (`SmsConfig`): seconds between messages (default 8) and a pause after every N messages (default 30, pause 180 s) to avoid network blocking.
* **Devices.** Each phone has a token (`token_hash` stored, token starts with the school's schema name, so the phone needs no `X-School` header). Jobs are leased (`leased_until`) and retried.
* Details: `docs/PARENTS_SMS.md`.

---

## 14. Anti-cheat and proctoring

Everything here is **information for a person to review**; the Terms and Privacy policy say alerts are not proof of cheating. Students accept the policy before an exam (`LegalAcceptance`, version `LEGAL_VERSION`).

```mermaid
flowchart TD
  PH["Student phone"] -->|"POST /api/attempts/{id}/location/ about every few seconds"| RS["report_location"]
  RS --> SP["spoof checks: teleport, frozen, perfect accuracy, rounded coordinates"]
  RS --> MV["moving or still"]
  RS --> PX["proximity: any two students closer than the alert distance"]
  RS --> DV["device change or login during the exam"]
  SP --> FL["IntegrityFlag per attempt and kind"]
  DV --> FL
  PX --> AL["ProximityAlert"]
  AL -->|"proximity_lock_enabled"| LK["lock both screens until an admin unlocks"]
  EV["left_screen / returned events"] --> CNT["count of leaves"]
  CNT -->|"over leave_lock_limit"| LK2["lock the student's exam screen"]
  FL --> BOARD["Admin: Live monitor, Anti-cheat tab"]
  AL --> BOARD
```

| Setting (`SchoolSettings`) | Default | Meaning |
|---|---|---|
| `proximity_alert_meters` | 20 | Distance under which two students raise an alert |
| `proximity_lock_enabled` | off | Also lock both students' screens until an admin unlocks |
| `leave_lock_enabled` | on | Lock a student's exam after she leaves the exam screen too many times |
| `leave_lock_limit` | 3 | How many times she may leave before the next time locks |

Environment: `PROCTORING_ENABLED` (default on), `LOCATION_STALE_SECONDS` (45), `LOCATION_MAX_ACCURACY` (100 m), `PROXIMITY_CLEAR_SECONDS` (60).
`StudentRelation` (twins, same house, same room) lets staff mark pairs who are expected to be close, so they are not alerted. Locations are purged daily (`purge_locations`).
No map tiles load from other sites: positions are drawn on a plan view so student locations stay on the school's server.

---

## 15. Analytics and exports

* **Teacher:** subject dashboard, student list and profile, per-question analysis, topic heat map, flags (`needs support`, `top performer`). Scoped to the teacher's assigned subjects and classes and to **published** results only.
* **Student:** own analytics, report card (best seven subjects, projected division), PDF result slip after publication.
* **Admin:** school-wide analytics, exam results and student exports (Excel), credential sheets (PDF).
* Maths lives in `analytics/calc.py` with no Django imports. Thresholds: latest score below 30 or average of the last three below 45 means needs support; average of the last three at 75 or above means top performer; three falling scores losing 10 points or more also flags support. A retake replaces the first attempt in analytics.
* Exports: `?file=pdf` or `?file=xlsx` on the relevant endpoint (`core/reports.py`).

---

## 16. Web app (frontend)

Next.js 14 with `output: "export"`: `npm run build` writes plain files to `frontend/out`. `trailingSlash: true` keeps URLs identical in development and production.

### Routes (`frontend/app`)

| Area | Routes |
|---|---|
| Public | `/login`, `/about`, `/privacy`, `/terms`, `/accessibility`, `/install`, `/demo` |
| Student | `/` (home), `/exam`, `/results`, `/result`, `/review`, `/practice`, `/progress`, `/badges`, `/leaderboard`, `/notifications`, `/messages`, `/settings`, `/change-password` |
| Staff | `/staff` (overview), `/staff/questions`, `/staff/exams`, `/staff/people`, `/staff/school`, `/staff/settings`, `/staff/analytics`, `/staff/monitor`, `/staff/guardians`, `/staff/messages`, `/staff/audit` |

### Key modules (`frontend/lib`, `frontend/components`)

| File | Role |
|---|---|
| `lib/api.ts` | Single `api()` function: adds token and `X-School`, turns errors into plain messages (`friendly`), falls back to saved offline copies, fires `amani:unauthorized`, `amani:maintenance` and `amani:must-change-password` events |
| `lib/session.tsx` | Login state, user, preferences (language, theme, text size...), translation function `t()`, logout (also clears offline data) |
| `lib/i18n.ts` | English and Swahili dictionaries (both must have the same keys) |
| `lib/clock.ts` | Server-time offset, countdown formatting, East Africa Time dates |
| `lib/offlineQueue.ts` | Answer queue and drafts during an exam |
| `lib/offline.ts`, `lib/offlineStore.ts` | Offline downloads with true progress, saved copies (section 17) |
| `lib/marking.ts` | Phone-side marker for offline practice, identical rules to `exams/marking.py` |
| `lib/proctor.ts`, `components/AntiCheat.tsx` | Location reporting, leave detection, admin anti-cheat board |
| `components/Shell.tsx` | Page frame: top bar, navigation, bottom bar on phones |
| `components/QuestionView.tsx`, `lib/answers.ts` | Rendering and describing the six question types |
| `components/MaintenanceGate.tsx` | Shows the maintenance screen when the API answers 503 `maintenance` |

### Accessibility and personalisation

Per-user settings stored on the account and mirrored locally: language (English or Swahili), theme (light, dark, high contrast, Modern Warfare III), text size 100 to 200 percent, line spacing, dyslexia-friendly font,
reduced motion and read-aloud (`components/Listen.tsx`). Large touch targets and `role` / `aria` attributes are used throughout.

### Footer and credits

`lib/site.ts` holds the operator and partner credits (`OPERATORS`), version and year; the footer (`components/Footer.tsx`) and About page read from it.

---

## 17. PWA and offline use

* `public/manifest.webmanifest` + icons make the app installable (`/install` explains how).
* `public/sw.js` (service worker, cache `amani-v3`): pre-caches the app shell, serves pages from cache when the network fails, caches other same-origin GET files as they are used, **never caches `/api/`**, and serves saved question pictures from the API's `/media/`.
* The two offline caches `amani-offline-static` and `amani-user-data` are never deleted by a new release.

### What can be downloaded (Settings → Offline use)

| Item | Where stored | Used for |
|---|---|---|
| App files (pages, scripts, styles, icons) | `amani-offline-static` | Opening the app with no signal |
| Exam timetable and rules | `amani-user-data` | Showing the exams list offline |
| Results and answer review (latest 30) | `amani-user-data` | Reading results and reviews offline |
| Practice questions per subject | `amani-user-data` | Quizzes with no signal (marked on the phone, no XP) |

```mermaid
flowchart TD
  U["Student taps Download"] --> C{"Online and supported?"}
  C -->|no| M["Message: connect first or browser unsupported"]
  C -->|yes| F["fetch with streaming reader"]
  F --> P["Progress = bytes of the current file inside count of files, questions or results done"]
  P --> ST["Cache API put"]
  ST --> IX["Index in localStorage: date, size, count, expiry"]
  IX --> OK["Row shows: saved date and size"]
```

* **Exam questions are never downloaded in advance.** They are sent only when the exam starts; the answer queue covers dropped signal during an exam.
* **Privacy.** Saved personal data belongs to one person: it is removed on logout and when a different user signs in on the same phone. When the network fails, `api()` answers a GET from the saved copy only for that user.
* An **offline banner** appears whenever the phone has no signal.

---

## 18. Error handling

| Layer | Behaviour |
|---|---|
| API | `core/exceptions.friendly_exception_handler`: DRF errors (400, 401, 403, 404, 429) keep their normal body; any unexpected exception is logged (`amani.errors`) and answered as `{"detail": "Something went wrong on our side...", "code": "server_error"}` with status 500 |
| API error shape | `{"detail": "...", "code": "..."}` or DRF field errors. Common codes: `not_open`, `too_early`, `too_late`, `already_taken`, `empty`, `submitted`, `time_over`, `out_of_order`, `locked`, `maintenance`, `password_change_required`, `unknown_school`, `school_suspended` |
| Web app | `api()` never shows server addresses, status codes or stack traces: no connection → "Cannot connect right now..."; 5xx → "Something went wrong on our side..."; unreadable or technical messages become a generic line (English or Swahili). Details go to the browser console |
| Screen crash | `app/error.tsx` shows a plain message with Try again and Home |
| Login diagnostics | The "Test connection" tool (server addresses, settings) is shown only with `npm run dev` or `?debug=1` |

---

## 19. API reference

All endpoints are under `/api/`, JSON, trailing slash required. Send `Authorization: Token <key>` and `X-School: <host>`. Lists accept `?page=` and `?page_size=`;
without `?page=` a plain array is returned (`core/pagination.OptionalPagination`).

### Authentication and accounts (`accounts`)

| Method and path | Who | Purpose |
|---|---|---|
| `POST auth/login/` | anyone (throttled) | Log in, returns token and user |
| `POST auth/logout/` | any user | Delete the token |
| `POST auth/change-password/` | any user | Change password (allowed during forced change) |
| `GET/PATCH me/` | any user | Profile and preferences |
| `students/`, `teachers/`, `admins/` (router) | staff | CRUD; actions `restore`, `reset_password`, `activate`, `deactivate`, `graduate`, `move` |
| `POST students/bulk-action/` | admin | Bulk archive, move, reset |
| `GET students/credentials/?class=` | admin | PDF of starting logins |
| `GET students/bulk-upload/template/` | admin | Excel template |
| `POST students/bulk-upload/validate/` | admin | Validate an upload |
| `POST students/bulk-upload/{id}/confirm/` | admin | Create the accounts |
| `GET students/bulk-upload/{id}/credentials/` | admin | PDF for that batch |

### Academics (`academics`, router)

`classes/`, `subjects/`, `assignments/`, `academic-years/`, `terms/`

### Questions (`questions`)

| Path | Purpose |
|---|---|
| `questions/` (router) | CRUD; actions `submit`, `approve`, `reject` |
| `POST question-images/` | Upload an image with alt text |

### Exams (`exams`)

| Method and path | Who | Purpose |
|---|---|---|
| `exams/` (router) | staff | CRUD plus actions in section 7 |
| `GET overview/` | staff | Dashboard numbers |
| `GET student/exams/` | student | Exams available to me with state |
| `POST student/exams/{id}/start/` | student | Start or resume |
| `GET attempts/{id}/` | student | Current question and clock |
| `POST attempts/{id}/answer/` | student | Save an answer (or skip) |
| `POST attempts/{id}/finish/` | student | Submit |
| `POST attempts/{id}/event/` | student | `left_screen` / `returned` |
| `GET results/`, `results/pending/` | student | My results / results not yet released |
| `GET results/{attempt}/`, `results/{attempt}/review/` | student | Detail and review of wrong answers |

### Core, notifications (`core`, `notifications`)

| Path | Purpose |
|---|---|
| `GET branding/` | School name, logo, defaults (public) |
| `GET/PATCH settings/`, `settings/logo/` | School settings (admin) |
| `GET audit-log/` | Audit entries (admin) |
| `GET i18n/{lang}/` | Server message catalog |
| `GET/POST presence/` | Student heartbeat (about every 30 s); returns only the number of students online |
| `GET notifications/`, `POST notifications/read/` | Inbox |
| `push/public-key/`, `push/subscribe/`, `push/unsubscribe/` | Web Push |
| `announcements/`, `messages/`, `messages/{id}/dismiss/`, `admin/messages/` | Announcements and private messages |
| `GET /api/site-status/` (root) | Maintenance status (public) |

### Analytics (`analytics`)

`analytics/subjects/`, `analytics/subjects/{id}/`, `.../students/`, `.../students/{student}/`, `.../heatmap/`, `.../export/`, `analytics/exams/{id}/questions/`,
`analytics/exams/{id}/integrity/`, `analytics/school/`, `student/analytics/`, `student/report-card/`, `results/{attempt}/slip/`, `exports/slip/{attempt}/`,
`exports/exams/{id}/results/`, `exports/students/`

### Gamification and practice (`gamification`)

`gamification/me/`, `gamification/ack/`, `gamification/badges/`, `gamification/xp/`, `gamification/profile/`, `gamification/leaderboard/`, `gamification/catalog/`,
`gamification/settings/`, `results/{attempt}/review/seen/`, `practice/subjects/`, `practice/start/`, `practice/pack/{subject}/`, `practice/{session}/`,
`practice/{session}/answer/`, `practice/subjects/{id}/toggle/`, `practice/mark-eligible/`

### Parents and SMS (`guardians`)

`guardians/`, `guardians/summary/`, `guardians/template/`, `guardians/upload/`, `guardians/send/`, `guardians/jobs/`, `guardians/jobs/retry/`, `guardians/jobs/{id}/retry/`,
`guardians/jobs/cancel-queued/`, `guardians/devices/`, `guardians/devices/{id}/`, `guardians/config/`, `guardians/{id}/`, `guardians/{id}/reveal/`, `guardians/{id}/links/`;
phone side: `sms/ping/`, `sms/pull/`, `sms/report/` (header `X-Device-Token`)

### Proctoring (`proctoring`)

`proctoring/config/`, `attempts/{id}/location/`, `proctoring/exams/{id}/`, `proctoring/place/`, `proctoring/alerts/{id}/ack/`, `proctoring/alerts/{id}/unlock/`,
`proctoring/flags/{id}/ack/`, `proctoring/relations/`, `proctoring/relations/{id}/`, `proctoring/exams/{id}/unlock-all/`, `proctoring/attempts/{id}/lock/`,
`proctoring/attempts/{id}/unlock/`, `proctoring/guardians/{id}/reveal-phone/`

### Owner (`/controlroom/`, browser pages)

Home, maintenance on/off, God's Eye (`eye/`, `eye/data/`, `eye/tables/`) for reading tables across schools.

---

## 20. Configuration

### Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `DJANGO_SECRET_KEY` | Signing key | required in production |
| `DJANGO_DEBUG` | `1` = debug | `0` (auto `1` under `runserver`) |
| `DJANGO_ALLOWED_HOSTS` | API host names, comma separated, no `https://` | `localhost,127.0.0.1` |
| `DJANGO_CSRF_ORIGINS` | `https://` addresses for CSRF | empty |
| `DJANGO_SSL_REDIRECT` | `0` to disable the https redirect locally | `1` in production |
| `DATABASE_URL` | PostgreSQL URL | required |
| `REDIS_URL` | Shared cache (recommended with several workers) | memory cache |
| `CORS_ORIGINS` | Extra web app origins (school domains are allowed automatically) | empty |
| `CONTROLROOM_OWNERS` | User names allowed into the Control Room | empty |
| `GUARDIAN_KEY` | Encryption secret for parents' data (**back it up; losing it makes the data unreadable**) | empty |
| `MEDIA_ROOT` | Where uploads are stored (use the persistent disk) | `./media` |
| `TOKEN_TTL_HOURS` | Login lifetime | `12` |
| `LOGIN_USER_THROTTLE_RATE` | Login limit per user name | `10/min` |
| `LOGIN_IP_THROTTLE_RATE` | Login limit per internet address (a school shares one; old name `LOGIN_THROTTLE_RATE` also works) | `600/min` |
| `NUM_PROXIES` | Reverse proxies in front of Django | `1` in production |
| `LEGACY_SCHOOL_SCHEMA` | Schema for old clients that send no school clue | empty |
| `PROCTORING_ENABLED`, `LOCATION_STALE_SECONDS`, `LOCATION_MAX_ACCURACY`, `PROXIMITY_CLEAR_SECONDS` | Anti-cheat tuning | see section 14 |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT_EMAIL` | Web Push | empty |
| `GEOCODER_USER_AGENT` | Contact string for place lookups | empty |
| `NEXT_PUBLIC_API_URL` | Web app: API address (set **before** building) | `http://localhost:8000` |
| `NEXT_PUBLIC_SCHOOL_HOST` | Web app: force a school host when testing | the page's host |
| `BACKEND_URL` | `npm run dev`: where Django runs | `http://127.0.0.1:8000` |

### Per-school settings (Staff → Settings → School)

School name, short name, contact, result delay, late-entry minutes, question approval, class position, leaderboard, grading scale, logo, default rules, theme, language, anti-cheat options.
Gamification values are edited under Settings → Gamification.

---

## 21. Deployment on Render

```mermaid
flowchart LR
  GH["GitHub repository"] --> B1["Build API: pip install, collectstatic"]
  GH --> B2["Build web app: npm ci, npm run build"]
  B1 --> PRE["Pre-deploy: migrate_schemas"]
  PRE --> RUN["gunicorn config.wsgi --workers 3 --timeout 60"]
  B2 --> OUT["Publish directory: frontend/out"]
  RUN --> HC["Health check: /healthz"]
  CRON1["Cron every minute: for_each_school run_scheduler"] --> DB[("PostgreSQL")]
  CRON2["Cron daily: for_each_school purge_locations"] --> DB
  RUN --> DB
```

Steps (full text in `docs/DEPLOY_RENDER.md`)

1. Create PostgreSQL (1 GB). Copy the internal database URL.
2. Create the Web Service (root directory empty). Build `pip install -r requirements.txt && python manage.py collectstatic --noinput`; pre-deploy `python manage.py migrate_schemas`; start `gunicorn config.wsgi --workers 3 --timeout 60`; health check `/healthz`; add a disk at `/var/data` and set `MEDIA_ROOT=/var/data/media`; set the environment variables above.
3. Create the Static Site: root `frontend`, build `npm ci && npm run build`, publish `out`, env `NEXT_PUBLIC_API_URL`. Add each school's address as a custom domain.
4. Create the two cron jobs (same repository and variables).
5. In the API shell: `python manage.py createsuperuser`, then `python manage.py create_school "School" --domain <web app address>`, then `python manage.py for_each_school golive_check`.
6. Apply the security headers in `frontend/public/_headers` (Settings → Headers on Render), replacing `api.example.com` with your API address.

**Caveats:** Render's normal disk is wiped on deploy: mount a persistent disk (or use object storage) for uploaded images and logos. Never use SQLite for exams (the load test saw "database locked" errors at 25 students; PostgreSQL had none).
Login is the heaviest request (password hashing, about 0.2 s of processor time): for hundreds of students logging in the same minute use 4 or more cores, or ask students to log in before the exam (the token stays valid).

### Local development

```
:: terminal 1 (API)
venv\Scripts\activate
pip install -r requirements.txt
set DATABASE_URL=postgres://postgres:PASSWORD@localhost:5432/amani_exams
python manage.py migrate_schemas
python manage.py createsuperuser
python manage.py create_school "Dev School" --domain localhost
python manage.py runserver

:: terminal 2 (web app)
cd frontend
npm install
npm run dev
```

---

## 22. Security

| Topic | Measure |
|---|---|
| Authentication | Expiring tokens (12 h), lockout after 5 failures, login throttling, forced first password change, PBKDF2 600k |
| Authorisation | Role permission classes; teachers limited to assigned subjects and classes; students can only reach their own attempts and results |
| Exam integrity | Server clock, answers never sent to the phone during the exam, one question at a time, idempotent answer saving, anti-cheat flags |
| Data separation | One PostgreSQL schema per school, per-school media folders, school-aware cache keys |
| Sensitive data | Guardian contacts encrypted at rest, passwords erased from SMS jobs after sending, phone reveal is audited |
| Input | Rich text sanitised with bleach, images need alt text and are validated by Pillow, answer length limited |
| Transport | HTTPS redirect, HSTS (1 year), secure cookies, `X-Frame-Options: DENY`, `nosniff`, same-origin referrer policy |
| Web app | Content Security Policy and permissions policy in `_headers` |
| Audit | `AuditLog` for sensitive actions; `ControlEvent` for owner actions |
| Errors | No stack traces, file names or server addresses reach users (section 18) |
| Privacy | Student locations purged daily; legal acceptance recorded per exam with the policy version |

---

## 23. Testing

```
python manage.py test                                   :: whole backend suite
python manage.py test gamification                      :: one app
set PYTHONPATH=. && python -m unittest gamification.test_rules   :: pure rules, no database
python manage.py makemigrations --check --dry-run       :: should say: No changes detected
cd frontend && npm run typecheck && npm run build
```

* The suite runs against PostgreSQL schemas through `django-tenants`; a fast password hasher is used under test.
* `loadtest/` and `python manage.py seed_loadtest` create many students for a load test on your own server.
* `python manage.py for_each_school golive_check` checks a school is ready for go-live.
* Pilot and sign-off documents: `docs/PILOT_RUNBOOK.md`, `docs/pilot_and_golive.md`, `docs/SRS_SECTION10_SIGNOFF.md`.

---

## 24. Operations and troubleshooting

### Management commands

| Command | Purpose |
|---|---|
| `migrate_schemas [--shared]` | Create or upgrade the platform and every school's tables |
| `create_school "Name" --domain host` | Create a school and print its logins |
| `list_schools`, `adopt_existing_school` | List schools / move an existing single-school database into a school |
| `for_each_school <command>` | Run any command in every school |
| `run_scheduler [--loop N]` | Advance exam states, auto-submit, notifications, rewards |
| `purge_locations` | Delete old student locations |
| `golive_check` | Pre-flight checks |
| `rotate_initial_passwords` | Reissue starting passwords |
| `maintenance on/off` | Maintenance mode from the command line |
| `seed_loadtest` | Generate load-test users |

### Common problems

| Symptom | Likely cause and fix |
|---|---|
| `No module named 'django_tenants'` | Dependencies not installed: `pip install -r requirements.txt` |
| Login says it cannot connect | API not running, wrong `NEXT_PUBLIC_API_URL` (rebuild after changing), school host not registered (`unknown_school`), or CORS: add the origin or register the domain |
| 404 `unknown_school` | The address is not a registered school Domain: `create_school --domain ...` or add it in the platform admin |
| 403 `school_suspended` | School `is_active` is off |
| Everything shows "maintenance" | Control Room maintenance is on; turn it off |
| Results not appearing | Release time not reached (end time + delay) or an attempt is still in progress; the scheduler or any request advances it |
| Practice shows no questions | Questions not approved or not practice-eligible, held back for an unpublished exam, or fewer than 5 for the form: use the question bank's "Allow practice" button |
| Uploaded images vanish after deploy | `MEDIA_ROOT` is not on the persistent disk |
| Parents' data unreadable | `GUARDIAN_KEY` changed or lost |
| SQLite "database locked" | SQLite must never be used; use PostgreSQL |
| New release not showing on phones | Service worker cache: hard refresh once; `sw.js` version is `amani-v3` |

### Logs

Server errors are logged under `amani.errors` (unhandled exceptions) and per module loggers. Check the Render service logs first; the web app shows users only plain messages.

---

## 25. Conventions for developers

* **Business rules go in `services.py`** (or a pure-rules module), views stay thin. A new rule needs a test.
* **Never trust the phone.** Marks, time, ordering and visibility are decided on the server.
* **Rewards never change marks** (BR-10). **Results are hidden until their release time** (BR-06).
* **Idempotency.** Anything a phone may send twice (answers, finishing, starting) must be safe to repeat.
* **Migrations:** every model change needs `makemigrations`; commit the files; deploy runs `migrate_schemas`.
* **i18n:** add every new web app string to both `en` and `sw` in `lib/i18n.ts`, and every new server message to `core/i18n.py` in both languages.
* **Errors shown to people** must be plain sentences. Put technical detail in the log or the console, never in the response or on screen.
* **Line endings:** some files (for example `Footer.tsx`, `api.ts`, `i18n.ts`, `settings.py`) use Windows line endings; keep each file's style when editing.
* **Static export limits:** pages must work without a Node server (no server components needing request data, no API routes).
* **Dates** are stored in UTC and displayed in East Africa Time (`Africa/Dar_es_Salaam`).
