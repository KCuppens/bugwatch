package dev.bugwatch;

import java.time.Instant;
import java.util.Map;

/**
 * Represents a breadcrumb trail entry for debugging context.
 */
public record Breadcrumb(
        String timestamp,
        String type,
        String category,
        String message,
        Map<String, Object> data,
        String level
) {

    /**
     * Creates a new breadcrumb with the current timestamp.
     */
    public static Breadcrumb create(String type, String category, String message, Level level) {
        return new Breadcrumb(
                Instant.now().toString(),
                type,
                category,
                message,
                null,
                level != null ? level.getValue() : null
        );
    }

    /**
     * Creates a new breadcrumb with the current timestamp and additional data.
     */
    public static Breadcrumb create(String type, String category, String message, Map<String, Object> data, Level level) {
        return new Breadcrumb(
                Instant.now().toString(),
                type,
                category,
                message,
                data,
                level != null ? level.getValue() : null
        );
    }
}
