"""One-shot producer ledger and signed moderated-input permits; stdlib only."""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sqlite3
import time
import uuid
import threading
from official import MODEL_ID, MODEL_REVISION


def validate_permit(token, secret, subject, image_digest, prompt, seed, now=None):
    now = time.time() if now is None else now
    if not isinstance(secret, str) or len(secret) < 32 or not isinstance(token, str) or len(token) > 4096:
        raise ValueError("Producer authorization required")
    parts = token.split(".")
    if len(parts) != 2 or not re.fullmatch(r"[A-Za-z0-9_-]+", parts[0]) or not re.fullmatch(r"[a-f0-9]{64}", parts[1]):
        raise ValueError("Invalid permit")
    expected = hmac.new(secret.encode(), parts[0].encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, parts[1]):
        raise ValueError("Invalid signature")
    try:
        body = json.loads(base64.urlsafe_b64decode(parts[0] + "=" * (-len(parts[0]) % 4)))
        valid_id = str(uuid.UUID(body["id"])) == body["id"]
    except Exception:
        raise ValueError("Invalid permit body") from None
    if (not valid_id or body.get("modelId") != MODEL_ID or body.get("modelRevision") != MODEL_REVISION
        or not subject or body.get("subject") != subject or body.get("imageSha256") != image_digest
        or body.get("promptSha256") != hashlib.sha256(prompt.encode()).hexdigest()
        or type(body.get("seed")) is not int or body["seed"] != seed or body.get("steps") != 50
        or type(body.get("expiresAt")) is not int or not now < body["expiresAt"] <= now + 300):
        raise ValueError("Permit scope mismatch")
    return body["id"]


class JobLedger:
    def __init__(self, path):
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(path, timeout=5, check_same_thread=False)
        self.lock = threading.RLock()
        self.db.execute("CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,subject TEXT NOT NULL,status TEXT NOT NULL,file TEXT,created REAL NOT NULL)")
        self.db.commit()
        if path != ":memory:":
            os.chmod(path, 0o600)

    def reserve(self, job_id, subject):
        # Commit BEFORE entering @spaces.GPU. Reopening or a lost acknowledgement
        # cannot repeat an uncertain allocation. No credentials or media in SQLite.
        with self.lock:
            try:
                self.db.execute("INSERT INTO jobs SELECT ?,?,'reserved',NULL,? WHERE (SELECT count(*) FROM jobs)<10000", (job_id, subject, time.time()))
                if self.db.execute('SELECT changes()').fetchone()[0] != 1:
                    raise ValueError('Job capacity exhausted')
                self.db.commit()
            except sqlite3.IntegrityError:
                self.db.rollback()
                raise ValueError("Job already submitted; no automatic retry") from None

    def complete(self, job_id, subject, file):
        with self.lock:
            changed = self.db.execute("UPDATE jobs SET status='complete',file=? WHERE id=? AND subject=? AND status='reserved'", (str(file),job_id,subject)).rowcount
            self.db.commit()
        if changed != 1:
            raise ValueError("Job fence lost")

    def owns_file(self, file, subject):
        with self.lock:
            return bool(self.db.execute("SELECT 1 FROM jobs WHERE file=? AND subject=? AND status='complete' AND created>?", (str(file),subject,time.time()-900)).fetchone())

    def completed_file(self, job_id):
        with self.lock:
            row = self.db.execute("SELECT file FROM jobs WHERE id=? AND status='complete' AND created>?", (job_id,time.time()-900)).fetchone()
            return Path(row[0]) if row else None

    def prune(self, output_root):
        root = Path(output_root).resolve()
        with self.lock:
            expired = self.db.execute("SELECT id,file FROM jobs WHERE file IS NOT NULL AND created<?", (time.time()-900,)).fetchall()
            for job_id, name in expired:
                path = Path(name)
                if path.parent.resolve() == root and path.name == job_id + '.mp4' and not path.is_symlink():
                    path.unlink(missing_ok=True)
                self.db.execute('UPDATE jobs SET file=NULL WHERE id=?', (job_id,))
            # Expired permits cannot reallocate. Retain uncertain one-shot fences
            # much longer than the five-minute signed-permit validity window.
            self.db.execute('DELETE FROM jobs WHERE created<?', (time.time()-86400,))
            self.db.commit()

    def close(self):
        self.db.close()


def media_capability(job_id, expires, secret):
    return hmac.new(secret.encode(), f'video:{job_id}:{expires}'.encode(), hashlib.sha256).hexdigest()


def validate_media_capability(job_id, expires, signature, secret, now=None):
    now = time.time() if now is None else now
    try:
        valid = str(uuid.UUID(job_id)) == job_id and type(expires) is int and now < expires <= now+900
    except (ValueError, TypeError):
        valid = False
    return bool(valid and len(secret)>=32 and isinstance(signature,str) and re.fullmatch(r'[a-f0-9]{64}',signature)
        and hmac.compare_digest(media_capability(job_id,expires,secret),signature))
