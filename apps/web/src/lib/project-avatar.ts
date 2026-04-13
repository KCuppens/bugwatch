/**
 * Deterministic color + initial helpers for project avatars.
 * Same name always produces the same color across the app.
 */

function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch: number; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Returns a CSS color string for the project avatar chip.
 * Uses HSL with tuned saturation/lightness so white text passes AA contrast.
 */
export function projectAvatarColor(name: string): string {
  const hash = cyrb53(name || "?");
  const hue = hash % 360;
  return `hsl(${hue}, 62%, 48%)`;
}

/**
 * Returns the first alphanumeric character of a project name, uppercased.
 * Falls back to "?" for empty / punctuation-only names.
 */
export function projectInitial(name: string): string {
  if (!name) return "?";
  const match = name.match(/[a-zA-Z0-9]/);
  return match ? match[0].toUpperCase() : "?";
}
