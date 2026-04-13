package dev.bugwatch.spring;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Spring Boot configuration properties for the Bugwatch SDK.
 * <p>
 * Configure via {@code application.properties} or {@code application.yml}:
 * <pre>
 * bugwatch.api-key=your-api-key
 * bugwatch.environment=production
 * bugwatch.release=1.0.0
 * bugwatch.server-url=https://api.bugwatch.dev
 * bugwatch.debug=false
 * </pre>
 */
@ConfigurationProperties("bugwatch")
public class BugwatchProperties {

    private String apiKey;
    private String environment;
    private String release;
    private String serverUrl;
    private boolean debug;

    public String getApiKey() {
        return apiKey;
    }

    public void setApiKey(String apiKey) {
        this.apiKey = apiKey;
    }

    public String getEnvironment() {
        return environment;
    }

    public void setEnvironment(String environment) {
        this.environment = environment;
    }

    public String getRelease() {
        return release;
    }

    public void setRelease(String release) {
        this.release = release;
    }

    public String getServerUrl() {
        return serverUrl;
    }

    public void setServerUrl(String serverUrl) {
        this.serverUrl = serverUrl;
    }

    public boolean isDebug() {
        return debug;
    }

    public void setDebug(boolean debug) {
        this.debug = debug;
    }
}
