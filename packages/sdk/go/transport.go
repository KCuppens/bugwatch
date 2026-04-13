package bugwatch

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Transport defines the interface for sending error events to the Bugwatch API.
type Transport interface {
	Send(event *ErrorEvent) error
}

// HttpTransport sends events over HTTP to the Bugwatch API.
type HttpTransport struct {
	httpClient *http.Client
	serverURL  string
	apiKey     string
}

// NewHttpTransport creates a new HttpTransport with the given server URL and API key.
func NewHttpTransport(serverURL, apiKey string) *HttpTransport {
	return &HttpTransport{
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		serverURL: serverURL,
		apiKey:    apiKey,
	}
}

// Send serializes the event to JSON and POSTs it to the Bugwatch API.
func (t *HttpTransport) Send(event *ErrorEvent) error {
	body, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("bugwatch: failed to marshal event: %w", err)
	}

	url := t.serverURL + "/api/v1/events"
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("bugwatch: failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+t.apiKey)

	resp, err := t.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("bugwatch: failed to send event: %w", err)
	}
	defer func() {
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
	}()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("bugwatch: server returned status %d", resp.StatusCode)
	}

	return nil
}

// NoopTransport discards all events silently.
type NoopTransport struct{}

// Send discards the event and returns nil.
func (t *NoopTransport) Send(_ *ErrorEvent) error {
	return nil
}

// ConsoleTransport prints events to stdout for debugging.
type ConsoleTransport struct{}

// Send prints the event as formatted JSON to stdout.
func (t *ConsoleTransport) Send(event *ErrorEvent) error {
	data, err := json.MarshalIndent(event, "", "  ")
	if err != nil {
		return fmt.Errorf("bugwatch: failed to marshal event: %w", err)
	}
	fmt.Printf("[Bugwatch] Event captured:\n%s\n", string(data))
	return nil
}
