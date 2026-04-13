package dev.bugwatch;

import java.util.List;

/**
 * Represents exception information extracted from a Throwable.
 */
public record ExceptionInfo(
        String type,
        String value,
        List<StackFrame> stacktrace
) {
}
