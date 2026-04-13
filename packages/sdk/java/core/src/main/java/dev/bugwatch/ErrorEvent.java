package dev.bugwatch;

import com.google.gson.annotations.SerializedName;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Represents an error event to be sent to the Bugwatch API.
 */
public class ErrorEvent {

    @SerializedName("event_id")
    private final String id;
    private final String timestamp;
    private String level;
    private final String platform;
    @SerializedName("server_name")
    private String serverName;
    private String environment;
    private String release;
    private ExceptionInfo exception;
    private UserContext user;
    private RequestContext request;
    private List<Breadcrumb> breadcrumbs;
    private Map<String, String> tags;
    private Map<String, Object> extra;
    private String fingerprint;

    public ErrorEvent() {
        this.id = UUID.randomUUID().toString();
        this.timestamp = Instant.now().toString();
        this.platform = "java";
        this.level = Level.ERROR.getValue();
    }

    // --- Getters ---

    public String getId() {
        return id;
    }

    public String getTimestamp() {
        return timestamp;
    }

    public String getLevel() {
        return level;
    }

    public String getPlatform() {
        return platform;
    }

    public String getServerName() {
        return serverName;
    }

    public String getEnvironment() {
        return environment;
    }

    public String getRelease() {
        return release;
    }

    public ExceptionInfo getException() {
        return exception;
    }

    public UserContext getUser() {
        return user;
    }

    public RequestContext getRequest() {
        return request;
    }

    public List<Breadcrumb> getBreadcrumbs() {
        return breadcrumbs;
    }

    public Map<String, String> getTags() {
        return tags;
    }

    public Map<String, Object> getExtra() {
        return extra;
    }

    public String getFingerprint() {
        return fingerprint;
    }

    // --- Setters ---

    public void setLevel(String level) {
        this.level = level;
    }

    public void setLevel(Level level) {
        this.level = level != null ? level.getValue() : Level.ERROR.getValue();
    }

    public void setServerName(String serverName) {
        this.serverName = serverName;
    }

    public void setEnvironment(String environment) {
        this.environment = environment;
    }

    public void setRelease(String release) {
        this.release = release;
    }

    public void setException(ExceptionInfo exception) {
        this.exception = exception;
    }

    public void setUser(UserContext user) {
        this.user = user;
    }

    public void setRequest(RequestContext request) {
        this.request = request;
    }

    public void setBreadcrumbs(List<Breadcrumb> breadcrumbs) {
        this.breadcrumbs = breadcrumbs;
    }

    public void setTags(Map<String, String> tags) {
        this.tags = tags;
    }

    public void setExtra(Map<String, Object> extra) {
        this.extra = extra;
    }

    public void setFingerprint(String fingerprint) {
        this.fingerprint = fingerprint;
    }

    // --- Convenience methods ---

    public void addTag(String key, String value) {
        if (this.tags == null) {
            this.tags = new HashMap<>();
        }
        this.tags.put(key, value);
    }

    public void addExtra(String key, Object value) {
        if (this.extra == null) {
            this.extra = new HashMap<>();
        }
        this.extra.put(key, value);
    }

    public void addBreadcrumb(Breadcrumb breadcrumb) {
        if (this.breadcrumbs == null) {
            this.breadcrumbs = new ArrayList<>();
        }
        this.breadcrumbs.add(breadcrumb);
    }
}
