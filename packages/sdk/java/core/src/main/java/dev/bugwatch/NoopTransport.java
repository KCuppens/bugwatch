package dev.bugwatch;

/**
 * A no-op transport that discards all events. Useful for testing or disabling event submission.
 */
public class NoopTransport implements Transport {

    @Override
    public boolean send(ErrorEvent event) {
        return true;
    }
}
