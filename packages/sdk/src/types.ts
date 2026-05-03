/**
 * Core types for the AI Agent Proxy SDK
 */

export type ProxyLogLevel = 'silent' | 'info' | 'verbose' | 'debug';

export interface ProxyServerOptions {
  /** Port for the proxy server to listen on */
  port?: number;
  /** Host to bind to */
  host?: string;
  /** Log level */
  logLevel?: ProxyLogLevel;
  /** Auto-configure NODE_EXTRA_CA_CERTS for HTTPS interception */
  autoConfigureTrust?: boolean;
  /** WebSocket port for real-time updates */
  wsPort?: number;
}

export type InterceptTarget = 'http' | 'https';

export interface InterceptorConfig {
  /** Target to intercept: 'http', 'https', or 'all' */
  target: InterceptTarget | 'all';
  /** Function to call when a request is intercepted */
  onRequest?: InterceptCallback;
  /** Function to call when a response is intercepted */
  onResponse?: InterceptCallback;
  /** Enable body capture (can impact performance) */
  captureBody?: boolean;
  /** Maximum body size to capture in bytes (default: 50KB) */
  maxBodySize?: number;
  /** Custom CA certificate directory (default: ~/.ai-agent-proxy) */
  caDir?: string;
}

export interface AgentClientConfig {
  /** Proxy server host */
  proxyHost?: string;
  /** Proxy server port */
  proxyPort?: number;
  /** WebSocket port */
  wsPort?: number;
  /** API key for authentication (if required) */
  apiKey?: string;
  /** Session identifier */
  sessionId?: string;
  /** Auto-connect on creation */
  autoConnect?: boolean;
}

export interface AgentRegistration {
  agentId: string;
  name: string;
  capabilities?: string[];
  metadata?: Record<string, unknown>;
}

export interface AgentSession {
  id: string;
  createdAt: number;
  config: AgentClientConfig;
  exchanges: string[];
}

export interface CaptureOptions {
  /** Enable request body capture */
  body?: boolean;
  /** Enable header capture */
  headers?: boolean;
  /** Maximum body size to capture in bytes */
  maxBodySize?: number;
}

export interface CapturedRequest {
  id: string;
  timestamp: number;
  method: string;
  url: string;
  protocol: 'HTTP' | 'HTTPS';
  host: string;
  path: string;
  headers: Record<string, string | string[]>;
  body?: string;
  bodySize?: number;
}

export interface CapturedResponse {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string | string[]>;
  body?: string;
  bodySize?: number;
  duration: number;
  timestamp: number;
}

export interface CapturedExchange {
  id: string;
  request: CapturedRequest;
  response?: CapturedResponse;
  isHttps?: boolean;
}

export interface InterceptContext {
  /** The captured request */
  request: CapturedRequest;
  /** The captured response (if available) */
  response?: CapturedResponse;
  /** Exchange ID */
  exchangeId: string;
  /** Protocol */
  protocol: 'HTTP' | 'HTTPS';
  /** Modify the request before it reaches the target */
  modifyRequest: (modifications: {
    method?: string;
    url?: string;
    headers?: Record<string, string | string[]>;
    body?: string;
  }) => void;
  /** Modify the response before it returns to the client */
  modifyResponse: (modifications: {
    statusCode?: number;
    statusMessage?: string;
    headers?: Record<string, string | string[]>;
    body?: string;
  }) => void;
}

export type InterceptCallback = (context: InterceptContext) => void | Promise<void>;

export interface Breakpoint {
  id: string;
  type: 'request' | 'response' | 'both';
  match?: {
    method?: string | RegExp;
    urlPattern?: string | RegExp;
    statusCode?: number;
  };
  enabled: boolean;
  hitCount: number;
  maxHits?: number;
}

export interface QueuedModification {
  exchangeId: string;
  type: 'request' | 'response';
  original: CapturedRequest | CapturedResponse;
  modified?: CapturedRequest | CapturedResponse;
  status: 'pending' | 'modified' | 'rejected';
}

export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: HarRequest;
  response: HarResponse;
  cache: Record<string, unknown>;
  timings: HarTimings;
  _aiAgentProxy?: {
    exchangeId: string;
    isHttps?: boolean;
  };
}

export interface HarRequest {
  method: string;
  url: string;
  httpVersion: string;
  cookies: HarCookie[];
  headers: HarHeader[];
  queryString: HarQueryString[];
  postData?: HarPostData;
  headersSize: number;
  bodySize: number;
}

export interface HarResponse {
  status: number;
  statusText: string;
  httpVersion: string;
  cookies: HarCookie[];
  headers: HarHeader[];
  content: HarContent;
  redirectURL: string;
  headersSize: number;
  bodySize: number;
}

export interface HarCookie {
  name: string;
  value: string;
  path?: string;
  domain?: string;
  expires?: string;
  httpOnly?: boolean;
  secure?: boolean;
  comment?: string;
}

export interface HarHeader {
  name: string;
  value: string;
}

export interface HarQueryString {
  name: string;
  value: string;
}

export interface HarPostData {
  mimeType: string;
  text?: string;
  params?: HarPostParam[];
}

export interface HarPostParam {
  name: string;
  value: string;
  fileName?: string;
  contentType?: string;
}

export interface HarContent {
  size: number;
  compression?: number;
  mimeType: string;
  text?: string;
  encoding?: string;
}

export interface HarTimings {
  blocked: number;
  dns: number;
  connect: number;
  send: number;
  wait: number;
  receive: number;
  ssl?: number;
}

export interface HarLog {
  version: string;
  creator: HarCreator;
  pages: HarPage[];
  entries: HarEntry[];
}

export interface HarCreator {
  name: string;
  version: string;
}

export interface HarPage {
  startedDateTime: string;
  id: string;
  title: string;
  pageTimings: {
    onContentLoad: number;
    onLoad: number;
  };
}
