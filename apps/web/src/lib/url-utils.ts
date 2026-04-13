/**
 * Validate that a URL uses a safe protocol (http or https).
 * Prevents javascript:, data:, and other dangerous URI schemes.
 */
export function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Returns the URL if it's a valid HTTP(S) URL, otherwise returns undefined.
 * Use this to sanitize URLs before rendering in href attributes.
 */
export function sanitizeUrl(url: string): string | undefined {
  return isValidHttpUrl(url) ? url : undefined;
}
