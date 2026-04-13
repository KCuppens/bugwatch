export interface ReplayOptions {
  /** Percentage of sessions to record (0.0 to 1.0). Default: 1.0 */
  sessionSampleRate?: number;
  /** Maximum size of a single segment in bytes. Default: 500KB */
  maxSegmentSize?: number;
  /** Interval in ms between segment flushes. Default: 30000 (30s) */
  segmentInterval?: number;
  /** Mask all input values. Default: true */
  maskAllInputs?: boolean;
  /** Mask all text content. Default: false */
  maskAllText?: boolean;
  /** CSS selector for elements to block from recording */
  blockSelector?: string;
}

export interface ReplaySegment {
  sessionId: string;
  segmentIndex: number;
  data: string; // base64 compressed
  startedAt: string;
  userAgent?: string;
  screenWidth?: number;
  screenHeight?: number;
}
