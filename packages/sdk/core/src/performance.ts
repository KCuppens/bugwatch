import type { SpanData, PerformanceEvent } from './types';

let idCounter = 0;
function generateId(): string {
  return Date.now().toString(36) + (idCounter++).toString(36) + Math.random().toString(36).slice(2, 6);
}

let warnedExperimental = false;
function warnExperimentalOnce(): void {
  if (warnedExperimental) return;
  warnedExperimental = true;
  // eslint-disable-next-line no-console
  console.warn(
    "[Bugwatch] Performance monitoring is experimental and disabled by default. " +
    "Set `experimentalPerformance: true` in init() options to enable. " +
    "Transaction data will not be sent until you opt in."
  );
}

/**
 * @experimental Performance monitoring is experimental — the API and wire
 * format may change. Set `experimentalPerformance: true` in client options
 * to enable. Without the flag, `Transaction.finish()` is a no-op.
 */
export class Span {
  public readonly spanId: string;
  public readonly op: string;
  public readonly description?: string;
  public readonly parentSpanId?: string;
  protected startTimestamp: number;
  protected endTimestamp?: number;
  private status: string = 'ok';
  private _data: Record<string, unknown> = {};
  private children: Span[] = [];

  constructor(op: string, description?: string, parentSpanId?: string) {
    this.spanId = generateId();
    this.op = op;
    this.description = description;
    this.parentSpanId = parentSpanId;
    this.startTimestamp = Date.now();
  }

  startChild(op: string, description?: string): Span {
    const child = new Span(op, description, this.spanId);
    this.children.push(child);
    return child;
  }

  setStatus(status: string): void {
    this.status = status;
  }

  setData(key: string, value: unknown): void {
    this._data[key] = value;
  }

  finish(): void {
    this.endTimestamp = Date.now();
    for (const child of this.children) {
      if (!child.endTimestamp) child.finish();
    }
  }

  toJSON(): SpanData {
    return {
      span_id: this.spanId,
      parent_span_id: this.parentSpanId,
      op: this.op,
      description: this.description,
      status: this.status,
      duration_ms: (this.endTimestamp || Date.now()) - this.startTimestamp,
      started_at: new Date(this.startTimestamp).toISOString(),
      finished_at: new Date(this.endTimestamp || Date.now()).toISOString(),
      data: Object.keys(this._data).length > 0 ? this._data : undefined,
    };
  }

  getAllSpans(): SpanData[] {
    const spans: SpanData[] = [this.toJSON()];
    for (const child of this.children) {
      spans.push(...child.getAllSpans());
    }
    return spans;
  }
}

/**
 * @experimental Performance monitoring is experimental — see Span.
 */
export class Transaction extends Span {
  public readonly traceId: string;
  public readonly name: string;
  private tags: Record<string, string> = {};
  private onFinish?: (event: PerformanceEvent) => void;
  private environment?: string;
  private release?: string;
  private experimentalEnabled: boolean;

  constructor(
    name: string,
    op: string,
    onFinish?: (event: PerformanceEvent) => void,
    environment?: string,
    release?: string,
    experimentalEnabled = false,
  ) {
    super(op, name);
    this.traceId = generateId();
    this.name = name;
    this.onFinish = onFinish;
    this.environment = environment;
    this.release = release;
    this.experimentalEnabled = experimentalEnabled;
  }

  setTag(key: string, value: string): void {
    this.tags[key] = value;
  }

  finish(): void {
    super.finish();
    if (!this.experimentalEnabled) {
      warnExperimentalOnce();
      return;
    }
    if (this.onFinish) {
      const allSpans = this.getAllSpans();
      const rootSpan = allSpans.shift()!;
      this.onFinish({
        transaction_name: this.name,
        trace_id: this.traceId,
        span_id: this.spanId,
        op: this.op,
        description: this.description,
        status: rootSpan.status,
        duration_ms: rootSpan.duration_ms,
        started_at: rootSpan.started_at,
        finished_at: rootSpan.finished_at,
        environment: this.environment,
        release: this.release,
        tags: Object.keys(this.tags).length > 0 ? this.tags : undefined,
        spans: allSpans,
      });
    }
  }
}
