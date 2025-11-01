import WebSocket from 'ws';
import logger from './logger';

interface ClientState {
    x: number;
    y: number;
    color: string;
    lastActive: number;
}

interface Client {
    ws: WebSocket;
    state: ClientState;
}

class SocketManager {
    private clients: Map<string, Client>;
    private heartbeatInterval: NodeJS.Timeout;
    private heartbeatIntervalTime: number = 30000; // 30秒心跳检测
    private heartbeatTimeoutTime: number = 10000; // 10秒心跳超时

    constructor() {
        this.clients = new Map();
        this.heartbeatInterval = setInterval(() => this.checkHeartbeats(), this.heartbeatIntervalTime);
    }

    /**
     * 处理客户端连接
     * @param ws WebSocket连接
     * @param clientId 客户端ID
     */
    handleConnection(ws: WebSocket, clientId: string): void {
        try {
            // 如果客户端已存在，关闭旧连接
            if (this.clients.has(clientId)) {
                const oldClient = this.clients.get(clientId);
                if (oldClient) {
                    oldClient.ws.terminate();
                    logger.info(`Closed old connection for client: ${clientId}`);
                }
            }

            // 创建新客户端
            const newClient: Client = {
                ws,
                state: {
                    x: 0,
                    y: 0,
                    color: this.generateRandomColor(),
                    lastActive: Date.now()
                }
            };

            this.clients.set(clientId, newClient);
            logger.info(`Client connected: ${clientId}, total clients: ${this.clients.size}`);

            // 设置心跳定时器
            const heartbeatTimeout = setTimeout(() => {
                this.handleDisconnection(clientId);
            }, this.heartbeatTimeoutTime);

            // 处理消息
            ws.on('message', (data) => {
                try {
                    clearTimeout(heartbeatTimeout);
                    
                    const message = JSON.parse(data.toString());
                    logger.info(`Received message from ${clientId}:`, message);

                    // 更新客户端状态
                    if (message.type === 'draw') {
                        newClient.state.x = message.x;
                        newClient.state.y = message.y;
                        if (message.color) {
                            newClient.state.color = message.color;
                        }
                    }

                    newClient.state.lastActive = Date.now();

                    // 广播消息给其他客户端
                    this.broadcastMessage(clientId, message);

                    // 重置心跳定时器
                    setTimeout(() => {
                        this.handleDisconnection(clientId);
                    }, this.heartbeatTimeoutTime);
                } catch (error) {
                    if (error instanceof SyntaxError) {
                        logger.error(`Invalid JSON from ${clientId}: ${data.toString()}`, error);
                    } else {
                        logger.error(`Error handling message from ${clientId}`, error);
                    }
                }
            });

            // 处理心跳响应
            ws.on('pong', () => {
                clearTimeout(heartbeatTimeout);
                newClient.state.lastActive = Date.now();
                logger.debug(`Received pong from ${clientId}`);
                
                // 重置心跳定时器
                setTimeout(() => {
                    this.handleDisconnection(clientId);
                }, this.heartbeatTimeoutTime);
            });

            // 处理关闭事件
            ws.on('close', () => {
                clearTimeout(heartbeatTimeout);
                this.handleDisconnection(clientId);
            });

            // 处理错误事件
            ws.on('error', (error) => {
                clearTimeout(heartbeatTimeout);
                logger.error(`WebSocket error for ${clientId}`, error);
                this.handleDisconnection(clientId);
            });

            // 发送欢迎消息和当前状态
            this.sendWelcomeMessage(clientId);

        } catch (error) {
            logger.error(`Error handling connection for ${clientId}`, error);
            ws.terminate();
        }
    }

    /**
     * 处理客户端断开连接
     * @param clientId 客户端ID
     */
    private handleDisconnection(clientId: string): void {
        try {
            if (this.clients.has(clientId)) {
                this.clients.delete(clientId);
                logger.info(`Client disconnected: ${clientId}, total clients: ${this.clients.size}`);
            }
        } catch (error) {
            logger.error(`Error handling disconnection for ${clientId}`, error);
        }
    }

    /**
     * 广播消息给其他客户端
     * @param senderId 发送者ID
     * @param message 消息内容
     */
    private broadcastMessage(senderId: string, message: any): void {
        try {
            const messageString = JSON.stringify(message);
            let broadcastCount = 0;

            this.clients.forEach((client, clientId) => {
                if (clientId !== senderId && client.ws.readyState === WebSocket.OPEN) {
                    client.ws.send(messageString, (error) => {
                        if (error) {
                            logger.error(`Error broadcasting to ${clientId}`, error);
                        }
                    });
                    broadcastCount++;
                }
            });

            logger.info(`Broadcasted message from ${senderId} to ${broadcastCount} clients`);
        } catch (error) {
            logger.error(`Error broadcasting message from ${senderId}`, error);
        }
    }

    /**
     * 发送欢迎消息和当前状态给新连接的客户端
     * @param clientId 客户端ID
     */
    private sendWelcomeMessage(clientId: string): void {
        try {
            const client = this.clients.get(clientId);
            if (!client || client.ws.readyState !== WebSocket.OPEN) {
                return;
            }

            // 收集其他客户端的当前状态
            const otherClientsState = Array.from(this.clients.entries())
                .filter(([id]) => id !== clientId)
                .map(([id, client]) => ({
                    id,
                    ...client.state
                }));

            const welcomeMessage = {
                type: 'welcome',
                clientId,
                state: client.state,
                otherClients: otherClientsState
            };

            client.ws.send(JSON.stringify(welcomeMessage));
            logger.info(`Sent welcome message to ${clientId}`);
        } catch (error) {
            logger.error(`Error sending welcome message to ${clientId}`, error);
        }
    }

    /**
     * 检查客户端心跳
     */
    private checkHeartbeats(): void {
        try {
            const now = Date.now();
            const clientsToDisconnect: string[] = [];

            this.clients.forEach((client, clientId) => {
                if (now - client.state.lastActive > this.heartbeatIntervalTime + this.heartbeatTimeoutTime) {
                    clientsToDisconnect.push(clientId);
                } else if (client.ws.readyState === WebSocket.OPEN) {
                    // 发送心跳请求
                    client.ws.ping();
                    logger.debug(`Sent ping to ${clientId}`);
                }
            });

            // 断开超时客户端
            clientsToDisconnect.forEach(clientId => {
                logger.info(`Client timeout: ${clientId}`);
                this.handleDisconnection(clientId);
            });

            logger.debug(`Heartbeat check completed, total clients: ${this.clients.size}`);
        } catch (error) {
            logger.error('Error checking heartbeats', error);
        }
    }

    /**
     * 生成随机颜色
     */
    private generateRandomColor(): string {
        const letters = '0123456789ABCDEF';
        let color = '#';
        for (let i = 0; i < 6; i++) {
            color += letters[Math.floor(Math.random() * 16)];
        }
        return color;
    }

    /**
     * 获取当前所有客户端的状态
     */
    getClientsState(): Map<string, ClientState> {
        const clientsState = new Map<string, ClientState>();
        this.clients.forEach((client, clientId) => {
            clientsState.set(clientId, { ...client.state });
        });
        return clientsState;
    }

    /**
     * 关闭所有客户端连接
     */
    closeAllConnections(): void {
        try {
            clearInterval(this.heartbeatInterval);
            
            this.clients.forEach((client, clientId) => {
                client.ws.terminate();
                logger.info(`Closed connection for client: ${clientId}`);
            });
            
            this.clients.clear();
            logger.info('All connections closed');
        } catch (error) {
            logger.error('Error closing all connections', error);
        }
    }
}

export default new SocketManager();