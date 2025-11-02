import logger from './logger';

interface Room {
    id: string;
    clients: Map<string, string>; // clientId => clientId
    history: any[];
}

class RoomManager {
    private rooms: Map<string, Room>;

    constructor() {
        this.rooms = new Map();
    }

    /**
     * 创建一个新房间
     * @param roomId 房间ID
     * @returns 创建的房间
     */
    createRoom(roomId: string): Room {
        if (!roomId) {
            throw new Error('roomId is required');
        }

        if (this.rooms.has(roomId)) {
            return this.rooms.get(roomId)!;
        }

        const room: Room = {
            id: roomId,
            clients: new Map(),
            history: []
        };

        this.rooms.set(roomId, room);
        logger.info(`Created room: ${roomId}`);
        return room;
    }

    /**
     * 删除一个房间
     * @param roomId 房间ID
     */
    deleteRoom(roomId: string): void {
        if (!roomId) {
            throw new Error('roomId is required');
        }

        if (this.rooms.delete(roomId)) {
            logger.info(`Deleted room: ${roomId}`);
        }
    }

    /**
     * 将客户端加入房间
     * @param roomId 房间ID
     * @param clientId 客户端ID
     */
    addClientToRoom(roomId: string, clientId: string): void {
        if (!roomId || !clientId) {
            throw new Error('roomId and clientId are required');
        }

        const room = this.createRoom(roomId);
        room.clients.set(clientId, clientId);
        logger.info(`Added client ${clientId} to room ${roomId}, total clients in room: ${room.clients.size}`);
    }

    /**
     * 将客户端从房间中移除
     * @param roomId 房间ID
     * @param clientId 客户端ID
     */
    removeClientFromRoom(roomId: string, clientId: string): void {
        if (!roomId || !clientId) {
            throw new Error('roomId and clientId are required');
        }

        const room = this.rooms.get(roomId);
        if (!room) {
            return;
        }

        if (room.clients.delete(clientId)) {
            logger.info(`Removed client ${clientId} from room ${roomId}, total clients in room: ${room.clients.size}`);

            // 如果房间为空，删除房间
            if (room.clients.size === 0) {
                this.deleteRoom(roomId);
            }
        }
    }

    /**
     * 获取房间内的所有客户端
     * @param roomId 房间ID
     * @returns 客户端ID数组
     */
    getClientsInRoom(roomId: string): string[] {
        if (!roomId) {
            throw new Error('roomId is required');
        }

        const room = this.rooms.get(roomId);
        if (!room) {
            return [];
        }

        return Array.from(room.clients.keys());
    }

    /**
     * 获取房间内的用户数量
     * @param roomId 房间ID
     * @returns 用户数量
     */
    getRoomUserCount(roomId: string): number {
        if (!roomId) {
            throw new Error('roomId is required');
        }

        const room = this.rooms.get(roomId);
        if (!room) {
            return 0;
        }

        return room.clients.size;
    }
    
    /**
     * 根据房间ID获取房间
     * @param roomId 房间ID
     * @returns 房间对象或undefined
     */
    getRoomById(roomId: string): Room | undefined {
        if (!roomId) {
            throw new Error('roomId is required');
        }

        return this.rooms.get(roomId);
    }

    /**
     * 添加消息到房间历史记录
     * @param roomId 房间ID
     * @param message 消息内容
     */
    addMessageToHistory(roomId: string, message: any): void {
        if (!roomId || !message) {
            throw new Error('roomId and message are required');
        }

        const room = this.rooms.get(roomId);
        if (!room) {
            return;
        }

        room.history.push(message);
        // 限制历史记录的长度，避免内存占用过多
        if (room.history.length > 100) {
            room.history.shift();
        }
    }

    /**
     * 获取房间的历史记录
     * @param roomId 房间ID
     * @returns 历史记录数组
     */
    getRoomHistory(roomId: string): any[] {
        if (!roomId) {
            throw new Error('roomId is required');
        }

        const room = this.rooms.get(roomId);
        if (!room) {
            return [];
        }

        return [...room.history];
    }

    /**
     * 获取客户端所在的房间
     * @param clientId 客户端ID
     * @returns 房间ID数组
     */
    getRoomsByClientId(clientId: string): string[] {
        if (!clientId) {
            throw new Error('clientId is required');
        }

        const rooms: string[] = [];
        this.rooms.forEach((room, roomId) => {
            if (room.clients.has(clientId)) {
                rooms.push(roomId);
            }
        });

        return rooms;
    }

    /**
     * 关闭所有房间
     */
    closeAllRooms(): void {
        this.rooms.forEach((room, roomId) => {
            this.deleteRoom(roomId);
        });
        logger.info('All rooms closed');
    }
}

export default new RoomManager();