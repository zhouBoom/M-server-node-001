const WebSocket = require('ws');

// 测试场景配置
const TEST_ROOM_1 = 'room-test-001';
const TEST_ROOM_2 = 'room-test-002';
const TEST_SERVER_URL = 'ws://localhost:3000';

// 测试状态
let testPassed = 0;
let testFailed = 0;

// 工具函数：创建WebSocket客户端
function createClient(clientId) {
  return new WebSocket(`${TEST_SERVER_URL}?clientId=${clientId}`);
}

// 工具函数：发送消息
function sendMessage(client, message) {
  return new Promise((resolve, reject) => {
    if (client.readyState !== WebSocket.OPEN) {
      reject(new Error('Client not connected'));
      return;
    }
    
    client.send(JSON.stringify(message), (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

// 工具函数：等待指定时间
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 测试1：基本房间加入和消息广播
async function testRoomJoinAndBroadcast() {
  console.log('=== Test 1: 基本房间加入和消息广播 ===');
  
  try {
    // 创建三个客户端
    const client1 = createClient('test-client-1');
    const client2 = createClient('test-client-2');
    const client3 = createClient('test-client-3');
    
    // 等待客户端连接
    await Promise.all([
      new Promise(resolve => client1.on('open', resolve)),
      new Promise(resolve => client2.on('open', resolve)),
      new Promise(resolve => client3.on('open', resolve))
    ]);
    
    console.log('所有客户端连接成功');
    
    // 客户端1和客户端2加入房间1
    await Promise.all([
      sendMessage(client1, { type: 'join', roomId: TEST_ROOM_1 }),
      sendMessage(client2, { type: 'join', roomId: TEST_ROOM_1 })
    ]);
    
    // 客户端3加入房间2
    await sendMessage(client3, { type: 'join', roomId: TEST_ROOM_2 });
    
    console.log('客户端加入房间成功');
    
    // 等待房间用户数量更新
    await wait(100);
    
    // 客户端1发送消息
    const testMessage = { type: 'draw', x: 100, y: 200, color: '#ff0000' };
    await sendMessage(client1, testMessage);
    
    console.log('客户端1发送消息成功');
    
    // 验证消息接收情况
    const client2Received = new Promise((resolve, reject) => {
      client2.once('message', (data) => {
        const message = JSON.parse(data);
        if (message.type === 'draw' && message.x === 100 && message.y === 200) {
          resolve(true);
        } else {
          reject(new Error(`客户端2收到错误消息: ${JSON.stringify(message)}`));
        }
      });
    });
    
    const client3Received = new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 1000);
      client3.once('message', () => {
        clearTimeout(timeout);
        resolve(true);
      });
    });
    
    const [client2GotMessage, client3GotMessage] = await Promise.all([client2Received, client3Received]);
    
    if (client2GotMessage) {
      console.log('✓ 客户端2收到同房间消息');
    } else {
      throw new Error('客户端2未收到同房间消息');
    }
    
    if (!client3GotMessage) {
      console.log('✓ 客户端3未收到不同房间消息');
    } else {
      throw new Error('客户端3收到了不同房间消息');
    }
    
    // 关闭连接
    client1.close();
    client2.close();
    client3.close();
    
    console.log('=== Test 1 成功 ===\n');
    testPassed++;
  } catch (error) {
    console.error(`=== Test 1 失败: ${error.message} ===\n`);
    testFailed++;
  }
}

// 测试2：新用户加入房间时同步历史记录
async function testRoomHistorySync() {
  console.log('=== Test 2: 新用户加入房间时同步历史记录 ===');
  
  try {
    // 创建客户端1
    const client1 = createClient('test-client-1');
    await new Promise(resolve => client1.on('open', resolve));
    
    // 客户端1加入房间
    await sendMessage(client1, { type: 'join', roomId: TEST_ROOM_1 });
    
    // 客户端1发送几条消息
    const testMessages = [
      { type: 'draw', x: 100, y: 200, color: '#ff0000' },
      { type: 'draw', x: 300, y: 400, color: '#00ff00' },
      { type: 'draw', x: 500, y: 600, color: '#0000ff' }
    ];
    
    for (const message of testMessages) {
      await sendMessage(client1, message);
      await wait(50);
    }
    
    console.log('客户端1发送了历史消息');
    
    // 创建客户端2并加入同一房间
    const client2 = createClient('test-client-2');
    await new Promise(resolve => client2.on('open', resolve));
    
    // 客户端2加入房间
    await sendMessage(client2, { type: 'join', roomId: TEST_ROOM_1 });
    
    // 等待客户端2收到历史记录
    const historyReceived = new Promise((resolve, reject) => {
      let welcomeReceived = false;
      
      const messageHandler = (data) => {
        const message = JSON.parse(data);
        
        if (message.type === 'welcome') {
          welcomeReceived = true;
        } else if (message.type === 'roomHistory' && message.roomId === TEST_ROOM_1) {
          client2.removeListener('message', messageHandler);
          resolve(message.history);
        } else if (welcomeReceived) {
          // 已经收到welcome消息，接下来应该收到roomHistory消息
          client2.removeListener('message', messageHandler);
          reject(new Error(`客户端2收到错误消息: ${JSON.stringify(message)}`));
        }
      };
      
      client2.on('message', messageHandler);
    });
    
    const history = await historyReceived;
    
    if (history && history.length >= testMessages.length) {
      console.log(`✓ 客户端2收到历史记录，共 ${history.length} 条消息`);
      
      // 验证历史记录中的消息
      const testMessageFound = testMessages.every(testMsg => 
        history.some(historyMsg => 
          historyMsg.type === testMsg.type &&
          historyMsg.x === testMsg.x &&
          historyMsg.y === testMsg.y &&
          historyMsg.color === testMsg.color
        )
      );
      
      if (testMessageFound) {
        console.log('✓ 历史记录包含所有发送的消息');
      } else {
        throw new Error('历史记录不完整');
      }
    } else {
      throw new Error(`未收到历史记录或记录数量不足，预期至少 ${testMessages.length} 条，实际 ${history ? history.length : 0} 条`);
    }
    
    // 关闭连接
    client1.close();
    client2.close();
    
    console.log('=== Test 2 成功 ===\n');
    testPassed++;
  } catch (error) {
    console.error(`=== Test 2 失败: ${error.message} ===\n`);
    testFailed++;
  }
}

// 测试3：房间用户数量统计
async function testRoomUserCount() {
  console.log('=== Test 3: 房间用户数量统计 ===');
  
  try {
    // 创建三个客户端
    const client1 = createClient('test-client-1');
    const client2 = createClient('test-client-2');
    const client3 = createClient('test-client-3');
    
    // 等待客户端连接
    await Promise.all([
      new Promise(resolve => client1.on('open', resolve)),
      new Promise(resolve => client2.on('open', resolve)),
      new Promise(resolve => client3.on('open', resolve))
    ]);
    
    // 监听用户数量更新
    const userCountUpdates = [];
    
    [client1, client2, client3].forEach((client, index) => {
      client.on('message', (data) => {
        const message = JSON.parse(data);
        if (message.type === 'roomUserCount') {
          userCountUpdates.push({
            client: index + 1,
            roomId: message.roomId,
            count: message.count,
            timestamp: Date.now()
          });
        }
      });
    });
    
    // 客户端1和客户端2加入房间1
    await Promise.all([
      sendMessage(client1, { type: 'join', roomId: TEST_ROOM_1 }),
      sendMessage(client2, { type: 'join', roomId: TEST_ROOM_1 })
    ]);
    
    // 等待更新
    await wait(200);
    
    // 检查房间1的用户数量
    const room1Updates = userCountUpdates.filter(u => u.roomId === TEST_ROOM_1);
    if (room1Updates.length >= 2) {
      // 检查最后一次更新的用户数量是否为2
      const lastUpdate = room1Updates[room1Updates.length - 1];
      if (lastUpdate.count === 2) {
        console.log('✓ 房间1用户数量正确显示为2');
      } else {
        throw new Error(`房间1用户数量错误，预期2，实际${lastUpdate.count}`);
      }
    } else {
      throw new Error('未收到足够的房间用户数量更新');
    }
    
    // 客户端3加入房间1
    await sendMessage(client3, { type: 'join', roomId: TEST_ROOM_1 });
    await wait(200);
    
    // 检查房间1的用户数量是否为3
    const room1UpdatesAfterJoin = userCountUpdates.filter(u => u.roomId === TEST_ROOM_1);
    const lastUpdateAfterJoin = room1UpdatesAfterJoin[room1UpdatesAfterJoin.length - 1];
    if (lastUpdateAfterJoin.count === 3) {
      console.log('✓ 房间1用户数量正确显示为3');
    } else {
      throw new Error(`房间1用户数量错误，预期3，实际${lastUpdateAfterJoin.count}`);
    }
    
    // 客户端1离开房间1
    client1.close();
    await wait(200);
    
    // 检查房间1的用户数量是否为2
    const room1UpdatesAfterLeave = userCountUpdates.filter(u => u.roomId === TEST_ROOM_1);
    const lastUpdateAfterLeave = room1UpdatesAfterLeave[room1UpdatesAfterLeave.length - 1];
    if (lastUpdateAfterLeave.count === 2) {
      console.log('✓ 房间1用户数量在客户端离开后正确显示为2');
    } else {
      throw new Error(`房间1用户数量错误，预期2，实际${lastUpdateAfterLeave.count}`);
    }
    
    // 关闭连接
    client2.close();
    client3.close();
    
    console.log('=== Test 3 成功 ===\n');
    testPassed++;
  } catch (error) {
    console.error(`=== Test 3 失败: ${error.message} ===\n`);
    testFailed++;
  }
}

// 测试4：未加入房间时禁止发送消息
async function testNoBroadcastWithoutRoom() {
  console.log('=== Test 4: 未加入房间时禁止发送消息 ===');
  
  try {
    // 创建两个客户端
    const client1 = createClient('test-client-1');
    const client2 = createClient('test-client-2');
    
    // 等待客户端连接
    await Promise.all([
      new Promise(resolve => client1.on('open', resolve)),
      new Promise(resolve => client2.on('open', resolve))
    ]);
    
    // 客户端2加入房间
    await sendMessage(client2, { type: 'join', roomId: TEST_ROOM_1 });
    
    // 客户端1未加入房间，直接发送消息
    const testMessage = { type: 'draw', x: 100, y: 200 };
    await sendMessage(client1, testMessage);
    
    console.log('客户端1在未加入房间的情况下发送了消息');
    
    // 验证客户端2是否收到消息
    const client2Received = new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 1000);
      client2.once('message', () => {
        clearTimeout(timeout);
        resolve(true);
      });
    });
    
    const client2GotMessage = await client2Received;
    
    if (!client2GotMessage) {
      console.log('✓ 未加入房间的客户端发送的消息未被广播');
    } else {
      throw new Error('未加入房间的客户端发送的消息被广播了');
    }
    
    // 关闭连接
    client1.close();
    client2.close();
    
    console.log('=== Test 4 成功 ===\n');
    testPassed++;
  } catch (error) {
    console.error(`=== Test 4 失败: ${error.message} ===\n`);
    testFailed++;
  }
}

// 测试5：客户端重连后保留房间信息
async function testReconnectRetainsRoom() {
  console.log('=== Test 5: 客户端重连后保留房间信息 ===');
  
  try {
    // 创建客户端1
    const client1 = createClient('test-client-1');
    await new Promise(resolve => client1.on('open', resolve));
    
    // 客户端1加入房间
    await sendMessage(client1, { type: 'join', roomId: TEST_ROOM_1 });
    
    // 客户端1发送消息
    await sendMessage(client1, { type: 'draw', x: 100, y: 200 });
    
    // 关闭客户端1
    client1.close();
    await wait(100);
    
    console.log('客户端1断开连接');
    
    // 创建客户端2并加入同一房间
    const client2 = createClient('test-client-2');
    await new Promise(resolve => client2.on('open', resolve));
    await sendMessage(client2, { type: 'join', roomId: TEST_ROOM_1 });
    
    // 等待客户端2收到用户数量更新
    const userCountPromise = new Promise((resolve) => {
      client2.on('message', (data) => {
        const message = JSON.parse(data);
        if (message.type === 'roomUserCount' && message.roomId === TEST_ROOM_1) {
          resolve(message.count);
        }
      });
    });
    
    // 重连客户端1
    const client1Reconnect = createClient('test-client-1');
    await new Promise(resolve => client1Reconnect.on('open', resolve));
    
    console.log('客户端1重连成功');
    
    // 等待用户数量更新
    const userCount = await userCountPromise;
    
    if (userCount === 2) {
      console.log('✓ 客户端重连后正确保留在房间中');
    } else {
      throw new Error(`客户端重连后房间用户数量错误，预期2，实际${userCount}`);
    }
    
    // 关闭连接
    client1Reconnect.close();
    client2.close();
    
    console.log('=== Test 5 成功 ===\n');
    testPassed++;
  } catch (error) {
    console.error(`=== Test 5 失败: ${error.message} ===\n`);
    testFailed++;
  }
}

// 运行所有测试
async function runAllTests() {
  console.log('开始测试房间管理功能...\n');
  
  try {
    // 运行各个测试
    await testRoomJoinAndBroadcast();
    await testRoomHistorySync();
    await testRoomUserCount();
    await testNoBroadcastWithoutRoom();
    await testReconnectRetainsRoom();
    
    // 输出测试结果
    console.log('=== 测试结果汇总 ===');
    console.log(`通过: ${testPassed}`);
    console.log(`失败: ${testFailed}`);
    
    if (testFailed === 0) {
      console.log('所有测试通过！');
      process.exit(0);
    } else {
      console.log('有测试失败，请检查代码！');
      process.exit(1);
    }
  } catch (error) {
    console.error('测试运行出错:', error);
    process.exit(1);
  }
}

// 启动测试
runAllTests();