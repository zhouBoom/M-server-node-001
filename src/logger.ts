import { createLogger, format, transports } from 'winston';
import path from 'path';
import fs from 'fs';

// 确保日志目录存在
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// 自定义格式化函数
const customFormat = format.combine(
    format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
    }),
    format.errors({
        stack: true
    }),
    format.printf((info) => {
        const { timestamp, level, message, ...meta } = info;
        let logMessage = `${timestamp} [${level.toUpperCase()}] ${message}`;
        
        if (Object.keys(meta).length > 0) {
            logMessage += ` ${JSON.stringify(meta, null, 2)}`;
        }
        
        return logMessage;
    })
);

// 创建日志记录器
const logger = createLogger({
    level: 'info',
    format: customFormat,
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
        }),
        // 控制台输出
        new transports.Console({
            format: format.combine(
                format.colorize(),
                customFormat
            )
        })
    ]
});

export default logger;