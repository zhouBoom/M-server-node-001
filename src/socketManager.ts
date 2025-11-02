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
    async handleConnection(ws: WebSocket, clientId: string): Promise<void> {
        try {
            // 如果客户端已存在，关闭旧连接并保留房间信息
            let previousRoomId: string | undefined;
            if (this.clients.has(clientId)) {
                const oldClient = this.clients.get(clientId);
                if (oldClient) {
                    oldClient.ws.terminate();
                    // 保留旧客户端的房间信息
                    previousRoomId = oldClient.roomId;
                    // 如果旧客户端在房间中，移除它
                    if (previousRoomId) {
                        roomManager.removeClientFromRoom(previousRoomId, clientId);
                    }
                    logger.info(`Closed old connection for client: ${clientId}, previousRoomId: ${previousRoomId}`);
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

            // 如果有之前的房间信息，恢复房间
            if (previousRoomId) {
                newClient.roomId = previousRoomId;
                roomManager.addClientToRoom(previousRoomId, clientId);
                logger.info(`Restored client ${clientId} to room ${previousRoomId}`);
                // 广播房间用户数量变化
                try {
                    await this.broadcastRoomUserCount(previousRoomId);
                } catch (error) {
                    logger.error(`Error broadcasting room user count after restoring client ${clientId}`, error);
                }
            } else {
                logger.info(`No previous room information for client ${clientId}`);
            }

            this.clients.set(clientId, newClient);
            logger.info(`Client connected: ${clientId}, total clients: ${this.clients.size}`);

            // 设置心跳定时器
            const heartbeatTimeout = setTimeout(() => {
                this.handleDisconnection(clientId);
            }, this.heartbeatTimeoutTime);

            // 处理消息
            ws.on('message', async (data) => {
                try {
                    clearTimeout(heartbeatTimeout);
                    
                    const message = JSON.parse(data.toString());
                    logger.info(`Received message from ${clientId}:`, message);

                    // 先检查客户端是否在房间中（除了join消息）
                    if (message.type !== 'join') {
                        const rooms = roomManager.getRoomsByClientId(clientId);
                        logger.info(`Client ${clientId} is in rooms: ${rooms.join(', ')}`);
                        if (rooms.length === 0) {
                            if (newClient.roomId) {
                                logger.warn(`Client ${clientId} tried to send message to room ${newClient.roomId} but is not in any room`);
                            } else {
                                logger.warn(`Client ${clientId} tried to send message without joining a room`);
                            }
                            logger.info('Returning early, message will not be broadcast');
                            return;
                        } else {
                            logger.info('Client is in a room, continuing to process message');
                        }
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
                        try {
                            await this.sendRoomHistory(clientId, message.roomId);
                        } catch (error) {
                            logger.error(`Error sending room history to ${clientId}`, error);
                        }
                        
                        // 发送房间用户数量给所有用户
                        try {
                            await this.broadcastRoomUserCount(message.roomId);
                        } catch (error) {
                            logger.error(`Error broadcasting room user count after joining room ${message.roomId}`, error);
                        }
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
                        const rooms = roomManager.getRoomsByClientId(clientId);
                        if (rooms.length > 0) {
                            // 添加消息到所有房间的历史记录
                            rooms.forEach(roomId => {
                                roomManager.addMessageToHistory(roomId, message);
                            });
                            
                            // 广播消息给所有房间内的其他客户端
                            try {
                                await this.broadcastMessage(clientId, message);
                            } catch (error) {
                                logger.error(`Error broadcasting message from ${clientId}`, error);
                            }
                        } else {
                            logger.warn(`Client ${clientId} tried to send message without joining a room`);
                        }
                    }

                    // 重置心跳定时器
                    setTimeout(async () => {
                        await this.handleDisconnection(clientId);
                    }, this.heartbeatTimeoutTime);
                } catch (error) {
                    if (error instanceof SyntaxError) {
                        logger.error(`Invalid JSON from ${clientId}: ${data.toString()}`, error);
                        // 向客户端返回无效JSON错误
                        try {
                            await this.sendWithRetry(newClient.ws, JSON.stringify({ type: 'error', message: 'Invalid JSON' }), clientId);
                        } catch (error) {
                            logger.error(`Error sending invalid JSON error to ${clientId}`, error);
                        }
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
            ws.on('close', async () => {
                clearTimeout(heartbeatTimeout);
                await this.handleDisconnection(clientId);
            });

            // 处理错误事件
            ws.on('error', async (error) => {
                clearTimeout(heartbeatTimeout);
                logger.error(`WebSocket error for ${clientId}`, error);
                await this.handleDisconnection(clientId);
            });

            // 发送欢迎消息和当前状态
            try {
                await this.sendWelcomeMessage(clientId);
            } catch (error) {
                logger.error(`Error sending welcome message to ${clientId}`, error);
            }

        } catch (error) {
            logger.error(`Error handling connection for ${clientId}`, error);
            ws.terminate();
        }
    }

    /**
     * 处理客户端断开连接
     * @param clientId 客户端ID
     */
    private async handleDisconnection(clientId: string): Promise<void> {
        try {
            const client = this.clients.get(clientId);
            if (client) {
                // 如果客户端在房间中，移除它
                if (client.roomId) {
                    roomManager.removeClientFromRoom(client.roomId, clientId);
                    // 广播房间用户数量变化
                    try {
                        await this.broadcastRoomUserCount(client.roomId);
                    } catch (error) {
                        logger.error(`Error broadcasting room user count after disconnecting client ${clientId}`, error);
                    }
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
    private async broadcastMessage(senderId: string, message: any): Promise<void> {
        try {
            const sender = this.clients.get(senderId);
            if (!sender) {
                logger.warn(`Cannot broadcast message from ${senderId}: client not found`);
                return;
            }
            
            // 获取客户端所在的所有房间
            const rooms = roomManager.getRoomsByClientId(senderId);
            if (rooms.length === 0) {
                logger.warn(`Cannot broadcast message from ${senderId}: not in any room`);
                return;
            }
            
            // 添加发送者信息和时间戳
            const messageWithMetadata = {
                ...message,
                sender: {
                    id: senderId,
                    color: sender.state.color
                },
                timestamp: Date.now()
            };
            
            const messageString = JSON.stringify(messageWithMetadata);
            let totalBroadcastCount = 0;

            // 遍历每个房间进行广播
            for (const roomId of rooms) {
                const room = roomManager.getRoomById(roomId);
                if (!room) {
                    logger.warn(`Cannot broadcast message to room ${roomId}: room not found`);
                    continue;
                }
                
                const clientsInRoom = roomManager.getClientsInRoom(roomId);
                let broadcastCount = 0;

                if (clientsInRoom && clientsInRoom.length > 0) {
                    for (const clientId of clientsInRoom) {
                        if (clientId !== senderId) {
                            const client = this.clients.get(clientId);
                            if (client && client.ws.readyState === WebSocket.OPEN) {
                                try {
                                    const success = await this.sendWithRetry(client.ws, messageString, clientId);
                                    if (success) {
                                        broadcastCount++;
                                        totalBroadcastCount++;
                                    }
                                } catch (error) {
                                    logger.error(`Error sending message to ${clientId}: WebSocket is not open`, error);
                                }
                            }
                        }
                    }
                } else {
                    logger.warn(`No clients in room ${roomId} to broadcast to`);
                }

                logger.info(`Broadcasted message from ${senderId} to ${broadcastCount} clients in room ${roomId}`);
            }

            logger.info(`Total broadcasted message from ${senderId} to ${totalBroadcastCount} clients in ${rooms.length} rooms`);
        } catch (error) {
            logger.error(`Error broadcasting message from ${senderId}`, error);
        }
    }
    
    /**
     * 广播房间用户数量给所有用户
     * @param roomId 房间ID
     */
    private async broadcastRoomUserCount(roomId: string): Promise<void> {
        try {
            if (!roomId) {
                throw new Error('roomId is required');
            }
            
            const userCount = roomManager.getRoomUserCount(roomId);
            const message = { type: 'roomUserCount', roomId, count: userCount };
            const messageString = JSON.stringify(message);
            
            const clientsInRoom = roomManager.getClientsInRoom(roomId);
            if (clientsInRoom && clientsInRoom.length > 0) {
                let broadcastCount = 0;
                
                for (const clientId of clientsInRoom) {
                    const client = this.clients.get(clientId);
                    if (client && client.ws.readyState === WebSocket.OPEN) {
                        try {
                            const success = await this.sendWithRetry(client.ws, messageString, clientId);
                            if (success) {
                                broadcastCount++;
                            }
                        } catch (error) {
                            logger.error(`Error sending room user count to ${clientId}: WebSocket is not open`, error);
                        }
                    }
                }
                
                logger.info(`Broadcasted room user count to ${broadcastCount} clients in room ${roomId}`);
            } else {
                logger.warn(`No clients in room ${roomId} to broadcast user count to`);
            }
        } catch (error) {
            logger.error(`Error broadcasting room user count for room ${roomId}`, error);
        }
    }
    
    /**
     * 发送房间历史记录给客户端
     * @param clientId 客户端ID
     * @param roomId 房间ID
     */
    private async sendRoomHistory(clientId: string, roomId: string): Promise<void> {
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
            const messageString = JSON.stringify(message);
            
            try {
                const success = await this.sendWithRetry(client.ws, messageString, clientId);
                if (success) {
                    logger.info(`Sent room history to ${clientId} for room ${roomId}, ${history.length} messages`);
                } else {
                    logger.error(`Failed to send room history to ${clientId} after 3 retries`);
                }
            } catch (error) {
                logger.error(`Error sending room history to ${clientId}: WebSocket is not open`, error);
            }
        } catch (error) {
            logger.error(`Error sending room history to ${clientId}`, error);
        }
    }

    /**
     * 发送欢迎消息和当前状态给新连接的客户端
     * @param clientId 客户端ID
     */
    private async sendWelcomeMessage(clientId: string): Promise<void> {
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
            const messageString = JSON.stringify(welcomeMessage);

            try {
                const success = await this.sendWithRetry(client.ws, messageString, clientId);
                if (success) {
                    logger.info(`Sent welcome message to ${clientId}`);
                } else {
                    logger.error(`Failed to send welcome message to ${clientId} after 3 retries`);
                }
            } catch (error) {
                logger.error(`Error sending welcome message to ${clientId}: WebSocket is not open`, error);
            }
        } catch (error) {
            logger.error(`Error sending welcome message to ${clientId}`, error);
        }
    }

    /**
     * 带重试的消息发送
     * @param ws WebSocket连接
     * @param message 要发送的消息
     * @param clientId 客户端ID
     * @param maxRetries 最大重试次数
     * @param timeout 超时时间（毫秒）
     */
    private async sendWithRetry(ws: WebSocket, message: string, clientId: string, maxRetries = 3, timeout = 5000): Promise<boolean> {
        let retries = 0;
        
        while (retries < maxRetries) {
            try {
                if (ws.readyState !== WebSocket.OPEN) {
                    logger.warn(`Cannot send message to ${clientId}: WebSocket is not open (state: ${ws.readyState})`);
                    return false;
                }
                
                const sendPromise = new Promise<boolean>((resolve, reject) => {
                    ws.send(message, (error) => {
                        if (error) {
                            reject(error);
                        } else {
                            resolve(true);
                        }
                    });
                });
                
                // 添加超时
                const timeoutPromise = new Promise<boolean>((resolve) => {
                    setTimeout(() => {
                        resolve(false);
                    }, timeout);
                });
                
                const result = await Promise.race([sendPromise, timeoutPromise]);
                
                if (result) {
                    return true;
                } else {
                    logger.warn(`Send timeout for client ${clientId}, retrying... (${retries + 1}/${maxRetries})`);
                    retries++;
                }
            } catch (error) {
                logger.error(`Error sending message to ${clientId}, retrying... (${retries + 1}/${maxRetries})`, error);
                retries++;
            }
            
            // 重试间隔
            if (retries < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        logger.error(`Failed to send message to ${clientId} after ${maxRetries} retries`);
        return false;
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
                      try {
                          client.ws.ping();
                          logger.debug(`Sent ping to ${clientId}`);
                      } catch (error) {
                          logger.error(`Error sending ping to ${clientId}: WebSocket is not open`, error);
                      }
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