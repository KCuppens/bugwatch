"""Tests for fingerprint generation."""
import pytest

from bugwatch.fingerprint import generate_fingerprint, fingerprint_from_exception
from bugwatch.types import ExceptionInfo, StackFrame


class TestGenerateFingerprint:
    """Tests for generate_fingerprint function."""

    def test_consistent_fingerprint_for_same_error(self) -> None:
        """Same error type and message should produce same fingerprint."""
        fp1 = generate_fingerprint("TypeError", "Cannot read property 'x' of undefined")
        fp2 = generate_fingerprint("TypeError", "Cannot read property 'x' of undefined")
        assert fp1 == fp2

    def test_different_fingerprint_for_different_type(self) -> None:
        """Different error types should produce different fingerprints."""
        fp1 = generate_fingerprint("TypeError", "error message")
        fp2 = generate_fingerprint("ValueError", "error message")
        assert fp1 != fp2

    def test_different_fingerprint_for_different_message(self) -> None:
        """Different messages should produce different fingerprints."""
        fp1 = generate_fingerprint("TypeError", "cannot read property of undefined")
        fp2 = generate_fingerprint("TypeError", "null is not a function")
        assert fp1 != fp2

    def test_normalizes_numbers(self) -> None:
        """Numbers in messages should be normalized."""
        fp1 = generate_fingerprint("IndexError", "list index 5 out of range")
        fp2 = generate_fingerprint("IndexError", "list index 10 out of range")
        assert fp1 == fp2

    def test_normalizes_uuids(self) -> None:
        """UUIDs in messages should be normalized."""
        fp1 = generate_fingerprint("KeyError", "user 550e8400-e29b-41d4-a716-446655440000 not found")
        fp2 = generate_fingerprint("KeyError", "user 6ba7b810-9dad-11d1-80b4-00c04fd430c8 not found")
        assert fp1 == fp2

    def test_normalizes_quoted_strings(self) -> None:
        """Quoted strings in messages should be normalized."""
        fp1 = generate_fingerprint("KeyError", 'key "foo" not found')
        fp2 = generate_fingerprint("KeyError", 'key "bar" not found')
        assert fp1 == fp2

    def test_stacktrace_affects_fingerprint(self) -> None:
        """Including stacktrace should change fingerprint."""
        fp1 = generate_fingerprint("TypeError", "error")
        fp2 = generate_fingerprint("TypeError", "error", "file.py:func:10")
        assert fp1 != fp2


class TestFingerprintFromException:
    """Tests for fingerprint_from_exception function."""

    def test_generates_fingerprint_from_exception_info(self) -> None:
        """Should generate fingerprint from ExceptionInfo."""
        exception = ExceptionInfo(
            type="ValueError",
            value="invalid value",
            stacktrace=[
                StackFrame(
                    filename="app.py",
                    function="main",
                    lineno=10,
                    in_app=True,
                ),
            ],
        )
        fp = fingerprint_from_exception(exception)
        assert isinstance(fp, str)
        assert len(fp) == 32  # SHA256 truncated to 32 chars

    def test_uses_in_app_frames_only(self) -> None:
        """Should only use in_app frames for fingerprint."""
        exception1 = ExceptionInfo(
            type="ValueError",
            value="error",
            stacktrace=[
                StackFrame(filename="lib.py", function="lib_func", lineno=5, in_app=False),
                StackFrame(filename="app.py", function="main", lineno=10, in_app=True),
            ],
        )
        exception2 = ExceptionInfo(
            type="ValueError",
            value="error",
            stacktrace=[
                StackFrame(filename="other_lib.py", function="other_func", lineno=20, in_app=False),
                StackFrame(filename="app.py", function="main", lineno=10, in_app=True),
            ],
        )
        fp1 = fingerprint_from_exception(exception1)
        fp2 = fingerprint_from_exception(exception2)
        assert fp1 == fp2  # Same because in_app frames are the same

    def test_consistent_for_same_exception(self) -> None:
        """Same exception should produce same fingerprint."""
        exception = ExceptionInfo(
            type="RuntimeError",
            value="something went wrong",
            stacktrace=[
                StackFrame(filename="handler.py", function="handle", lineno=50, in_app=True),
            ],
        )
        fp1 = fingerprint_from_exception(exception)
        fp2 = fingerprint_from_exception(exception)
        assert fp1 == fp2
