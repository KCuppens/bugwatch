package dev.bugwatch.spring;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class AutoConfigurationTest {

    @Test
    void autoConfigurationClassExists() {
        assertNotNull(BugwatchAutoConfiguration.class);
    }

    @Test
    void propertiesHaveDefaults() {
        BugwatchProperties props = new BugwatchProperties();
        assertNull(props.getApiKey());
        assertNull(props.getEnvironment());
        assertNull(props.getRelease());
        assertFalse(props.isDebug());
    }
}
