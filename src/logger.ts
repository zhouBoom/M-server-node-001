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

// 导出基础日志记录器
// 我们直接使用baseLogger而不是扩展它，以避免类型错误
export default baseLogger;