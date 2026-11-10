import hashlib

from django.contrib.auth.hashers import BasePasswordHasher, PBKDF2PasswordHasher, mask_hash
from django.utils.crypto import constant_time_compare


class InitialPasswordHasher(PBKDF2PasswordHasher):
    """Lighter PBKDF2 used only for starting passwords of bulk-uploaded students.
    Never the preferred hasher, so Django upgrades it on the first successful login."""

    algorithm = "pbkdf2_sha256_initial"
    iterations = 100_000


class StrongPasswordHasher(PBKDF2PasswordHasher):
    """The preferred hasher: PBKDF2-SHA256 with 600,000 iterations (the OWASP recommendation).
    Django's own default is 1,000,000, which costs about 0.3 s of processor time per login; with hundreds of
    students logging in during the same minute that dominates the load (NFR-05). Older hashes still verify and
    are upgraded to this one automatically on the next login."""

    iterations = 600_000


class FastPasswordHasher(BasePasswordHasher):
    """Student passwords: ONE salted MD5, a few microseconds per check instead of about 0.2 s (PBKDF2 600k).
    Chosen on purpose so 500+ students can log in at the same moment (NFR-05). It is NOT safe against someone who
    steals the database, so it is used for STUDENT accounts only (see accounts/models.py). Staff keep StrongPasswordHasher."""

    algorithm = "fast_md5"

    def encode(self, password, salt, iterations=None):
        return "%s$%s$%s" % (self.algorithm, salt, hashlib.md5((salt + password).encode()).hexdigest())

    def decode(self, encoded):
        algorithm, salt, hash_ = encoded.split("$", 2)
        return {"algorithm": algorithm, "hash": hash_, "salt": salt}

    def verify(self, password, encoded):
        d = self.decode(encoded)
        return constant_time_compare(encoded, self.encode(password, d["salt"]))

    def safe_summary(self, encoded):
        d = self.decode(encoded)
        return {"algorithm": d["algorithm"], "salt": mask_hash(d["salt"], show=2), "hash": mask_hash(d["hash"])}

    def must_update(self, encoded):
        return False

    def harden_runtime(self, password, encoded):
        pass
