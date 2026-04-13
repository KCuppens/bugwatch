package bugwatch

import (
	"os"
	"strings"
)

const defaultServerURL = "https://api.bugwatch.dev"

// BugwatchOptions configures the Bugwatch SDK client.
type BugwatchOptions struct {
	// ApiKey is the API key used to authenticate with the Bugwatch API.
	// Falls back to BUGWATCH_API_KEY environment variable if empty.
	ApiKey string

	// Environment is the environment name (e.g. "production", "staging").
	// Falls back to BUGWATCH_ENVIRONMENT environment variable if empty.
	Environment string

	// Release is the release/version identifier for the application.
	// Falls back to BUGWATCH_RELEASE environment variable if empty.
	Release string

	// Debug enables debug logging when true.
	// Falls back to BUGWATCH_DEBUG environment variable ("true"/"1") if not set.
	Debug bool

	// BeforeSend is an optional callback invoked before sending an event.
	// Return nil to drop the event, or modify and return the event.
	BeforeSend func(event *ErrorEvent) *ErrorEvent

	// ServerURL is the base URL of the Bugwatch API server.
	// Defaults to https://api.bugwatch.dev if empty.
	ServerURL string
}

// applyDefaults fills in missing options from environment variables and defaults.
func (o *BugwatchOptions) applyDefaults() {
	if o.ApiKey == "" {
		o.ApiKey = os.Getenv("BUGWATCH_API_KEY")
	}

	if o.Environment == "" {
		o.Environment = os.Getenv("BUGWATCH_ENVIRONMENT")
	}

	if o.Release == "" {
		o.Release = os.Getenv("BUGWATCH_RELEASE")
	}

	if !o.Debug {
		debugEnv := os.Getenv("BUGWATCH_DEBUG")
		if strings.EqualFold(debugEnv, "true") || debugEnv == "1" {
			o.Debug = true
		}
	}

	if o.ServerURL == "" {
		o.ServerURL = defaultServerURL
	}
}
