const socket = new WebSocket(`ws://${window.location.hostname}:9877`);

let exchanges = new Map();
let breakpoints = new Map();
let selectedId = null;
let currentFilter = "all";
let searchQuery = "";

const connectionStatus = document.getElementById("connectionStatus");
const exchangeCount = document.getElementById("exchangeCount");
const breakpointCount = document.getElementById("breakpointCount");
const requestCount = document.getElementById("requestCount");
const requestList = document.getElementById("requestList");
const detailPane = document.getElementById("detailPane");
const searchInput = document.getElementById("searchInput");
const filterTags = document.getElementById("filterTags");
const filterBtns = document.querySelectorAll(".filter-btn");
const clearBtn = document.getElementById("clearBtn");
const harExportBtn = document.getElementById("harExportBtn");
const breakpointsBtn = document.getElementById("breakpointsBtn");

/* --- Modals --- */
const breakpointModal = document.getElementById("breakpointModal");
const replayModal = document.getElementById("replayModal");
const breakpointActionModal = document.getElementById("breakpointActionModal");

socket.onopen = () => {
  connectionStatus.classList.add("connected");
  connectionStatus.querySelector(".label").textContent = "Connected";
  fetchBreakpoints();
};
socket.onclose = () => {
  connectionStatus.classList.remove("connected");
  connectionStatus.querySelector(".label").textContent = "Disconnected";
  setTimeout(() => location.reload(), 2000);
};
socket.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === "exchange") {
    exchanges.set(msg.data.id, msg.data);
    renderRequestList();
    updateStats();
    if (selectedId === msg.data.id) renderDetail(msg.data.id);
  } else if (msg.type === "breakpointCreated" || msg.type === "breakpointUpdated") {
    breakpoints.set(msg.data.id, msg.data);
    renderBreakpointsList();
    updateStats();
  } else if (msg.type === "modificationApplied") {
    breakpoints.set(msg.data.id, msg.data);
    renderBreakpointsList();
  } else if (msg.type === "replayComplete") {
    console.log("Replay complete", msg.data);
  } else if (msg.type === "breakpoint_hit") {
    showBreakpointAction(msg.data);
  } else if (msg.type === "summary") {
    updateStats();
  }
};

clearBtn.addEventListener("click", () => {
  if (confirm("Clear all captured requests?")) {
    fetch("/api/exchanges", { method: "DELETE" }).then(() => {
      exchanges.clear();
      selectedId = null;
      renderRequestList();
      updateStats();
      renderEmptyDetail();
    });
  }
});

harExportBtn.addEventListener("click", () => {
  if (exchanges.size === 0) { alert("No requests to export"); return; }
  fetch("/api/har").then(r => r.json()).then(har => {
    const blob = new Blob([JSON.stringify(har, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `har-export-${new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")}.har`;
    a.click();
    URL.revokeObjectURL(url);
  });
});

breakpointsBtn.addEventListener("click", () => {
  breakpointModal.style.display = "flex";
  renderBreakpointsList();
});

document.getElementById("closeBreakpointModal").addEventListener("click", () => breakpointModal.style.display = "none");
document.getElementById("closeReplayModal").addEventListener("click", () => replayModal.style.display = "none");
document.getElementById("closeBpAction").addEventListener("click", () => breakpointActionModal.style.display = "none");
[breakpointModal, replayModal, breakpointActionModal].forEach(m => {
  m.addEventListener("click", e => { if (e.target === m) m.style.display = "none"; });
});

document.getElementById("addBreakpoint").addEventListener("click", () => {
  const type = document.getElementById("bpType").value;
  const method = document.getElementById("bpMethod").value.trim() || undefined;
  const urlPattern = document.getElementById("bpUrlPattern").value.trim() || undefined;
  const statusCode = document.getElementById("bpStatusCode").value.trim();
  const match = {};
  if (method) match.method = method;
  if (urlPattern) match.urlPattern = urlPattern;
  if (statusCode) match.statusCode = parseInt(statusCode);
  fetch("/api/breakpoints", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, match, enabled: true })
  }).then(r => r.json()).then(bp => {
    breakpoints.set(bp.id, bp);
    renderBreakpointsList();
    updateStats();
    document.getElementById("bpMethod").value = "";
    document.getElementById("bpUrlPattern").value = "";
    document.getElementById("bpStatusCode").value = "";
  });
});

async function fetchBreakpoints() {
  const r = await fetch("/api/breakpoints");
  const bps = await r.json();
  bps.forEach(bp => breakpoints.set(bp.id, bp));
  renderBreakpointsList();
  updateStats();
}

function renderBreakpointsList() {
  const container = document.getElementById("breakpointsContainer");
  if (breakpoints.size === 0) { container.innerHTML = "<p style=color:#888>No breakpoints</p>"; return; }
  container.innerHTML = Array.from(breakpoints.values()).map(bp => `
    <div class="breakpoint-item ${bp.enabled ? "" : "disabled"}" data-id="${bp.id}">
      <div class="bp-header">
        <strong>${bp.type}</strong> <span class="bp-hitcount">${bp.hitCount||0} hits</span>
        <button class="bp-delete" onclick="deleteBreakpoint('${bp.id}')" title="Delete">×</button>
        <button class="bp-toggle" onclick="toggleBreakpoint('${bp.id}')" title="${bp.enabled?"Disable":"Enable"}">${bp.enabled?"✓":"○"}</button>
      </div>
      <div class="bp-details">
        ${bp.match?.method ? `Method: ${bp.match.method}<br>` : ""}
        ${bp.match?.urlPattern ? `URL: ${bp.match.urlPattern}<br>` : ""}
        ${bp.match?.statusCode ? `Status: ${bp.match.statusCode}<br>` : ""}
      </div>
    </div>
  `).join("");
}

window.deleteBreakpoint = (id) => {
  fetch(`/api/breakpoints/${id}`, { method: "DELETE" }).then(() => {
    breakpoints.delete(id);
    renderBreakpointsList();
    updateStats();
  });
};

window.toggleBreakpoint = (id) => {
  const bp = breakpoints.get(id);
  if (!bp) return;
  bp.enabled = !bp.enabled;
  fetch(`/api/breakpoints/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: bp.type, match: bp.match, enabled: bp.enabled })
  }).then(r => r.json()).then(() => {
    breakpoints.set(id, bp);
    renderBreakpointsList();
    updateStats();
  });
};

document.getElementById("replayBtn")?.remove();
searchInput.addEventListener("input", e => { searchQuery = e.target.value.toLowerCase(); updateFilterTags(); renderRequestList(); });
filterBtns.forEach(btn => btn.addEventListener("click", () => {
  filterBtns.forEach(b => b.removeAttribute("active"));
  btn.setAttribute("active", "");
  currentFilter = btn.dataset.filter;
  renderRequestList();
}));
window.removeSearch = () => { searchInput.value = ""; searchQuery = ""; updateFilterTags(); renderRequestList(); searchInput.focus(); };
function escapeHtml(s) { return s.replace(/[&<>"']/g, m => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[m])); }

/**
 * Pretty-print and syntax-highlight JSON with proper word wrapping
 */
function formatJson(jsonStr, maxDepth = 20) {
  if (!jsonStr) return '';
  try {
    const obj = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    return syntaxHighlightJson(obj, 0, maxDepth);
  } catch (e) {
    return escapeHtml(jsonStr);
  }
}

/**
 * Recursive JSON syntax highlighter
 */
function syntaxHighlightJson(obj, depth, maxDepth) {
  if (depth > maxDepth) return '<span class="json-null">[Max depth]</span>';
  
  if (obj === null) return '<span class="json-null">null</span>';
  if (obj === undefined) return '<span class="json-null">undefined</span>';
  if (typeof obj === 'boolean') return `<span class="json-boolean">${obj}</span>`;
  if (typeof obj === 'number') return `<span class="json-number">${obj}</span>`;
  if (typeof obj === 'string') {
    const escaped = escapeHtml(obj);
    return `<span class="json-string">"${escaped}"</span>`;
  }
  
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '<span class="json-null">[]</span>';
    const items = obj.map((item, i) => {
      const comma = i < obj.length - 1 ? ',' : '';
      const formatted = syntaxHighlightJson(item, depth + 1, maxDepth);
      return `  ${formatted}${comma}`;
    }).join('\n');
    return `[\n${items}\n]`;
  }
  
  if (typeof obj === 'object') {
    const keys = Object.keys(obj);
    if (keys.length === 0) return '<span class="json-null">{}</span>';
    const items = keys.map((key, i) => {
      const comma = i < keys.length - 1 ? ',' : '';
      const formatted = syntaxHighlightJson(obj[key], depth + 1, maxDepth);
      return `  <span class="json-key">"${escapeHtml(key)}"</span>: ${formatted}${comma}`;
    }).join('\n');
    return `{\n${items}\n}`;
  }
  
  return escapeHtml(String(obj));
}

/**
 * Try to format a string as JSON, falling back to raw text
 */
function prettyPrint(body) {
  if (!body) return '(no body)';
  
  const trimmed = body.trim();
  
  // Try to detect and format as JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      return formatJson(parsed);
    } catch (e) {
      // Not valid JSON
    }
  }
  
  // Return as plain text with HTML escaping
  return escapeHtml(body);
}

/**
 * Extract LLM token usage from SSE (server-sent events) response body
 * SSE format: "event: message_delta\ndata: {...}\n\n"
 * The message_delta event contains usage: {input_tokens, output_tokens}
 */
function extractSseTokenUsage(body) {
  if (!body || typeof body !== 'string') return null;
  
  // Split into SSE events by double newline
  const events = body.split('\n\n');
  
  // Scan all events: prefer message_delta (final usage), fall back to message_start (initial usage)
  let finalTokens = null;
  let initialTokens = null;
  
  for (const eventBlock of events) {
    // message_delta carries final token usage (input + output)
    if (eventBlock.includes('message_delta') && eventBlock.includes('"usage"')) {
      const lines = eventBlock.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.usage) {
              const input = data.usage.input_tokens || data.usage.prompt_tokens || 0;
              const output = data.usage.output_tokens || data.usage.completion_tokens || 0;
              if (input > 0 || output > 0) {
                finalTokens = { prompt: input, completion: output, total: input + output };
              }
            }
          } catch (e) { /* skip unparseable */ }
        }
      }
    }
    
    // message_start carries initial usage (input only, output=0)
    if (eventBlock.includes('message_start') && !finalTokens) {
      const lines = eventBlock.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.message && data.message.usage) {
              const u = data.message.usage;
              const input = u.input_tokens || u.prompt_tokens || 0;
              if (input > 0) {
                initialTokens = { prompt: input, completion: 0, total: input };
              }
            }
          } catch (e) { /* skip */ }
        }
      }
    }
  }
  
  // Prefer message_delta (final) over message_start (initial) token counts
  return finalTokens || initialTokens || null;
}

function matches(exchange) {
  const req = exchange.request;
  const res = exchange.response;
  if (currentFilter === "error" && (!res || res.statusCode < 400)) return false;
  if (currentFilter === "llm") {
    const u = req.url.toLowerCase();
    if (!u.includes("openai") && !u.includes("anthropic") && !u.includes("v1/chat") && !u.includes("v1/completions") && !u.includes("api.anthropic") && !u.includes("googleai") && !u.includes("gemini") && !u.includes("mistral") && !u.includes("cohere") && !u.includes("deepseek") && !u.includes("xai") && !u.includes("minimax")) return false;
  }
  if (currentFilter === "https" && !exchange.isHttps) return false;
  if (currentFilter === "websocket" && (!res || res.statusCode !== 101)) return false;
  if (searchQuery) {
    const s = JSON.stringify([req.method, req.url, req.body || ""]).toLowerCase();
    if (!s.includes(searchQuery)) return false;
  }
  return true;
}

function renderRequestList() {
  const list = Array.from(exchanges.values()).filter(matches).sort((a,b) => b.request.timestamp - a.request.timestamp);
  requestCount.textContent = `${list.length} requests`;
  if (list.length === 0) {
    requestList.innerHTML = `<div class="empty-state"><p>${exchanges.size > 0 ? "No matching requests" : "⏳ Waiting for traffic..."}</p><small>Set HTTP_PROXY=http://localhost:9876</small><br><small>Breakpoints · HAR Export · Replay</small></div>`;
    return;
  }
  requestList.innerHTML = list.map(ex => {
    const status = ex.response?.statusCode || 0;
    const isErr = status >= 400;
    const isWs = status === 101;
    const wsCount = (ex.response?.websocketMessages || []).length;
    const duration = ex.response?.duration || 0;
    const timeStr = duration > 1000 ? (duration/1000).toFixed(1)+"s" : duration+"ms";
    const method = ex.request.method;
    const url = ex.request.url.length > 50 ? ex.request.url.slice(0,47)+"..." : ex.request.url;
    const wsBadge = isWs ? `<span class="ws-badge">WS${wsCount > 0 ? ' (' + wsCount + ')' : ''}</span>` : '';
    return `<div class="request-item${selectedId===ex.id?" selected":""}${ex.isHttps?" https":""}${isWs?" ws-gateway":""}" data-id="${ex.id}" onclick="selectRequest('${ex.id}')" ${isErr?'style="border-left:3px solid var(--error)"':''} ${isWs?'style="border-left:3px solid var(--cyan)"':''}>
      <div class="req-method ${method==="POST"?"post":method==="PUT"?"put":method==="DELETE"?"delete":"get"}">${method}</div>
      <div class="req-details"><div class="req-url">${escapeHtml(url)}${wsBadge}</div>
      <div class="req-meta">${status ? `Status: ${status} | ` : ""}${timeStr}${ex.isHttps?' | HTTPS':' | HTTP'}${wsCount > 0 ? ' | ' + wsCount + ' WS messages' : ''}</div></div>
      ${isWs ? `<div class="req-status ws-indicator">🔌 WS</div>` : (status>=400 ? `<div class="req-status error">${status}</div>` : `<div class="req-status">${duration?timeStr:""}</div>`)}
    </div>`;
  }).join("");
}

function updateStats() {
  const total = exchanges.size;
  const withResp = Array.from(exchanges.values()).filter(e=>e.response).length;
  const https = Array.from(exchanges.values()).filter(e=>e.isHttps).length;
  exchangeCount.textContent = `${total} total | ${withResp} with response${https?` | ${https} HTTPS`:""}`;
  breakpointCount.textContent = `${breakpoints.size} breakpoints`;
}

function renderDetail(id) {
  selectedId = id;
  const ex = exchanges.get(id);
  if (!ex) return;
  renderRequestList();
  const req = ex.request;
  const res = ex.response;
  const isHttps = ex.isHttps;

  // Detect LLM API calls (include minimax, together, fireworks, groq, etc.)
  const urlLower = (req.url || "").toLowerCase();
  const isLlmCall = urlLower.includes("openai") || urlLower.includes("anthropic") || urlLower.includes("v1/chat/") || urlLower.includes("v1/completions") || urlLower.includes("api.anthropic") || urlLower.includes("googleai") || urlLower.includes("gemini") || urlLower.includes("mistral") || urlLower.includes("cohere") || urlLower.includes("deepseek") || urlLower.includes("xai") || urlLower.includes("minimax");

  // Extract token usage from response body if LLM call
  let tokens = null;
  let tokenSource = ''; // '' = API usage, ' (est.)' = character-based fallback
  if (isLlmCall && res && res.body) {
    // Try SSE parsing first (for streaming LLM responses from minimax, etc.)
    const sseTokens = extractSseTokenUsage(res.body);
    if (sseTokens) {
      tokens = sseTokens;
    } else {
      // Try regular JSON parsing (for non-streaming responses)
      try {
        const parsed = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
        if (parsed.usage) {
          // Official token counts from the API response
          tokens = { prompt: parsed.usage.prompt_tokens || parsed.usage.input_tokens || 0, completion: parsed.usage.completion_tokens || parsed.usage.output_tokens || 0, total: (parsed.usage.prompt_tokens || parsed.usage.input_tokens || 0) + (parsed.usage.completion_tokens || parsed.usage.output_tokens || 0) };
        }
      } catch (e) {
        // Not valid JSON — try partial JSON extraction from SSE data lines
        try {
          // Last resort: search for any JSON in the body that has "usage"
          const usageMatch = res.body.match(/\{"input_tokens":(\d+),"output_tokens":(\d+)[^}]*\}/);
          if (usageMatch) {
            tokens = { prompt: parseInt(usageMatch[1]), completion: parseInt(usageMatch[2]), total: parseInt(usageMatch[1]) + parseInt(usageMatch[2]) };
          }
        } catch (e2) {}
      }
    }
    // Fallback: character-based estimation (~4 chars per token) if API didn't provide usage
    if (!tokens) {
      const reqBodyStr = req.body || '';
      const resBodyStr = res.body || '';
      const promptChars = reqBodyStr.length;
      const completionChars = resBodyStr.length;
      tokens = {
        prompt: Math.ceil(promptChars / 4),
        completion: Math.ceil(completionChars / 4),
        total: Math.ceil((promptChars + completionChars) / 4),
      };
      tokenSource = ' (est.)';
    }
  }

  let body = "";
  // Header with metadata
  body += `<div class="detail-header" style="background:var(--bg-tertiary);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:16px">`;
  body += `<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">`;
  const methodColor = req.method==="POST"?"#10b981":req.method==="PUT"?"#f59e0b":req.method==="DELETE"?"#ef4444":"#4f46e5";
  body += `<span style="padding:4px 12px;border-radius:4px;font-weight:700;font-size:13px;text-transform:uppercase;background:${methodColor}20;color:${methodColor}">${escapeHtml(req.method)}</span>`;
  body += `<span style="font-size:14px;font-weight:500;word-break:break-all;color:var(--fg)">${escapeHtml(req.url)}</span>`;
  if (isLlmCall) body += `<span style="margin-left:auto;padding:3px 10px;border-radius:12px;background:rgba(34,211,238,0.2);color:var(--cyan);font-size:11px;font-weight:600">LLM</span>`;
  body += `</div>`;
  body += `<div style="display:flex;gap:20px;font-size:12px;color:var(--fg-muted)">`;
  body += `<span>🆔 ${id}</span>`;
  body += `<span>🔒 ${isHttps?"HTTPS":"HTTP"}</span>`;
  body += `<span>🕐 ${new Date(req.timestamp).toLocaleString()}</span>`;
  if (res) body += `<span>⏱ ${res.duration}ms</span>`;
  if (res) body += `<span>📦 ${res.bodySize || 0}B</span>`;
  if (isLlmCall && tokens) body += `<span>📊 ${tokens.total.toLocaleString()} tokens${tokenSource}</span>`;
  body += `</div>`;
  body += `</div>`;

  // Tabs — auto-select WebSocket for Gateway exchanges
  const isWsExchange = res && res.statusCode === 101 && res.websocketMessages && res.websocketMessages.length > 0;
  body += `<div style=\"display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:16px\">`;
  body += `<button class=\"detail-tab${isWsExchange ? '' : ' active'}\" onclick=\"showDetailTab('request',this)\">Request</button>`;
  body += `<button class=\"detail-tab\" onclick=\"showDetailTab('response',this)\">Response</button>`;
  body += `<button class=\"detail-tab\" onclick=\"showDetailTab('headers',this)\">Headers</button>`;
  body += `<button class=\"detail-tab\" onclick=\"showDetailTab('timing',this)\">Timing</button>`;
  if (isWsExchange) {
    body += `<button class=\"detail-tab active\" onclick=\"showDetailTab('websocket',this)\">WebSocket (${res.websocketMessages.length})</button>`;
  }
  body += `<button class=\"detail-tab\" onclick=\"openReplayModal('${id}')\\\">↻ Replay</button></div>`;

  // Request tab — hide initially for Gateway exchanges (shows garbled binary)
  body += `<div class="tab-content" id="req-tab" style="display:${isWsExchange ? 'none' : 'block'}"><div class="code-block"><pre>${prettyPrint(req.body)}</pre></div></div>`;

  // Response tab
  body += `<div class="tab-content" id="res-tab" style="display:none">`;
  if (res) {
    if (res.statusCode >= 400) body += `<div style="padding:8px 14px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:var(--radius-sm);margin-bottom:12px;font-size:13px;color:var(--error)"><strong>${res.statusCode} ${escapeHtml(res.statusMessage || "")}</strong></div>`;
    body += `<div class="code-block"><pre>${prettyPrint(res.body)}</pre></div>`;
    if (isLlmCall && tokens) {
      body += `<div style="margin-top:12px"><div class="token-stats">`;
      body += `<div class="token-stat prompt"><div class="stat-value">${tokens.prompt.toLocaleString()}</div><div class="stat-label">Prompt${tokenSource}</div></div>`;
      body += `<div class="token-stat completion"><div class="stat-value">${tokens.completion.toLocaleString()}</div><div class="stat-label">Completion${tokenSource}</div></div>`;
      body += `<div class="token-stat total"><div class="stat-value">${tokens.total.toLocaleString()}</div><div class="stat-label">Total${tokenSource}</div></div>`;
      body += `</div></div>`;
    }
  } else {
    body += `<p style="color:var(--fg-muted)">No response yet</p>`;
  }
  body += `</div>`;

  // Headers tab
  body += `<div class="tab-content" id="hdr-tab" style="display:none"><div class="headers-section"><h4>Request Headers</h4><pre style="font-size:12px;line-height:1.7">${escapeHtml(formatHeaders(req.headers))}</pre>`;
  if (res) body += `<h4>Response Headers</h4><pre style="font-size:12px;line-height:1.7">${escapeHtml(formatHeaders(res.headers))}</pre>`;
  body += `</div></div>`;

  // Timing tab
  body += `<div class="tab-content" id="time-tab" style="display:none">`;
  body += `<div style="background:var(--bg-tertiary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px">`;
  body += `<p style="margin-bottom:8px"><strong>Started:</strong> ${new Date(req.timestamp).toISOString()}</p>`;
  body += `<p style="margin-bottom:8px"><strong>Request Body:</strong> ${req.bodySize || 0} bytes</p>`;
  if (res) body += `<p style="margin-bottom:8px"><strong>Response Time:</strong> ${res.duration}ms</p>`;
  if (res) body += `<p><strong>Response Body:</strong> ${res.bodySize || 0} bytes</p>`;
  body += `</div></div>`;

  // WebSocket tab — visible by default for Gateway exchanges
  body += `<div class="tab-content" id="ws-tab" style="display:${isWsExchange ? 'block' : 'none'}">`;
  if (res && res.websocketMessages && res.websocketMessages.length > 0) {
    body += `<div style="margin-bottom:12px;font-size:13px;color:var(--fg-muted)">${res.websocketMessages.length} WebSocket messages</div>`;
    res.websocketMessages.forEach((msg, i) => {
      const label = formatWsLabel(msg);
      body += `<details style="margin-bottom:6px;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:6px 10px" ${i < 5 ? 'open' : ''}>`;
      body += `<summary style="cursor:pointer;font-weight:600;font-size:12px;margin-bottom:4px;display:flex;align-items:center;gap:8px">`;
      body += `<span class="ws-msg-badge" style="background:${label.color}20;color:${label.color};padding:2px 8px;border-radius:3px;font-size:11px;font-weight:700">${label.emoji} ${label.text}</span>`;
      body += `<span style="color:var(--fg-muted);font-weight:400;font-size:11px">#${i}</span>`;
      body += `</summary>`;
      body += `<div class="code-block" style="max-height:400px;overflow:auto;margin-top:4px"><pre>${prettyPrint(msg)}</pre></div>`;
      body += `</details>`;
    });
  } else {
    body += `<p style="color:var(--fg-muted)">No WebSocket messages</p>`;
  }
  body += `</div>`;

  detailPane.innerHTML = body;
}

function showDetailTab(tab, btn) {
  document.querySelectorAll(".detail-tab").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  ["req","res","hdr","time","ws"].forEach(t => { const el = document.getElementById(t+"-tab"); if (el) el.style.display = "none"; });
  const el = document.getElementById(tab+"-tab");
  if (el) el.style.display = "block";
}

function formatHeaders(h) {
  let out = "";
  if (!h) return out;
  for (const [k,v] of Object.entries(h)) out += `${k}: ${Array.isArray(v)?v.join(", "):v}\n`;
  return out;
}

/**
 * Parse a WebSocket Gateway JSON message and return formatted label metadata.
 */
function formatWsLabel(msg) {
  try {
    const p = typeof msg === 'string' ? JSON.parse(msg) : msg;
    const op = p.op;
    const t = p.t || '';
    
    // Opcode labels: https://discord.com/developers/docs/topics/gateway#opcodes-and-status-codes
    const opLabels = {
      0: { emoji: '📨', color: '#4f46e5', text: t || 'Dispatch' },
      1: { emoji: '💓', color: '#ef4444', text: 'Heartbeat' },
      2: { emoji: '🆔', color: '#10b981', text: 'Identify' },
      3: { emoji: '📍', color: '#f59e0b', text: 'Presence Update' },
      4: { emoji: '🎤', color: '#f59e0b', text: 'Voice State Update' },
      7: { emoji: '🔁', color: '#8b5cf6', text: 'Reconnect' },
      8: { emoji: '🏃', color: '#8b5cf6', text: 'Request Guild Members' },
      9: { emoji: '❌', color: '#ef4444', text: 'Invalid Session' },
      10: { emoji: '👋', color: '#22d3ee', text: 'Hello' },
      11: { emoji: '💚', color: '#34d399', text: 'Heartbeat ACK' },
    };
    
    if (opLabels[op]) return opLabels[op];
    return { emoji: '📦', color: '#888', text: `op ${op}` };
  } catch (e) {
    return { emoji: '❓', color: '#888', text: 'Unknown' };
  }
}

/**
 * Try to decompress gzip/brotli response body for display
 */
function tryDecompressBody(body) {
  if (!body || typeof body !== 'string') return null;
  // Check for gzip magic bytes: 0x1f 0x8b
  if (body.charCodeAt(0) === 0x1f && body.charCodeAt(1) === 0x8b) {
    try {
      // Use the browser's built-in decompression
      const compressed = Uint8Array.from(body.split('').map(c => c.charCodeAt(0)));
      const decompressor = new DecompressionStream('gzip');
      const readable = new Blob([compressed]).stream().pipeThrough(decompressor);
      // This is async, so we return the body with a note
      return null; // Keep showing raw for now - browser can't sync decompress
    } catch (e) {
      return null;
    }
  }
  return null;
}

function selectRequest(id) {
  selectedId = id;
  renderRequestList();
  renderDetail(id);
}

function renderEmptyDetail() {
  selectedId = null;
  renderRequestList();
  detailPane.innerHTML = `<div class="empty-detail"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg><h3>Select a request</h3><p>Click any request to inspect</p></div>`;
}

function openReplayModal(id) {
  const ex = exchanges.get(id);
  if (!ex) return;
  const dlg = document.getElementById("replayBody");
  const url = ex.request.url;
  dlg.innerHTML = `<div class="form-group"><label>URL</label><input type="text" id="replayUrl" value="${escapeHtml(url)}"></div><div class="form-group"><label>Method</label><select id="replayMethod"><option ${ex.request.method==="GET"?"selected":""}>GET</option><option ${ex.request.method==="POST"?"selected":""}>POST</option><option ${ex.request.method==="PUT"?"selected":""}>PUT</option><option ${ex.request.method==="DELETE"?"selected":""}>DELETE</option></select></div><div class="form-group"><label>Headers (JSON)</label><textarea id="replayHeaders" rows="4">${JSON.stringify(ex.request.headers, null, 2)}</textarea></div><div class="form-group"><label>Body</label><textarea id="replayBodyText" rows="6">${ex.request.body || ""}</textarea></div><div class="form-actions"><button class="btn btn-primary" onclick="executeReplay('${id}')">Execute Replay</button></div>`;
  replayModal.style.display = "flex";
}

window.executeReplay = (origId) => {
  const url = document.getElementById("replayUrl").value;
  const method = document.getElementById("replayMethod").value;
  let headers = {};
  try { headers = JSON.parse(document.getElementById("replayHeaders").value); } catch(e) { alert("Invalid headers JSON"); return; }
  const body = document.getElementById("replayBodyText").value;
  fetch(`/api/exchanges/${origId}/replay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, method, headers, body }) })
    .then(r => r.json()).then(r => { alert("Replay queued: " + r.replayId); replayModal.style.display = "none"; }).catch(e => alert("Replay failed: " + e.message));
};

function showBreakpointAction(data) {
  breakpointActionModal.style.display = "flex";
  document.getElementById("bpActionType").textContent = data.type === "request" ? "Incoming Request" : "Response Ready";
  document.getElementById("bpActionTypeTitle").textContent = data.type === "request" ? "Incoming Request" : "Response";
  
  // Use syntax highlighting for intercepted request/response
  document.getElementById("bpRequestDisplay").innerHTML = prettyPrint(JSON.stringify(data.request, null, 2));
  const respGroup = document.getElementById("bpResponseGroup");
  if (data.response) {
    respGroup.style.display = "block";
    document.getElementById("bpResponseDisplay").innerHTML = prettyPrint(JSON.stringify(data.response, null, 2));
  } else { respGroup.style.display = "none"; }
  
  const urlGroup = document.getElementById("bpModRequestGroup");
  urlGroup.style.display = data.type === "request" ? "block" : "none";
  document.getElementById("bpModUrl").value = data.request.url || "";
  document.getElementById("bpModMethod").value = data.request.method || "GET";
  document.getElementById("bpModHeaders").value = JSON.stringify(data.request.headers || {}, null, 2);
  document.getElementById("bpModBody").value = data.request.body || "";
  const dlg = document.getElementById("breakpointActionBody");
  dlg.dataset.exchangeId = data.exchangeId;
  dlg.dataset.type = data.type;
}

document.getElementById("bpContinue").addEventListener("click", () => {
  const dlg = document.getElementById("breakpointActionBody");
  fetch(`/api/breakpoints/dummy/trigger`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "continue", exchangeId: dlg.dataset.exchangeId, type: dlg.dataset.type })
  }).then(() => { breakpointActionModal.style.display = "none"; });
});

document.getElementById("bpModify").addEventListener("click", () => {
  const dlg = document.getElementById("breakpointActionBody");
  const mod = {};
  if (dlg.dataset.type === "request") {
    mod.url = document.getElementById("bpModUrl").value;
    mod.method = document.getElementById("bpModMethod").value;
    try { mod.headers = JSON.parse(document.getElementById("bpModHeaders").value); } catch(e) { alert("Invalid headers JSON"); return; }
    mod.body = document.getElementById("bpModBody").value;
  }
  fetch(`/api/breakpoints/dummy/trigger`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "modify", exchangeId: dlg.dataset.exchangeId, type: dlg.dataset.type, modification: mod })
  }).then(() => { breakpointActionModal.style.display = "none"; });
});

document.getElementById("bpReject").addEventListener("click", () => {
  const dlg = document.getElementById("breakpointActionBody");
  fetch(`/api/breakpoints/dummy/trigger`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reject", exchangeId: dlg.dataset.exchangeId, type: dlg.dataset.type })
  }).then(() => { breakpointActionModal.style.display = "none"; });
});

window.addEventListener("keydown", e => { if (e.key === "Escape") { breakpointModal.style.display = "none"; replayModal.style.display = "none"; breakpointActionModal.style.display = "none"; } });

console.log("Conflux Lens Dashboard: Breakpoints | HAR Export | Replay");
