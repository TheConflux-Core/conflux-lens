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
  } else if (msg.type === "breakpoint") {
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
    requestList.innerHTML = `<div class="empty-state"><p>${Object.keys(exchanges).length ? "No matching requests" : "Waiting for Phase 3 requests..."}</p><small>Set HTTP_PROXY=http://localhost:9876</small><br><small>Features: Breakpoints | HAR Export | Replay</small></div>`;
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
  let body = "";
  body += `<div class="detail-header"><h2>${escapeHtml(req.method)} ${escapeHtml(req.url)}</h2>`;
  body += `<div class="detail-tabs"><button class="detail-tab active" onclick="showDetailTab('request',this)">Request</button><button class="detail-tab" onclick="showDetailTab('response',this)">Response</button><button class="detail-tab" onclick="showDetailTab('headers',this)">Headers</button><button class="detail-tab" onclick="showDetailTab('timing',this)">Timing</button>`;
  body += `<button class="detail-tab" onclick="openReplayModal('${id}')">↻ Replay</button></div></div>`;
  body += `<div class="detail-section"><div class="detail-metadata">`;
  body += `<p><strong>ID:</strong> ${id} | <strong>Protocol:</strong> ${isHttps?"HTTPS • Encrypted":"HTTP • Plain"} | <strong>Time:</strong> ${new Date(req.timestamp).toLocaleString()}</p>`;
  if (res) body += `<p><strong>Duration:</strong> ${res.duration}ms | <strong>Status:</strong> ${res.statusCode} ${res.statusMessage || ""} | <strong>Size:</strong> ${res.bodySize || 0} bytes</p>`;
  body += `</div>`;
  body += `<div class="tab-content" id="req-tab"><div class="code-block"><pre>${escapeHtml(req.body || "(no body)")}</pre></div></div>`;
  body += `<div class="tab-content" id="res-tab" style="display:none">${res ? `<div class="code-block"><pre>${escapeHtml(res.body || "(empty)")}</pre></div><p><strong>Status:</strong> ${res.statusCode} ${res.statusMessage || ""}</p>` : "<p>No response yet</p>"}</div>`;
  body += `<div class="tab-content" id="hdr-tab" style="display:none"><div class="headers-section"><h4>Request Headers</h4><pre>${escapeHtml(formatHeaders(req.headers))}</pre><h4>Response Headers</h4><pre>${res ? escapeHtml(formatHeaders(res.headers)) : "(no response)"}</pre></div></div>`;
  body += `<div class="tab-content" id="time-tab" style="display:none"><p><strong>Started:</strong> ${new Date(req.timestamp).toISOString()}</p><p><strong>Request Body Size:</strong> ${req.bodySize || 0} bytes</p>${res ? `<p><strong>Response Time:</strong> ${res.duration}ms</p><p><strong>Response Body Size:</strong> ${res.bodySize || 0} bytes</p>` : "<p><strong>Response:</strong> Pending...</p>"}</div>`;
  body += `</div>`;
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
  document.getElementById("bpActionType").textContent = data.type;
  document.getElementById("bpRequestDisplay").textContent = JSON.stringify(data.request, null, 2);
  const respGroup = document.getElementById("bpResponseGroup");
  if (data.response) {
    respGroup.style.display = "block";
    document.getElementById("bpResponseDisplay").textContent = JSON.stringify(data.response, null, 2);
  } else { respGroup.style.display = "none"; }
  const dlg = document.getElementById("breakpointActionBody");
  dlg.querySelectorAll("[id$='Group']").forEach(el => el.style.display = data.type === "request" ? "block" : "none");
  document.getElementById("bpModUrl").value = data.request.url || "";
  document.getElementById("bpModMethod").value = data.request.method || "GET";
  document.getElementById("bpModHeaders").value = JSON.stringify(data.request.headers || {}, null, 2);
  document.getElementById("bpModBody").value = data.request.body || "";
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

console.log("Phase 3 Dashboard: Breakpoints | HAR Export | Replay");
