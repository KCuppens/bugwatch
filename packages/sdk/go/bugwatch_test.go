package bugwatch

import (
	"context"
	"errors"
	"sync"
	"testing"
)

// mockTransport implements Transport and stores captured events.
type mockTransport struct {
	mu     sync.Mutex
	events []*ErrorEvent
}

func (m *mockTransport) Send(event *ErrorEvent) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.events = append(m.events, event)
	return nil
}

func (m *mockTransport) getEvents() []*ErrorEvent {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*ErrorEvent, len(m.events))
	copy(out, m.events)
	return out
}

func newTestClient(t *testing.T) (*BugwatchClient, *mockTransport) {
	t.Helper()
	mock := &mockTransport{}
	opts := &BugwatchOptions{
		ApiKey:      "test-key",
		Environment: "test",
		Release:     "1.0.0",
		ServerURL:   "http://localhost",
	}
	opts.applyDefaults()
	client := &BugwatchClient{
		options:   opts,
		transport: mock,
	}
	return client, mock
}

func TestInit(t *testing.T) {
	// Reset global client
	globalMu.Lock()
	globalClient = nil
	globalMu.Unlock()

	err := Init(&BugwatchOptions{
		ApiKey:    "test-key",
		ServerURL: "http://localhost",
	})
	if err != nil {
		t.Fatalf("Init failed: %v", err)
	}

	client := getClient()
	if client == nil {
		t.Fatal("Global client should not be nil after Init")
	}

	// Cleanup
	Close()
}

func TestInitWithoutApiKey(t *testing.T) {
	// Reset global client
	globalMu.Lock()
	globalClient = nil
	globalMu.Unlock()

	// Ensure env var is not set
	t.Setenv("BUGWATCH_API_KEY", "")

	err := Init(&BugwatchOptions{})
	if err == nil {
		t.Fatal("Init should fail without an API key")
	}
}

func TestCaptureException(t *testing.T) {
	client, mock := newTestClient(t)

	testErr := errors.New("something went wrong")
	eventID := client.CaptureException(testErr)

	if eventID == "" {
		t.Fatal("CaptureException should return a non-empty event ID")
	}

	events := mock.getEvents()
	if len(events) != 1 {
		t.Fatalf("Expected 1 event, got %d", len(events))
	}

	event := events[0]

	if event.ID != eventID {
		t.Errorf("Event ID mismatch: got %s, want %s", event.ID, eventID)
	}
	if event.Platform != "go" {
		t.Errorf("Platform should be 'go', got %s", event.Platform)
	}
	if event.Level != LevelError {
		t.Errorf("Level should be 'error', got %s", event.Level)
	}
	if event.Environment != "test" {
		t.Errorf("Environment should be 'test', got %s", event.Environment)
	}
	if event.Release != "1.0.0" {
		t.Errorf("Release should be '1.0.0', got %s", event.Release)
	}
	if event.Exception == nil {
		t.Fatal("Exception should not be nil")
	}
	if event.Exception.Value != "something went wrong" {
		t.Errorf("Exception value mismatch: got %s", event.Exception.Value)
	}
	if event.Fingerprint == "" {
		t.Error("Fingerprint should not be empty")
	}
	if event.Timestamp == "" {
		t.Error("Timestamp should not be empty")
	}
}

func TestCaptureExceptionNil(t *testing.T) {
	client, mock := newTestClient(t)

	eventID := client.CaptureException(nil)

	if eventID != "" {
		t.Error("CaptureException(nil) should return empty string")
	}
	if len(mock.getEvents()) != 0 {
		t.Error("No event should be sent for nil error")
	}
}

func TestCaptureMessage(t *testing.T) {
	client, mock := newTestClient(t)

	eventID := client.CaptureMessage("test message", LevelWarning)

	if eventID == "" {
		t.Fatal("CaptureMessage should return a non-empty event ID")
	}

	events := mock.getEvents()
	if len(events) != 1 {
		t.Fatalf("Expected 1 event, got %d", len(events))
	}

	event := events[0]

	if event.Level != LevelWarning {
		t.Errorf("Level should be 'warning', got %s", event.Level)
	}
	if event.Exception == nil {
		t.Fatal("Exception should not be nil")
	}
	if event.Exception.Type != "Message" {
		t.Errorf("Exception type should be 'Message', got %s", event.Exception.Type)
	}
	if event.Exception.Value != "test message" {
		t.Errorf("Exception value should be 'test message', got %s", event.Exception.Value)
	}
}

func TestCaptureExceptionWithContext(t *testing.T) {
	client, mock := newTestClient(t)

	ctx := context.Background()
	ctx = WithUser(ctx, &UserContext{
		ID:    "user-123",
		Email: "test@example.com",
	})
	ctx = WithBreadcrumb(ctx, Breadcrumb{
		Message:  "navigated",
		Category: "navigation",
	})
	ctx = WithRequestContext(ctx, &RequestContext{
		URL:    "/api/test",
		Method: "GET",
	})

	testErr := errors.New("context error")
	eventID := client.CaptureExceptionWithContext(ctx, testErr)

	if eventID == "" {
		t.Fatal("Should return non-empty event ID")
	}

	events := mock.getEvents()
	event := events[0]

	if event.User == nil {
		t.Fatal("User context should be set")
	}
	if event.User.ID != "user-123" {
		t.Errorf("User ID should be 'user-123', got %s", event.User.ID)
	}
	if event.User.Email != "test@example.com" {
		t.Errorf("User email mismatch")
	}
	if len(event.Breadcrumbs) != 1 {
		t.Fatalf("Expected 1 breadcrumb, got %d", len(event.Breadcrumbs))
	}
	if event.Breadcrumbs[0].Message != "navigated" {
		t.Errorf("Breadcrumb message mismatch")
	}
	if event.Request == nil {
		t.Fatal("Request context should be set")
	}
	if event.Request.URL != "/api/test" {
		t.Errorf("Request URL should be '/api/test', got %s", event.Request.URL)
	}
}

func TestBeforeSendDrop(t *testing.T) {
	mock := &mockTransport{}
	opts := &BugwatchOptions{
		ApiKey:    "test-key",
		ServerURL: "http://localhost",
		BeforeSend: func(event *ErrorEvent) *ErrorEvent {
			return nil // drop all events
		},
	}
	opts.applyDefaults()
	client := &BugwatchClient{
		options:   opts,
		transport: mock,
	}

	eventID := client.CaptureException(errors.New("dropped"))

	if eventID != "" {
		t.Error("Should return empty string when BeforeSend drops event")
	}
	if len(mock.getEvents()) != 0 {
		t.Error("No event should be sent when BeforeSend returns nil")
	}
}

func TestBeforeSendModify(t *testing.T) {
	mock := &mockTransport{}
	opts := &BugwatchOptions{
		ApiKey:    "test-key",
		ServerURL: "http://localhost",
		BeforeSend: func(event *ErrorEvent) *ErrorEvent {
			event.Tags = map[string]string{"modified": "true"}
			return event
		},
	}
	opts.applyDefaults()
	client := &BugwatchClient{
		options:   opts,
		transport: mock,
	}

	client.CaptureException(errors.New("modified"))

	events := mock.getEvents()
	if len(events) != 1 {
		t.Fatalf("Expected 1 event, got %d", len(events))
	}
	if events[0].Tags["modified"] != "true" {
		t.Error("BeforeSend should have added the 'modified' tag")
	}
}
