package dev.bugwatch;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class FingerprintTest {

    @Test
    void testGenerateProducesConsistentHash() {
        ErrorEvent event = createTestEvent("java.lang.RuntimeException", "test error");
        String fp1 = Fingerprint.generate(event);
        String fp2 = Fingerprint.generate(event);

        assertNotNull(fp1);
        assertFalse(fp1.isBlank());
        assertEquals(fp1, fp2, "Fingerprint should be deterministic");
    }

    @Test
    void testDifferentExceptionsProduceDifferentFingerprints() {
        ErrorEvent event1 = createTestEvent("java.lang.RuntimeException", "error one");
        ErrorEvent event2 = createTestEvent("java.lang.IllegalStateException", "error two");

        String fp1 = Fingerprint.generate(event1);
        String fp2 = Fingerprint.generate(event2);

        assertNotEquals(fp1, fp2, "Different exceptions should produce different fingerprints");
    }

    @Test
    void testSameExceptionTypeSameMessageSameFingerprint() {
        ErrorEvent event1 = createTestEvent("java.lang.NullPointerException", "null ref");
        ErrorEvent event2 = createTestEvent("java.lang.NullPointerException", "null ref");

        String fp1 = Fingerprint.generate(event1);
        String fp2 = Fingerprint.generate(event2);

        assertEquals(fp1, fp2, "Same exception type and message should produce the same fingerprint");
    }

    @Test
    void testEmptyEventProducesFingerprint() {
        ErrorEvent event = new ErrorEvent();
        String fp = Fingerprint.generate(event);
        assertNotNull(fp);
        assertFalse(fp.isBlank());
    }

    @Test
    void testFingerprintIsSha256Length() {
        ErrorEvent event = createTestEvent("Exception", "test");
        String fp = Fingerprint.generate(event);
        // SHA-256 produces 64 hex characters
        assertEquals(64, fp.length());
    }

    private ErrorEvent createTestEvent(String type, String message) {
        ErrorEvent event = new ErrorEvent();
        List<StackFrame> frames = List.of(
                new StackFrame("Test.java", "com.example.Test.run", 42, null, "Test.java", true, "com.example")
        );
        event.setException(new ExceptionInfo(
                type,
                message,
                frames
        ));
        return event;
    }
}
