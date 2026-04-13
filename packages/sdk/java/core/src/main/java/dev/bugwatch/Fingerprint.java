package dev.bugwatch;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;

/**
 * Generates a fingerprint (SHA-256 hash) for an error event to group similar errors together.
 */
public final class Fingerprint {

    private Fingerprint() {
    }

    /**
     * Generates a SHA-256 fingerprint for the given error event based on its exception types,
     * messages, and top stack frames.
     *
     * @param event the error event
     * @return hex-encoded SHA-256 hash string
     */
    public static String generate(ErrorEvent event) {
        StringBuilder sb = new StringBuilder();

        ExceptionInfo ex = event.getException();
        if (ex != null) {
            sb.append(ex.type() != null ? ex.type() : "unknown").append(":");
            sb.append(ex.value() != null ? ex.value() : "").append(";");

            if (ex.stacktrace() != null) {
                List<StackFrame> frames = ex.stacktrace();
                // Use the top 5 frames for fingerprinting
                int limit = Math.min(frames.size(), 5);
                for (int i = 0; i < limit; i++) {
                    StackFrame frame = frames.get(i);
                    sb.append(frame.function() != null ? frame.function() : "").append("@");
                    sb.append(frame.lineno()).append(";");
                }
            }
        }

        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(sb.toString().getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 is guaranteed to be available in all Java implementations
            throw new RuntimeException("SHA-256 not available", e);
        }
    }
}
