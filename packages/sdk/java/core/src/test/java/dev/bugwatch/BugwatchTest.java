package dev.bugwatch;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class BugwatchTest {

    private final List<ErrorEvent> capturedEvents = new ArrayList<>();

    private final Transport mockTransport = new Transport() {
        @Override
        public boolean send(ErrorEvent event) {
            capturedEvents.add(event);
            return true;
        }
    };

    @BeforeEach
    void setUp() {
        capturedEvents.clear();
        BugwatchOptions options = BugwatchOptions.builder()
                .apiKey("test-api-key")
                .environment("test")
                .release("1.0.0")
                .build();
        BugwatchClient client = new BugwatchClient(options, mockTransport);
        Bugwatch.init(client);
    }

    @AfterEach
    void tearDown() {
        Bugwatch.close();
    }

    @Test
    void testInit() {
        assertNotNull(Bugwatch.getClient());
    }

    @Test
    void testCaptureException() {
        RuntimeException exception = new RuntimeException("Test error");
        String eventId = Bugwatch.captureException(exception);

        assertNotNull(eventId);
        assertEquals(1, capturedEvents.size());

        ErrorEvent event = capturedEvents.get(0);
        assertEquals(eventId, event.getId());
        assertEquals("error", event.getLevel());
        assertEquals("java", event.getPlatform());
        assertEquals("test", event.getEnvironment());
        assertEquals("1.0.0", event.getRelease());
        assertNotNull(event.getException());

        ExceptionInfo ex = event.getException();
        assertEquals("java.lang.RuntimeException", ex.type());
        assertEquals("Test error", ex.value());
        assertNotNull(ex.stacktrace());
        assertFalse(ex.stacktrace().isEmpty());
    }

    @Test
    void testCaptureExceptionWithCause() {
        Exception cause = new IllegalArgumentException("root cause");
        RuntimeException exception = new RuntimeException("wrapper", cause);
        String eventId = Bugwatch.captureException(exception);

        assertNotNull(eventId);
        assertEquals(1, capturedEvents.size());

        ErrorEvent event = capturedEvents.get(0);
        assertNotNull(event.getException());
        assertEquals("java.lang.RuntimeException", event.getException().type());
    }

    @Test
    void testCaptureMessage() {
        String eventId = Bugwatch.captureMessage("Something happened", Level.WARNING);

        assertNotNull(eventId);
        assertEquals(1, capturedEvents.size());

        ErrorEvent event = capturedEvents.get(0);
        assertEquals(eventId, event.getId());
        assertEquals("warning", event.getLevel());
        assertNotNull(event.getException());
        assertEquals("Something happened", event.getException().value());
    }

    @Test
    void testCaptureWithoutInit() {
        Bugwatch.close();
        String eventId = Bugwatch.captureException(new RuntimeException("test"));
        assertNull(eventId);
    }

    @Test
    void testBeforeSendDrop() {
        Bugwatch.close();
        capturedEvents.clear();

        BugwatchOptions options = BugwatchOptions.builder()
                .apiKey("test-api-key")
                .environment("test")
                .beforeSend(event -> null) // Drop all events
                .build();
        BugwatchClient client = new BugwatchClient(options, mockTransport);
        Bugwatch.init(client);

        String eventId = Bugwatch.captureException(new RuntimeException("dropped"));
        assertNull(eventId);
        assertTrue(capturedEvents.isEmpty());
    }

    @Test
    void testBeforeSendModify() {
        Bugwatch.close();
        capturedEvents.clear();

        BugwatchOptions options = BugwatchOptions.builder()
                .apiKey("test-api-key")
                .environment("test")
                .beforeSend(event -> {
                    event.addTag("custom", "tag");
                    return event;
                })
                .build();
        BugwatchClient client = new BugwatchClient(options, mockTransport);
        Bugwatch.init(client);

        Bugwatch.captureException(new RuntimeException("modified"));
        assertEquals(1, capturedEvents.size());
        assertEquals("tag", capturedEvents.get(0).getTags().get("custom"));
    }

    @Test
    void testFingerprint() {
        Bugwatch.captureException(new RuntimeException("Test error"));
        assertNotNull(capturedEvents.get(0).getFingerprint());
        assertFalse(capturedEvents.get(0).getFingerprint().isBlank());
    }

    @Test
    void testScopeManager() {
        BugwatchClient client = Bugwatch.getClient();
        assertNotNull(client);

        client.getScopeManager().setUser(new UserContext("u1", "test@example.com", "tester", "127.0.0.1"));
        Bugwatch.captureException(new RuntimeException("scoped error"));

        assertEquals(1, capturedEvents.size());
        assertNotNull(capturedEvents.get(0).getUser());
        assertEquals("u1", capturedEvents.get(0).getUser().id());
    }
}
