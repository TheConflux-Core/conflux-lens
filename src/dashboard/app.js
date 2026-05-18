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

function matches(exchange) {
  const req = exchange.request;
  if (currentFilter === "error" && exchange.response?.statusCode < 400) return false;
  if (currentFilter === "llm") {
    const u = req.url.toLowerCase();
    if (!u.includes("openai") && !u.includes("anthropic") && !u.includes("v1/chat") && !u.includes("v1/completions") && !u.includes("api.anthropic") && !u.includes("googleai") && !u.includes("gemini")) return false;
  }
  if (currentFilter === "https" && !exchange.isHttps) return false;
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
    const duration = ex.response?.duration || 0;
    const timeStr = duration > 1000 ? (duration/1000).toFixed(1)+"s" : duration+"ms";
    const method = ex.request.method;
    const url = ex.request.url.length > 50 ? ex.request.url.slice(0,47)+"..." : ex.request.url;
    return `<div class="request-item${selectedId===ex.id?" selected":""}${ex.isHttps?" https":""}" data-id="${ex.id}" onclick="selectRequest('${ex.id}')" ${isErr?'style="border-left:3px solid var(--error)"':''}>
      <div class="req-method ${method==="POST"?"post":method==="PUT"?"put":method==="DELETE"?"delete":"get"}">${method}</div>
      <div class="req-details"><div class="req-url">${escapeHtml(url)}</div>
      <div class="req-meta">${status ? `Status: ${status} | ` : ""}${timeStr}${ex.isHttps?' | HTTPS':' | HTTP'}</div></div>
      ${status>=400?`<div class="req-status error">${status}</div>`:`<div class="req-status">${duration?timeStr:""}</div>`}
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

  // Detect LLM API calls
  const urlLower = (req.url || "").toLowerCase();
  const isLlmCall = urlLower.includes("openai") || urlLower.includes("anthropic") || urlLower.includes("v1/chat/") || urlLower.includes("v1/completions") || urlLower.includes("api.anthropic") || urlLower.includes("googleai") || urlLower.includes("gemini") || urlLower.includes("mistral") || urlLower.includes("cohere") || urlLower.includes("deepseek") || urlLower.includes("xai");

  // Extract token usage from response body if LLM call
  let tokens = null;
  let cost = null;
  const modelPrices = { "gpt-4": { in: 30, out: 60 }, "gpt-4o": { in: 2.5, out: 10 }, "gpt-4o-mini": { in: 0.15, out: 0.6 }, "claude-3": { in: 3, out: 15 }, "claude-3.5": { in: 3, out: 15 }, "claude-sonnet-4": { in: 3, out: 15 }, "deepseek-chat": { in: 0.27, out: 1.1 }, default: { in: 2, out: 8 } };
  if (isLlmCall && res && res.body) {
    try {
      const parsed = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
      if (parsed.usage) {
        tokens = { prompt: parsed.usage.prompt_tokens || 0, completion: parsed.usage.completion_tokens || 0, total: (parsed.usage.prompt_tokens || 0) + (parsed.usage.completion_tokens || 0) };
        const model = (parsed.model || req.body ? req.body.match(/"model"\s*:\s*"([^"]+)"/) : null)?.[1] || "default";
        const prices = modelPrices[model] || modelPrices.default;
        cost = { prompt: (tokens.prompt / 1000000 * prices.in).toFixed(4), completion: (tokens.completion / 1000000 * prices.out).toFixed(4), total: ((tokens.prompt * prices.in + tokens.completion * prices.out) / 1000000).toFixed(4) };
      }
    } catch (e) {}
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
  if (isLlmCall && tokens) body += `<span>📊 ${tokens.total} tokens</span>`;
  body += `</div>`;
  if (isLlmCall && cost) body += `<div style="margin-top:10px;padding:10px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);border-radius:var(--radius-sm)"><span style="font-size:13px;font-weight:600;color:var(--success)">$${cost.total}</span><span style="font-size:11px;color:var(--fg-muted);margin-left:8px">(prompt: $${cost.prompt} · completion: $${cost.completion})</span></div>`;
  body += `</div>`;

  // Tabs
  body += `<div style="display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:16px">`;
  body += `<button class="detail-tab active" onclick="showDetailTab('request',this)">Request</button>`;
  body += `<button class="detail-tab" onclick="showDetailTab('response',this)">Response</button>`;
  body += `<button class="detail-tab" onclick="showDetailTab('headers',this)">Headers</button>`;
  body += `<button class="detail-tab" onclick="showDetailTab('timing',this)">Timing</button>`;
  body += `<button class="detail-tab" onclick="openReplayModal('${id}')">↻ Replay</button></div>`;

  // Request tab
  body += `<div class="tab-content" id="req-tab"><div class="code-block"><pre>${prettyPrint(req.body)}</pre></div></div>`;

  // Response tab
  body += `<div class="tab-content" id="res-tab" style="display:none">`;
  if (res) {
    if (res.statusCode >= 400) body += `<div style="padding:8px 14px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:var(--radius-sm);margin-bottom:12px;font-size:13px;color:var(--error)"><strong>${res.statusCode} ${escapeHtml(res.statusMessage || "")}</strong></div>`;
    body += `<div class="code-block"><pre>${prettyPrint(res.body)}</pre></div>`;
    if (isLlmCall && tokens) {
      body += `<div style="margin-top:12px"><div class="token-stats">`;
      body += `<div class="token-stat prompt"><div class="stat-value">${tokens.prompt.toLocaleString()}</div><div class="stat-label">Prompt Tokens</div></div>`;
      body += `<div class="token-stat completion"><div class="stat-value">${tokens.completion.toLocaleString()}</div><div class="stat-label">Completion Tokens</div></div>`;
      body += `<div class="token-stat total"><div class="stat-value">${tokens.total.toLocaleString()}</div><div class="stat-label">Total Tokens</div></div>`;
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

  detailPane.innerHTML = body;
}

function showDetailTab(tab, btn) {
  document.querySelectorAll(".detail-tab").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  ["req","res","hdr","time"].forEach(t => { const el = document.getElementById(t+"-tab"); if (el) el.style.display = "none"; });
  const el = document.getElementById(tab+"-tab");
  if (el) el.style.display = "block";
}

function formatHeaders(h) {
  let out = "";
  for (const [k,v] of Object.entries(h)) out += `${k}: ${Array.isArray(v)?v.join(", "):v}
`;
  return out;
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
