/**
 * Lightweight HTTP/HTTPS Interceptor
 * Intercepts requests made through Node.js http/https modules without proxy configuration
 */

import * as httpM from 'http';
import { URL } from 'url';
import type { IncomingMessage, ClientRequest, RequestOptions } from 'http';
import {
  InterceptorConfig,
  InterceptCallback,
  InterceptContext,
  CapturedRequest,
  CapturedResponse,
} from './types';

// Store originals
let originalHttpRequest: typeof httpM.request | null = null;
let originalHttpsRequest: any = null;

// State
let isPatched = false;
const interceptors = new Map<string, InterceptorConfig>();

interface ActiveRequest {
  request: CapturedRequest;
  startTime: number;
}
const activeRequests = new Map<string, ActiveRequest>();

function normalizeHeaders(headers: httpM.OutgoingHttpHeaders | readonly string[] | undefined): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  if (!headers) return result;

  if (Array.isArray(headers)) {
    for (let i = 0; i < headers.length; i += 2) {
      const name = headers[i] as string;
      const value = String(headers[i + 1]);
      result[name] = value;
    }
  } else {
    for (const [key, value] of Object.entries(headers)) {
      result[key] = value as string | string[];
    }
  }
  return result;
}

function createInterceptContext(request: CapturedRequest): InterceptContext {
  return {
    request,
    exchangeId: request.id,
    protocol: request.protocol,
    response: undefined,
    modifyRequest: () => {},
    modifyResponse: () => {},
  };
}

function buildUrlFromOptions(opts: RequestOptions): string {
  const protocol = (opts as any).protocol || 'http:';
  const hostname = opts.hostname || opts.host || 'localhost';
  const port = opts.port;
  const path = opts.path || '/';
  const portStr = port && port !== (protocol === 'https:' ? '443' : '80') ? `:${port}` : '';
  return `${protocol}//${hostname}${portStr}${path}`;
}

function parseInput(input: string | URL): RequestOptions {
  if (typeof input === 'string') {
    try {
      const urlObj = new URL(input);
      return {
        protocol: urlObj.protocol,
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname + urlObj.search,
      };
    } catch (err) {
      return {};
    }
  } else {
    return {
      protocol: input.protocol,
      hostname: input.hostname,
      port: input.port,
      path: input.pathname + input.search,
    };
  }
}

function hasBodyCaptureInterceptor(): boolean {
  for (const config of interceptors.values()) {
    if ((config.target === 'http' || config.target === 'all') && config.captureBody) {
      return true;
    }
  }
  return false;
}

function getMaxBodySize(): number {
  for (const config of interceptors.values()) {
    if (config.captureBody && config.maxBodySize) {
      return config.maxBodySize;
    }
  }
  return 50000;
}

/**
 * Create a patched version of http.request
 */
function createPatchedHttpRequest(original: typeof httpM.request): any {
  return function patchedHttpRequest(
    input: string | URL | RequestOptions,
    options?: RequestOptions | ((res: IncomingMessage) => void),
    cb?: (res: IncomingMessage) => void
  ): ClientRequest {
    const hasCallback = typeof options === 'function';
    const opts: any = hasCallback ? parseInput(input as string | URL) : {
      ...parseInput(input as string | URL),
      ...(options as any),
    };

    const callback = hasCallback ? options as (res: IncomingMessage) => void : cb;

    const exchangeId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const timestamp = Date.now();
    const protocol = (opts.protocol === 'https:' || opts.port === 443) ? 'HTTPS' : 'HTTP';

    const request: CapturedRequest = {
      id: exchangeId,
      timestamp,
      method: opts.method || 'GET',
      url: buildUrlFromOptions(opts),
      protocol,
      host: opts.hostname || opts.host || 'localhost',
      path: opts.path || '/',
      headers: normalizeHeaders(opts.headers),
      body: undefined,
      bodySize: 0,
    };

    activeRequests.set(exchangeId, { request, startTime: timestamp });

    for (const config of interceptors.values()) {
      if ((config.target === 'http' || config.target === 'all') && config.onRequest) {
        const context = createInterceptContext(request);
        try {
          config.onRequest(context);
        } catch (err) {
          console.error('Interceptor onRequest error:', err);
        }
      }
    }

    const clientRequest = (original || (originalHttpRequest as typeof httpM.request))(opts, (res: IncomingMessage) => {
        const duration = Date.now() - timestamp;

        const response: CapturedResponse = {
          statusCode: res.statusCode || 0,
          statusMessage: res.statusMessage || '',
          headers: normalizeHeaders(res.headers),
          body: undefined,
          bodySize: 0,
          duration,
          timestamp: Date.now(),
        };

        if (hasBodyCaptureInterceptor()) {
          const chunks: any[] = [];
          const originalOn = res.on;

          (res as any).on = function (event: string, listener: any) {
            if (event === 'data') {
              const wrapped = function (chunk: any) {
                chunks.push(chunk);
                if (listener) (listener as any)(chunk);
              };
              return originalOn.call(this, event, wrapped);
            }
            return originalOn.call(this, event, listener);
          };

          const originalEmit = res.emit.bind(res);
          (res as any).emit = function (...args: any[]) {
            if (args[0] === 'end' && chunks.length > 0) {
              const combined = Buffer.concat(chunks);
              response.body = combined.toString('utf8');
              response.bodySize = combined.length;
            }
            return originalEmit.apply(this, args as [string | symbol, ...any[]]);
          };
        }

        for (const config of interceptors.values()) {
          if ((config.target === 'http' || config.target === 'all') && config.onResponse) {
            const context = createInterceptContext(request);
            context.response = response;
            try {
              config.onResponse(context);
            } catch (err) {
              console.error('Interceptor onResponse error:', err);
            }
          }
        }

        activeRequests.delete(exchangeId);
        if (callback) {
          callback(res);
        }
      }
    );

    let requestBody = '';
    const originalWrite = clientRequest.write.bind(clientRequest);
    clientRequest.write = function (chunk: any, ...args: any[]) {
      if (typeof chunk === 'string') {
        requestBody += chunk;
      } else if (Buffer.isBuffer(chunk)) {
        requestBody += chunk.toString('utf8');
      } else if (chunk && typeof chunk === 'object') {
        try {
          requestBody += JSON.stringify(chunk);
        } catch (err) {}
      }
      return originalWrite.call(this, chunk, args ? args[0] : undefined, args ? args[1] : undefined);
    };

    const originalEnd = clientRequest.end.bind(clientRequest);
    clientRequest.end = function (chunk?: any, encoding?: any, cb?: any) {
      try {
      if (chunk !== undefined && chunk !== null) {
          
          if (typeof chunk === 'string') {
            requestBody += chunk;
          } else if (Buffer.isBuffer(chunk)) {
            requestBody += chunk.toString('utf8');
          } else if (chunk && typeof chunk === 'object') {
            try {
              requestBody += JSON.stringify(chunk);
            } catch (err) {}
          }
        }
      } catch (err) {}

      if (requestBody.length > 0) {
        request.body = requestBody;
        request.bodySize = Buffer.byteLength(requestBody);
      }
      return originalEnd.call(this, chunk, encoding, cb);
    };

    if (callback) {
      clientRequest.on('error', callback);
    }

    return clientRequest;
  };
}

/**
 * Create a patched version of https.request
 */
function createPatchedHttpsRequest(httpRequest: any): any {
  return function patchedHttpsRequest(
    this: any,
    input: string | URL | RequestOptions,
    options?: RequestOptions | ((res: IncomingMessage) => void),
    cb?: (res: IncomingMessage) => void
  ): ClientRequest {
    const hasCallback = typeof options === 'function';
    let opts: any = hasCallback ? parseInput(input as string | URL) : {
      ...parseInput(input as string | URL),
      ...(options as any),
    };

    opts.protocol = 'https:';
    if (!opts.port) {
      if (typeof input === 'string') {
        try {
          const urlObj = new URL(input);
          opts.hostname = urlObj.hostname;
          opts.port = urlObj.port || '443';
        } catch (err) {}
      }
    }
    if (!opts.port) opts.port = '443';

    return httpRequest.call(this, opts, hasCallback ? options : cb, hasCallback ? cb : undefined);
  };
}

/**
 * Install HTTP/HTTPS request interception
 */
function installHttpInterceptor(): void {
  if (isPatched) return;

  const http = require('http');
  const https = require('https');

  originalHttpRequest = http.request;
  originalHttpsRequest = https.request;

  const patchedHttp = createPatchedHttpRequest(originalHttpRequest as typeof httpM.request);
  const patchedHttps = createPatchedHttpsRequest(patchedHttp);

  (http as any).request = patchedHttp;
  (https as any).request = patchedHttps;

  isPatched = true;
}

/**
 * Uninstall HTTP/HTTPS request interception
 */
function uninstallHttpInterceptor(): void {
  if (!isPatched) return;

  const http = require('http');
  const https = require('https');

  (http as any).request = originalHttpRequest || http.request;
  (https as any).request = originalHttpsRequest || https.request;

  isPatched = false;
  interceptors.clear();
  activeRequests.clear();
}

/**
 * Create an interceptor instance
 */
export function createInterceptor(config: InterceptorConfig): {
  enable: () => void;
  disable: () => void;
  isEnabled: () => boolean;
} {
  const id = `interceptor_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  interceptors.set(id, config);

  const isEnabled = (): boolean => interceptors.has(id);

  const enable = (): void => {
    installHttpInterceptor();
  };

  const disable = (): void => {
    interceptors.delete(id);
    if (interceptors.size === 0) {
      uninstallHttpInterceptor();
    }
  };

  if (interceptors.size === 1) {
    enable();
  }

  return { enable, disable, isEnabled };
}

/**
 * Remove all interceptors and uninstall patching
 */
export function removeAllInterceptors(): void {
  interceptors.clear();
  uninstallHttpInterceptor();
}

/**
 * Get active interceptor count
 */
export function getInterceptorCount(): number {
  return interceptors.size;
}
