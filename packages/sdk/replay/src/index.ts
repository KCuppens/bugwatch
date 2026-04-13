import { ReplayRecorder } from './recorder';
import { ReplayTransport } from './transport';
import type { ReplayOptions } from './types';

export { ReplayRecorder, ReplayTransport };
export type { ReplayOptions, ReplaySegment } from './types';

let idCounter = 0;
function generateSessionId(): string {
  return (
    Date.now().toString(36) +
    (idCounter++).toString(36) +
    Math.random().toString(36).slice(2, 8)
  );
}

export class BugwatchReplay {
  private recorder: ReplayRecorder;
  private transport: ReplayTransport;
  private sessionId: string;

  constructor(
    options: { endpoint: string; apiKey: string } & ReplayOptions,
  ) {
    this.sessionId = generateSessionId();
    this.transport = new ReplayTransport(options.endpoint, options.apiKey);
    this.recorder = new ReplayRecorder(
      this.sessionId,
      (segment) => this.transport.sendSegment(segment),
      options,
    );
  }

  getSessionId(): string {
    return this.sessionId;
  }

  async start(): Promise<void> {
    await this.recorder.start();
  }

  flush(): void {
    this.recorder.flush();
  }

  stop(): void {
    this.recorder.stop();
    this.transport.finish(this.sessionId);
  }
}
