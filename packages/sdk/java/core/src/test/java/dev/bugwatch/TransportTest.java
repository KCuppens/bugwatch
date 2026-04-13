package dev.bugwatch;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class TransportTest {

    @Test
    void testNoopTransportReturnTrue() {
        NoopTransport transport = new NoopTransport();
        ErrorEvent event = new ErrorEvent();
        assertTrue(transport.send(event));
    }

    @Test
    void testConsoleTransportReturnTrue() {
        ConsoleTransport transport = new ConsoleTransport();
        ErrorEvent event = new ErrorEvent();
        event.setException(new ExceptionInfo(
                "TestException",
                "test message",
                null
        ));
        assertTrue(transport.send(event));
    }

    @Test
    void testHttpTransportFailsWithInvalidServer() {
        BugwatchOptions options = BugwatchOptions.builder()
                .apiKey("test-key")
                .serverUrl("http://localhost:1")
                .build();
        HttpTransport transport = new HttpTransport(options);

        ErrorEvent event = new ErrorEvent();
        event.setException(new ExceptionInfo(
                "TestException",
                "test message",
                null
        ));

        // Should return false since the server is not reachable
        assertFalse(transport.send(event));
    }

    @Test
    void testTransportFlushAndCloseDefaults() {
        Transport transport = new NoopTransport();
        // These should not throw
        assertDoesNotThrow(transport::flush);
        assertDoesNotThrow(transport::close);
    }
}
