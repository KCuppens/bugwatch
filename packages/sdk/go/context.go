package bugwatch

import (
	"context"
)

type contextKey int

const (
	userContextKey    contextKey = iota
	breadcrumbKey     contextKey = iota
	requestContextKey contextKey = iota
)

// WithUser returns a new context with the given UserContext attached.
func WithUser(ctx context.Context, user *UserContext) context.Context {
	return context.WithValue(ctx, userContextKey, user)
}

// GetUser retrieves the UserContext from the context, or nil if not set.
func GetUser(ctx context.Context) *UserContext {
	user, _ := ctx.Value(userContextKey).(*UserContext)
	return user
}

// WithBreadcrumb returns a new context with the given Breadcrumb appended
// to the existing breadcrumbs.
func WithBreadcrumb(ctx context.Context, b Breadcrumb) context.Context {
	existing := GetBreadcrumbs(ctx)
	crumbs := make([]Breadcrumb, len(existing), len(existing)+1)
	copy(crumbs, existing)
	crumbs = append(crumbs, b)
	return context.WithValue(ctx, breadcrumbKey, crumbs)
}

// GetBreadcrumbs retrieves all breadcrumbs from the context.
func GetBreadcrumbs(ctx context.Context) []Breadcrumb {
	crumbs, _ := ctx.Value(breadcrumbKey).([]Breadcrumb)
	return crumbs
}

// WithRequestContext returns a new context with the given RequestContext attached.
func WithRequestContext(ctx context.Context, rc *RequestContext) context.Context {
	return context.WithValue(ctx, requestContextKey, rc)
}

// GetRequestContext retrieves the RequestContext from the context, or nil if not set.
func GetRequestContext(ctx context.Context) *RequestContext {
	rc, _ := ctx.Value(requestContextKey).(*RequestContext)
	return rc
}
