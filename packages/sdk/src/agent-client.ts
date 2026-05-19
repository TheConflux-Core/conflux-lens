/**
 * AI Agent Client
 * SDK for AI agents to register and manage proxy sessions
 */

const WebSocket = require('ws');
type ClientOptions = Record<string, any>;
import { ProxyServer } from './proxy-server';
import {
  CapturedExchange,
  Breakpoint,
  HarLog,
  AgentClientConfig,
  AgentRegistration,
  AgentSession,
} from './types';

const WebSocketClient: any = WebSocket;

export class AgentClient {
  private config: AgentClientConfig;
  private ws: any = null;
  private session: AgentSession | null = null;
  private proxyServer: ProxyServer | null = null;
  private eventHandlers = new Map<string, Set<Function>>();
  private isConnectedStatus = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(config: AgentClientConfig = {}) {
    this.config = {
      proxyHost: '127.0.0.1',
      proxyPort: 9876,
      wsPort: 9877,
      sessionId: `session_${Date.now()}`,
      autoConnect: true,
      ...config,
    };

    if (this.config.autoConnect) {
      this.connect();
    }
  }

  /**
   * Connect to the proxy server
   */
  async connect(): Promise<void> {
    const wsUrl = `ws://${this.config.proxyHost}:${this.config.wsPort || 9877}`;

    return new Promise<void>((resolve, reject) => {
      const options: ClientOptions = {};
      // @ts-ignore - ws constructor accepts url and options
      this.ws = new WebSocketClient(wsUrl, options);

      this.ws.on('open', () => {
        this.isConnectedStatus = true;
        this.reconnectAttempts = 0;
        console.log(`\u2705 Agent client connected to ${wsUrl}`);

        this.register();
        resolve();
      });

      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('close', () => {
        this.isConnectedStatus = false;
        console.log('\u26a0 Agent client disconnected');
        this.handleDisconnect();
      });

      this.ws.on('error', (err: Error) => {
        console.error('\u274c Agent client error:', err.message);
        reject(err);
      });
    });
  }

  /**
   * Register the agent with the proxy
   */
  private register(): void {
    const registration: AgentRegistration = {
      agentId: this.config.sessionId || `agent_${Date.now()}`,
      name: 'AI Agent',
      capabilities: ['traffic_inspection', 'breakpoint_control', 'har_export'],
      metadata: {
        sessionId: this.config.sessionId,
        proxyHost: this.config.proxyHost,
        proxyPort: this.config.proxyPort,
      },
    };

    this.send('register', registration);

    this.session = {
      id: this.config.sessionId || `session_${Date.now()}`,
      createdAt: Date.now(),
      config: this.config,
      exchanges: [],
    };
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'exchange':
          this.handleExchange(message.data);
          break;
        case 'breakpoint_hit':
          this.handleBreakpointHit(message.data);
          break;
        case 'summary':
          this.handleSummary(message.data);
          break;
        default:
          this._emit('message', message);
      }
    } catch (err) {
      console.error('Failed to parse message:', err);
    }
  }

  private handleExchange(exchange: CapturedExchange): void {
    if (this.session) {
      this.session.exchanges.push(exchange.id);
    }
    this._emit('exchange', exchange);
  }

  private handleBreakpointHit(data: any): void {
    this._emit('breakpoint_hit', data);
  }

  private handleSummary(data: any): void {
    this._emit('summary', data);
  }

  private handleDisconnect(): void {
    this._emit('disconnect');

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      console.log(`Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts})`);

      setTimeout(() => {
        this.connect().catch(() => {});
      }, delay);
    }
  }

  /**
   * Send a message through the WebSocket
   */
  private send(type: string, payload?: any): void {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ type, ...payload }));
    }
  }

  /**
   * Start a local proxy server for this agent
   */
  async startProxyServer(port?: number): Promise<ProxyServer> {
    this.proxyServer = new ProxyServer({
      port: port || this.config.proxyPort || 9876,
      wsPort: (port || this.config.proxyPort || 9876) + 1,
      logLevel: 'info',
    });

    await this.proxyServer.start();
    return this.proxyServer;
  }

  /**
   * Stop the local proxy server
   */
  async stopProxyServer(): Promise<void> {
    if (this.proxyServer) {
      await this.proxyServer.stop();
      this.proxyServer = null;
    }
  }

  /**
   * Add an event listener
   */
  on(event: string, handler: Function): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /**
   * Remove an event listener
   */
  off(event: string, handler: Function): void {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event)!.delete(handler);
    }
  }

  /**
   * Emit an event
   */
  private _emit(event: string, data?: any): void {
    if (this.eventHandlers.has(event)) {
      for (const handler of this.eventHandlers.get(event)!) {
        handler(data);
      }
    }
  }

  /**
   * Get all captured exchanges for this session
   */
  async getExchanges(): Promise<CapturedExchange[]> {
    if (this.proxyServer) {
      return this.proxyServer.getExchanges();
    }
    return [];
  }

  /**
   * Add a breakpoint
   */
  addBreakpoint(breakpoint: Omit<Breakpoint, 'id' | 'hitCount'>): Breakpoint | undefined {
    if (this.proxyServer) {
      const bp = this.proxyServer.addBreakpoint(breakpoint);
      this.send('breakpoint_add', bp);
      return bp;
    }
    return undefined;
  }

  /**
   * Remove a breakpoint
   */
  removeBreakpoint(id: string): boolean {
    if (this.proxyServer) {
      const result = this.proxyServer.removeBreakpoint(id);
      if (result) {
        this.send('breakpoint_remove', { id });
      }
      return result;
    }
    return false;
  }

  /**
   * Export exchanges as HAR
   */
  async exportHar(): Promise<HarLog> {
    if (this.proxyServer) {
      return this.proxyServer.exportHar();
    }

    return {
      version: '1.2',
      creator: {
        name: 'Conflux Lens SDK',
        version: '0.1.0',
      },
      pages: [],
      entries: [],
    };
  }

  /**
   * Get session info
   */
  getSession(): AgentSession | null {
    return this.session;
  }

  /**
   * Disconnect the agent client
   */
  disconnect(): void {
    this.maxReconnectAttempts = 0;
    if (this.ws) {
      this.ws.close(1000, "normal");
      this.ws = null;
    }
    this.isConnectedStatus = false;
  }

  /**
   * Check if connected
   */
  isConnectedToProxy(): boolean {
    return this.isConnectedStatus;
  }
}
