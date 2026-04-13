package dev.bugwatch;

import com.google.gson.annotations.SerializedName;

import java.util.Map;

/**
 * Represents HTTP request context attached to an error event.
 */
public record RequestContext(
        String url,
        String method,
        Map<String, String> headers,
        @SerializedName("query_string") String queryString,
        Object data
) {

    public static final class Builder {
        private String url;
        private String method;
        private Map<String, String> headers;
        private String queryString;
        private Object data;

        public Builder url(String url) {
            this.url = url;
            return this;
        }

        public Builder method(String method) {
            this.method = method;
            return this;
        }

        public Builder headers(Map<String, String> headers) {
            this.headers = headers;
            return this;
        }

        public Builder queryString(String queryString) {
            this.queryString = queryString;
            return this;
        }

        public Builder data(Object data) {
            this.data = data;
            return this;
        }

        public RequestContext build() {
            return new RequestContext(url, method, headers, queryString, data);
        }
    }
}
