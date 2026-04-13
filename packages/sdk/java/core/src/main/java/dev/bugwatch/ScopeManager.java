package dev.bugwatch;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Thread-local scope manager for maintaining contextual data (user, tags, extras, breadcrumbs)
 * across the call stack. Supports push/pop semantics for nested scopes.
 */
public class ScopeManager {

    private final ThreadLocal<Deque<Scope>> scopeStack = ThreadLocal.withInitial(() -> {
        Deque<Scope> stack = new ArrayDeque<>();
        stack.push(new Scope());
        return stack;
    });

    /**
     * Returns the current (top-of-stack) scope.
     */
    public Scope currentScope() {
        return scopeStack.get().peek();
    }

    /**
     * Pushes a clone of the current scope onto the stack.
     */
    public void pushScope() {
        Scope current = currentScope();
        scopeStack.get().push(current.copy());
    }

    /**
     * Pops the top scope. If only one scope remains, it is not popped.
     */
    public void popScope() {
        Deque<Scope> stack = scopeStack.get();
        if (stack.size() > 1) {
            stack.pop();
        }
    }

    public void setUser(UserContext user) {
        currentScope().user = user;
    }

    public void setTags(Map<String, String> tags) {
        currentScope().tags.putAll(tags);
    }

    public void setExtras(Map<String, Object> extras) {
        currentScope().extras.putAll(extras);
    }

    public void addBreadcrumb(Breadcrumb breadcrumb) {
        currentScope().breadcrumbs.add(breadcrumb);
    }

    /**
     * Applies the current scope data to an error event.
     */
    public void applyTo(ErrorEvent event) {
        Scope scope = currentScope();
        if (scope.user != null && event.getUser() == null) {
            event.setUser(scope.user);
        }
        if (!scope.tags.isEmpty()) {
            Map<String, String> merged = new HashMap<>(scope.tags);
            if (event.getTags() != null) {
                merged.putAll(event.getTags());
            }
            event.setTags(merged);
        }
        if (!scope.extras.isEmpty()) {
            Map<String, Object> merged = new HashMap<>(scope.extras);
            if (event.getExtra() != null) {
                merged.putAll(event.getExtra());
            }
            event.setExtra(merged);
        }
        if (!scope.breadcrumbs.isEmpty()) {
            List<Breadcrumb> merged = new ArrayList<>(scope.breadcrumbs);
            if (event.getBreadcrumbs() != null) {
                merged.addAll(event.getBreadcrumbs());
            }
            event.setBreadcrumbs(merged);
        }
    }

    /**
     * Internal scope data holder.
     */
    static class Scope {
        UserContext user;
        final Map<String, String> tags = new HashMap<>();
        final Map<String, Object> extras = new HashMap<>();
        final List<Breadcrumb> breadcrumbs = new ArrayList<>();

        Scope copy() {
            Scope copy = new Scope();
            copy.user = this.user;
            copy.tags.putAll(this.tags);
            copy.extras.putAll(this.extras);
            copy.breadcrumbs.addAll(this.breadcrumbs);
            return copy;
        }
    }
}
