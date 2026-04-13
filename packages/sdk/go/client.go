package bugwatch

import (
	"context"
	"fmt"
	"log"
	"os"
	"reflect"
	"sync"
	"time"
)

// BugwatchClient is the core client for capturing and sending error events.
type BugwatchClient struct {
	options   *BugwatchOptions
	transport Transport
	mu        sync.RWMutex
}

// NewClient creates a new BugwatchClient with the given options.
func NewClient(options *BugwatchOptions) (*BugwatchClient, error) {
	if options == nil {
		return nil, fmt.Errorf("bugwatch: options must not be nil")
	}

	options.applyDefaults()

	if options.ApiKey == "" {
		return nil, fmt.Errorf("bugwatch: ApiKey is required (set via options or BUGWATCH_API_KEY env var)")
	}

	transport := Transport(NewHttpTransport(options.ServerURL, options.ApiKey))

	client := &BugwatchClient{
		options:   options,
		transport: transport,
	}

	if options.Debug {
		log.Printf("[Bugwatch] Client initialized (env=%s, release=%s, server=%s)",
			options.Environment, options.Release, options.ServerURL)
	}

	return client, nil
}

// CaptureException captures an error and sends it as an event.
// Returns the event ID.
func (c *BugwatchClient) CaptureException(err error) string {
	return c.CaptureExceptionWithContext(context.Background(), err)
}

// CaptureExceptionWithContext captures an error with context enrichment
// (user, breadcrumbs, request) and sends it as an event. Returns the event ID.
func (c *BugwatchClient) CaptureExceptionWithContext(ctx context.Context, err error) string {
	if err == nil {
		return ""
	}

	c.mu.RLock()
	opts := c.options
	c.mu.RUnlock()

	event := &ErrorEvent{
		ID:          generateUUID(),
		Timestamp:   time.Now().UTC().Format(time.RFC3339Nano),
		Level:       LevelError,
		Platform:    "go",
		Environment: opts.Environment,
		Release:     opts.Release,
	}

	// Set server name from hostname
	if hostname, hostErr := os.Hostname(); hostErr == nil {
		event.ServerName = hostname
	}

	// Build exception info
	exInfo := &ExceptionInfo{
		Type:       reflect.TypeOf(err).String(),
		Value:      err.Error(),
		Stacktrace: CaptureStacktrace(3), // skip CaptureStacktrace, CaptureExceptionWithContext, caller
	}
	event.Exception = exInfo

	// Enrich from context
	if user := GetUser(ctx); user != nil {
		event.User = user
	}
	if crumbs := GetBreadcrumbs(ctx); len(crumbs) > 0 {
		event.Breadcrumbs = crumbs
	}
	if rc := GetRequestContext(ctx); rc != nil {
		event.Request = rc
	}

	// Generate fingerprint
	event.Fingerprint = GenerateFingerprint(event)

	// Call beforeSend if set
	if opts.BeforeSend != nil {
		event = opts.BeforeSend(event)
		if event == nil {
			if opts.Debug {
				log.Printf("[Bugwatch] Event dropped by BeforeSend callback")
			}
			return ""
		}
	}

	if opts.Debug {
		log.Printf("[Bugwatch] Capturing exception: %s - %s (id=%s)", exInfo.Type, exInfo.Value, event.ID)
	}

	if sendErr := c.transport.Send(event); sendErr != nil {
		if opts.Debug {
			log.Printf("[Bugwatch] Failed to send event: %v", sendErr)
		}
	}

	return event.ID
}

// CaptureMessage captures a message at the given level and sends it as an event.
// Returns the event ID.
func (c *BugwatchClient) CaptureMessage(msg string, level Level) string {
	c.mu.RLock()
	opts := c.options
	c.mu.RUnlock()

	event := &ErrorEvent{
		ID:          generateUUID(),
		Timestamp:   time.Now().UTC().Format(time.RFC3339Nano),
		Level:       level,
		Platform:    "go",
		Environment: opts.Environment,
		Release:     opts.Release,
	}

	if hostname, err := os.Hostname(); err == nil {
		event.ServerName = hostname
	}

	event.Exception = &ExceptionInfo{
		Type:  "Message",
		Value: msg,
	}

	event.Fingerprint = GenerateFingerprint(event)

	if opts.BeforeSend != nil {
		event = opts.BeforeSend(event)
		if event == nil {
			if opts.Debug {
				log.Printf("[Bugwatch] Event dropped by BeforeSend callback")
			}
			return ""
		}
	}

	if opts.Debug {
		log.Printf("[Bugwatch] Capturing message: %s (level=%s, id=%s)", msg, level, event.ID)
	}

	if sendErr := c.transport.Send(event); sendErr != nil {
		if opts.Debug {
			log.Printf("[Bugwatch] Failed to send event: %v", sendErr)
		}
	}

	return event.ID
}

// Flush is a no-op placeholder for future buffered transport support.
func (c *BugwatchClient) Flush() {
	// Currently a no-op; reserved for future buffered transports.
}

// Close flushes pending events and releases resources.
func (c *BugwatchClient) Close() {
	c.Flush()
}
