import pino from 'pino';

// Create logger instance with configuration
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
  // Redact sensitive fields
  redact: {
    paths: ['accessToken', 'refreshToken', 'token', 'messages.*.content'],
    remove: true,
  },
});

export default logger;
