package bugwatch

import (
	"crypto/rand"
	"fmt"
)

// generateUUID generates a v4 UUID using crypto/rand.
func generateUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	// Set version (4) and variant (RFC 4122)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
