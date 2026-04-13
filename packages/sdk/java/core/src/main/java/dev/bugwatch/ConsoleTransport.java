package dev.bugwatch;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

/**
 * A transport that prints error events to {@code System.err}. Useful for local development and debugging.
 */
public class ConsoleTransport implements Transport {

    private final Gson gson = new GsonBuilder().setPrettyPrinting().create();

    @Override
    public boolean send(ErrorEvent event) {
        System.err.println("[Bugwatch] Event " + event.getId() + ":");
        System.err.println(gson.toJson(event));
        return true;
    }
}
