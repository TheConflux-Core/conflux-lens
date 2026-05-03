/**
 * AI Agent Proxy SDK
 * 
 * Programmatic HTTP/HTTPS interception and AI agent traffic monitoring
 * 
 * @packageDocumentation
 */

export { ProxyServer, createProxyServer } from './proxy-server';
export { createInterceptor, removeAllInterceptors, getInterceptorCount } from './interceptor';
export { AgentClient } from './agent-client';
export {
  loadOrCreateRootCA,
  generateCertForHost,
  clearCertCache,
  getCAFingerprint,
  CA_CERT_PATH,
  CA_KEY_PATH,
} from './cert-manager';

// Type exports
export type {
  ProxyLogLevel,
  ProxyServerOptions,
  InterceptTarget,
  InterceptorConfig,
  CaptureOptions,
  CapturedRequest,
  CapturedResponse,
  CapturedExchange,
  InterceptContext,
  InterceptCallback,
  Breakpoint,
  QueuedModification,
  HarEntry,
  HarRequest,
  HarResponse,
  HarCookie,
  HarHeader,
  HarQueryString,
  HarPostData,
  HarContent,
  HarTimings,
  HarLog,
  HarCreator,
  HarPage,
  AgentClientConfig,
  AgentSession,
  AgentRegistration,
} from './types';
