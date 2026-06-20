"""
PII scrubbing — recursively walks event dicts and masks values whose
keys or string contents match known sensitive patterns.

Returns a new dict (deep-copied). Original references stay intact.
"""

import copy
import re
from re import Pattern
from typing import Any, Optional

REDACTED = "[Filtered]"

# Default sensitive key substrings (case-insensitive).
DEFAULT_SENSITIVE_KEYS: list[str] = [
    "password",
    "passwd",
    "pwd",
    "secret",
    "token",
    "api_key",
    "apikey",
    "access_token",
    "refresh_token",
    "bearer",
    "authorization",
    "cookie",
    "set-cookie",
    "session",
    "credit_card",
    "creditcard",
    "cc_number",
    "card_number",
    "cvv",
    "cvc",
    "ssn",
    "social_security",
    "private_key",
    "client_secret",
    "signature",
]

# Default value patterns matched against string values.
_JWT_RE = re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b")
_AWS_KEY_RE = re.compile(r"\bAKIA[0-9A-Z]{16}\b")
_SSN_RE = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
_STRIPE_RE = re.compile(r"\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b")
_SLACK_RE = re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b")
_GITHUB_PAT_RE = re.compile(r"\bghp_[A-Za-z0-9]{36}\b")
_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_CC_RE = re.compile(r"\b(?:\d[ -]*?){13,19}\b")

DEFAULT_VALUE_PATTERNS: list[Pattern[str]] = [
    _JWT_RE,
    _AWS_KEY_RE,
    _SSN_RE,
    _STRIPE_RE,
    _SLACK_RE,
    _GITHUB_PAT_RE,
]


def _luhn_check(s: str) -> bool:
    """Luhn algorithm to reduce credit-card false positives."""
    digits = re.sub(r"[^\d]", "", s)
    if len(digits) < 13 or len(digits) > 19:
        return False
    total = 0
    alt = False
    for ch in reversed(digits):
        n = int(ch)
        if alt:
            n *= 2
            if n > 9:
                n -= 9
        total += n
        alt = not alt
    return total % 10 == 0


def _key_is_sensitive(key: str, sensitive_keys: list[str]) -> bool:
    lower = key.lower()
    for needle in sensitive_keys:
        if needle in lower:
            return True
    return False


def _value_is_sensitive(
    value: str,
    patterns: list[Pattern[str]],
    scrub_emails: bool,
) -> bool:
    for pat in patterns:
        if pat.search(value):
            return True
    if scrub_emails and _EMAIL_RE.search(value):
        return True
    if _CC_RE.search(value) and _luhn_check(value):
        return True
    return False


def _scrub_value(
    value: Any,
    sensitive_keys: list[str],
    patterns: list[Pattern[str]],
    scrub_emails: bool,
    depth: int,
    seen: set[int],
) -> Any:
    if depth > 8:
        return value
    if value is None:
        return value
    if isinstance(value, str):
        return REDACTED if _value_is_sensitive(value, patterns, scrub_emails) else value
    if isinstance(value, (int, float, bool)):
        return value
    obj_id = id(value)
    if obj_id in seen:
        return value
    seen.add(obj_id)

    if isinstance(value, list):
        return [
            _scrub_value(v, sensitive_keys, patterns, scrub_emails, depth + 1, seen) for v in value
        ]

    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            if isinstance(k, str) and _key_is_sensitive(k, sensitive_keys):
                out[k] = REDACTED
            else:
                out[k] = _scrub_value(v, sensitive_keys, patterns, scrub_emails, depth + 1, seen)
        return out

    return value


def scrub_event(
    event: dict[str, Any],
    options: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Scrub PII from an event dict. Returns a new dict.

    Options:
        enabled (bool): Master switch, default True.
        sensitive_keys (list[str]): Extra key substrings to mask.
        scrub_emails (bool): Also mask email addresses, default False.
        custom_patterns (list[re.Pattern]): Extra value patterns.
    """
    if options and options.get("enabled") is False:
        return event

    opts = options or {}
    sensitive_keys = DEFAULT_SENSITIVE_KEYS + (opts.get("sensitive_keys") or [])
    sensitive_keys = [k.lower() for k in sensitive_keys]
    patterns = DEFAULT_VALUE_PATTERNS + (opts.get("custom_patterns") or [])
    scrub_emails = opts.get("scrub_emails", False)
    seen: set[int] = set()

    result = copy.deepcopy(event)

    for field in ("extra", "user", "tags"):
        if field in result and result[field]:
            result[field] = _scrub_value(
                result[field], sensitive_keys, patterns, scrub_emails, 0, seen
            )

    if "request" in result and result["request"]:
        req = result["request"]
        if "headers" in req and req["headers"]:
            req["headers"] = _scrub_value(
                req["headers"], sensitive_keys, patterns, scrub_emails, 0, seen
            )
        if "data" in req and req["data"]:
            req["data"] = _scrub_value(req["data"], sensitive_keys, patterns, scrub_emails, 0, seen)

    if "breadcrumbs" in result and result["breadcrumbs"]:
        for crumb in result["breadcrumbs"]:
            if "data" in crumb and crumb["data"]:
                crumb["data"] = _scrub_value(
                    crumb["data"], sensitive_keys, patterns, scrub_emails, 0, seen
                )

    return result
