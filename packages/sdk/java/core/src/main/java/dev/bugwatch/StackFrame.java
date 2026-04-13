package dev.bugwatch;

import com.google.gson.annotations.SerializedName;

/**
 * Represents a single frame in a stack trace.
 */
public record StackFrame(
        String filename,
        @SerializedName("function") String function,
        @SerializedName("lineno") int lineno,
        @SerializedName("colno") Integer colno,
        @SerializedName("abs_path") String absPath,
        @SerializedName("in_app") boolean inApp,
        String module
) {

    /**
     * Builder for constructing StackFrame instances.
     */
    public static final class Builder {
        private String filename;
        private String function;
        private int lineno;
        private Integer colno;
        private String absPath;
        private boolean inApp;
        private String module;

        public Builder filename(String filename) {
            this.filename = filename;
            return this;
        }

        public Builder function(String function) {
            this.function = function;
            return this;
        }

        public Builder lineno(int lineno) {
            this.lineno = lineno;
            return this;
        }

        public Builder colno(Integer colno) {
            this.colno = colno;
            return this;
        }

        public Builder absPath(String absPath) {
            this.absPath = absPath;
            return this;
        }

        public Builder inApp(boolean inApp) {
            this.inApp = inApp;
            return this;
        }

        public Builder module(String module) {
            this.module = module;
            return this;
        }

        public StackFrame build() {
            return new StackFrame(filename, function, lineno, colno, absPath, inApp, module);
        }
    }
}
