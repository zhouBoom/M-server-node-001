import express from 'express';
import http from 'http';
import WebSocket from 'ws';
import logger from './logger';
import socketManager from './socketManager';

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 处理WebSocket连接
wss.on('connection', (ws, req) => {
    try {
        // 从查询参数获取clientId，如果没有则生成新的
        const url = new URL(req.url || '', 'http://localhost:3000');
        let clientId = url.searchParams.get('clientId');
        
        if (!clientId) {
            clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            logger.info(`Generated new clientId: ${clientId}`);
        }

        // 处理客户端连接
        socketManager.handleConnection(ws, clientId);
    } catch (error) {
        logger.error('Error accepting WebSocket connection', error);
        ws.terminate();
    }
});

// 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
});

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// 处理进程终止
process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down...');
    socketManager.closeAllConnections();
    server.close(() => {
        logger.info('Server closed');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down...');
    socketManager.closeAllConnections();
    server.close(() => {
        logger.info('Server closed');
        process.exit(0);
    });
});