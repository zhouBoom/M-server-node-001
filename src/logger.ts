import { createLogger, format, transports, Logger } from 'winston';
import path from 'path';
import fs from 'fs';

// 确保日志目录存在
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// 基础日志记录器，没有自定义格式化，避免JSON.stringify问题
const baseLogger = createLogger({
    level: 'info',
    format: format.combine(
        format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        format.errors({
            stack: true
        })
    ),
    transports: [
        // 错误日志文件
        new transports.File({
            filename: path.join(logDir, 'error.log'),
            level: 'error',
            maxsize: 10485760, // 10MB
            maxFiles: 5,
            tailable: true
        }),
        // 所有日志文件
        new transports.File({
            filename: path.join(logDir, 'server.log'),
            maxsize: 10485760, // 10MB
            maxFiles: 5,
            tailable: true
        })
    ]
});

// 安全的JSON.stringify函数
const safeStringify = (obj: any): string => {
    try {
        return JSON.stringify(obj, null, 2);
    } catch (e) {
        return `[Circular or non-serializable object: ${e instanceof Error ? e.message : String(e)}]`;
    }
};

// 日志记录保护标志
let isLoggingError = false;

// 安全日志记录器，防止日志记录过程中出现死循环
const safeLogger: Logger = {
    ...baseLogger,
    log: (info: any, callback?: () => void) => {
        if (isLoggingError) {
            // 如果正在处理日志错误，只打印到控制台，不记录到文件
            console.error('Logging error occurred while processing another log:', info);
            return;
        }
        try {
            // 自定义格式化
            const { timestamp, level, message, ...meta } = info;
            let logMessage = `${timestamp} [${level.toUpperCase()}] ${message}`;
            
            if (Object.keys(meta).length > 0) {
                logMessage += ` ${safeStringify(meta)}`;
            }
            
            // 使用基础日志记录器记录格式化后的消息
            baseLogger.log({ ...info, message: logMessage });
            
            // 同时输出到控制台
            console[level in console ? level : 'log'](logMessage);
            
            if (callback) callback();
        } catch (e) {
            if (!isLoggingError) {
                isLoggingError = true;
                console.error('Error in safeLogger:', e);
                console.error('Original log info:', info);
                isLoggingError = false;
            }
        }
    },
    error: (message: any, ...meta: any[]) => {
        safeLogger.log({ level: 'error', message, ...meta });
    },
    warn: (message: any, ...meta: any[]) => {
        safeLogger.log({ level: 'warn', message, ...meta });
    },
    info: (message: any, ...meta: any[]) => {
        safeLogger.log({ level: 'info', message, ...meta });
    },
    http: (message: any, ...meta: any[]) => {
        safeLogger.log({ level: 'http', message, ...meta });
    },
    verbose: (message: any, ...meta: any[]) => {
        safeLogger.log({ level: 'verbose', message, ...meta });
    },
    debug: (message: any, ...meta: any[]) => {
        safeLogger.log({ level: 'debug', message, ...meta });
    },
    silly: (message: any, ...meta: any[]) => {
        safeLogger.log({ level: 'silly', message, ...meta });
    }
};

export default safeLogger;