package bugwatch

import (
	"runtime"
	"strings"
)

// CaptureStacktrace captures the current goroutine's stack trace,
// skipping the specified number of callers.
func CaptureStacktrace(skip int) []StackFrame {
	const maxDepth = 50
	pcs := make([]uintptr, maxDepth)
	// skip + 1 to account for CaptureStacktrace itself
	n := runtime.Callers(skip+1, pcs)
	if n == 0 {
		return nil
	}
	pcs = pcs[:n]

	frames := runtime.CallersFrames(pcs)
	var stackFrames []StackFrame

	for {
		frame, more := frames.Next()

		sf := StackFrame{
			Filename: frame.File,
			Function: frame.Function,
			Lineno:   frame.Line,
			AbsPath:  frame.File,
			InApp:    isInApp(frame),
		}
		stackFrames = append(stackFrames, sf)

		if !more {
			break
		}
	}

	return stackFrames
}

// isInApp determines whether a stack frame belongs to application code
// (as opposed to standard library or vendored code).
func isInApp(frame runtime.Frame) bool {
	goroot := runtime.GOROOT()
	if goroot != "" && strings.HasPrefix(frame.File, goroot) {
		return false
	}
	if strings.Contains(frame.File, "/vendor/") || strings.Contains(frame.File, "\\vendor\\") {
		return false
	}
	if strings.Contains(frame.Function, "/vendor/") || strings.Contains(frame.Function, "\\vendor\\") {
		return false
	}
	return true
}
