package dev.bugwatch;

import java.util.function.Function;

/**
 * Configuration options for the Bugwatch SDK.
 * <p>
 * Use the {@link Builder} to construct instances. Environment variables are read
 * as fallbacks when builder values are not explicitly set:
 * <ul>
 *   <li>{@code BUGWATCH_API_KEY} - API key for authentication</li>
 *   <li>{@code BUGWATCH_ENVIRONMENT} - deployment environment name</li>
 *   <li>{@code BUGWATCH_RELEASE} - release/version identifier</li>
 *   <li>{@code BUGWATCH_SERVER_URL} - custom API server URL</li>
 *   <li>{@code BUGWATCH_DEBUG} - enable debug logging ("true"/"false")</li>
 * </ul>
 */
public final class BugwatchOptions {

    private static final String DEFAULT_SERVER_URL = "https://api.bugwatch.dev";

    private final String apiKey;
    private final String environment;
    private final String release;
    private final String serverUrl;
    private final boolean debug;
    private final Function<ErrorEvent, ErrorEvent> beforeSend;

    private BugwatchOptions(Builder builder) {
        this.apiKey = resolveValue(builder.apiKey, "BUGWATCH_API_KEY");
        this.environment = resolveValue(builder.environment, "BUGWATCH_ENVIRONMENT");
        this.release = resolveValue(builder.release, "BUGWATCH_RELEASE");
        String url = resolveValue(builder.serverUrl, "BUGWATCH_SERVER_URL");
        this.serverUrl = url != null ? url : DEFAULT_SERVER_URL;
        String debugEnv = System.getenv("BUGWATCH_DEBUG");
        this.debug = builder.debug || "true".equalsIgnoreCase(debugEnv);
        this.beforeSend = builder.beforeSend;
    }

    private static String resolveValue(String explicit, String envVar) {
        if (explicit != null && !explicit.isBlank()) {
            return explicit;
        }
        String env = System.getenv(envVar);
        return (env != null && !env.isBlank()) ? env : null;
    }

    public String getApiKey() {
        return apiKey;
    }

    public String getEnvironment() {
        return environment;
    }

    public String getRelease() {
        return release;
    }

    public String getServerUrl() {
        return serverUrl;
    }

    public boolean isDebug() {
        return debug;
    }

    public Function<ErrorEvent, ErrorEvent> getBeforeSend() {
        return beforeSend;
    }

    public static Builder builder() {
        return new Builder();
    }

    /**
     * Builder for {@link BugwatchOptions}.
     */
    public static final class Builder {
        private String apiKey;
        private String environment;
        private String release;
        private String serverUrl;
        private boolean debug;
        private Function<ErrorEvent, ErrorEvent> beforeSend;

        private Builder() {
        }

        public Builder apiKey(String apiKey) {
            this.apiKey = apiKey;
            return this;
        }

        public Builder environment(String environment) {
            this.environment = environment;
            return this;
        }

        public Builder release(String release) {
            this.release = release;
            return this;
        }

        public Builder serverUrl(String serverUrl) {
            this.serverUrl = serverUrl;
            return this;
        }

        public Builder debug(boolean debug) {
            this.debug = debug;
            return this;
        }

        public Builder beforeSend(Function<ErrorEvent, ErrorEvent> beforeSend) {
            this.beforeSend = beforeSend;
            return this;
        }

        public BugwatchOptions build() {
            return new BugwatchOptions(this);
        }
    }
}
