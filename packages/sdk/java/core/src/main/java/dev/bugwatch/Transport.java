package dev.bugwatch;

/**
 * Interface for sending error events to a backend.
 */
public interface Transport {

    /**
     * Sends an error event synchronously.
     *
     * @param event the error event to send
     * @return {@code true} if the event was sent successfully
     */
    boolean send(ErrorEvent event);

    /**
     * Flushes any buffered events. Default implementation is a no-op.
     */
    default void flush() {
    }

    /**
     * Closes the transport and releases resources. Default implementation is a no-op.
     */
    default void close() {
    }
}
