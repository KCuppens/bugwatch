package dev.bugwatch;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Parses Java stack traces from {@link Throwable} instances into structured {@link ExceptionInfo} objects.
 */
public final class StackTraceParser {

    private static final Set<String> SYSTEM_PREFIXES = Set.of(
            "java.", "javax.", "sun.", "jdk.", "com.sun."
    );

    private StackTraceParser() {
    }

    /**
     * Parses a throwable (and its cause chain) into a list of {@link ExceptionInfo}.
     *
     * @param throwable the throwable to parse
     * @return list of exception info objects, outermost exception first
     */
    public static List<ExceptionInfo> parse(Throwable throwable) {
        List<ExceptionInfo> exceptions = new ArrayList<>();
        Throwable current = throwable;
        while (current != null) {
            exceptions.add(parseOne(current));
            current = current.getCause();
        }
        return exceptions;
    }

    private static ExceptionInfo parseOne(Throwable throwable) {
        StackTraceElement[] elements = throwable.getStackTrace();
        List<StackFrame> frames = new ArrayList<>(elements.length);

        for (StackTraceElement element : elements) {
            String className = element.getClassName();
            boolean inApp = isInApp(className);

            frames.add(new StackFrame(
                    element.getFileName(),
                    className + "." + element.getMethodName(),
                    element.getLineNumber(),
                    null,
                    element.getFileName(),
                    inApp,
                    className.contains(".") ? className.substring(0, className.lastIndexOf('.')) : null
            ));
        }

        return new ExceptionInfo(
                throwable.getClass().getName(),
                throwable.getMessage(),
                frames
        );
    }

    /**
     * Determines whether a class is application code (not a JDK/system class).
     */
    static boolean isInApp(String className) {
        if (className == null) {
            return true;
        }
        for (String prefix : SYSTEM_PREFIXES) {
            if (className.startsWith(prefix)) {
                return false;
            }
        }
        return true;
    }
}
