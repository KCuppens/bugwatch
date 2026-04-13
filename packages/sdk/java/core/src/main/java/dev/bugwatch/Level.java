package dev.bugwatch;

import com.google.gson.annotations.SerializedName;

/**
 * Severity levels for error events.
 */
public enum Level {

    @SerializedName("debug")
    DEBUG("debug"),

    @SerializedName("info")
    INFO("info"),

    @SerializedName("warning")
    WARNING("warning"),

    @SerializedName("error")
    ERROR("error"),

    @SerializedName("fatal")
    FATAL("fatal");

    private final String value;

    Level(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    @Override
    public String toString() {
        return value;
    }
}
