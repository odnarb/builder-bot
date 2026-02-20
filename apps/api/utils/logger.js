/**
 * Lightweight structured logger for backend services.
 * Designed to be swappable with Google Cloud Logging later.
 */
export class Logger {
    /**
     * @param {{ service?: string }} [options]
     */
    constructor(options = {}) {
        this.service = options.service || 'api';
    }

    /**
     * Emit an info-level log.
     * @param {string} message
     * @param {Record<string, unknown>} [context]
     */
    info(message, context = {}) {
        this.#write('info', message, context);
    }

    /**
     * Emit a warning-level log.
     * @param {string} message
     * @param {Record<string, unknown>} [context]
     */
    warn(message, context = {}) {
        this.#write('warn', message, context);
    }

    /**
     * Emit an error-level log.
     * @param {string} message
     * @param {Record<string, unknown>} [context]
     */
    error(message, context = {}) {
        this.#write('error', message, context);
    }

    /**
     * Write a single structured log line.
     * @param {'info' | 'warn' | 'error'} level
     * @param {string} message
     * @param {Record<string, unknown>} context
     */
    #write(level, message, context) {
        const payload = {
            timestamp: new Date().toISOString(),
            service: this.service,
            level,
            message,
            context,
        };

        const line = JSON.stringify(payload);
        if (level === 'error') {
            console.error(line);
            return;
        }

        if (level === 'warn') {
            console.warn(line);
            return;
        }

        console.info(line);
    }
}

const logger = new Logger({ service: 'minecraft-ai-agent-api' });

export default logger;
