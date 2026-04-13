package dev.bugwatch.spring;

import dev.bugwatch.Bugwatch;
import dev.bugwatch.RequestContext;
import dev.bugwatch.ScopeManager;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/**
 * Servlet filter that captures unhandled exceptions and attaches HTTP request context
 * to Bugwatch error events.
 */
public class BugwatchFilter implements Filter {

    @Override
    public void doFilter(ServletRequest servletRequest, ServletResponse servletResponse, FilterChain chain)
            throws IOException, ServletException {

        if (!(servletRequest instanceof HttpServletRequest request)) {
            chain.doFilter(servletRequest, servletResponse);
            return;
        }

        // Extract request context
        RequestContext requestContext = extractRequestContext(request);

        // Push a new scope for this request
        var client = Bugwatch.getClient();
        ScopeManager scopeManager = client != null ? client.getScopeManager() : null;

        if (scopeManager != null) {
            scopeManager.pushScope();
        }

        try {
            // Attach request context via scope extras
            if (scopeManager != null) {
                Map<String, Object> extras = new HashMap<>();
                extras.put("request_url", requestContext.url());
                extras.put("request_method", requestContext.method());
                scopeManager.setExtras(extras);
            }

            chain.doFilter(servletRequest, servletResponse);
        } catch (Exception e) {
            // Capture the exception with request context
            Bugwatch.captureException(e);
            throw e;
        } finally {
            if (scopeManager != null) {
                scopeManager.popScope();
            }
        }
    }

    private RequestContext extractRequestContext(HttpServletRequest request) {
        // Extract headers
        Map<String, String> headers = new HashMap<>();
        Collections.list(request.getHeaderNames()).forEach(name ->
                headers.put(name, request.getHeader(name))
        );

        // Build full URL
        StringBuilder url = new StringBuilder(request.getRequestURL());
        if (request.getQueryString() != null) {
            url.append("?").append(request.getQueryString());
        }

        return new RequestContext(
                url.toString(),
                request.getMethod(),
                headers,
                request.getQueryString(),
                null
        );
    }
}
