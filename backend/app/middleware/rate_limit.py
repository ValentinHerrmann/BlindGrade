"""slowapi rate limiting setup."""
from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address

# Shared limiter instance — imported by routers that need rate limiting.
# In production, configure a Redis backend via REDIS_URL env var by passing
# storage_uri to Limiter. In dev/test, the default in-memory backend is used.
limiter = Limiter(key_func=get_remote_address)
