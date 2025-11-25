import { createLogger, format, transports } from 'winston';
import path from 'path';
import fs from 'fs';

// 确保日志目录存在
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// 事件日志记录器
const eventLogger = createLogger({
    level: 'info',
    format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.json()
    ),
    transports: [
        new transports.File({ 
            filename: path.join(logDir, 'events.log'),
            maxsize: 10485760, // 10MB
            maxFiles: 5,
            tailable: true
        })
    ]
});

// 客户端接口
interface Client {
    id: string;
    res: any;
    isActive: boolean;
}

// 事件接口
interface Event {
    type: string;
    data: any;
    clientId: string;
    timestamp: number;
}

class EventManager {
    private clients: Map<string, Client>;
    private eventHistory: Event[];
    private maxHistorySize: number = 1000;

    constructor() {
        this.clients = new Map();
        this.eventHistory = [];
    }

    /**
     * 添加客户端订阅
     * @param clientId 客户端ID
     * @param res 响应对象
     */
    addClient(clientId: string, res: any): void {
        try {
            // 如果客户端已存在，标记为不活跃并关闭旧连接
            if (this.clients.has(clientId)) {
                const oldClient = this.clients.get(clientId)!;
                oldClient.isActive = false;
                oldClient.res.end();
                this.logEvent('client_replaced', { clientId }, clientId);
            }

            // 添加新客户端
            const newClient: Client = {
                id: clientId,
                res,
                isActive: true
            };

            this.clients.set(clientId, newClient);
            this.logEvent('client_connected', { clientId }, clientId);

            // 设置超时自动清理不活跃客户端
            res.on('close', () => {
                this.removeClient(clientId);
            });

            res.on('error', (error: Error) => {
                this.logError('client_error', error, { clientId });
                this.removeClient(clientId);
            });

        } catch (error) {
            this.logError('add_client_error', error as Error, { clientId });
            throw error;
        }
    }

    /**
     * 移除客户端订阅
     * @param clientId 客户端ID
     */
    removeClient(clientId: string): void {
        try {
            const client = this.clients.get(clientId);
            if (client) {
                client.isActive = false;
                client.res.end();
                this.clients.delete(clientId);
                this.logEvent('client_disconnected', { clientId }, clientId);
            }
        } catch (error) {
            this.logError('remove_client_error', error as Error, { clientId });
        }
    }

    /**
     * 发布事件
     * @param clientId 发布事件的客户端ID
     * @param eventType 事件类型
     * @param eventData 事件数据
     */
    publishEvent(clientId: string, eventType: string, eventData: any): void {
        try {
            const event: Event = {
                type: eventType,
                data: eventData,
                clientId,
                timestamp: Date.now()
            };

            // 记录事件到日志
            this.logEvent(eventType, eventData, clientId);

            // 保存到历史记录
            this.eventHistory.push(event);
            if (this.eventHistory.length > this.maxHistorySize) {
                this.eventHistory.shift();
            }

            // 广播事件给所有活跃客户端
            this.broadcastEvent(event);

        } catch (error) {
            this.logError('publish_event_error', error as Error, { clientId, eventType, eventData });
            throw error;
        }
    }

    /**
     * 广播事件给所有活跃客户端
     * @param event 事件对象
     */
    private broadcastEvent(event: Event): void {
        try {
            const activeClients = Array.from(this.clients.values()).filter(client => client.isActive);

            activeClients.forEach(client => {
                try {
                    // 只发送给其他客户端，不发送给自己
                    if (client.id !== event.clientId) {
                        client.res.write(`data: ${JSON.stringify(event)}

`);
                    }
                } catch (error) {
                    this.logError('broadcast_event_error', error as Error, { 
                        clientId: client.id,
                        eventType: event.type,
                        eventData: event.data
                    });
                    // 标记客户端为不活跃并移除
                    client.isActive = false;
                    this.clients.delete(client.id);
                }
            });

        } catch (error) {
            this.logError('broadcast_error', error as Error, { event });
        }
    }

    /**
     * 获取事件历史记录
     * @param limit 限制返回的历史记录数量
     * @returns 事件历史记录数组
     */
    getEventHistory(limit: number = 100): Event[] {
        try {
            const startIndex = Math.max(0, this.eventHistory.length - limit);
            return this.eventHistory.slice(startIndex);
        } catch (error) {
            this.logError('get_history_error', error as Error, { limit });
            return [];
        }
    }

    /**
     * 记录事件到日志
     * @param eventType 事件类型
     * @param eventData 事件数据
     * @param clientId 客户端ID
     */
    private logEvent(eventType: string, eventData: any, clientId: string): void {
        try {
            eventLogger.info('event', {
                eventType,
                eventData,
                clientId,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('Error logging event:', error);
        }
    }

    /**
     * 记录错误到日志
     * @param errorType 错误类型
     * @param error 错误对象
     * @param context 上下文信息
     */
    private logError(errorType: string, error: Error, context: any): void {
        try {
            eventLogger.error('error', {
                errorType,
                errorMessage: error.message,
                errorStack: error.stack,
                context,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('Error logging error:', error);
        }
    }

    /**
     * 获取当前活跃客户端数量
     * @returns 活跃客户端数量
     */
    getActiveClientsCount(): number {
        return Array.from(this.clients.values()).filter(client => client.isActive).length;
    }
}

export default new EventManager();
