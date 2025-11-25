import express from 'express';
import http from 'http';
import WebSocket from 'ws';
import logger from './logger';
import eventManager from './eventManager';
import socketManager from './socketManager';

const app = express();
const server = http.createServer(app);

// 中间件
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 健康检查路由
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: Date.now(),
        activeClients: eventManager.getActiveClientsCount()
    });
});

// 订阅事件路由 (SSE)
app.get('/subscribe/:clientId', (req, res) => {
    try {
        const clientId = req.params.clientId;
        if (!clientId) {
            res.status(400).json({ error: 'clientId is required' });
            return;
        }

        // 设置SSE响应头
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        // 添加客户端订阅
        eventManager.addClient(clientId, res);

        // 发送欢迎消息
        res.write(`data: ${JSON.stringify({ 
            type: 'welcome', 
            data: { 
                clientId, 
                message: 'Successfully subscribed to events',
                activeClients: eventManager.getActiveClientsCount()
            },
            clientId: 'server',
            timestamp: Date.now()
        })}

`);

        logger.info(`Client ${clientId} subscribed to events`);

    } catch (error) {
        logger.error('Error in subscribe route', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 发布事件路由
app.post('/publish/:clientId', (req, res) => {
    try {
        const clientId = req.params.clientId;
        const { type, data } = req.body;

        if (!clientId) {
            res.status(400).json({ error: 'clientId is required' });
            return;
        }

        if (!type) {
            res.status(400).json({ error: 'event type is required' });
            return;
        }

        // 发布事件
        eventManager.publishEvent(clientId, type, data);

        res.json({ 
            success: true, 
            message: 'Event published successfully',
            timestamp: Date.now()
        });

        logger.info(`Client ${clientId} published event: ${type}`, data);

    } catch (error) {
        logger.error('Error in publish route', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 获取事件历史记录路由
app.get('/history', (req, res) => {
    try {
        const limit = parseInt(req.query.limit as string) || 100;
        const history = eventManager.getEventHistory(limit);

        res.json({ 
            success: true, 
            history,
            total: history.length
        });

    } catch (error) {
        logger.error('Error in history route', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 获取当前活跃客户端数量路由
app.get('/clients', (req, res) => {
    try {
        const activeClients = eventManager.getActiveClientsCount();

        res.json({ 
            success: true, 
            activeClients
        });

    } catch (error) {
        logger.error('Error in clients route', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 配置WebSocket服务器
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    try {
        // 从URL中获取clientId
        const urlParams = new URLSearchParams(req.url?.split('?')[1] || '');
        const clientId = urlParams.get('clientId');
        
        if (!clientId) {
            logger.error('WebSocket connection failed: clientId is required');
            ws.close(4001, 'clientId is required');
            return;
        }
        
        logger.info(`WebSocket connection established for client: ${clientId}`);
        
        // 处理WebSocket连接
        socketManager.handleConnection(ws, clientId);
    } catch (error) {
        logger.error('Error handling WebSocket connection', error);
        ws.close(5000, 'Internal server error');
    }
});

// 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`API endpoints:
- GET /health - Health check
- GET /subscribe/:clientId - Subscribe to events (SSE)
- POST /publish/:clientId - Publish event
- GET /history - Get event history
- GET /clients - Get active clients count`);
    logger.info(`WebSocket server is running on ws://localhost:${PORT}`);
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
process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down...');
    
    // 关闭所有WebSocket连接
    await socketManager.closeAllConnections();
    
    server.close(() => {
        logger.info('Server closed');
        process.exit(0);
    });
});

process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down...');
    
    // 关闭所有WebSocket连接
    await socketManager.closeAllConnections();
    
    server.close(() => {
        logger.info('Server closed');
        process.exit(0);
    });
});
