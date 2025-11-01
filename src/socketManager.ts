import WebSocket from 'ws';
import logger from './logger';
import roomManager from './roomManager';

interface ClientState {
    x: number;
    y: number;
    color: string;
    lastActive: number;
}

interface Client {
    ws: WebSocket;
    state: ClientState;
    roomId?: string;
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
                    // 如果旧客户端在房间中，移除它
                    if (oldClient.roomId) {
                        roomManager.removeClientFromRoom(oldClient.roomId, clientId);
                    }
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

                    // 先检查客户端是否在房间中（除了join消息）
                    if (message.type !== 'join' && !newClient.roomId) {
                        logger.warn(`Client ${clientId} tried to send message without joining a room`);
                        return;
                    }
                    
                    // 处理加入房间请求
                    if (message.type === 'join') {
                        if (!message.roomId) {
                            throw new Error('roomId is required for join message');
                        }
                        
                        // 如果客户端已经在房间中，先移除
                        if (newClient.roomId) {
                            roomManager.removeClientFromRoom(newClient.roomId, clientId);
                        }
                        
                        // 加入新房间
                        newClient.roomId = message.roomId;
                        roomManager.addClientToRoom(message.roomId, clientId);
                        
                        // 发送房间历史记录给新用户
                        this.sendRoomHistory(clientId, message.roomId);
                        
                        // 发送房间用户数量给所有用户
                        this.broadcastRoomUserCount(message.roomId);
                    }
                    // 更新客户端状态
                    else if (message.type === 'draw') {
                        newClient.state.x = message.x;
                        newClient.state.y = message.y;
                        if (message.color) {
                            newClient.state.color = message.color;
                        }
                    }

                    newClient.state.lastActive = Date.now();

                    // 广播消息给同房间内的其他客户端
                    if (message.type !== 'join') {
                        const clientsInRoom = roomManager.getClientsInRoom(newClient.roomId);
                        if (clientsInRoom && clientsInRoom.includes(clientId)) {
                            // 添加消息到房间历史记录
                            roomManager.addMessageToHistory(newClient.roomId, message);
                            
                            // 广播消息给同房间内的其他客户端
                            this.broadcastMessage(clientId, message);
                        } else {
                            logger.warn(`Client ${clientId} tried to send message without joining a room`);
                        }
                    }

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
            const client = this.clients.get(clientId);
            if (client) {
                // 如果客户端在房间中，移除它
                if (client.roomId) {
                    roomManager.removeClientFromRoom(client.roomId, clientId);
                    // 广播房间用户数量变化
                    this.broadcastRoomUserCount(client.roomId);
                }
                
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
            const sender = this.clients.get(senderId);
            if (!sender || !sender.roomId) {
                logger.warn(`Cannot broadcast message from ${senderId}: not in a room`);
                return;
            }
            
            const messageString = JSON.stringify(message);
            const clientsInRoom = roomManager.getClientsInRoom(sender.roomId);
            let broadcastCount = 0;

            clientsInRoom.forEach(clientId => {
                if (clientId !== senderId) {
                    const client = this.clients.get(clientId);
                    if (client && client.ws.readyState === WebSocket.OPEN) {
                        client.ws.send(messageString, (error) => {
                            if (error) {
                                logger.error(`Error broadcasting to ${clientId}`, error);
                            }
                        });
                        broadcastCount++;
                    }
                }
            });

            logger.info(`Broadcasted message from ${senderId} to ${broadcastCount} clients in room ${sender.roomId}`);
        } catch (error) {
            logger.error(`Error broadcasting message from ${senderId}`, error);
        }
    }
    
    /**
     * 广播房间用户数量给所有用户
     * @param roomId 房间ID
     */
    private broadcastRoomUserCount(roomId: string): void {
        try {
            if (!roomId) {
                throw new Error('roomId is required');
            }
            
            const userCount = roomManager.getRoomUserCount(roomId);
            const message = { type: 'roomUserCount', roomId, count: userCount };
            const messageString = JSON.stringify(message);
            
            const clientsInRoom = roomManager.getClientsInRoom(roomId);
            clientsInRoom.forEach(clientId => {
                const client = this.clients.get(clientId);
                if (client && client.ws.readyState === WebSocket.OPEN) {
                    client.ws.send(messageString, (error) => {
                        if (error) {
                            logger.error(`Error broadcasting room user count to ${clientId}`, error);
                        }
                    });
                }
            });
            
            logger.info(`Broadcasted room user count to ${clientsInRoom.length} clients in room ${roomId}`);
        } catch (error) {
            logger.error(`Error broadcasting room user count for room ${roomId}`, error);
        }
    }
    
    /**
     * 发送房间历史记录给客户端
     * @param clientId 客户端ID
     * @param roomId 房间ID
     */
    private sendRoomHistory(clientId: string, roomId: string): void {
        try {
            if (!clientId || !roomId) {
                throw new Error('clientId and roomId are required');
            }
            
            const client = this.clients.get(clientId);
            if (!client || client.ws.readyState !== WebSocket.OPEN) {
                return;
            }
            
            const history = roomManager.getRoomHistory(roomId);
            const message = { type: 'roomHistory', roomId, history };
            
            client.ws.send(JSON.stringify(message), (error) => {
                if (error) {
                    logger.error(`Error sending room history to ${clientId}`, error);
                } else {
                    logger.info(`Sent room history to ${clientId} for room ${roomId}, ${history.length} messages`);
                }
            });
        } catch (error) {
            logger.error(`Error sending room history to ${clientId}`, error);
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

            // 初始欢迎消息不包含其他客户端状态
            // 其他客户端状态会在用户加入房间后通过roomHistory和roomUserCount消息发送
            const welcomeMessage = {
                type: 'welcome',
                clientId,
                state: client.state
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