package bugwatch

import (
	"context"
	"fmt"
	"log"
	"sync"
)

var (
	globalClient *BugwatchClient
	globalMu     sync.RWMutex
)

// Init initializes the global Bugwatch client with the given options.
// Must be called before using any package-level capture functions.
func Init(options *BugwatchOptions) error {
	client, err := NewClient(options)
	if err != nil {
		return err
	}

	globalMu.Lock()
	globalClient = client
	globalMu.Unlock()

	return nil
}

// getClient returns the global client, or nil if not initialized.
func getClient() *BugwatchClient {
	globalMu.RLock()
	defer globalMu.RUnlock()
	return globalClient
}

// CaptureException captures an error using the global client.
// Returns the event ID, or an empty string if the client is not initialized.
func CaptureException(err error) string {
	client := getClient()
	if client == nil {
		return ""
	}
	return client.CaptureException(err)
}

// CaptureMessage captures a message at the given level using the global client.
// Returns the event ID, or an empty string if the client is not initialized.
func CaptureMessage(msg string, level Level) string {
	client := getClient()
	if client == nil {
		return ""
	}
	return client.CaptureMessage(msg, level)
}

// CaptureExceptionWithContext captures an error with context enrichment
// using the global client. Returns the event ID.
func CaptureExceptionWithContext(ctx context.Context, err error) string {
	client := getClient()
	if client == nil {
		return ""
	}
	return client.CaptureExceptionWithContext(ctx, err)
}

// RecoverAndCaptureException recovers from a panic and captures it as an
// exception using the global client. Intended to be used with defer:
//
//	defer bugwatch.RecoverAndCaptureException()
func RecoverAndCaptureException() {
	if r := recover(); r != nil {
		client := getClient()
		if client == nil {
			return
		}

		var err error
		switch v := r.(type) {
		case error:
			err = v
		case string:
			err = fmt.Errorf("%s", v)
		default:
			err = fmt.Errorf("panic: %v", v)
		}

		client.mu.RLock()
		debug := client.options.Debug
		client.mu.RUnlock()

		if debug {
			log.Printf("[Bugwatch] Recovered panic: %v", err)
		}

		client.CaptureException(err)
	}
}

// Flush flushes any pending events in the global client.
func Flush() {
	client := getClient()
	if client == nil {
		return
	}
	client.Flush()
}

// Close flushes and closes the global client.
func Close() {
	client := getClient()
	if client == nil {
		return
	}
	client.Close()

	globalMu.Lock()
	globalClient = nil
	globalMu.Unlock()
}
