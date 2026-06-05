from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

ITERATIONS = 200_000
ALGO = "sha256"
SALT_BYTES = 16

SESSION_TTL = timedelta(days=60)

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(SALT_BYTES)
    dk = hashlib.pbkdf2_hmac(ALGO, password.encode("utf-8"), salt, ITERATIONS)
    return f"pbkdf2_{ALGO}${ITERATIONS}${salt.hex()}${dk.hex()}"

def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, iters, salt_hex, hash_hex = stored.split("$")
        if not scheme.startswith("pbkdf2_"):
            return False
        algo = scheme.split("_", 1)[1]
        iters = int(iters)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
        dk = hashlib.pbkdf2_hmac(algo, password.encode("utf-8"), salt, iters)
        return hmac.compare_digest(dk, expected)
    except Exception:
        return False

def new_token() -> str:
    return secrets.token_urlsafe(36)

def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

def _utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)

def session_expiry() -> str:
    return (_utcnow_naive() + SESSION_TTL).isoformat(timespec="seconds")

def is_session_valid(expires_at: str) -> bool:
    try:
        return datetime.fromisoformat(expires_at) > _utcnow_naive()
    except Exception:
        return False
