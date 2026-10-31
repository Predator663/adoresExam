# Deploy on Render (one API, one database, one static web app)

1. **PostgreSQL**: New > PostgreSQL, plan 1 GB RAM. Copy its *Internal Database URL*.
2. **Web service (API)**: New > Web Service > your GitHub repo.
   - Root directory: *(empty, the repo root where manage.py is)*; Runtime: Python 3; instance: 1 CPU / 2 GB.
   - Build command: `pip install -r requirements.txt && python manage.py collectstatic --noinput`
   - Pre-deploy command: `python manage.py migrate_schemas`  (all schools; see docs/MULTI_SCHOOL.md)
   - Health check path: `/healthz`
   - Start command: `gunicorn config.wsgi --workers 3 --timeout 60`
   - Disk: add a disk, mount path `/var/data`, 1 GB or more.
   - Environment: DJANGO_SECRET_KEY, DJANGO_ALLOWED_HOSTS (api address only, no https://), DJANGO_CSRF_ORIGINS (https://api address),
     CORS_ORIGINS (optional: every school address registered in the platform is allowed automatically), DATABASE_URL, CONTROLROOM_OWNERS, GUARDIAN_KEY, MEDIA_ROOT=/var/data/media, DJANGO_DEBUG=0,
     GEOCODER_USER_AGENT or VAPID_CONTACT_EMAIL (a real contact), optional REDIS_URL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.
3. **Static site (web app)**: New > Static Site > same repo. Root directory `frontend`, build `npm ci && npm run build`, publish directory `out`,
   env NEXT_PUBLIC_API_URL=https://api address (no trailing slash). Set it BEFORE the first build. One static site serves every school:
   add each school's address under Custom Domains.
4. **Cron jobs** (same repo, same environment variables as the API except the disk):
   - every minute `* * * * *` : `python manage.py for_each_school run_scheduler`
   - daily `0 1 * * *` : `python manage.py for_each_school purge_locations`
5. After the first deploy open the API service's Shell: `python manage.py createsuperuser` (the platform login), then create the first school:
   `python manage.py create_school "School name" --domain <address of the static site>`. Run `python manage.py for_each_school golive_check`.
6. In the app: Settings > School (name, anti-cheat distance), Parents > Phone (school web address = the web app address, then pair the phone app with the API address).
