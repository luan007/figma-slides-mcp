import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { WebSocket } from 'ws';
import { Bridge } from '../server/bridge.js';

describe('Bridge', () => {
  let bridge;

  before(() => {
    bridge = new Bridge({ port: 0 }); // random available port
  });

  after(() => {
    bridge.close();
  });

  it('should report not connected initially', () => {
    assert.strictEqual(bridge.isConnected(), false);
  });

  it('should accept plugin connection and track state', async () => {
    const addr = bridge.address();
    const ws = new WebSocket(`ws://localhost:${addr.port}`);
    await new Promise(resolve => ws.on('open', resolve));

    ws.send(JSON.stringify({ type: 'hello', version: '1.0', editorType: 'slides', documentName: 'Test' }));
    await new Promise(resolve => setTimeout(resolve, 100));

    assert.strictEqual(bridge.isConnected(), true);
    assert.strictEqual(bridge.editorType(), 'slides');
    assert.strictEqual(bridge.documentName(), 'Test');

    ws.close();
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.strictEqual(bridge.isConnected(), false);
  });

  it('should send command and receive response', async () => {
    const addr = bridge.address();
    const ws = new WebSocket(`ws://localhost:${addr.port}`);
    await new Promise(resolve => ws.on('open', resolve));

    ws.send(JSON.stringify({ type: 'hello', version: '1.0', editorType: 'slides', documentName: 'Test' }));
    await new Promise(resolve => setTimeout(resolve, 50));

    // Mock plugin: echo back
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.cmd) {
        ws.send(JSON.stringify({ id: msg.id, result: { echoed: msg.cmd } }));
      }
    });

    const result = await bridge.send('ping', {});
    assert.deepStrictEqual(result, { echoed: 'ping' });
    ws.close();
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  it('should timeout if no response', async () => {
    const addr = bridge.address();
    const ws = new WebSocket(`ws://localhost:${addr.port}`);
    await new Promise(resolve => ws.on('open', resolve));

    ws.send(JSON.stringify({ type: 'hello', version: '1.0', editorType: 'slides', documentName: 'Test' }));
    await new Promise(resolve => setTimeout(resolve, 50));

    // Don't respond
    try {
      await bridge.send('ping', {}, { timeout: 200 });
      assert.fail('Should have timed out');
    } catch (e) {
      assert.strictEqual(e.code, 'TIMEOUT');
    }
    ws.close();
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  it('should reject with NOT_CONNECTED when plugin disconnects mid-command', async () => {
    const addr = bridge.address();
    const ws = new WebSocket(`ws://localhost:${addr.port}`);
    await new Promise(resolve => ws.on('open', resolve));

    ws.send(JSON.stringify({ type: 'hello', version: '1.0', editorType: 'slides', documentName: 'Test' }));
    await new Promise(resolve => setTimeout(resolve, 50));

    // Send command but close immediately
    const promise = bridge.send('ping', {}, { timeout: 5000 });
    ws.close();

    try {
      await promise;
      assert.fail('Should have rejected');
    } catch (e) {
      assert.strictEqual(e.code, 'NOT_CONNECTED');
    }
  });

  it('should reject immediately when not connected', async () => {
    // After previous test, plugin is disconnected
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      await bridge.send('ping', {});
      assert.fail('Should have rejected');
    } catch (e) {
      assert.strictEqual(e.code, 'NOT_CONNECTED');
    }
  });
});
