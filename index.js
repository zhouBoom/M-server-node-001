const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 确保日志目录存在
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// 日志文件路径
const logFile = path.join(logDir, 'server.log');

/**
 * 记录日志到文件
 * @param {string} message - 日志内容
 */
const logToFile = (message) => {
    const timestamp = new Date().toISOString();
    const logLine = `${timestamp} - ${message}\n`;
    
    fs.appendFile(logFile, logLine, (err) => {
        if (err) {
            console.warn('Failed to write to log file:', err);
        }
    });
};

// 存储所有连接的客户端
const clients = new Map();

// 生成唯一客户端ID
const generateClientId = () => {
    return `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

wss.on('connection', (ws) => {
    const clientId = generateClientId();
    clients.set(clientId, ws);
    
    console.log(`Client connected: ${clientId}`);
    logToFile(`Client connected: ${clientId}`);
    
    ws.on('message', (data) => {
        try {
            // 尝试解析JSON消息
            const message = JSON.parse(data.toString());
            console.log(`Received from ${clientId}:`, message);
            logToFile(`Received from ${clientId}: ${JSON.stringify(message)}`);
            
            // 广播消息给所有其他客户端
            clients.forEach((client, id) => {
                if (id !== clientId && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(message));
                }
            });
            
            console.log(`Broadcasted message from ${clientId} to ${clients.size - 1} clients`);
            logToFile(`Broadcasted message from ${clientId} to ${clients.size - 1} clients`);
            
        } catch (error) {
            if (error instanceof SyntaxError) {
                console.warn(`Invalid JSON from ${clientId}:`, data.toString());
                logToFile(`Invalid JSON from ${clientId}: ${data.toString()}`);
            } else {
                console.warn(`Error handling message from ${clientId}:`, error.message);
                logToFile(`Error handling message from ${clientId}: ${error.message}`);
            }
        }
    });
    
    ws.on('close', () => {
        clients.delete(clientId);
        console.log(`Client disconnected: ${clientId}`);
        logToFile(`Client disconnected: ${clientId}`);
    });
    
    ws.on('error', (error) => {
        console.warn(`WebSocket error for ${clientId}:`, error.message);
        logToFile(`WebSocket error for ${clientId}: ${error.message}`);
    });
});

// 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    logToFile(`Server started on port ${PORT}`);
});