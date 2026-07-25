"""Server-side cryptographic helpers — Argon2id password hashing, HMAC."""
from __future__ import annotations

import hashlib
import hmac
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError

# Argon2id parameters — OWASP recommended minimums for 2024
_ph = PasswordHasher(
    time_cost=3,       # iterations
    memory_cost=65536, # 64 MB
    parallelism=4,
    hash_len=32,
    salt_len=16,
)


def hash_password(plaintext: str) -> str:
    """Return Argon2id hash of *plaintext*. Include the full encoded hash string."""
    return _ph.hash(plaintext)


def verify_password(plaintext: str, hashed: str) -> bool:
    """Return True if *plaintext* matches *hashed*. Constant-time comparison."""
    try:
        return _ph.verify(hashed, plaintext)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(hashed: str) -> bool:
    """Return True if the hash was made with outdated parameters."""
    return _ph.check_needs_rehash(hashed)


def hash_token(raw_token: str) -> str:
    """Return hex-encoded SHA-256 of *raw_token* for storage in InviteToken."""
    return hashlib.sha256(raw_token.encode()).hexdigest()


def generate_invite_token() -> str:
    """Generate a cryptographically secure URL-safe random token (32 bytes → 43 chars)."""
    return secrets.token_urlsafe(32)


def hash_ip(ip: str) -> str | None:
    """Return hex-encoded SHA-256 of *ip* for privacy-safe audit logging."""
    if not ip:
        return None
    return hashlib.sha256(ip.encode()).hexdigest()


def hmac_sha256(message: str, key: str) -> str:
    """Return hex-encoded HMAC-SHA256 of *message* keyed with *key*."""
    return hmac.new(key.encode(), message.encode(), hashlib.sha256).hexdigest()
