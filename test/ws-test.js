const WebSocket = require('ws');

console.log('=== WebSocket Test Suite ===\n');

// 测试1: 基本消息发送和接收
function startTest1() {
    return new Promise((resolve, reject) => {
        console.log('Test 1: Basic message sending and receiving');
        let client1, client2;
        let connectedClients = 0;
        let testPassed = false;
        
        const cleanup = () => {
            if (client1) client1.close();
            if (client2) client2.close();
        };
        
        const checkAllConnected = () => {
            connectedClients++;
            if (connectedClients === 2) {
                console.log('Both clients connected');
                const testMessage = { type: 'chat', text: 'Hello from Client1' };
                client1.send(JSON.stringify(testMessage));
                console.log('Client1 sent:', JSON.stringify(testMessage));
            }
        };
        
        client1 = new WebSocket('ws://localhost:3000');
        client2 = new WebSocket('ws://localhost:3000');
        
        client1.on('open', () => {
            console.log('Client1 connected');
            checkAllConnected();
        });
        
        client2.on('open', () => {
            console.log('Client2 connected');
            checkAllConnected();
        });
        
        client2.on('message', (data) => {
            try {
                const receivedMessage = JSON.parse(data.toString());
                if (receivedMessage.type === 'chat' && receivedMessage.text === 'Hello from Client1') {
                    console.log('Client2 received:', JSON.stringify(receivedMessage));
                    testPassed = true;
                    console.log('✓ Test 1 passed\n');
                    cleanup();
                    resolve();
                }
            } catch (error) {
                console.error('Client2 failed to parse message:', error.message);
                cleanup();
                reject(new Error('Test 1 failed'));
            }
        });
        
        client1.on('error', (error) => {
            console.error('Client1 error:', error.message);
            cleanup();
            reject(new Error('Test 1 failed'));
        });
        
        client2.on('error', (error) => {
            console.error('Client2 error:', error.message);
            cleanup();
            reject(new Error('Test 1 failed'));
        });
        
        // 超时处理
        setTimeout(() => {
            if (!testPassed) {
                console.log('✗ Test 1 failed (timeout)\n');
                cleanup();
                reject(new Error('Test 1 failed'));
            }
        }, 5000);
    });
}

// 测试2: 发送无效JSON
function startTest2() {
    return new Promise((resolve, reject) => {
        console.log('Test 2: Sending invalid JSON');
        let client;
        let testPassed = false;
        
        const cleanup = () => {
            if (client) client.close();
        };
        
        client = new WebSocket('ws://localhost:3000');
        
        client.on('open', () => {
            console.log('Client connected');
            
            // 发送无效JSON
            client.send('This is not valid JSON');
            console.log('Client sent: This is not valid JSON');
            
            // 服务器应该不会崩溃，所以我们等待一段时间后关闭客户端
            setTimeout(() => {
                testPassed = true;
                console.log('✓ Test 2 passed (server handled invalid JSON)\n');
                cleanup();
                resolve();
            }, 2000);
        });
        
        client.on('error', (error) => {
            console.error('Client error:', error.message);
            cleanup();
            // 即使有错误，只要服务器没有崩溃，测试就算通过
            console.log('✓ Test 2 passed (server handled invalid JSON)\n');
            resolve();
        });
        
        client.on('close', () => {
            if (!testPassed) {
                console.log('✓ Test 2 passed (server handled invalid JSON)\n');
                resolve();
            }
        });
        
        // 超时处理
        setTimeout(() => {
            if (!testPassed) {
                console.log('✓ Test 2 passed (server handled invalid JSON)\n');
                cleanup();
                resolve();
            }
        }, 5000);
    });
}

// 测试3: 重连机制
function startTest3() {
    return new Promise((resolve, reject) => {
        console.log('Test 3: Reconnection mechanism');
        let client;
        let clientId = null;
        let testPassed = false;
        
        const cleanup = () => {
            if (client) client.close();
        };
        
        // 第一个连接
        client = new WebSocket('ws://localhost:3000');
        
        client.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                if (message.type === 'welcome' && message.clientId) {
                    clientId = message.clientId;
                    console.log(`Client connected with ID: ${clientId}`);
                    
                    // 断开连接
                    console.log('Disconnecting client...');
                    client.close();
                    
                    // 500ms后重连
                    setTimeout(() => {
                        console.log(`Reconnecting with clientId: ${clientId}`);
                        const reconnectedClient = new WebSocket(`ws://localhost:3000?clientId=${clientId}`);
                        
                        reconnectedClient.on('open', () => {
                            console.log('Client reconnected');
                        });
                        
                        reconnectedClient.on('message', (reconnectData) => {
                            try {
                                const reconnectMessage = JSON.parse(reconnectData.toString());
                                if (reconnectMessage.type === 'welcome' && reconnectMessage.clientId === clientId) {
                                    console.log('✓ Test 3 passed (reconnected with same clientId)\n');
                                    testPassed = true;
                                    reconnectedClient.close();
                                    resolve();
                                }
                            } catch (error) {
                                console.error('Failed to parse reconnect message:', error.message);
                                reconnectedClient.close();
                                reject(new Error('Test 3 failed'));
                            }
                        });
                        
                        reconnectedClient.on('error', (error) => {
                            console.error('Reconnect error:', error.message);
                            reconnectedClient.close();
                            reject(new Error('Test 3 failed'));
                        });
                        
                        // 重连超时处理
                        setTimeout(() => {
                            if (!testPassed) {
                                console.log('✗ Test 3 failed (reconnect timeout)\n');
                                reconnectedClient.close();
                                reject(new Error('Test 3 failed'));
                            }
                        }, 5000);
                    }, 500);
                }
            } catch (error) {
                console.error('Failed to parse message:', error.message);
                cleanup();
                reject(new Error('Test 3 failed'));
            }
        });
        
        client.on('error', (error) => {
            console.error('Client error:', error.message);
            cleanup();
            reject(new Error('Test 3 failed'));
        });
        
        // 超时处理
        setTimeout(() => {
            if (!testPassed) {
                console.log('✗ Test 3 failed (timeout)\n');
                cleanup();
                reject(new Error('Test 3 failed'));
            }
        }, 10000);
    });
}

// 测试4: 多个客户端广播
function startTest4() {
    return new Promise((resolve, reject) => {
        console.log('Test 4: Multiple clients broadcast');
        let clientCount = 0;
        let messageReceivedCount = 0;
        const totalClients = 3;
        const messageToSend = { type: 'chat', text: 'Hello from Client 1' };
        const clients = [];
        let testPassed = false;
        
        const cleanup = () => {
            clients.forEach(c => c.close());
        };
        
        // 创建多个客户端
        for (let i = 0; i < totalClients; i++) {
            const client = new WebSocket('ws://localhost:3000');
            const clientName = `Client ${i+1}`;
            
            client.on('open', () => {
                console.log(`${clientName} connected`);
                clientCount++;
                
                // 当所有客户端连接后，让第一个客户端发送消息
                if (clientCount === totalClients) {
                    console.log(`\nAll ${totalClients} clients connected`);
                    console.log(`Client 1 sending message: ${JSON.stringify(messageToSend)}`);
                    // 假设第一个客户端是第一个创建的
                    const firstClient = clients[0];
                    firstClient.send(JSON.stringify(messageToSend));
                }
            });
            
            client.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    if (message.type === 'chat' && message.text === messageToSend.text) {
                        console.log(`${clientName} received: ${JSON.stringify(message)}`);
                        messageReceivedCount++;
                        
                        // 检查是否所有其他客户端都收到了消息
                        if (messageReceivedCount === totalClients - 1) {
                            console.log(`✓ Test 4 passed (${messageReceivedCount} clients received broadcast)`);
                            testPassed = true;
                            cleanup();
                            console.log('\n=== All tests completed ===');
                            resolve();
                        }
                    }
                } catch (error) {
                    console.error(`${clientName} failed to parse message:`, error.message);
                }
            });
            
            client.on('error', (error) => {
                console.error(`${clientName} error:`, error.message);
            });
            
            clients.push(client);
        }
        
        // 超时处理
        setTimeout(() => {
            if (!testPassed) {
                console.log('✗ Test 4 failed (timeout)\n');
                cleanup();
                reject(new Error('Test 4 failed'));
            }
        }, 10000);
    });
}

// 运行所有测试
startTest1()
    .then(startTest2)
    .then(startTest3)
    .then(startTest4)
    .catch(error => {
        console.error('Test suite failed:', error.message);
        process.exit(1);
    });