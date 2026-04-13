package nethttp

import (
	"fmt"
	"net/http"

	bugwatch "github.com/KCuppens/bugwatch-go"
)

// Middleware returns an http.Handler that wraps the given handler with
// Bugwatch error capture. It extracts request context (URL, method, headers)
// and attaches it to the context. It also recovers from panics and captures
// them as exceptions.
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rc := &bugwatch.RequestContext{
			URL:         r.URL.String(),
			Method:      r.Method,
			Headers:     extractHeaders(r),
			QueryString: r.URL.RawQuery,
		}

		ctx := bugwatch.WithRequestContext(r.Context(), rc)
		r = r.WithContext(ctx)

		defer func() {
			if rec := recover(); rec != nil {
				var err error
				switch v := rec.(type) {
				case error:
					err = v
				case string:
					err = fmt.Errorf("%s", v)
				default:
					err = fmt.Errorf("panic: %v", v)
				}
				bugwatch.CaptureExceptionWithContext(r.Context(), err)
				http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
			}
		}()

		next.ServeHTTP(w, r)
	})
}

func extractHeaders(r *http.Request) map[string]string {
	headers := make(map[string]string, len(r.Header))
	for key, values := range r.Header {
		if len(values) > 0 {
			headers[key] = values[0]
		}
	}
	return headers
}
