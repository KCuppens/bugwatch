import { toast } from "sonner";

/**
 * Extract a user-friendly message from an unknown error.
 *
 * Convention:
 * - `toast` (via `showErrorToast`) for user-initiated actions (save, delete, etc.)
 * - Inline alert for form validation errors
 * - Error boundary for unexpected crashes
 */
export function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "Something went wrong. Please try again.";
}

/** Show a sonner error toast with a consistent format. */
export function showErrorToast(error: unknown, title = "Error") {
  toast.error(title, { description: getErrorMessage(error) });
}
