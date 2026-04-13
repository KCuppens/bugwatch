package echo

import (
	"fmt"
	"net/http"

	bugwatch "github.com/KCuppens/bugwatch-go"
	"github.com/labstack/echo/v4"
)

// Middleware returns an echo.MiddlewareFunc that wraps request handling with
// Bugwatch error capture. It extracts request context and recovers from panics.
func Middleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			r := c.Request()

			rc := &bugwatch.RequestContext{
				URL:         r.URL.String(),
				Method:      r.Method,
				Headers:     extractHeaders(r),
				QueryString: r.URL.RawQuery,
			}

			ctx := bugwatch.WithRequestContext(r.Context(), rc)
			c.SetRequest(r.WithContext(ctx))

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
					bugwatch.CaptureExceptionWithContext(c.Request().Context(), err)
					// Return 500 to the client
					c.Error(echo.NewHTTPError(http.StatusInternalServerError, err.Error()))
				}
			}()

			return next(c)
		}
	}
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
