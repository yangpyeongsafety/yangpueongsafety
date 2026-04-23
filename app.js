const pageRole = document.body.dataset.role || "public";
const currentPage = document.body.dataset.page || "main";

const supabase = window.supabase?.createClient?.(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const state = {
  session: null,
  profile: null,
  workers: [],
  clients: [],
  requests: [],
  assignments: [],
  workLogs: []
};

const els = {
  sessionBar: byId("sessionBar"),
  authMessage: byId("authMessage"),
  authHint: byId("authHint"),
  authNameField: byId("authNameField"),
  gateTitle: byId("userGateName"),
  loginForm: byId("loginForm"),
  signupForm: byId("signupForm"),
  loginRole: byId("loginRole"),
  signupRole: byId("signupRole"),
  requestForm: byId("requestForm"),
  requestsTable: byId("requestsTable"),
  workerForm: byId("workerForm"),
  workerChips: byId("workerChips"),
  assignmentForm: byId("assignmentForm"),
  assignmentRequestSelect: byId("assignmentRequestSelect"),
  assignmentWorkerSelect: byId("assignmentWorkerSelect"),
  assignmentList: byId("assignmentList"),
  assignmentCardTemplate: byId("assignmentCardTemplate"),
  manualEntryForm: byId("manualEntryForm"),
  manualAssignmentSelect: byId("manualAssignmentSelect"),
  manualStartTime: byId("manualStartTime"),
  manualEndTime: byId("manualEndTime"),
  manualBreakMinutes: byId("manualBreakMinutes"),
  manualPreview: byId("manualPreview"),
  manualEntryTable: byId("manualEntryTable"),
  reportClientFilter: byId("reportClientFilter"),
  clientSummaryGrid: byId("clientSummaryGrid"),
  reportTable: byId("reportTable"),
  exportCsvBtn: byId("exportCsvBtn"),
  heroStats: byId("heroStats")
};

window.forceLogout = function forceLogout() {
  try {
    clearAuthStorage();
  } catch (error) {
    console.error(error);
  }
  window.location.href = "index.html";
};

bootstrap().catch((error) => {
  console.error(error);
  showStartupError("페이지 초기화 중 오류가 발생했습니다. Supabase 설정과 인터넷 연결을 확인해 주세요.");
});

async function bootstrap() {
  bindEvents();
  syncAuthFields();
  renderSessionBar();
  if (!supabase) {
    showStartupError("Supabase 스크립트를 불러오지 못했습니다. 인터넷 연결 또는 supabase-config.js를 확인해 주세요.");
    return;
  }
  await hydrateSession();
  const allowed = await enforceAccess();
  if (!allowed) {
    return;
  }
  await renderAll();
}

function byId(id) {
  return document.getElementById(id);
}

function showStartupError(message) {
  const messageEl = document.getElementById("authMessage");
  if (messageEl) {
    messageEl.textContent = message;
    messageEl.className = "auth-message error";
  }
}

async function hydrateSession() {
  const { data } = await supabase.auth.getSession();
  state.session = data.session;
  if (state.session) {
    state.profile = await fetchMyProfile();
    return;
  }

  const fallback = loadFallbackSession();
  state.session = fallback?.auth ? { user: fallback.auth.user, access_token: fallback.auth.access_token } : null;
  state.profile = fallback?.profile || null;
}

function loadFallbackSession() {
  try {
    const raw = localStorage.getItem("workforce.session");
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed?.auth?.access_token || !parsed?.profile) {
      return null;
    }
    if (parsed.auth.expires_at && parsed.auth.expires_at < Math.floor(Date.now() / 1000)) {
      localStorage.removeItem("workforce.session");
      return null;
    }
    return parsed;
  } catch (error) {
    console.error(error);
    return null;
  }
}

async function fetchMyProfile() {
  if (!state.session?.user?.id) {
    return null;
  }
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", state.session.user.id)
    .single();
  if (error) {
    console.error(error);
    return null;
  }
  return data;
}

async function enforceAccess() {
  if (pageRole === "public") {
    return true;
  }
  if (!state.session) {
    redirectToLogin("로그인이 필요합니다.");
    return false;
  }
  if (pageRole === "admin" && state.profile?.role !== "admin") {
    redirectToLogin("관리자 계정으로 로그인해야 합니다.");
    return false;
  }
  if (pageRole === "user" && state.profile?.role !== "worker") {
    redirectToLogin("사용자 계정으로 로그인해야 합니다.");
    return false;
  }
  return true;
}

function redirectToLogin(message) {
  const params = new URLSearchParams();
  params.set("redirect", `${currentPage}.html`);
  params.set("role", pageRole === "user" ? "worker" : pageRole);
  params.set("message", message);
  window.location.href = `index.html?${params.toString()}`;
}

function bindEvents() {
  els.loginForm?.addEventListener("submit", handleLoginSubmit);
  els.signupForm?.addEventListener("submit", handleSignupSubmit);
  els.loginRole?.addEventListener("change", syncAuthFields);
  els.signupRole?.addEventListener("change", syncAuthFields);
  els.requestForm?.addEventListener("submit", handleRequestSubmit);
  els.workerForm?.addEventListener("submit", handleWorkerSubmit);
  els.assignmentForm?.addEventListener("submit", handleAssignmentSubmit);
  els.manualEntryForm?.addEventListener("submit", handleManualEntrySubmit);
  els.reportClientFilter?.addEventListener("change", () => {
    renderClientSummary();
    renderReports();
  });
  els.exportCsvBtn?.addEventListener("click", exportCsv);
  els.manualAssignmentSelect?.addEventListener("change", handleManualAssignmentChange);
  els.manualStartTime?.addEventListener("input", updateManualPreview);
  els.manualEndTime?.addEventListener("input", updateManualPreview);
  els.manualBreakMinutes?.addEventListener("input", updateManualPreview);
  document.querySelectorAll("[data-action='logout']").forEach((button) => {
    button.addEventListener("click", logout);
  });
}

async function renderAll() {
  await loadPageData();
  renderSessionBar();
  renderStats();
  renderRequests();
  renderWorkers();
  renderAssignmentOptions();
  renderAssignments();
  renderClientFilter();
  renderClientSummary();
  renderReports();
  renderManualEntryOptions();
  renderManualEntryTable();
  syncAuthFields();
  updateManualPreview();
}

async function loadPageData() {
  if (pageRole === "public") {
    return;
  }

  if (state.profile?.role === "admin") {
    const [workersRes, clientsRes, requestsRes, assignmentsRes, workLogsRes] = await Promise.all([
      supabase.from("workers").select("*").order("name"),
      supabase.from("clients").select("*").order("name"),
      supabase.from("job_requests").select("*").order("work_date", { ascending: false }),
      supabase.from("assignments").select("*").order("created_at", { ascending: false }),
      supabase.from("work_logs").select("*")
    ]);
    state.workers = workersRes.data || [];
    state.clients = clientsRes.data || [];
    state.requests = requestsRes.data || [];
    state.assignments = assignmentsRes.data || [];
    state.workLogs = workLogsRes.data || [];
    return;
  }

  const [workersRes, requestsRes, assignmentsRes, workLogsRes] = await Promise.all([
    supabase.from("workers").select("*"),
    supabase.from("job_requests").select("*"),
    supabase.from("assignments").select("*"),
    supabase.from("work_logs").select("*")
  ]);
  state.workers = workersRes.data || [];
  state.requests = requestsRes.data || [];
  state.assignments = (assignmentsRes.data || []).filter(
    (assignment) => assignment.worker_id === state.profile?.worker_id
  );
  state.workLogs = workLogsRes.data || [];
  const clientIds = [...new Set(state.requests.map((request) => request.client_id).filter(Boolean))];
  if (clientIds.length > 0) {
    const { data } = await supabase.from("clients").select("*").in("id", clientIds);
    state.clients = data || [];
  } else {
    state.clients = [];
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  if (!supabase) {
    setAuthMessage("Supabase 연결이 준비되지 않았습니다. 잠시 후 새로고침해 주세요.");
    return;
  }
  const data = new FormData(event.currentTarget);
  const loginId = String(data.get("loginId") || "").trim();
  const password = String(data.get("password") || "").trim();
  const role = normalizeRole(String(data.get("role") || "").trim());

  const { error } = await supabase.auth.signInWithPassword({
    email: toAuthEmail(loginId),
    password
  });
  if (error) {
    setAuthMessage("로그인에 실패했습니다. 아이디와 비밀번호를 확인해 주세요.");
    return;
  }

  await hydrateSession();
  if (state.profile?.role !== role) {
    await supabase.auth.signOut();
    setAuthMessage("선택한 권한과 가입된 권한이 다릅니다.");
    return;
  }

  const redirect = new URLSearchParams(window.location.search).get("redirect");
  window.location.href = redirect || defaultPageForRole(role);
}

async function handleSignupSubmit(event) {
  event.preventDefault();
  if (!supabase) {
    setAuthMessage("Supabase 연결이 준비되지 않았습니다. 잠시 후 새로고침해 주세요.");
    return;
  }
  const data = new FormData(event.currentTarget);
  const role = normalizeRole(String(data.get("role") || "").trim());
  const loginId = String(data.get("signupId") || "").trim();
  const password = String(data.get("signupPassword") || "").trim();
  const name = String(data.get("name") || "").trim();
  const phone = String(data.get("phone") || "").trim();

  if (!loginId || !password || !name) {
    setAuthMessage("회원가입 항목을 모두 입력해 주세요.");
    return;
  }

  setAuthMessage("회원가입을 처리 중입니다. 잠시만 기다려 주세요.", false);

  try {
    const { error } = await supabase.auth.signUp({
      email: toAuthEmail(loginId),
      password,
      options: {
        data: {
          login_id: loginId,
          role,
          name,
          phone
        }
      }
    });

    if (error) {
      console.error(error);
      setAuthMessage(`회원가입 실패: ${translateSupabaseError(error.message)}`);
      return;
    }

    event.currentTarget.reset();
    syncAuthFields();
    setAuthMessage("회원가입이 완료됐습니다. 이제 로그인해 주세요.", false);
  } catch (error) {
    console.error(error);
    setAuthMessage("회원가입 요청을 보내지 못했습니다. 인터넷 연결 또는 Supabase 설정을 확인해 주세요.");
  }
}

async function logout() {
  try {
    await supabase?.auth?.signOut?.();
  } catch (error) {
    console.error(error);
  }
  clearAuthStorage();
  window.location.href = "index.html";
}

function clearAuthStorage() {
  const keysToRemove = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key && (key.includes("supabase") || key.includes("sb-") || key.includes("workforce"))) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key));
  sessionStorage.clear();
}

async function handleRequestSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const clientName = String(data.get("clientName") || "").trim();
  const clientId = await getOrCreateClient(clientName);
  if (!clientId) {
    setAuthMessage("거래처 저장에 실패했습니다.");
    return;
  }

  const { error } = await supabase.from("job_requests").insert({
    client_id: clientId,
    contact_method: String(data.get("contactMethod") || "").trim(),
    headcount: Number(data.get("headcount")),
    site_location: String(data.get("siteLocation") || "").trim(),
    work_date: String(data.get("workDate") || ""),
    status: "대기",
    created_by: state.profile.id
  });

  if (error) {
    setAuthMessage("인력 의뢰 저장에 실패했습니다.");
    return;
  }

  event.currentTarget.reset();
  await renderAll();
}

async function getOrCreateClient(name) {
  const existing = state.clients.find((client) => client.name === name);
  if (existing) {
    return existing.id;
  }

  const { data, error } = await supabase
    .from("clients")
    .insert({ name, created_by: state.profile.id })
    .select("id")
    .single();

  if (error) {
    console.error(error);
    return null;
  }
  return data.id;
}

async function handleWorkerSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const { error } = await supabase.from("workers").insert({
    name: String(data.get("name") || "").trim(),
    phone: String(data.get("phone") || "").trim()
  });
  if (error) {
    setAuthMessage("인력 등록에 실패했습니다.");
    return;
  }
  event.currentTarget.reset();
  await renderAll();
}

async function handleAssignmentSubmit(event) {
  event.preventDefault();
  const requestId = String(new FormData(event.currentTarget).get("requestId") || "");
  const workerIds = Array.from(els.assignmentWorkerSelect.selectedOptions).map((option) => option.value);
  if (!requestId || workerIds.length === 0) {
    return;
  }

  const rows = workerIds.map((workerId) => ({
    request_id: requestId,
    worker_id: workerId,
    created_by: state.profile.id
  }));

  const { data, error } = await supabase.from("assignments").insert(rows).select("id,worker_id");
  if (error) {
    setAuthMessage("인력 배정 저장에 실패했습니다. 이미 배정된 인력일 수 있습니다.");
    return;
  }

  const logs = (data || []).map((assignment) => ({
    assignment_id: assignment.id,
    worker_id: assignment.worker_id
  }));
  if (logs.length > 0) {
    await supabase.from("work_logs").upsert(logs, { onConflict: "assignment_id" });
  }

  const assignedCount = state.assignments.filter((item) => item.request_id === requestId).length + workerIds.length;
  await supabase.from("job_requests").update({ status: `${assignedCount}명 배정` }).eq("id", requestId);
  event.currentTarget.reset();
  await renderAll();
}

async function handleManualEntrySubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const assignmentId = String(data.get("assignmentId") || "");
  const startTime = String(data.get("startTime") || "");
  const endTime = String(data.get("endTime") || "");
  const breakMinutes = Number(data.get("breakMinutes") || 0);
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  const result = calculateWorkMetrics(startTime, endTime, breakMinutes);
  if (!assignment || !result) {
    updateManualPreview(true);
    return;
  }

  const { error } = await supabase.from("work_logs").upsert(
    {
      assignment_id: assignmentId,
      worker_id: assignment.worker_id,
      start_time: new Date(startTime).toISOString(),
      end_time: new Date(endTime).toISOString(),
      break_minutes: breakMinutes,
      work_hours: result.workHours,
      labor_units: result.gongsu
    },
    { onConflict: "assignment_id" }
  );

  if (error) {
    setAuthMessage("근무시간 저장에 실패했습니다.");
    return;
  }

  await renderAll();
}

function renderSessionBar() {
  if (!els.sessionBar) {
    return;
  }
  if (!state.session || !state.profile) {
    els.sessionBar.innerHTML = `<span>로그인 전입니다.</span><a class="session-link" href="index.html">로그인</a>`;
    return;
  }
  const roleLabel = state.profile.role === "admin" ? "관리자" : "사용자";
  els.sessionBar.innerHTML = `
    <span><strong>${escapeHtml(state.profile.name)}</strong> 님 · ${roleLabel} · ${escapeHtml(state.profile.login_id)}</span>
    <button type="button" class="ghost-btn session-button" data-action="logout" onclick="window.forceLogout && window.forceLogout()">로그아웃</button>
  `;
  els.sessionBar.querySelector("[data-action='logout']")?.addEventListener("click", logout);
}

function renderStats() {
  if (!els.heroStats) {
    return;
  }
  const totalGongsu = state.workLogs.reduce((sum, item) => sum + Number(item.labor_units || 0), 0);
  const statItems = [
    ["인력의뢰", `${state.requests.length}건`],
    ["인력배치", `${state.assignments.length}건`],
    ["근무입력", `${state.workLogs.filter((item) => Number(item.work_hours) > 0).length}건`],
    ["총 공수", `${totalGongsu.toFixed(1)}`]
  ];
  els.heroStats.innerHTML = statItems
    .map(
      ([label, value]) => `
        <article class="stat-card">
          <strong>${value}</strong>
          <span>${label}</span>
        </article>
      `
    )
    .join("");
}

function renderRequests() {
  if (!els.requestsTable) {
    return;
  }
  if (state.requests.length === 0) {
    els.requestsTable.innerHTML = emptyRow("등록된 요청이 없습니다.", 6);
    return;
  }
  els.requestsTable.innerHTML = state.requests
    .map((request) => {
      const client = getClient(request.client_id);
      return `
        <tr>
          <td>${escapeHtml(client?.name || "-")}</td>
          <td>${escapeHtml(request.contact_method)}</td>
          <td>${request.headcount}명</td>
          <td>${escapeHtml(request.site_location)}</td>
          <td>${formatDate(request.work_date)}</td>
          <td>${renderStatus(request.status)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderWorkers() {
  if (!els.workerChips) {
    return;
  }
  els.workerChips.innerHTML =
    state.workers.length === 0
      ? `<p class="empty">등록된 인력이 없습니다.</p>`
      : state.workers
          .map((worker) => `<span class="chip">${escapeHtml(worker.name)} · ${escapeHtml(worker.phone || "연락처 없음")}</span>`)
          .join("");
}

function renderAssignmentOptions() {
  if (!els.assignmentRequestSelect || !els.assignmentWorkerSelect) {
    return;
  }
  els.assignmentRequestSelect.innerHTML =
    state.requests
      .map((request) => {
        const client = getClient(request.client_id);
        return `<option value="${request.id}">${client?.name || "-"} / ${request.site_location} / ${request.headcount}명</option>`;
      })
      .join("") || `<option value="">요청이 없습니다</option>`;

  els.assignmentWorkerSelect.innerHTML =
    state.workers
      .map((worker) => `<option value="${worker.id}">${worker.name} (${worker.phone || "연락처 없음"})</option>`)
      .join("") || `<option value="">인력이 없습니다</option>`;
}

function renderAssignments() {
  if (!els.assignmentList || !els.assignmentCardTemplate) {
    return;
  }
  if (state.assignments.length === 0) {
    els.assignmentList.innerHTML = `<p class="empty">아직 배정된 인력이 없습니다.</p>`;
    return;
  }
  els.assignmentList.innerHTML = state.requests
    .filter((request) => state.assignments.some((assignment) => assignment.request_id === request.id))
    .map((request) => {
      const fragment = els.assignmentCardTemplate.content.cloneNode(true);
      const assignedWorkers = state.assignments
        .filter((assignment) => assignment.request_id === request.id)
        .map((assignment) => getWorker(assignment.worker_id))
        .filter(Boolean);
      fragment.querySelector("h3").textContent = getClient(request.client_id)?.name || "-";
      fragment.querySelector(".badge").textContent = `${assignedWorkers.length}/${request.headcount}명`;
      fragment.querySelector(".assignment-meta").textContent = `${request.site_location} · ${formatDate(request.work_date)}`;
      fragment.querySelector(".assigned-workers").innerHTML = assignedWorkers
        .map((worker) => `<span class="worker-tag">${escapeHtml(worker.name)} · ${escapeHtml(worker.phone || "연락처 없음")}</span>`)
        .join("");
      return fragment.firstElementChild.outerHTML;
    })
    .join("");
}

function renderClientFilter() {
  if (!els.reportClientFilter) {
    return;
  }
  const clientNames = [...new Set(state.requests.map((request) => getClient(request.client_id)?.name).filter(Boolean))];
  const currentValue = els.reportClientFilter.value || "all";
  els.reportClientFilter.innerHTML = ['<option value="all">전체 거래처</option>']
    .concat(clientNames.map((name) => `<option value="${name}">${name}</option>`))
    .join("");
  els.reportClientFilter.value = currentValue === "all" || clientNames.includes(currentValue) ? currentValue : "all";
}

function renderClientSummary() {
  if (!els.clientSummaryGrid) {
    return;
  }
  const rows = getReportRows();
  if (rows.length === 0) {
    els.clientSummaryGrid.innerHTML = `<p class="empty">거래처별 근무 요약이 아직 없습니다.</p>`;
    return;
  }
  const grouped = new Map();
  rows.forEach((row) => {
    const byDate = grouped.get(row.clientName) || new Map();
    const list = byDate.get(row.workDate) || [];
    list.push(`${row.workerName} (${formatGongsu(row.gongsu)})`);
    byDate.set(row.workDate, list);
    grouped.set(row.clientName, byDate);
  });
  els.clientSummaryGrid.innerHTML = Array.from(grouped.entries())
    .map(([clientName, dates]) => `
      <article class="summary-card">
        <h3>${escapeHtml(clientName)}</h3>
        <p>${dates.size}일 근무 기록</p>
        <div class="summary-items">
          ${Array.from(dates.entries())
            .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
            .map(([workDate, names]) => `<div class="summary-item"><strong>${formatDate(workDate)}</strong><span>${names.join(", ")}</span></div>`)
            .join("")}
        </div>
      </article>
    `)
    .join("");
}

function renderReports() {
  if (!els.reportTable) {
    return;
  }
  const rows = getReportRows();
  if (rows.length === 0) {
    els.reportTable.innerHTML = emptyRow("조회할 데이터가 없습니다.", 8);
    return;
  }
  els.reportTable.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.clientName)}</td>
          <td>${formatDate(row.workDate)}</td>
          <td>${escapeHtml(row.siteLocation)}</td>
          <td>${escapeHtml(row.workerName)}</td>
          <td>${formatDateTime(row.checkIn)}</td>
          <td>${formatDateTime(row.checkOut)}</td>
          <td>${formatHours(row.workHours)}</td>
          <td>${formatGongsu(row.gongsu)}</td>
        </tr>
      `
    )
    .join("");
}

function exportCsv() {
  const rows = getReportRows().map((row) => [
    row.clientName,
    formatDate(row.workDate),
    row.siteLocation,
    row.workerName,
    formatDateTime(row.checkIn),
    formatDateTime(row.checkOut),
    formatHours(row.workHours),
    formatGongsu(row.gongsu)
  ]);
  const csvLines = [["거래처명", "근무일", "현장 위치", "인력명", "출근시간", "퇴근시간", "실근무시간", "공수"], ...rows]
    .map((line) => line.map((item) => `"${String(item).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["\uFEFF" + csvLines], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `settlement-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function renderManualEntryOptions() {
  if (!els.manualAssignmentSelect) {
    return;
  }
  if (state.assignments.length === 0) {
    els.manualAssignmentSelect.innerHTML = `<option value="">입력 가능한 배정이 없습니다</option>`;
    return;
  }
  const currentValue = els.manualAssignmentSelect.value;
  els.manualAssignmentSelect.innerHTML = state.assignments
    .map((assignment) => {
      const request = getRequest(assignment.request_id);
      const client = getClient(request?.client_id);
      const worker = getWorker(assignment.worker_id);
      return `<option value="${assignment.id}">${worker?.name || "-"} / ${client?.name || "-"} / ${formatDate(request?.work_date || "")}</option>`;
    })
    .join("");
  els.manualAssignmentSelect.value = state.assignments.some((item) => item.id === currentValue)
    ? currentValue
    : state.assignments[0].id;
  applyManualSelectionToForm();
}

function renderManualEntryTable() {
  if (!els.manualEntryTable) {
    return;
  }
  const rows = getReportRows().filter((row) => row.workHours > 0 || row.gongsu > 0);
  els.manualEntryTable.innerHTML =
    rows.length === 0
      ? emptyRow("아직 입력된 근무시간이 없습니다.", 5)
      : rows
          .map(
            (row) => `
              <tr>
                <td>${escapeHtml(row.workerName)}</td>
                <td>${escapeHtml(row.clientName)}</td>
                <td>${formatDate(row.workDate)}</td>
                <td>${formatHours(row.workHours)}</td>
                <td>${formatGongsu(row.gongsu)}</td>
              </tr>
            `
          )
          .join("");
}

function handleManualAssignmentChange() {
  applyManualSelectionToForm();
  updateManualPreview();
}

function applyManualSelectionToForm() {
  if (!els.manualAssignmentSelect || !els.manualStartTime || !els.manualEndTime || !els.manualBreakMinutes) {
    return;
  }
  const log = state.workLogs.find((item) => item.assignment_id === els.manualAssignmentSelect.value);
  els.manualStartTime.value = log?.start_time ? toDatetimeLocal(log.start_time) : "";
  els.manualEndTime.value = log?.end_time ? toDatetimeLocal(log.end_time) : "";
  els.manualBreakMinutes.value = String(log?.break_minutes || 0);
}

function updateManualPreview(forceError = false) {
  if (!els.manualPreview || !els.manualStartTime || !els.manualEndTime || !els.manualBreakMinutes) {
    return;
  }
  const result = calculateWorkMetrics(
    els.manualStartTime.value,
    els.manualEndTime.value,
    Number(els.manualBreakMinutes.value || 0)
  );
  if (forceError || !result) {
    els.manualPreview.innerHTML = `<strong>공수 계산 미리보기</strong><span>시작시간과 종료시간을 올바르게 입력하면 계산됩니다.</span>`;
    return;
  }
  els.manualPreview.innerHTML = `<strong>실근무 ${formatHours(result.workHours)} / 공수 ${formatGongsu(result.gongsu)}</strong><span>8시간 기준 1.0, 이후 1시간마다 0.1 추가</span>`;
}

function getReportRows() {
  const filterValue = els.reportClientFilter?.value || "all";
  return state.assignments
    .map((assignment) => {
      const request = getRequest(assignment.request_id);
      const client = getClient(request?.client_id);
      const worker = getWorker(assignment.worker_id);
      const log = state.workLogs.find((item) => item.assignment_id === assignment.id);
      return {
        clientName: client?.name || "-",
        workDate: request?.work_date || "",
        siteLocation: request?.site_location || "-",
        workerName: worker?.name || "-",
        checkIn: log?.start_time || "",
        checkOut: log?.end_time || "",
        workHours: Number(log?.work_hours || 0),
        gongsu: Number(log?.labor_units || 0)
      };
    })
    .filter((row) => filterValue === "all" || row.clientName === filterValue)
    .sort((a, b) => String(a.workDate).localeCompare(String(b.workDate)) || a.clientName.localeCompare(b.clientName, "ko") || a.workerName.localeCompare(b.workerName, "ko"));
}

function getClient(id) {
  return state.clients.find((item) => item.id === id);
}

function getRequest(id) {
  return state.requests.find((item) => item.id === id);
}

function getWorker(id) {
  return state.workers.find((item) => item.id === id);
}

function calculateWorkMetrics(startTime, endTime, breakMinutes) {
  if (!startTime || !endTime) {
    return null;
  }
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return null;
  }
  const totalMinutes = (end.getTime() - start.getTime()) / 60000;
  const netMinutes = Math.max(0, totalMinutes - Math.max(0, breakMinutes));
  const workHours = Math.round((netMinutes / 60) * 10) / 10;
  let gongsu = 0;
  if (workHours > 0 && workHours <= 8) {
    gongsu = Math.round((workHours / 8) * 10) / 10;
  } else if (workHours > 8) {
    gongsu = Math.round((1 + (workHours - 8) * 0.1) * 10) / 10;
  }
  return { workHours, gongsu };
}

function syncAuthFields() {
  if (!els.authHint) {
    return;
  }
  const query = new URLSearchParams(window.location.search);
  const forcedRole = normalizeRole(query.get("role") || els.signupRole?.value || els.loginRole?.value || "admin");
  const roleText = forcedRole === "admin" ? "관리자" : "사용자";
  if (els.loginRole) {
    els.loginRole.value = forcedRole;
  }
  if (els.signupRole) {
    els.signupRole.value = forcedRole;
  }
  els.authHint.textContent =
    currentPage === "signup"
      ? `${roleText} 계정을 새로 만드세요.`
      : `${roleText} 계정으로 로그인하세요.`;
  if (els.gateTitle) {
    els.gateTitle.textContent =
      currentPage === "signup" ? `${roleText} 회원가입` : `${roleText} 로그인`;
  }
  if (els.authNameField) {
    els.authNameField.textContent =
      forcedRole === "worker"
        ? "사용자 이름/전화번호는 배정된 인력 정보와 같게 맞추는 것이 좋습니다."
        : "관리자 이름과 연락처를 입력하세요.";
  }
  const message = query.get("message");
  if (message && els.authMessage && !els.authMessage.textContent) {
    setAuthMessage(message);
    query.delete("message");
    history.replaceState(null, "", `${window.location.pathname}?${query.toString()}`.replace(/\?$/, ""));
  }
}

function setAuthMessage(message, isError = true) {
  if (!els.authMessage) {
    return;
  }
  els.authMessage.textContent = message;
  els.authMessage.className = isError ? "auth-message error" : "auth-message success";
}

function toAuthEmail(loginId) {
  const safeId = String(loginId)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "_");
  return `${safeId}@yangpyeongsafety.app`;
}

function translateSupabaseError(message) {
  if (!message) {
    return "알 수 없는 오류입니다.";
  }
  if (message.includes("already") || message.includes("registered")) {
    return "이미 사용 중인 아이디입니다.";
  }
  if (message.includes("Password")) {
    return "비밀번호 조건을 확인해 주세요. 보통 6자리 이상이어야 합니다.";
  }
  if (message.includes("email")) {
    return "아이디 형식 변환 중 문제가 발생했습니다. 영문/숫자 조합 아이디로 다시 시도해 주세요.";
  }
  if (message.includes("Database")) {
    return "Supabase SQL 테이블 또는 회원가입 트리거가 아직 준비되지 않았습니다.";
  }
  return message;
}

function normalizeRole(value) {
  return value === "worker" || value === "user" ? "worker" : "admin";
}

function defaultPageForRole(role) {
  return role === "admin" ? "main.html" : "worker-entry.html";
}

function emptyRow(message, colspan) {
  return `<tr><td colspan="${colspan}" class="empty">${message}</td></tr>`;
}

function renderStatus(value) {
  return `<span class="${value === "대기" ? "status-pill pending" : "status-pill"}">${value}</span>`;
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatHours(value) {
  return value ? `${Number(value).toFixed(1)}시간` : "-";
}

function formatGongsu(value) {
  return value ? Number(value).toFixed(1) : "-";
}

function toDatetimeLocal(value) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
