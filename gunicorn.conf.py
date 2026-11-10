"""gunicorn settings, read automatically when the start command is just:  gunicorn config.wsgi
Threads let one worker serve many students at once (exam answers wait mostly on the database, not the processor).
Override with environment variables on Render: WEB_CONCURRENCY (workers), GUNICORN_THREADS, GUNICORN_TIMEOUT."""
import multiprocessing
import os

worker_class = "gthread"
workers = int(os.environ.get("WEB_CONCURRENCY") or (2 * multiprocessing.cpu_count() + 1))
threads = int(os.environ.get("GUNICORN_THREADS", "4"))
timeout = int(os.environ.get("GUNICORN_TIMEOUT", "60"))
keepalive = 5
backlog = 2048  # many students arriving in the same second wait in the queue instead of being refused
worker_tmp_dir = "/dev/shm"
