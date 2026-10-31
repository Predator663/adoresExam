# Many schools, one database

Every school gets its **own PostgreSQL schema** (its own set of tables) inside the same database. Users, classes, exams, results,
parents, SMS devices and uploaded images of one school are physically separate from every other school. The platform itself (the list of
schools and their web addresses) lives in the `public` schema.

```
Render PostgreSQL  ->  schema public   : schools, domains (the platform)
                       schema amani    : Amani's users, exams, results ...
                       schema kilimo   : Kilimo's users, exams, results ...
Render API service (one)  <--  Static site (one build, many custom domains)
```

## How a request finds its school
1. The web app sends its own address in every call: header `X-School: exams.kilimo.ac.tz` (done in `frontend/lib/api.ts`).
2. The API looks that address up in **Platform admin > Schools > Domains** and switches to that school's schema.
3. Unknown address -> `404 unknown_school`. A suspended school (untick *Active*) -> `403 school_suspended`.
4. The SMS phone cannot send that header, so its device token starts with the school: `kilimo.Xy12...` (new pairings do this).
5. Uploaded files: `/media/<school>/...` (one folder per school, random file names).
6. Cache keys, login lock-outs, throttles and the maintenance switch are per school too.

## Move the existing Amani database (one time)
Do it in a quiet hour. Downtime: from the API deploy until step 5 (a few minutes).

1. **Back up.** Render > the database > Backups (or `pg_dump`). Write down where the backup is.
2. In the API service set `LEGACY_SCHOOL_SCHEMA=amani` (keeps the OLD web app and the already paired SMS phone working until you rebuild them),
   keep `CONTROLROOM_OWNERS`, and change the **Pre-deploy command** to `python manage.py migrate_schemas`.
   Set the health check path to `/healthz`.
3. Push this code and let Render deploy. (This only adds the `schools` tables; your data is untouched.)
4. API service > Shell, look first, then do it:
   ```
   python manage.py adopt_existing_school "Amani Girls Secondary School" --domain amaniexams-1.onrender.com
   python manage.py adopt_existing_school "Amani Girls Secondary School" --domain amaniexams-1.onrender.com --yes
   ```
   Use the real address of your static site (and add `--domain` again for a custom domain). The first command only reports.
   Add `--logo frontend/public/logo.png` to the second command: the web app no longer ships Amani's crest as a file, each school's logo
   now comes from its own settings.
   The second moves all tables to schema `amani` in ONE transaction (all or nothing), builds the platform tables, registers the school and
   moves the uploaded files into `MEDIA_ROOT/amani/`.
5. Open the web app and log in: everything is as before, except that the logo and the name come from Staff > Settings (see "Name and logo
   of each school" below) and Amani's contact e-mail/phone/address, which used to be written in the code, must be typed there once. Create the platform login (the platform admin, not a school):
   `python manage.py createsuperuser` (use your owner name from `CONTROLROOM_OWNERS`).
6. Change the **cron jobs** (they must visit every school):
   - every minute: `python manage.py for_each_school run_scheduler`   (do NOT use `--loop` here)
   - daily: `python manage.py for_each_school purge_locations`
7. Rebuild the static site (it now sends `X-School`). When every web app is rebuilt and the phone is re-paired, delete `LEGACY_SCHOOL_SCHEMA`.

**If step 4 fails**, it rolls back by itself and nothing has changed (read the message, fix, run again). To undo a move that finished, restore the backup from step 1.

## Add a new school
```
python manage.py create_school "Kilimo Secondary School" --short-name Kilimo --domain exams.kilimo.ac.tz --admin-username headmaster --email info@kilimo.ac.tz --phone "+255 7xx xxx xxx" --address "Moshi, Tanzania" --logo path\to\kilimo.png
```
(`--short-name`, `--email`, `--phone`, `--address` and `--logo` are optional; everything can also be typed later in Staff > Settings.)
It builds the school's tables (about a minute), registers the address, creates the school administrator (must change the password at first
login) and the owner login, and prints the passwords once. Then in Render:
1. Static Site > Settings > Custom Domains > add `exams.kilimo.ac.tz`; at the school's DNS add the CNAME Render shows.
2. Nothing to change on the API: the address is already registered (this also lets the browser call the API from it: CORS).
3. In the school's app: Settings > School, then Parents > Phone (pair the phone: the new token starts with the school name).

Another address for the same school: Platform admin > Schools > open the school > add a Domain row.
Suspend a school: untick *Active*. Schools are never deleted from the admin on purpose.

## Name and logo of each school
Each school's identity is stored in ITS OWN settings (Staff > Settings): school name, short name, contact e-mail/phone/address, logo.
The web app asks the public call `/api/branding/` (with the `X-School` header) when it opens, so when a school opens its own domain it shows:
- its logo in the top bar, login page, footer and as the browser tab icon (until a logo is uploaded: a round badge with the first letter),
- its name on the login page, footer, About, Privacy, Terms and Accessibility pages, and as the tab title (`<Short name> Exams`),
- its own contact details on the legal pages (a blank detail is simply left out),
- its name at the start of the parents' SMS login message.
To change them, the school administrator opens Staff > Settings, edits the fields and uploads the logo (PNG/JPG, up to 5 MB). It is live at once.
Not per school yet: the **installed app** (Add to Home Screen): its name is the neutral "Exams" and its icon is still the crest files in
`frontend/public/icons`. A per-school icon needs a per-school manifest (a separate small job: ask for it when a school wants it).

## Where things are
| What | Where |
|---|---|
| Platform admin (list of schools, addresses) | `https://<api address>/django-admin/` with the platform login |
| A school's Django admin / control room | `https://<api address>/django-admin/?school=exams.kilimo.ac.tz` (log in with that school's owner login; `?school=` alone goes back to the platform) |
| Maintenance for ALL schools | platform control room `https://<api address>/controlroom/`, or `python manage.py maintenance on` |
| Maintenance for ONE school | that school's control room, or `python manage.py for_each_school --only kilimo maintenance on` |
| Any command for one school | `python manage.py tenant_command <command> --schema=kilimo` or `for_each_school --only kilimo <command>` |
| List schools | `python manage.py list_schools` |
| Backups | one database = one backup for all schools; to restore ONE school use `pg_dump --schema=kilimo` |

## Running it on your Windows computer (cmd)
SQLite no longer works (schemas are a PostgreSQL feature), also for `manage.py test`. One time:
1. Install PostgreSQL for Windows (https://www.postgresql.org/download/windows/). Remember the password you give the `postgres` user.
2. Create the database (change `17` to your version):
   ```
   "C:\Program Files\PostgreSQL\17\bin\createdb" -U postgres amani_exams
   ```
Every time you open a new cmd window (the `set` only lasts for that window):
```
cd path\to\Working_Branch
venv\Scripts\activate
pip install -r requirements.txt
set DATABASE_URL=postgres://postgres:YOURPASSWORD@localhost:5432/amani_exams
python manage.py migrate_schemas
python manage.py createsuperuser
python manage.py create_school "Dev School" --domain localhost
python manage.py runserver
```
`create_school` prints the school's logins. Then in a second window `cd frontend`, `npm run dev`, open http://localhost:3000: the web
app sends `X-School: localhost`, which is the address you registered. Opening it from your phone by IP (`http://192.168.1.10:3000`)? Either
register that address too (`--domain 192.168.1.10`) or `set NEXT_PUBLIC_SCHOOL_HOST=localhost` before `npm run dev`.
Tests: `python manage.py test` (same `set DATABASE_URL`; it creates and deletes its own `test_amani_exams` database).
If pip or startup complains about psycopg, run `pip install psycopg2-binary` and try again.

## Limits to know
- Isolation is done by PostgreSQL schemas, not by filters in the code: a missing `.filter(school=...)` cannot leak data.
- One school's heavy exam can still slow the others (they share the same server and database). Watch it before putting many schools on one instance.
- Hundreds of schools make migrations slow (each one is migrated in turn). Tens are fine.
- The same person in two schools has two separate accounts.
- God's Eye and the tables view show the school you opened (use `?school=`), not all schools together.
