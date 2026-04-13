package bugwatch

// Level represents the severity level of an event.
type Level string

const (
	LevelDebug   Level = "debug"
	LevelInfo    Level = "info"
	LevelWarning Level = "warning"
	LevelError   Level = "error"
	LevelFatal   Level = "fatal"
)

// ErrorEvent represents an error event to be sent to the Bugwatch API.
type ErrorEvent struct {
	ID          string                 `json:"event_id"`
	Timestamp   string                 `json:"timestamp"`
	Level       Level                  `json:"level"`
	Platform    string                 `json:"platform"`
	ServerName  string                 `json:"server_name,omitempty"`
	Environment string                 `json:"environment,omitempty"`
	Release     string                 `json:"release,omitempty"`
	Exception   *ExceptionInfo         `json:"exception,omitempty"`
	User        *UserContext           `json:"user,omitempty"`
	Request     *RequestContext        `json:"request,omitempty"`
	Breadcrumbs []Breadcrumb           `json:"breadcrumbs,omitempty"`
	Tags        map[string]string      `json:"tags,omitempty"`
	Extra       map[string]interface{} `json:"extra,omitempty"`
	Fingerprint string                 `json:"fingerprint,omitempty"`
}

// ExceptionInfo holds information about a single exception.
type ExceptionInfo struct {
	Type       string       `json:"type"`
	Value      string       `json:"value"`
	Stacktrace []StackFrame `json:"stacktrace,omitempty"`
}

// StackFrame represents a single frame in a stacktrace.
type StackFrame struct {
	Filename    string `json:"filename"`
	Function    string `json:"function"`
	Lineno      int    `json:"lineno"`
	Colno       int    `json:"colno,omitempty"`
	AbsPath     string `json:"abs_path,omitempty"`
	InApp       bool   `json:"in_app"`
	ContextLine string `json:"context_line,omitempty"`
}

// Breadcrumb represents a breadcrumb trail entry.
type Breadcrumb struct {
	Timestamp string                 `json:"timestamp"`
	Type      string                 `json:"type,omitempty"`
	Category  string                 `json:"category,omitempty"`
	Message   string                 `json:"message,omitempty"`
	Data      map[string]interface{} `json:"data,omitempty"`
	Level     Level                  `json:"level,omitempty"`
}

// UserContext holds user-specific context for an event.
type UserContext struct {
	ID        string `json:"id,omitempty"`
	Email     string `json:"email,omitempty"`
	Username  string `json:"username,omitempty"`
	IPAddress string `json:"ip_address,omitempty"`
}

// RequestContext holds HTTP request context for an event.
type RequestContext struct {
	URL         string            `json:"url,omitempty"`
	Method      string            `json:"method,omitempty"`
	Headers     map[string]string `json:"headers,omitempty"`
	QueryString string            `json:"query_string,omitempty"`
	Data        interface{}       `json:"data,omitempty"`
}
