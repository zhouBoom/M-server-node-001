const http = require('http');
const fs = require('fs');
const path = require('path');

// 确保logs目录存在
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// 服务器配置
const SERVER_URL = 'http://localhost:3000';

// 测试客户端ID
const CLIENT1_ID = 'test-client-1';
const CLIENT2_ID = 'test-client-2';

// 测试事件数量
const TEST_EVENT_COUNT = 1000;

// 记录测试结果
const testResults = {
    startTime: Date.now(),
    eventsSent: 0,
    eventsReceived: 0,
    errors: [],
    completed: false
};

// 客户端2：订阅事件并接收
function startClient2() {
    console.log(`[${new Date().toISOString()}] Starting Client 2 (${CLIENT2_ID})...`);

    const options = {
        hostname: 'localhost',
        port: 3000,
        path: `/subscribe/${CLIENT2_ID}`,
        method: 'GET'
    };

    const req = http.request(options, (res) => {
        console.log(`[${new Date().toISOString()}] Client 2 connected, status code: ${res.statusCode}`);

        let buffer = '';

        res.on('data', (chunk) => {
            buffer += chunk.toString();
            
            // 分割SSE事件
            const events = buffer.split('\n\n');
            buffer = events.pop(); // 保留不完整的事件

            for (const event of events) {
                if (event.trim() === '') continue;

                try {
                    // 解析SSE事件
                    const dataMatch = event.match(/^data: (.*)$/m);
                    if (dataMatch) {
                        const jsonData = JSON.parse(dataMatch[1]);
                        
                        // 忽略欢迎消息
                        if (jsonData.type === 'welcome') {
                            console.log(`[${new Date().toISOString()}] Client 2 received welcome message: ${jsonData.data.message}`);
                            return;
                        }

                        // 记录接收的事件
                        testResults.eventsReceived++;
                        console.log(`[${new Date().toISOString()}] Client 2 received event #${testResults.eventsReceived}: type=${jsonData.type}, data=${JSON.stringify(jsonData.data)}, from=${jsonData.clientId}`);

                        // 检查是否完成所有测试
                        if (testResults.eventsReceived === TEST_EVENT_COUNT) {
                            testResults.completed = true;
                            testResults.endTime = Date.now();
                            testResults.duration = testResults.endTime - testResults.startTime;
                            
                            console.log(`\n[${new Date().toISOString()}] Test completed!`);
                            console.log(`- Total events sent: ${testResults.eventsSent}`);
                            console.log(`- Total events received: ${testResults.eventsReceived}`);
                            console.log(`- Duration: ${testResults.duration}ms`);
                            console.log(`- Errors: ${testResults.errors.length}`);
                            
                            if (testResults.errors.length > 0) {
                                console.log(`\nErrors:`);
                                testResults.errors.forEach((error, index) => {
                                    console.log(`${index + 1}. ${error}`);
                                });
                            }

                            // 退出进程
                            process.exit(testResults.eventsReceived === TEST_EVENT_COUNT && testResults.errors.length === 0 ? 0 : 1);
                        }
                    }
                } catch (error) {
                    const errorMsg = `Error parsing event: ${error.message}`;
                    testResults.errors.push(errorMsg);
                    console.error(`[${new Date().toISOString()}] ${errorMsg}`);
                }
            }
        });

        res.on('end', () => {
            console.log(`[${new Date().toISOString()}] Client 2 connection closed`);
        });

        res.on('error', (error) => {
            const errorMsg = `Client 2 error: ${error.message}`;
            testResults.errors.push(errorMsg);
            console.error(`[${new Date().toISOString()}] ${errorMsg}`);
        });
    });

    req.on('error', (error) => {
        const errorMsg = `Client 2 request error: ${error.message}`;
        testResults.errors.push(errorMsg);
        console.error(`[${new Date().toISOString()}] ${errorMsg}`);
    });

    req.end();
}

// 客户端1：发送事件
function startClient1() {
    console.log(`[${new Date().toISOString()}] Starting Client 1 (${CLIENT1_ID})...`);

    let eventIndex = 1;

    function sendNextEvent() {
        if (eventIndex > TEST_EVENT_COUNT) {
            console.log(`[${new Date().toISOString()}] Client 1 finished sending all ${TEST_EVENT_COUNT} events`);
            return;
        }

        const eventData = {
            type: 'test-event',
            data: {
                index: eventIndex,
                message: `Test event #${eventIndex}`,
                timestamp: Date.now(),
                random: Math.random()
            }
        };

        const postData = JSON.stringify(eventData);

        const options = {
            hostname: 'localhost',
            port: 3000,
            path: `/publish/${CLIENT1_ID}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = http.request(options, (res) => {
            let responseData = '';

            res.on('data', (chunk) => {
                responseData += chunk.toString();
            });

            res.on('end', () => {
                try {
                    const result = JSON.parse(responseData);
                    if (result.success) {
                        testResults.eventsSent++;
                        console.log(`[${new Date().toISOString()}] Client 1 sent event #${eventIndex}`);
                        eventIndex++;
                        sendNextEvent(); // 发送下一个事件
                    } else {
                        const errorMsg = `Failed to send event #${eventIndex}: ${result.error}`;
                        testResults.errors.push(errorMsg);
                        console.error(`[${new Date().toISOString()}] ${errorMsg}`);
                        eventIndex++;
                        sendNextEvent(); // 继续发送下一个事件
                    }
                } catch (error) {
                    const errorMsg = `Error parsing response for event #${eventIndex}: ${error.message}`;
                    testResults.errors.push(errorMsg);
                    console.error(`[${new Date().toISOString()}] ${errorMsg}`);
                    eventIndex++;
                    sendNextEvent(); // 继续发送下一个事件
                }
            });
        });

        req.on('error', (error) => {
            const errorMsg = `Error sending event #${eventIndex}: ${error.message}`;
            testResults.errors.push(errorMsg);
            console.error(`[${new Date().toISOString()}] ${errorMsg}`);
            eventIndex++;
            sendNextEvent(); // 继续发送下一个事件
        });

        req.write(postData);
        req.end();
    }

    // 等待1秒让客户端2建立连接
    setTimeout(() => {
        console.log(`[${new Date().toISOString()}] Client 1 starting to send events...`);
        sendNextEvent();
    }, 1000);
}

// 检查服务器是否启动
function checkServerStatus() {
    console.log(`[${new Date().toISOString()}] Checking if server is running on ${SERVER_URL}...`);

    const req = http.request(`${SERVER_URL}/health`, (res) => {
        if (res.statusCode === 200) {
            console.log(`[${new Date().toISOString()}] Server is running`);
            startClient2();
            startClient1();
        } else {
            console.error(`[${new Date().toISOString()}] Server is not running (status code: ${res.statusCode})`);
            process.exit(1);
        }
    });

    req.on('error', (error) => {
        console.error(`[${new Date().toISOString()}] Server is not running: ${error.message}`);
        process.exit(1);
    });

    req.end();
}

// 启动测试
console.log(`[${new Date().toISOString()}] Starting real-time collaboration event system test...`);
console.log(`[${new Date().toISOString()}] Test configuration:`);
console.log(`- Server URL: ${SERVER_URL}`);
console.log(`- Client 1 ID: ${CLIENT1_ID}`);
console.log(`- Client 2 ID: ${CLIENT2_ID}`);
console.log(`- Number of events to send: ${TEST_EVENT_COUNT}`);
console.log(`\n${'='.repeat(50)}\n`);

// 检查服务器状态并启动测试
checkServerStatus();
