package dev.bugwatch.spring;

import dev.bugwatch.Bugwatch;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.core.Ordered;
import org.springframework.web.servlet.HandlerExceptionResolver;
import org.springframework.web.servlet.ModelAndView;

/**
 * Spring MVC exception resolver that captures exceptions handled by Spring's dispatcher servlet.
 * <p>
 * Registered with highest precedence so it observes exceptions before other resolvers handle them,
 * then returns {@code null} to let the normal Spring exception handling proceed.
 */
public class BugwatchExceptionResolver implements HandlerExceptionResolver, Ordered {

    @Override
    public ModelAndView resolveException(
            HttpServletRequest request,
            HttpServletResponse response,
            Object handler,
            Exception ex) {

        Bugwatch.captureException(ex);

        // Return null to let other exception resolvers handle the response
        return null;
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE;
    }
}
