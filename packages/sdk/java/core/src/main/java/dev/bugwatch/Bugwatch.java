package dev.bugwatch;

/**
 * Static facade for the Bugwatch SDK.
 * <p>
 * Initialize once at application startup:
 * <pre>{@code
 * Bugwatch.init(BugwatchOptions.builder()
 *     .apiKey("your-api-key")
 *     .environment("production")
 *     .build());
 * }</pre>
 * <p>
 * Then capture errors anywhere:
 * <pre>{@code
 * try {
 *     riskyOperation();
 * } catch (Exception e) {
 *     Bugwatch.captureException(e);
 * }
 * }</pre>
 */
public final class Bugwatch {

    private static volatile BugwatchClient instance;
    private static final Object LOCK = new Object();

    private Bugwatch() {
    }

    /**
     * Initializes the SDK with the given options. Must be called before any capture methods.
     * Uses double-checked locking to ensure thread-safe singleton initialization.
     *
     * @param options the SDK configuration options
     */
    public static void init(BugwatchOptions options) {
        if (instance == null) {
            synchronized (LOCK) {
                if (instance == null) {
                    instance = new BugwatchClient(options);
                }
            }
        }
    }

    /**
     * Initializes the SDK with a pre-built client. Useful for testing.
     *
     * @param client the client instance
     */
    public static void init(BugwatchClient client) {
        synchronized (LOCK) {
            instance = client;
        }
    }

    /**
     * Captures an exception and sends it to Bugwatch.
     *
     * @param throwable the throwable to capture
     * @return the event ID, or {@code null} if the SDK is not initialized
     */
    public static String captureException(Throwable throwable) {
        BugwatchClient client = instance;
        if (client == null) {
            System.err.println("[Bugwatch] SDK not initialized. Call Bugwatch.init() first.");
            return null;
        }
        return client.captureException(throwable);
    }

    /**
     * Captures a message and sends it to Bugwatch.
     *
     * @param message the message to capture
     * @param level   the severity level
     * @return the event ID, or {@code null} if the SDK is not initialized
     */
    public static String captureMessage(String message, Level level) {
        BugwatchClient client = instance;
        if (client == null) {
            System.err.println("[Bugwatch] SDK not initialized. Call Bugwatch.init() first.");
            return null;
        }
        return client.captureMessage(message, level);
    }

    /**
     * Flushes any buffered events.
     */
    public static void flush() {
        BugwatchClient client = instance;
        if (client != null) {
            client.flush();
        }
    }

    /**
     * Closes the SDK and releases resources.
     */
    public static void close() {
        synchronized (LOCK) {
            if (instance != null) {
                instance.close();
                instance = null;
            }
        }
    }

    /**
     * Returns the underlying client instance, or {@code null} if not initialized.
     */
    static BugwatchClient getClient() {
        return instance;
    }
}
