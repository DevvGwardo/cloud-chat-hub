import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

// Electron main + pino-pretty's worker-thread transport fight on quit:
// before-quit tears down workers, then SIGINT handlers try to log and
// thread-stream throws "the worker is ending" as an uncaught exception.
// Use the sync destination in Electron so shutdown logging is safe.
const isElectronMain =
  typeof process.versions === 'object' &&
  process.versions !== null &&
  typeof (process.versions as NodeJS.ProcessVersions & { electron?: string }).electron === 'string';

const usePrettyTransport = !isProduction && !isElectronMain && process.env.PINO_PRETTY !== '0';

export const logger = pino({
  level,
  ...(usePrettyTransport
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : {}),
});

/**
 * Request ID middleware — attaches a unique ID to each request
 * and includes it in all log lines via child logger.
 */
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction) {
  const requestId = randomUUID();
  const typedReq = req as Request & { requestId: string; log: pino.Logger };
  typedReq.requestId = requestId;
  typedReq.log = logger.child({ requestId });
  next();
}