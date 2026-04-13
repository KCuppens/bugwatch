package dev.bugwatch.spring;

import dev.bugwatch.Bugwatch;
import dev.bugwatch.BugwatchOptions;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;

@AutoConfiguration
@EnableConfigurationProperties(BugwatchProperties.class)
public class BugwatchAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean(BugwatchFilter.class)
    public FilterRegistrationBean<BugwatchFilter> bugwatchFilter(BugwatchProperties properties) {
        BugwatchOptions options = BugwatchOptions.builder()
                .apiKey(properties.getApiKey())
                .environment(properties.getEnvironment())
                .release(properties.getRelease())
                .serverUrl(properties.getServerUrl())
                .debug(properties.isDebug())
                .build();
        Bugwatch.init(options);

        FilterRegistrationBean<BugwatchFilter> registration = new FilterRegistrationBean<>();
        registration.setFilter(new BugwatchFilter());
        registration.addUrlPatterns("/*");
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
        return registration;
    }

    @Bean
    @ConditionalOnMissingBean
    public BugwatchExceptionResolver bugwatchExceptionResolver() {
        return new BugwatchExceptionResolver();
    }
}
