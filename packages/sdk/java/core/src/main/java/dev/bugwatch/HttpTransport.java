package dev.bugwatch;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;

/**
 * HTTP transport that sends error events to the Bugwatch API using {@link java.net.http.HttpClient}.
 */
public class HttpTransport implements Transport {

    private static final Duration TIMEOUT = Duration.ofSeconds(10);

    private final HttpClient httpClient;
    private final String endpoint;
    private final String apiKey;
    private final boolean debug;
    private final Gson gson;

    public HttpTransport(BugwatchOptions options) {
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(TIMEOUT)
                .build();
        this.endpoint = options.getServerUrl() + "/api/v1/events";
        this.apiKey = options.getApiKey();
        this.debug = options.isDebug();
        this.gson = new GsonBuilder().serializeNulls().create();
    }

    @Override
    public boolean send(ErrorEvent event) {
        try {
            String json = gson.toJson(event);

            if (debug) {
                System.err.println("[Bugwatch] Sending event " + event.getId() + " to " + endpoint);
            }

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(endpoint))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + apiKey)
                    .timeout(TIMEOUT)
                    .POST(HttpRequest.BodyPublishers.ofString(json))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            if (debug) {
                System.err.println("[Bugwatch] Response status: " + response.statusCode());
            }

            return response.statusCode() >= 200 && response.statusCode() < 300;
        } catch (Exception e) {
            if (debug) {
                System.err.println("[Bugwatch] Failed to send event: " + e.getMessage());
            }
            return false;
        }
    }

    /**
     * Sends an event asynchronously.
     *
     * @param event the error event to send
     * @return a {@link CompletableFuture} that resolves to {@code true} on success
     */
    public CompletableFuture<Boolean> sendAsync(ErrorEvent event) {
        return CompletableFuture.supplyAsync(() -> send(event));
    }

    @Override
    public void close() {
        // HttpClient does not require explicit close in Java 17
    }
}
