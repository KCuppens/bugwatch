"""Error fingerprinting for grouping similar errors."""
import hashlib
from typing import Optional

from .types import ExceptionInfo


def generate_fingerprint(error_type: str, message: str, stacktrace: Optional[str] = None) -> str:
    """
    Generate a fingerprint for grouping similar errors.

    Args:
        error_type: The type/class of the error
        message: The error message
        stacktrace: Optional normalized stacktrace string

    Returns:
        A hex string fingerprint
    """
    # Normalize the message by removing variable parts
    normalized_message = _normalize_message(message)

    # Create fingerprint content
    content = f"{error_type}:{normalized_message}"

    if stacktrace:
        content += f":{stacktrace}"

    # Generate hash
    return hashlib.sha256(content.encode()).hexdigest()[:32]


def fingerprint_from_exception(exception: ExceptionInfo) -> str:
    """
    Generate a fingerprint from an ExceptionInfo object.

    Args:
        exception: The exception information

    Returns:
        A hex string fingerprint
    """
    # Build stacktrace string from top frames
    stacktrace_parts = []
    for frame in exception.stacktrace[:5]:  # Use top 5 frames
        if frame.in_app:
            stacktrace_parts.append(f"{frame.filename}:{frame.function}:{frame.lineno}")

    stacktrace = "|".join(stacktrace_parts) if stacktrace_parts else None

    return generate_fingerprint(exception.type, exception.value, stacktrace)


def _normalize_message(message: str) -> str:
    """
    Normalize an error message by removing variable parts.

    Args:
        message: The original error message

    Returns:
        The normalized message
    """
    import re

    normalized = message

    # Replace UUIDs first (before numbers corrupt them)
    normalized = re.sub(
        r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
        '<uuid>',
        normalized
    )

    # Replace hex values (before numbers corrupt them)
    normalized = re.sub(r'0x[0-9a-fA-F]+', '<hex>', normalized)

    # Replace memory addresses
    normalized = re.sub(r'at 0x[0-9a-fA-F]+', 'at <address>', normalized)

    # Replace file paths
    normalized = re.sub(r'(/[\w\-./]+)+', '<path>', normalized)
    normalized = re.sub(r'(\\[\w\-.\\ ]+)+', '<path>', normalized)

    # Replace quoted strings
    normalized = re.sub(r'"[^"]*"', '<string>', normalized)
    normalized = re.sub(r"'[^']*'", '<string>', normalized)

    # Replace numbers last (after other patterns that contain numbers)
    normalized = re.sub(r'\d+', '<number>', normalized)

    return normalized
