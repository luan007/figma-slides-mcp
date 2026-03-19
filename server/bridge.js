import { WebSocketServer } from 'ws';

export class Bridge {
  constructor(options = {}) {
    this.port = options.port !== undefined ? options.port : 3055;
    this._ws = null;
    this._editorType = null;
    this._documentName = null;
    this._pending = new Map();
    this._reqCounter = 0;

    this._wss = new WebSocketServer({ port: this.port });
    this._wss.on('connection', (ws) => this._onConnection(ws));
  }

  _onConnection(ws) {
    // Only allow one plugin connection at a time
    if (this._ws) {
      this._ws.close();
    }

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        // Hello handshake
        if (msg.type === 'hello') {
          this._ws = ws;
          this._editorType = msg.editorType;
          this._documentName = msg.documentName;
          console.error(`[bridge] Plugin connected: ${msg.documentName} (${msg.editorType})`);
          return;
        }

        // Response to a pending command
        if (msg.id && this._pending.has(msg.id)) {
          const { resolve, reject, timer } = this._pending.get(msg.id);
          clearTimeout(timer);
          this._pending.delete(msg.id);
          if (msg.error) {
            const err = new Error(msg.error.message);
            err.code = msg.error.code;
            reject(err);
          } else {
            resolve(msg.result);
          }
        }
      } catch (e) {
        console.error('[bridge] Failed to parse message:', e);
      }
    });

    ws.on('close', () => {
      if (this._ws === ws) {
        console.error('[bridge] Plugin disconnected');
        this._ws = null;
        this._editorType = null;
        this._documentName = null;
        // Reject all pending commands
        for (const [id, { reject, timer }] of this._pending) {
          clearTimeout(timer);
          const err = new Error('Plugin disconnected');
          err.code = 'NOT_CONNECTED';
          reject(err);
        }
        this._pending.clear();
      }
    });

    ws.on('error', (err) => {
      console.error('[bridge] WebSocket error:', err.message);
    });
  }

  isConnected() {
    return this._ws !== null && this._ws.readyState === 1;
  }

  editorType() {
    return this._editorType;
  }

  documentName() {
    return this._documentName;
  }

  address() {
    return this._wss.address();
  }

  send(cmd, params = {}, options = {}) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        const err = new Error('Plugin not connected');
        err.code = 'NOT_CONNECTED';
        return reject(err);
      }

      const id = `req-${++this._reqCounter}`;
      const isExport = cmd.startsWith('export') || cmd === 'exportSlide' || cmd === 'exportAllSlides';
      const timeout = options.timeout || (isExport ? 30000 : 10000);

      const timer = setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          const err = new Error(`Command ${cmd} timed out after ${timeout}ms`);
          err.code = 'TIMEOUT';
          reject(err);
        }
      }, timeout);

      this._pending.set(id, { resolve, reject, timer });
      this._ws.send(JSON.stringify({ id, cmd, params }));
    });
  }

  close() {
    for (const [id, { reject, timer }] of this._pending) {
      clearTimeout(timer);
      const err = new Error('Bridge closing');
      err.code = 'NOT_CONNECTED';
      reject(err);
    }
    this._pending.clear();
    if (this._ws) this._ws.close();
    this._wss.close();
  }
}
