const WebSocket = require('ws');

// 创建两个WebSocket客户端
const client1 = new WebSocket('ws://localhost:3000');
const client2 = new WebSocket('ws://localhost:3000');

// 客户端1连接成功事件
client1.on('open', () => {
    console.log('Client1 connected');
    
    // 延迟发送消息，确保客户端2已连接
    setTimeout(() => {
        const testMessage = { type: 'draw', x: 100, y: 200 };
        client1.send(JSON.stringify(testMessage));
        console.log('Client1 sent:', JSON.stringify(testMessage));
    }, 1000);
});

// 客户端2连接成功事件
client2.on('open', () => {
    console.log('Client2 connected');
});

// 客户端2接收消息事件
client2.on('message', (data) => {
    try {
        const receivedMessage = JSON.parse(data.toString());
        console.log('Client2 received:', JSON.stringify(receivedMessage));
        
        // 测试完成后关闭客户端
        client1.close();
        client2.close();
    } catch (error) {
        console.error('Client2 failed to parse message:', error.message);
    }
});

// 错误处理
client1.on('error', (error) => {
    console.error('Client1 error:', error.message);
});

client2.on('error', (error) => {
    console.error('Client2 error:', error.message);
});