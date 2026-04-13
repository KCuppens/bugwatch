package bugwatch

import (
	"testing"
)

func TestGenerateFingerprintConsistency(t *testing.T) {
	event := &ErrorEvent{
		Exception: &ExceptionInfo{
			Type:  "RuntimeError",
			Value: "something broke",
			Stacktrace: []StackFrame{
				{Filename: "main.go", Function: "main.handleRequest", InApp: true},
			},
		},
	}

	fp1 := GenerateFingerprint(event)
	fp2 := GenerateFingerprint(event)

	if fp1 != fp2 {
		t.Errorf("Fingerprint should be consistent: got %s and %s", fp1, fp2)
	}

	if fp1 == "" {
		t.Error("Fingerprint should not be empty")
	}
}

func TestGenerateFingerprintDifferentInputs(t *testing.T) {
	event1 := &ErrorEvent{
		Exception: &ExceptionInfo{
			Type:  "RuntimeError",
			Value: "error one",
			Stacktrace: []StackFrame{
				{Filename: "main.go", Function: "main.handler", InApp: true},
			},
		},
	}

	event2 := &ErrorEvent{
		Exception: &ExceptionInfo{
			Type:  "TypeError",
			Value: "error two",
			Stacktrace: []StackFrame{
				{Filename: "api.go", Function: "api.process", InApp: true},
			},
		},
	}

	fp1 := GenerateFingerprint(event1)
	fp2 := GenerateFingerprint(event2)

	if fp1 == fp2 {
		t.Errorf("Different events should produce different fingerprints: both got %s", fp1)
	}
}

func TestGenerateFingerprintNoException(t *testing.T) {
	event := &ErrorEvent{}

	fp := GenerateFingerprint(event)
	if fp == "" {
		t.Error("Fingerprint should not be empty even without exceptions")
	}
}

func TestGenerateFingerprintUsesFirstInAppFrame(t *testing.T) {
	event1 := &ErrorEvent{
		Exception: &ExceptionInfo{
			Type:  "Error",
			Value: "oops",
			Stacktrace: []StackFrame{
				{Filename: "vendor/lib.go", Function: "lib.Do", InApp: false},
				{Filename: "main.go", Function: "main.run", InApp: true},
				{Filename: "handler.go", Function: "handler.serve", InApp: true},
			},
		},
	}

	event2 := &ErrorEvent{
		Exception: &ExceptionInfo{
			Type:  "Error",
			Value: "oops",
			Stacktrace: []StackFrame{
				{Filename: "vendor/lib.go", Function: "lib.Do", InApp: false},
				{Filename: "other.go", Function: "other.run", InApp: true},
			},
		},
	}

	fp1 := GenerateFingerprint(event1)
	fp2 := GenerateFingerprint(event2)

	if fp1 == fp2 {
		t.Error("Events with different first in-app frames should have different fingerprints")
	}
}
