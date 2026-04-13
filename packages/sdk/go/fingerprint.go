package bugwatch

import (
	"crypto/sha256"
	"fmt"
)

// GenerateFingerprint creates a SHA256-based fingerprint from the event's
// exception type, value, and the first in-app stack frame's filename and function.
func GenerateFingerprint(event *ErrorEvent) string {
	var exType, exValue, frameFilename, frameFunction string

	if event.Exception != nil {
		exType = event.Exception.Type
		exValue = event.Exception.Value

		for _, frame := range event.Exception.Stacktrace {
			if frame.InApp {
				frameFilename = frame.Filename
				frameFunction = frame.Function
				break
			}
		}
	}

	input := exType + exValue + frameFilename + frameFunction
	hash := sha256.Sum256([]byte(input))
	return fmt.Sprintf("%x", hash)
}
