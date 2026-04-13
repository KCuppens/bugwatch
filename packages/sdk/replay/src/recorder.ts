import type { ReplayOptions, ReplaySegment } from './types';

export class ReplayRecorder {
  private sessionId: string;
  private events: unknown[] = [];
  private segmentIndex = 0;
  private stopFn?: () => void;
  private flushTimer?: ReturnType<typeof setInterval>;
  private options: Required<ReplayOptions>;
  private onSegment: (segment: ReplaySegment) => void;

  constructor(
    sessionId: string,
    onSegment: (segment: ReplaySegment) => void,
    options?: ReplayOptions,
  ) {
    this.sessionId = sessionId;
    this.onSegment = onSegment;
    this.options = {
      sessionSampleRate: options?.sessionSampleRate ?? 1.0,
      maxSegmentSize: options?.maxSegmentSize ?? 500 * 1024,
      segmentInterval: options?.segmentInterval ?? 30000,
      maskAllInputs: options?.maskAllInputs ?? true,
      maskAllText: options?.maskAllText ?? false,
      blockSelector: options?.blockSelector ?? '',
    };
  }

  async start(): Promise<void> {
    if (Math.random() > this.options.sessionSampleRate) return;

    try {
      const rrweb = await import('rrweb');
      this.stopFn = rrweb.record({
        emit: (event: unknown) => {
          // Cap buffered events to prevent unbounded growth between flushes.
          // A busy page can generate hundreds of mutations/sec; 5 000 events
          // is enough for a full segment without risking a multi-MB stringify.
          if (this.events.length < 5000) {
            this.events.push(event);
          }
        },
        maskAllInputs: this.options.maskAllInputs,
        maskTextSelector: this.options.maskAllText ? '*' : undefined,
        blockSelector: this.options.blockSelector || undefined,
      });
    } catch {
      // rrweb not available (SSR or unsupported browser)
      return;
    }

    this.flushTimer = setInterval(() => this.flush(), this.options.segmentInterval);
  }

  flush(): void {
    if (this.events.length === 0) return;

    try {
      const jsonStr = JSON.stringify(this.events);
      // Base64 encode the JSON string
      const encoded =
        typeof btoa === 'function'
          ? btoa(unescape(encodeURIComponent(jsonStr)))
          : Buffer.from(jsonStr).toString('base64');

      const segment: ReplaySegment = {
        sessionId: this.sessionId,
        segmentIndex: this.segmentIndex++,
        data: encoded,
        startedAt: new Date().toISOString(),
        userAgent:
          typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        screenWidth: typeof screen !== 'undefined' ? screen.width : undefined,
        screenHeight: typeof screen !== 'undefined' ? screen.height : undefined,
      };

      this.onSegment(segment);
      this.events = [];
    } catch {
      // Encoding error, skip this segment
    }
  }

  stop(): void {
    this.flush();
    if (this.stopFn) this.stopFn();
    if (this.flushTimer) clearInterval(this.flushTimer);
  }
}
