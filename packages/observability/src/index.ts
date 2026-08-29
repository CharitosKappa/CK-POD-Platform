import { SpanStatusCode, trace, type Attributes } from '@opentelemetry/api';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogContext = Record<string, unknown>;

export interface StructuredLogRecord {
  timestamp: string;
  level: LogLevel;
  service: string;
  event: string;
  context?: LogContext;
}

export interface AppLogger {
  debug(event: string, context?: LogContext): void;
  info(event: string, context?: LogContext): void;
  warn(event: string, context?: LogContext): void;
  error(event: string, context?: LogContext): void;
}

export interface LoggerOptions {
  service: string;
  minimumLevel?: LogLevel;
  write?: (record: StructuredLogRecord) => void;
}

const levelWeight: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const sensitiveKey = /(authorization|cookie|password|secret|token|api[-_]?key)/i;

export function parseLogLevel(value: string | undefined): LogLevel {
  return value === 'debug' || value === 'warn' || value === 'error' || value === 'info'
    ? value
    : 'info';
}

export function createLogger(options: LoggerOptions): AppLogger {
  const minimumLevel = options.minimumLevel ?? 'info';
  const write =
    options.write ??
    ((record: StructuredLogRecord) => {
      console.log(JSON.stringify(record));
    });

  const log = (level: LogLevel, event: string, context?: LogContext): void => {
    if (levelWeight[level] < levelWeight[minimumLevel]) {
      return;
    }

    const record: StructuredLogRecord = {
      timestamp: new Date().toISOString(),
      level,
      service: options.service,
      event,
      ...(context ? { context: redactSensitiveValues(context) as LogContext } : {}),
    };
    write(record);
  };

  return {
    debug: (event, context) => log('debug', event, context),
    info: (event, context) => log('info', event, context),
    warn: (event, context) => log('warn', event, context),
    error: (event, context) => log('error', event, context),
  };
}

export function redactSensitiveValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveValues);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        sensitiveKey.test(key) ? '[REDACTED]' : redactSensitiveValues(child),
      ]),
    );
  }

  return value;
}

/**
 * Adds a vendor-neutral span to an operation. Exporter setup is deliberately
 * deployment-owned; this shared contract remains OpenTelemetry-compatible.
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  operation: () => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer('let-it-be-platform');

  return tracer.startActiveSpan(name, async (span) => {
    span.setAttributes(attributes);

    try {
      const result = await operation();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    } finally {
      span.end();
    }
  });
}
