package bugwatch

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestHttpTransportSend(t *testing.T) {
	var receivedBody []byte
	var receivedAuth string
	var receivedContentType string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/events" {
			t.Errorf("Expected path /api/v1/events, got %s", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Errorf("Expected POST, got %s", r.Method)
		}

		receivedAuth = r.Header.Get("Authorization")
		receivedContentType = r.Header.Get("Content-Type")

		body, _ := io.ReadAll(r.Body)
		receivedBody = body

		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	transport := NewHttpTransport(server.URL, "test-api-key")

	event := &ErrorEvent{
		ID:        "test-id",
		Timestamp: "2026-01-01T00:00:00Z",
		Level:     LevelError,
		Platform:  "go",
		Exception: &ExceptionInfo{Type: "TestError", Value: "test error message"},
	}

	err := transport.Send(event)
	if err != nil {
		t.Fatalf("Send failed: %v", err)
	}

	if receivedAuth != "Bearer test-api-key" {
		t.Errorf("Expected Authorization 'Bearer test-api-key', got '%s'", receivedAuth)
	}

	if receivedContentType != "application/json" {
		t.Errorf("Expected Content-Type 'application/json', got '%s'", receivedContentType)
	}

	var decoded ErrorEvent
	if err := json.Unmarshal(receivedBody, &decoded); err != nil {
		t.Fatalf("Failed to decode received body: %v", err)
	}

	if decoded.ID != "test-id" {
		t.Errorf("Event ID mismatch: got %s", decoded.ID)
	}
	if decoded.Level != LevelError {
		t.Errorf("Level mismatch: got %s", decoded.Level)
	}
}

func TestHttpTransportServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	transport := NewHttpTransport(server.URL, "test-key")
	event := &ErrorEvent{
		ID:       "test-id",
		Level:    LevelError,
		Platform: "go",
	}

	err := transport.Send(event)
	if err == nil {
		t.Fatal("Send should return error for 500 response")
	}
	if !strings.Contains(err.Error(), "500") {
		t.Errorf("Error should mention status code 500, got: %v", err)
	}
}

func TestNoopTransport(t *testing.T) {
	transport := &NoopTransport{}
	event := &ErrorEvent{
		ID:       "test-id",
		Level:    LevelError,
		Platform: "go",
	}

	err := transport.Send(event)
	if err != nil {
		t.Fatalf("NoopTransport.Send should return nil, got: %v", err)
	}
}

func TestConsoleTransport(t *testing.T) {
	transport := &ConsoleTransport{}
	event := &ErrorEvent{
		ID:        "test-id",
		Level:     LevelInfo,
		Platform:  "go",
		Exception: &ExceptionInfo{Type: "TestError", Value: "console test"},
	}

	// Capture stdout
	oldStdout := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	err := transport.Send(event)

	w.Close()
	os.Stdout = oldStdout

	if err != nil {
		t.Fatalf("ConsoleTransport.Send should not error, got: %v", err)
	}

	var buf bytes.Buffer
	_, _ = io.Copy(&buf, r)
	output := buf.String()

	if !strings.Contains(output, "[Bugwatch]") {
		t.Error("Console output should contain [Bugwatch] prefix")
	}
	if !strings.Contains(output, "test-id") {
		t.Error("Console output should contain event ID")
	}
}
