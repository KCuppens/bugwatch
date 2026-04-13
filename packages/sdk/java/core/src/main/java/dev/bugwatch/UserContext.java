package dev.bugwatch;

import com.google.gson.annotations.SerializedName;

/**
 * Represents user context attached to an error event.
 */
public record UserContext(
        String id,
        String email,
        String username,
        @SerializedName("ip_address") String ipAddress
) {

    public static final class Builder {
        private String id;
        private String email;
        private String username;
        private String ipAddress;

        public Builder id(String id) {
            this.id = id;
            return this;
        }

        public Builder email(String email) {
            this.email = email;
            return this;
        }

        public Builder username(String username) {
            this.username = username;
            return this;
        }

        public Builder ipAddress(String ipAddress) {
            this.ipAddress = ipAddress;
            return this;
        }

        public UserContext build() {
            return new UserContext(id, email, username, ipAddress);
        }
    }
}
