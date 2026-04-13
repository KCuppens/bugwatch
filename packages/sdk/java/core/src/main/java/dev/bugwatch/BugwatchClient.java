package dev.bugwatch;

import java.net.InetAddress;
import java.util.List;
import java.util.function.Function;

/**
 * Thread-safe client for capturing and sending error events to Bugwatch.
 * <p>
 * This is the main workhorse of the SDK. Typically you interact with it through the
 * {@link Bugwatch} static facade, but you can also create and manage instances directly.
 */
public class BugwatchClient {

    private final BugwatchOptions options;
    private final Transport transport;
    private final ScopeManager scopeManager;
    private final String serverName;

    public BugwatchClient(BugwatchOptions options) {
        this(options, new HttpTransport(options));
    }

    public BugwatchClient(BugwatchOptions options, Transport transport) {
        this.options = options;
        this.transport = transport;
        this.scopeManager = new ScopeManager();
        this.serverName = resolveServerName();

        if (options.isDebug()) {
            System.err.println("[Bugwatch] Client initialized (env=" + options.getEnvironment()
                    + ", server=" + options.getServerUrl() + ")");
        }
    }

    /**
     * Captures an exception and sends it as an error event.
     *
     * @param throwable the throwable to capture
     * @return the event ID
     */
    public String captureException(Throwable throwable) {
        ErrorEvent event = new ErrorEvent();
        event.setLevel(Level.ERROR);
        var parsed = StackTraceParser.parse(throwable);
        if (!parsed.isEmpty()) {
            event.setException(parsed.get(0));
        }
        return processAndSend(event);
    }

    /**
     * Captures a message and sends it as an error event.
     *
     * @param message the message to capture
     * @param level   the severity level
     * @return the event ID
     */
    public String captureMessage(String message, Level level) {
        ErrorEvent event = new ErrorEvent();
        event.setLevel(level);
        event.setException(new ExceptionInfo(
                "Message",
                message,
                null
        ));
        return processAndSend(event);
    }

    /**
     * Returns the scope manager for setting contextual data.
     */
    public ScopeManager getScopeManager() {
        return scopeManager;
    }

    /**
     * Flushes any buffered events in the transport.
     */
    public void flush() {
        transport.flush();
    }

    /**
     * Closes the client and releases resources.
     */
    public void close() {
        flush();
        transport.close();
        if (options.isDebug()) {
            System.err.println("[Bugwatch] Client closed");
        }
    }

    private String processAndSend(ErrorEvent event) {
        // Apply options
        event.setEnvironment(options.getEnvironment());
        event.setRelease(options.getRelease());
        event.setServerName(serverName);

        // Apply scope data
        scopeManager.applyTo(event);

        // Generate fingerprint
        event.setFingerprint(Fingerprint.generate(event));

        // Run beforeSend hook
        Function<ErrorEvent, ErrorEvent> beforeSend = options.getBeforeSend();
        if (beforeSend != null) {
            event = beforeSend.apply(event);
            if (event == null) {
                if (options.isDebug()) {
                    System.err.println("[Bugwatch] Event dropped by beforeSend");
                }
                return null;
            }
        }

        // Send
        boolean success = transport.send(event);

        if (options.isDebug()) {
            System.err.println("[Bugwatch] Event " + event.getId() + " "
                    + (success ? "sent" : "failed"));
        }

        return event.getId();
    }

    private static String resolveServerName() {
        try {
            return InetAddress.getLocalHost().getHostName();
        } catch (Exception e) {
            return "unknown";
        }
    }
}
