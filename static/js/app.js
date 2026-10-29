/**
 * ClipForge Studio — Client Application
 * Multi-Page View Architecture, User Authentication (MongoDB),
 * Background Job Persistence & Cancellation, Social Publishing
 */

// Global Application State
const state = {
    user: null,
    token: localStorage.getItem("clipforge_token") || null,
    currentView: "studio",
    activeJobId: localStorage.getItem("clipforge_active_job") || null,
    jobPollTimer: null,
    jobsList: [],
    currentJobFilter: "all",
    searchQuery: "",
    clips: [],
    accounts: [],
    selectedStyle: "blur",
    currentPreviewData: null,
    modalVideoUrl: null,
    modalVideoName: null,
    selectedPublishAccounts: new Set(),
    selectedClips: new Set(),
    isBatchPublish: false,
};

// Helper: HTTP request with auth header
async function apiRequest(url, options = {}) {
    options.headers = options.headers || {};
    if (state.token) {
        options.headers["Authorization"] = `Bearer ${state.token}`;
    }
    const res = await fetch(url, options);
    return res;
}

// ──────────────────────────────────────────────────────────────────────────────
// Initialization
// ──────────────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
    initNavigation();
    initDbStatus();
    initAuth();
    initForm();
    initStoragePill();

    // Resume any active background job across refresh/navigation
    if (state.activeJobId) {
        resumeActiveJob(state.activeJobId);
    }

    // Load initial data
    loadClips();
    loadDownloads();
    loadAccounts();
    loadJobsList();
    loadPublishHistory();
});

// ──────────────────────────────────────────────────────────────────────────────
// Database Status Indicator
// ──────────────────────────────────────────────────────────────────────────────

async function initDbStatus() {
    const pill = document.getElementById("dbStatusPill");
    const text = document.getElementById("dbStatusText");
    if (!pill || !text) return;

    try {
        const res = await apiRequest("/api/auth/status");
        if (res.ok) {
            const data = await res.json();
            if (data.db_connected) {
                pill.className = "db-status-pill online";
                text.textContent = "MongoDB Active";
                pill.title = "Connected to MongoDB successfully";
            } else {
                pill.className = "db-status-pill offline";
                text.textContent = "MongoDB Offline";
                pill.title = "MongoDB is currently disconnected; using local fallback";
            }
        }
    } catch (e) {
        pill.className = "db-status-pill offline";
        text.textContent = "DB Check Failed";
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Navigation & Multi-View Switcher
// ──────────────────────────────────────────────────────────────────────────────

function initNavigation() {
    const hash = window.location.hash.replace("#", "") || "studio";
    switchView(hash, false);

    window.addEventListener("hashchange", () => {
        const h = window.location.hash.replace("#", "") || "studio";
        switchView(h, false);
    });
}

function switchView(viewName, updateHash = true) {
    const validViews = ["studio", "jobs", "library", "accounts"];
    if (!validViews.includes(viewName)) viewName = "studio";

    state.currentView = viewName;
    if (updateHash) {
        window.location.hash = viewName;
    }

    // Toggle Tab Buttons
    document.querySelectorAll(".nav-tab-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.view === viewName);
    });

    // Toggle View Sections
    document.querySelectorAll(".view-section").forEach(sec => {
        sec.classList.toggle("active", sec.id === `view_${viewName}`);
    });

    // Trigger data refresh depending on view
    if (viewName === "jobs") {
        if (state.activeJobTrackerTab === "publishing") {
            loadPublishHistory();
        } else {
            loadJobsList();
        }
        loadPublishHistory();
    } else if (viewName === "library") {
        if (state.activeLibraryTab === "downloads") {
            loadDownloads();
        } else {
            loadClips();
        }
    } else if (viewName === "accounts") {
        loadAccounts();
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// User Authentication (MongoDB)
// ──────────────────────────────────────────────────────────────────────────────

async function initAuth() {
    if (!state.token) {
        renderAuthUI(null);
        return;
    }

    try {
        const res = await apiRequest("/api/auth/me");
        if (res.ok) {
            const data = await res.json();
            state.user = data.user;
            renderAuthUI(state.user);
        } else {
            // Token expired or invalid
            handleLogout(false);
        }
    } catch (err) {
        console.warn("Auth check failed:", err);
        renderAuthUI(null);
    }
}

function renderAuthUI(user) {
    const authLoggedOut = document.getElementById("authLoggedOut");
    const authLoggedIn = document.getElementById("authLoggedIn");
    const userNameSpan = document.getElementById("headerUserName");
    const userAvatarDiv = document.getElementById("headerUserAvatar");
    const dropdownFullName = document.getElementById("dropdownUserFullName");
    const dropdownEmail = document.getElementById("dropdownUserEmail");

    if (user) {
        if (authLoggedOut) authLoggedOut.style.display = "none";
        if (authLoggedIn) authLoggedIn.style.display = "flex";
        if (userNameSpan) userNameSpan.textContent = user.name || user.username;
        if (userAvatarDiv) userAvatarDiv.textContent = (user.name || user.username).charAt(0).toUpperCase();
        if (dropdownFullName) dropdownFullName.textContent = user.name || user.username;
        if (dropdownEmail) dropdownEmail.textContent = user.email || `@${user.username}`;
    } else {
        if (authLoggedOut) authLoggedOut.style.display = "flex";
        if (authLoggedIn) authLoggedIn.style.display = "none";
    }
}

function openAuthModal(tab = "login") {
    const modal = document.getElementById("authModal");
    if (!modal) return;
    modal.classList.add("active");
    switchAuthTab(tab);
}

function closeAuthModal() {
    const modal = document.getElementById("authModal");
    if (modal) modal.classList.remove("active");
}

function switchAuthTab(tab) {
    document.querySelectorAll(".auth-tab-btn").forEach(b => {
        b.classList.toggle("active", b.dataset.tab === tab);
    });
    const loginForm = document.getElementById("loginForm");
    const signupForm = document.getElementById("signupForm");
    const authTitle = document.getElementById("authModalTitle");

    if (loginForm) loginForm.style.display = tab === "login" ? "block" : "none";
    if (signupForm) signupForm.style.display = tab === "signup" ? "block" : "none";
    if (authTitle) authTitle.textContent = tab === "login" ? "Sign In to ClipForge" : "Create ClipForge Account";
}

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById("loginUsername").value.trim();
    const password = document.getElementById("loginPassword").value;
    const errBox = document.getElementById("authErrorBox");

    errBox.style.display = "none";
    try {
        const res = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.detail || "Login failed");
        }
        state.token = data.token;
        state.user = data.user;
        localStorage.setItem("clipforge_token", data.token);
        renderAuthUI(state.user);
        closeAuthModal();
        loadAccounts();
        loadJobsList();
        showToast("Signed in as " + (state.user.name || state.user.username), "success");
    } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = "block";
    }
}

async function handleSignup(e) {
    e.preventDefault();
    const username = document.getElementById("signupUsername").value.trim();
    const name = document.getElementById("signupName").value.trim();
    const email = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;
    const errBox = document.getElementById("authErrorBox");

    errBox.style.display = "none";
    try {
        const res = await fetch("/api/auth/signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, name, email, password })
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.detail || "Signup failed");
        }
        state.token = data.token;
        state.user = data.user;
        localStorage.setItem("clipforge_token", data.token);
        renderAuthUI(state.user);
        closeAuthModal();
        loadAccounts();
        loadJobsList();
        showToast("Welcome to ClipForge Studio, " + state.user.name + "!", "success");
    } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = "block";
    }
}

async function handleLogout(callApi = true) {
    if (callApi && state.token) {
        try {
            await apiRequest("/api/auth/logout", { method: "POST" });
        } catch (e) {}
    }
    state.token = null;
    state.user = null;
    localStorage.removeItem("clipforge_token");
    renderAuthUI(null);
    closeUserDropdown();
    loadAccounts();
    loadJobsList();
    showToast("Signed out", "info");
}

function toggleUserDropdown() {
    const dropdown = document.getElementById("userDropdown");
    if (dropdown) dropdown.classList.toggle("show");
}

function closeUserDropdown() {
    const dropdown = document.getElementById("userDropdown");
    if (dropdown) dropdown.classList.remove("show");
}

window.addEventListener("click", (e) => {
    if (!e.target.closest("#userProfileMenu")) {
        closeUserDropdown();
    }
});

// ──────────────────────────────────────────────────────────────────────────────
// Background Job Management & Polling (Resilient Across Refresh & Navigation)
// ──────────────────────────────────────────────────────────────────────────────

async function submitJob(isPreview = false) {
    const urlInput = document.getElementById("urlInput");
    const titleInput = document.getElementById("titleInput");
    const startTimeInput = document.getElementById("startTime");
    const endTimeInput = document.getElementById("endTime");
    const clipLengthInput = document.getElementById("clipLength");
    const maxClipsInput = document.getElementById("maxClips");
    const showTitleInput = document.getElementById("showTitle");
    const showPartsInput = document.getElementById("showParts");
    const keepSourceInput = document.getElementById("keepSource");

    const payload = {
        url: urlInput ? urlInput.value.trim() : "",
        title: titleInput ? titleInput.value.trim() : "My Best Highlights",
        start_time: startTimeInput && startTimeInput.value !== "" ? parseFloat(startTimeInput.value) : 0,
        end_time: endTimeInput && endTimeInput.value !== "" ? parseFloat(endTimeInput.value) : null,
        clip_length: clipLengthInput ? parseInt(clipLengthInput.value, 10) : 30,
        count: maxClipsInput ? parseInt(maxClipsInput.value, 10) : 5,
        aspect_ratio: "9:16",
        background_style: state.selectedStyle || "blur",
        show_title: showTitleInput ? showTitleInput.checked : true,
        show_parts: showPartsInput ? showPartsInput.checked : true,
        keep_source: keepSourceInput ? keepSourceInput.checked : true,
        is_preview: isPreview,
    };

    if (!payload.url) {
        showToast("Please enter a valid YouTube video URL", "warning");
        if (urlInput) urlInput.focus();
        return;
    }

    try {
        const submitBtn = document.getElementById("submitBtn");
        const previewBtn = document.getElementById("previewBtn");
        if (submitBtn) submitBtn.disabled = true;
        if (previewBtn) previewBtn.disabled = true;

        showProgressCard(true);
        updateProgressUI(5, "queued", "Starting background server process...");

        const res = await apiRequest("/api/jobs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.detail || "Failed to start job");
        }

        const jobId = data.job_id || data.id;
        state.activeJobId = jobId;
        localStorage.setItem("clipforge_active_job", jobId);

        showToast(isPreview ? "Generating preview clip in background..." : "Job dispatched to server! Running in background...", "info");
        pollJob(jobId);
        loadJobsList();

    } catch (err) {
        showToast(err.message, "error");
        updateProgressUI(0, "failed", err.message);
        const submitBtn = document.getElementById("submitBtn");
        const previewBtn = document.getElementById("previewBtn");
        if (submitBtn) submitBtn.disabled = false;
        if (previewBtn) previewBtn.disabled = false;
    }
}

function resumeActiveJob(jobId) {
    showProgressCard(true);
    updateProgressUI(10, "processing", "Resuming live job tracking from server...");
    pollJob(jobId);
}

function pollJob(jobId) {
    if (state.jobPollTimer) {
        clearInterval(state.jobPollTimer);
    }

    const checkStatus = async () => {
        try {
            const res = await apiRequest(`/api/jobs/${jobId}`);
            if (!res.ok) {
                if (res.status === 404) {
                    clearActiveJob();
                }
                return;
            }
            const job = await res.json();
            updateProgressUI(job.progress || 0, job.status, job.message || "");

            if (job.status === "completed") {
                clearInterval(state.jobPollTimer);
                clearActiveJob();
                showToast("Clips ready! " + (job.message || ""), "success");
                loadClips();
                loadDownloads();
                initStoragePill();
                loadJobsList();
                if (job.files && job.files.length > 0) {
                    setTimeout(() => switchView("library"), 800);
                }
            } else if (job.status === "failed") {
                clearInterval(state.jobPollTimer);
                clearActiveJob();
                showToast("Job failed: " + (job.message || "Unknown error"), "error");
                loadJobsList();
            } else if (job.status === "cancelled") {
                clearInterval(state.jobPollTimer);
                clearActiveJob();
                showToast("Job was cancelled", "warning");
                loadJobsList();
            }
        } catch (err) {
            console.error("Job poll error:", err);
        }
    };

    // Immediate check + repeat interval
    checkStatus();
    state.jobPollTimer = setInterval(checkStatus, 1500);
}

function clearActiveJob() {
    state.activeJobId = null;
    localStorage.removeItem("clipforge_active_job");
    const submitBtn = document.getElementById("submitBtn");
    const previewBtn = document.getElementById("previewBtn");
    if (submitBtn) submitBtn.disabled = false;
    if (previewBtn) previewBtn.disabled = false;
}

async function cancelActiveJob(jobIdToCancel = null) {
    const jid = jobIdToCancel || state.activeJobId;
    if (!jid) return;

    if (!confirm("Are you sure you want to cancel this processing job?")) {
        return;
    }

    try {
        const res = await apiRequest(`/api/jobs/${jid}/cancel`, { method: "POST" });
        const data = await res.json();
        showToast("Cancellation requested. Stopping background process...");
        updateProgressUI(0, "cancelled", "Cancelled by user");
        clearActiveJob();
        loadJobsList();
    } catch (err) {
        showToast("Failed to cancel job: " + err.message, "error");
    }
}

async function deleteJob(jobId) {
    if (!confirm("Delete this request record from history?")) return;
    try {
        const res = await apiRequest(`/api/jobs/${jobId}`, { method: "DELETE" });
        if (res.ok) {
            showToast("Job record deleted");
            loadJobsList();
        } else {
            showToast("Failed to delete record", "error");
        }
    } catch (err) {
        showToast("Error: " + err.message, "error");
    }
}

async function clearCompletedJobs() {
    if (!confirm("Clear all completed and cancelled jobs from history?")) return;
    try {
        const res = await apiRequest("/api/jobs", { method: "DELETE" });
        if (res.ok) {
            showToast("Cleared completed jobs history");
            loadJobsList();
        }
    } catch (err) {
        showToast("Error: " + err.message, "error");
    }
}

function showProgressCard(visible) {
    const card = document.getElementById("jobProgressCard");
    if (card) {
        card.classList.toggle("active", visible);
    }
}

function updateProgressUI(pct, status, msg) {
    const fill = document.getElementById("progressBarFill");
    const pctText = document.getElementById("progressPercentText");
    const msgText = document.getElementById("progressStatusMsg");
    const badge = document.getElementById("progressStatusBadge");

    if (fill) fill.style.width = `${pct}%`;
    if (pctText) pctText.textContent = `${pct}%`;
    if (msgText) msgText.textContent = msg || status;

    if (badge) {
        badge.className = `progress-status-badge ${status}`;
        badge.textContent = status;
    }

    // Step pills
    const pQueue = document.getElementById("pStepQueue");
    const pDownload = document.getElementById("pStepDownload");
    const pSlice = document.getElementById("pStepSlice");
    const pDone = document.getElementById("pStepDone");

    if (pQueue) {
        pQueue.className = pct >= 5 ? "step-pill done" : "step-pill active";
    }
    if (pDownload) {
        if (pct >= 36) pDownload.className = "step-pill done";
        else if (pct >= 8) pDownload.className = "step-pill active";
        else pDownload.className = "step-pill";
    }
    if (pSlice) {
        if (pct >= 98) pSlice.className = "step-pill done";
        else if (pct >= 36) pSlice.className = "step-pill active";
        else pSlice.className = "step-pill";
    }
    if (pDone) {
        pDone.className = pct >= 100 ? "step-pill done" : "step-pill";
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Activity & Job Tracker List View
// ──────────────────────────────────────────────────────────────────────────────

async function loadJobsList() {
    const container = document.getElementById("jobsTableBody");
    const countBadge = document.getElementById("jobsCountBadge");
    if (!container) return;

    try {
        const res = await apiRequest("/api/jobs");
        if (!res.ok) return;
        const data = await res.json();
        const jobs = data.jobs || [];
        state.jobsList = jobs;

        if (countBadge) countBadge.textContent = jobs.length;
        const tabBadge = document.getElementById("jobsCountBadgeTab");
        if (tabBadge) tabBadge.textContent = jobs.length;

        // Auto-recover active background job if not currently tracked
        if (!state.activeJobId) {
            const runningJob = jobs.find(j => ["queued", "downloading", "processing"].includes(j.status));
            if (runningJob) {
                state.activeJobId = runningJob.id;
                localStorage.setItem("clipforge_active_job", runningJob.id);
                resumeActiveJob(runningJob.id);
            }
        }

        renderJobsList();

    } catch (err) {
        console.error("Failed to load jobs list:", err);
    }
}

function renderJobsList() {
    const container = document.getElementById("jobsTableBody");
    if (!container) return;

    const allJobs = state.jobsList || [];

    // Calculate Statistics
    const totalCount = allJobs.length;
    const activeCount = allJobs.filter(j => ["queued", "downloading", "processing"].includes(j.status)).length;
    const completedCount = allJobs.filter(j => j.status === "completed").length;
    const cancelledCount = allJobs.filter(j => ["cancelled", "failed"].includes(j.status)).length;

    // Update Counter Elements
    const sTotal = document.getElementById("statTotalJobs");
    const sActive = document.getElementById("statActiveJobs");
    const sCompleted = document.getElementById("statCompletedJobs");
    const sCancelled = document.getElementById("statCancelledJobs");

    if (sTotal) sTotal.textContent = totalCount;
    if (sActive) sActive.textContent = activeCount;
    if (sCompleted) sCompleted.textContent = completedCount;
    if (sCancelled) sCancelled.textContent = cancelledCount;

    // Update Filter Tab Badges
    const fAll = document.getElementById("countFilterAll");
    const fActive = document.getElementById("countFilterActive");
    const fCompleted = document.getElementById("countFilterCompleted");
    const fCancelled = document.getElementById("countFilterCancelled");

    if (fAll) fAll.textContent = totalCount;
    if (fActive) fActive.textContent = activeCount;
    if (fCompleted) fCompleted.textContent = completedCount;
    if (fCancelled) fCancelled.textContent = cancelledCount;

    // Apply Filter & Search
    let filtered = allJobs;
    if (state.currentJobFilter === "active") {
        filtered = filtered.filter(j => ["queued", "downloading", "processing"].includes(j.status));
    } else if (state.currentJobFilter === "completed") {
        filtered = filtered.filter(j => j.status === "completed");
    } else if (state.currentJobFilter === "cancelled") {
        filtered = filtered.filter(j => ["cancelled", "failed"].includes(j.status));
    }

    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        filtered = filtered.filter(j => {
            const title = (j.request && j.request.title ? j.request.title : "").toLowerCase();
            const url = (j.request && j.request.url ? j.request.url : "").toLowerCase();
            return title.includes(q) || url.includes(q);
        });
    }

    if (filtered.length === 0) {
        container.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 40px; color: var(--text-muted);">
                    No clip generation requests match your filter.
                </td>
            </tr>
        `;
        return;
    }

    container.innerHTML = filtered.map(j => {
        const req = j.request || {};
        const title = req.title || "Clip Job";
        const status = j.status || "queued";
        const progress = j.progress || 0;
        const filesCount = (j.files || []).length;
        const created = j.created_at ? new Date(j.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : "Just now";

        const canCancel = ["queued", "downloading", "processing"].includes(status);
        const cancelBtn = canCancel ? `
            <button type="button" class="btn-danger" style="padding: 5px 10px; font-size: 11px;" onclick="cancelActiveJob('${j.id}')" title="Cancel running job">
                <i class="fa-solid fa-stop"></i> Cancel
            </button>
        ` : "";

        const viewClipsBtn = filesCount > 0 ? `
            <button type="button" class="btn-secondary" style="padding: 5px 10px; font-size: 11px;" onclick="switchView('library')">
                <i class="fa-solid fa-eye"></i> View (${filesCount})
            </button>
        ` : "";

        const deleteBtn = !canCancel ? `
            <button type="button" class="btn-secondary danger" style="padding: 5px 8px; font-size: 11px;" onclick="deleteJob('${j.id}')" title="Delete job history">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        ` : "";

        return `
            <tr>
                <td>
                    <div style="font-weight: 700; color: #fff;">${escapeHtml(title)}</div>
                    <div style="font-size: 11.5px; color: var(--text-dim); max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${escapeHtml(req.url || "Local Download")}
                    </div>
                </td>
                <td>
                    <span class="progress-status-badge ${status}">
                        <i class="fa-solid ${status === 'completed' ? 'fa-check' : status === 'failed' ? 'fa-triangle-exclamation' : status === 'cancelled' ? 'fa-ban' : 'fa-spinner fa-spin'}"></i>
                        ${status}
                    </span>
                </td>
                <td style="min-width: 140px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; margin-bottom: 4px;">
                        <span style="color: var(--text-muted); max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(j.message || "")}</span>
                        <span style="font-weight: 700; color: #fff;">${progress}%</span>
                    </div>
                    <div class="progress-track" style="margin: 0; height: 6px;">
                        <div class="progress-bar-fill" style="width: ${progress}%;"></div>
                    </div>
                </td>
                <td>
                    <span style="font-weight: 600; color: #cbd5e1;">${filesCount} reel(s)</span>
                </td>
                <td style="font-size: 12px; color: var(--text-muted);">${created}</td>
                <td>
                    <div style="display: flex; gap: 6px; align-items: center;">
                        ${viewClipsBtn}
                        ${cancelBtn}
                        ${deleteBtn}
                    </div>
                </td>
            </tr>
        `;
    }).join("");
}

function setJobFilter(filter) {
    state.currentJobFilter = filter;
    document.querySelectorAll(".filter-tab-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.filter === filter);
    });
    renderJobsList();
}

function filterJobsList() {
    const input = document.getElementById("jobSearchInput");
    state.searchQuery = input ? input.value.trim() : "";
    renderJobsList();
}

// ──────────────────────────────────────────────────────────────────────────────
// Social Publishing Activity & Tracker (YouTube, Instagram, Facebook)
// ──────────────────────────────────────────────────────────────────────────────

state.activeJobTrackerTab = "slicing";
state.publishHistory = [];
state.currentPubFilter = "all";
state.pubSearchQuery = "";
state.publishPollerTimer = null;

function switchJobTrackerTab(tab) {
    state.activeJobTrackerTab = tab;
    const btnSlicing = document.getElementById("tabBtnSlicingJobs");
    const btnPublishing = document.getElementById("tabBtnPublishingJobs");
    const panelSlicing = document.getElementById("panelSlicingJobs");
    const panelPublishing = document.getElementById("panelPublishingJobs");

    if (tab === "slicing") {
        if (btnSlicing) btnSlicing.classList.add("active");
        if (btnPublishing) btnPublishing.classList.remove("active");
        if (panelSlicing) panelSlicing.style.display = "block";
        if (panelPublishing) panelPublishing.style.display = "none";
        loadJobsList();
    } else {
        if (btnPublishing) btnPublishing.classList.add("active");
        if (btnSlicing) btnSlicing.classList.remove("active");
        if (panelPublishing) panelPublishing.style.display = "block";
        if (panelSlicing) panelSlicing.style.display = "none";
        loadPublishHistory();
    }
}

function openPublishHistory() {
    switchView("jobs");
    switchJobTrackerTab("publishing");
}

async function loadPublishHistory() {
    const tbody = document.getElementById("publishHistoryTableBody");
    const countBadge = document.getElementById("publishCountBadgeTab");

    try {
        const res = await apiRequest("/publish/history");
        if (!res.ok) return;
        const data = await res.json();
        const records = data.records || [];
        state.publishHistory = records;

        if (countBadge) countBadge.textContent = records.length;

        if (tbody) renderPublishHistory();
    } catch (err) {
        console.error("Failed to load publish history:", err);
    }
}

function renderPublishHistory() {
    const tbody = document.getElementById("publishHistoryTableBody");
    if (!tbody) return;

    const allRecords = state.publishHistory || [];

    // Calculate Statistics
    const totalCount = allRecords.length;
    const activeCount = allRecords.filter(r => !r.all_done && (r.targets || []).some(t => ["queued", "uploading"].includes(t.status))).length;
    const successCount = allRecords.filter(r => (r.targets || []).some(t => t.status === "success")).length;
    const failedCount = allRecords.filter(r => (r.targets || []).length > 0 && (r.targets || []).every(t => t.status === "failed")).length;

    const sTotal = document.getElementById("statTotalPublishes");
    const sActive = document.getElementById("statActivePublishes");
    const sSuccess = document.getElementById("statSuccessPublishes");
    const sFailed = document.getElementById("statFailedPublishes");

    if (sTotal) sTotal.textContent = totalCount;
    if (sActive) sActive.textContent = activeCount;
    if (sSuccess) sSuccess.textContent = successCount;
    if (sFailed) sFailed.textContent = failedCount;

    // Filter count badges
    const fAll = document.getElementById("countPubFilterAll");
    const fActive = document.getElementById("countPubFilterActive");
    const fSuccess = document.getElementById("countPubFilterSuccess");
    const fFailed = document.getElementById("countPubFilterFailed");

    if (fAll) fAll.textContent = totalCount;
    if (fActive) fActive.textContent = activeCount;
    if (fSuccess) fSuccess.textContent = successCount;
    if (fFailed) fFailed.textContent = failedCount;

    // Filter list
    let filtered = allRecords;
    if (state.currentPubFilter === "active") {
        filtered = filtered.filter(r => !r.all_done && (r.targets || []).some(t => ["queued", "uploading"].includes(t.status)));
    } else if (state.currentPubFilter === "success") {
        filtered = filtered.filter(r => (r.targets || []).some(t => t.status === "success"));
    } else if (state.currentPubFilter === "failed") {
        filtered = filtered.filter(r => (r.targets || []).every(t => t.status === "failed"));
    }

    if (state.pubSearchQuery) {
        const q = state.pubSearchQuery.toLowerCase();
        filtered = filtered.filter(r => {
            const clipName = (r.clip_name || "").toLowerCase();
            const targetsMatch = (r.targets || []).some(t => 
                (t.account_alias || "").toLowerCase().includes(q) || 
                (t.platform || "").toLowerCase().includes(q)
            );
            return clipName.includes(q) || targetsMatch;
        });
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 40px; color: var(--text-muted);">
                    No social publishing activity matches your filter.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map(r => {
        const clipName = r.clip_name || "clip.mp4";
        const started = r.started_at ? new Date(r.started_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : "Recently";
        const targets = r.targets || [];

        // Targets badges
        const targetBadges = targets.map(t => {
            const p = (t.platform || "youtube").toLowerCase();
            const icon = p === "youtube" ? "fa-brands fa-youtube" : p === "instagram" ? "fa-brands fa-instagram" : "fa-brands fa-facebook";
            return `
                <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                    <span class="platform-badge ${p}"><i class="${icon}"></i> ${escapeHtml(t.account_alias || p)}</span>
                </div>
            `;
        }).join("");

        // Status determination
        const hasUploading = targets.some(t => ["uploading", "queued"].includes(t.status));
        const allSuccess = targets.length > 0 && targets.every(t => t.status === "success");
        const allFailed = targets.length > 0 && targets.every(t => t.status === "failed");
        const someSuccess = targets.some(t => t.status === "success");

        let statusBadge = "";
        if (hasUploading) {
            statusBadge = `<span class="progress-status-badge processing"><i class="fa-solid fa-cloud-arrow-up fa-bounce"></i> Uploading</span>`;
        } else if (allSuccess) {
            statusBadge = `<span class="progress-status-badge completed"><i class="fa-solid fa-circle-check"></i> Published</span>`;
        } else if (someSuccess) {
            statusBadge = `<span class="progress-status-badge processing" style="background: rgba(16, 185, 129, 0.2);"><i class="fa-solid fa-check-double"></i> Partial (${targets.filter(t => t.status === 'success').length}/${targets.length})</span>`;
        } else if (allFailed) {
            statusBadge = `<span class="progress-status-badge cancelled"><i class="fa-solid fa-circle-xmark"></i> Failed</span>`;
        } else {
            statusBadge = `<span class="progress-status-badge queued">Queued</span>`;
        }

        // Live links and errors
        const linksAndErrors = targets.map(t => {
            const p = (t.platform || "").toUpperCase();
            if (t.status === "success" && t.url) {
                return `
                    <div style="margin-bottom: 4px;">
                        <a href="${t.url}" target="_blank" rel="noopener noreferrer" class="publish-live-link">
                            <i class="fa-solid fa-arrow-up-right-from-square"></i> Open on ${p}
                        </a>
                    </div>
                `;
            } else if (t.status === "failed") {
                return `
                    <div class="publish-err-msg" title="${escapeHtml(t.error || 'Upload error')}">
                        <strong>${p}:</strong> ${escapeHtml(t.error || "Failed")}
                    </div>
                `;
            } else {
                return `
                    <div style="font-size: 11.5px; color: var(--accent-amber); margin-bottom: 3px;">
                        <i class="fa-solid fa-spinner fa-spin"></i> ${p}: ${t.status} (${t.progress || 0}%)
                    </div>
                `;
            }
        }).join("");

        return `
            <tr>
                <td>
                    <div style="font-weight: 700; color: #fff; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(clipName)}">
                        <i class="fa-solid fa-film" style="color: var(--primary); margin-right: 6px;"></i>
                        ${escapeHtml(clipName)}
                    </div>
                </td>
                <td>${targetBadges}</td>
                <td>${statusBadge}</td>
                <td style="min-width: 180px;">${linksAndErrors || '<span style="color: var(--text-dim); font-size: 11px;">None</span>'}</td>
                <td style="font-size: 12px; color: var(--text-muted);">${started}</td>
                <td>
                    <button type="button" class="btn-secondary danger" style="padding: 5px 9px; font-size: 11px;" onclick="deletePublishRecord('${r.job_id}')" title="Delete record">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}

function setPublishFilter(filter) {
    state.currentPubFilter = filter;
    document.querySelectorAll("[data-pubfilter]").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.pubfilter === filter);
    });
    renderPublishHistory();
}

function filterPublishHistoryList() {
    const input = document.getElementById("publishSearchInput");
    state.pubSearchQuery = input ? input.value.trim() : "";
    renderPublishHistory();
}

async function deletePublishRecord(jobId) {
    if (!confirm("Delete this publish history entry?")) return;
    try {
        const res = await apiRequest(`/publish/history/${jobId}`, { method: "DELETE" });
        if (res.ok) {
            showToast("Publish record deleted");
            loadPublishHistory();
        } else {
            showToast("Failed to delete record", "error");
        }
    } catch (err) {
        showToast("Error: " + err.message, "error");
    }
}

async function clearAllPublishHistory() {
    if (!confirm("Clear all social publishing history records?")) return;
    try {
        const res = await apiRequest("/publish/history", { method: "DELETE" });
        if (res.ok) {
            showToast("All publish history cleared");
            loadPublishHistory();
        }
    } catch (err) {
        showToast("Error: " + err.message, "error");
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Media Library (Clips & Downloaded Source Videos)
// ──────────────────────────────────────────────────────────────────────────────

state.activeLibraryTab = "clips";

function switchLibraryTab(tab) {
    state.activeLibraryTab = tab;
    const btnClips = document.getElementById("tabBtnClips");
    const btnDownloads = document.getElementById("tabBtnDownloads");
    const gridClips = document.getElementById("clipsGrid");
    const gridDownloads = document.getElementById("downloadsGrid");

    if (tab === "clips") {
        if (btnClips) btnClips.classList.add("active");
        if (btnDownloads) btnDownloads.classList.remove("active");
        if (gridClips) gridClips.style.display = "grid";
        if (gridDownloads) gridDownloads.style.display = "none";
        loadClips();
    } else {
        if (btnDownloads) btnDownloads.classList.add("active");
        if (btnClips) btnClips.classList.remove("active");
        if (gridDownloads) gridDownloads.style.display = "grid";
        if (gridClips) gridClips.style.display = "none";
        const selBar = document.getElementById("clipsSelectionBar");
        const headerBtn = document.getElementById("publishSelectedHeaderBtn");
        if (selBar) selBar.style.display = "none";
        if (headerBtn) headerBtn.style.display = "none";
        loadDownloads();
    }
}

function refreshActiveLibraryTab() {
    loadClips();
    loadDownloads();
}

function openFirstClipPublishModal() {
    if (!state.clips || state.clips.length === 0) {
        showToast("No clips available to publish", "warning");
        return;
    }
    const clip = state.clips[0];
    const url = clip.url || `/media/clips/${encodeURIComponent(clip.name)}`;
    openSinglePublishModal(clip.name, url);
}

async function loadClips() {
    const grid = document.getElementById("clipsGrid");
    const countBadge = document.getElementById("clipCountBadge");
    const publishAllCount = document.getElementById("publishAllCount");
    const publishAllBtn = document.getElementById("publishAllBtn");

    if (!grid) return;

    try {
        const res = await apiRequest("/api/clips");
        if (!res.ok) return;
        const data = await res.json();
        const clips = data.clips || [];
        state.clips = clips;

        if (countBadge) countBadge.textContent = clips.length;
        if (publishAllCount) publishAllCount.textContent = clips.length;
        if (publishAllBtn) publishAllBtn.style.display = clips.length > 0 ? "inline-flex" : "none";

        // Clean up any selected clips that no longer exist
        const currentClipNames = new Set(clips.map(c => c.name));
        for (const selName of state.selectedClips) {
            if (!currentClipNames.has(selName)) {
                state.selectedClips.delete(selName);
            }
        }

        if (clips.length === 0) {
            grid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-muted);">
                    <div style="font-size: 42px; margin-bottom: 12px; opacity: 0.5;"><i class="fa-solid fa-film"></i></div>
                    <h3 style="color: #fff; margin-bottom: 6px;">No Clips Generated Yet</h3>
                    <p style="font-size: 13.5px; margin-bottom: 18px;">Paste a YouTube link in the Studio tab to generate vertical 9:16 reels.</p>
                    <button class="btn-primary" onclick="switchView('studio')"><i class="fa-solid fa-wand-magic-sparkles"></i> Open Studio</button>
                </div>
            `;
            updateClipSelectionUI();
            return;
        }

        grid.innerHTML = clips.map((clip, index) => {
            const url = clip.url || `/media/clips/${encodeURIComponent(clip.name)}`;
            const sizeMb = clip.size_mb ? `${clip.size_mb} MB` : (clip.size_bytes ? (clip.size_bytes / (1024 * 1024)).toFixed(1) + " MB" : "");
            const isSelected = state.selectedClips.has(clip.name);

            return `
                <div class="clip-card ${isSelected ? 'selected' : ''}" data-index="${index}" data-name="${escapeHtml(clip.name)}" data-url="${url}">
                    <div class="clip-thumb-wrap" onclick="previewClipCard(this)">
                        <video src="${url}" preload="metadata" muted playsinline></video>
                        <label class="clip-select-label" onclick="event.stopPropagation()">
                            <input type="checkbox" class="clip-select-checkbox" data-clipname="${escapeHtml(clip.name)}" ${isSelected ? 'checked' : ''} onchange="toggleClipSelection('${escapeHtml(clip.name)}', this.checked)">
                            <span class="clip-select-custom"><i class="fa-solid fa-check"></i></span>
                        </label>
                        <div style="position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; color: #fff;">
                            9:16 Reel
                        </div>
                        <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.3); opacity: 0; transition: opacity 0.2s;" onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=0">
                            <div style="width: 48px; height: 48px; border-radius: 50%; background: var(--primary); display: flex; align-items: center; justify-content: center; color: #fff; font-size: 18px; box-shadow: 0 4px 15px rgba(0,0,0,0.5);">
                                <i class="fa-solid fa-play" style="margin-left: 3px;"></i>
                            </div>
                        </div>
                    </div>
                    <div class="clip-info">
                        <div class="clip-title" title="${escapeHtml(clip.name)}">${escapeHtml(clip.name)}</div>
                        <div class="clip-meta-row">
                            <span><i class="fa-regular fa-hard-drive"></i> ${sizeMb}</span>
                            ${clip.has_subtitles ? '<span style="color: #ffe500; font-weight: 600;"><i class="fa-solid fa-closed-captioning"></i> Subtitled</span>' : '<span style="color: var(--accent-emerald); font-weight: 600;"><i class="fa-solid fa-circle-check"></i> Ready</span>'}
                        </div>
                        <div class="clip-actions-row">
                            <a href="${url}" download="${escapeHtml(clip.name)}" class="btn-secondary" style="flex: 1; padding: 7px 8px; font-size: 11.5px; text-align: center;">
                                <i class="fa-solid fa-download"></i> Save
                            </a>
                            <button type="button" class="btn-secondary" style="flex: 1.1; padding: 7px 8px; font-size: 11.5px;" onclick="openSubtitleModal('${escapeHtml(clip.name)}', '${url}')" title="Subtitles & Captions Studio">
                                <i class="fa-solid fa-closed-captioning"></i> Captions
                            </button>
                            <button type="button" class="btn-primary" style="flex: 1.2; padding: 7px 10px; font-size: 11.5px;" onclick="publishClipCard(this)">
                                <i class="fa-solid fa-rocket"></i> Publish
                            </button>
                            <button type="button" class="btn-secondary danger" style="padding: 7px 8px; font-size: 11.5px;" onclick="deleteClipCard(this)" title="Delete Clip">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join("");

        updateClipSelectionUI();
    } catch (err) {
        console.error("Failed to load clips:", err);
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Multi-Clip Selection Handlers
// ──────────────────────────────────────────────────────────────────────────────

function toggleClipSelection(clipName, isChecked) {
    if (isChecked) {
        state.selectedClips.add(clipName);
    } else {
        state.selectedClips.delete(clipName);
    }

    const cards = document.querySelectorAll(".clip-card");
    cards.forEach(card => {
        if (card.dataset.name === clipName) {
            card.classList.toggle("selected", isChecked);
        }
    });

    updateClipSelectionUI();
}

function toggleSelectAllClips(selectAll) {
    if (selectAll) {
        (state.clips || []).forEach(c => state.selectedClips.add(c.name));
    } else {
        state.selectedClips.clear();
    }

    document.querySelectorAll(".clip-select-checkbox").forEach(cb => {
        if (cb.id !== "selectAllClipsCheckbox") {
            cb.checked = selectAll;
        }
    });

    document.querySelectorAll(".clip-card").forEach(card => {
        card.classList.toggle("selected", selectAll);
    });

    updateClipSelectionUI();
}

function clearClipSelection() {
    state.selectedClips.clear();

    document.querySelectorAll(".clip-select-checkbox").forEach(cb => {
        cb.checked = false;
    });

    document.querySelectorAll(".clip-card").forEach(card => {
        card.classList.remove("selected");
    });

    updateClipSelectionUI();
}

function updateClipSelectionUI() {
    const selBar = document.getElementById("clipsSelectionBar");
    const headerBtn = document.getElementById("publishSelectedHeaderBtn");
    const summary = document.getElementById("selectedClipsSummary");
    const countSpan = document.getElementById("publishSelectedCount");
    const headerCount = document.getElementById("publishHeaderCount");
    const selectAllCb = document.getElementById("selectAllClipsCheckbox");

    const count = state.selectedClips.size;
    const total = state.clips ? state.clips.length : 0;

    if (selBar) selBar.style.display = count > 0 && state.activeLibraryTab === "clips" ? "flex" : "none";
    if (headerBtn) headerBtn.style.display = count > 0 && state.activeLibraryTab === "clips" ? "inline-flex" : "none";
    if (summary) summary.textContent = `${count} clip${count === 1 ? '' : 's'} selected`;
    if (countSpan) countSpan.textContent = count;
    if (headerCount) headerCount.textContent = count;

    if (selectAllCb) {
        selectAllCb.checked = total > 0 && count === total;
        selectAllCb.indeterminate = count > 0 && count < total;
    }
}

function previewClipCard(el) {
    const card = el.closest(".clip-card");
    if (!card) return;
    openPhoneModal(card.dataset.url, card.dataset.name);
}

function publishClipCard(el) {
    const card = el.closest(".clip-card");
    if (!card) return;
    openSinglePublishModal(card.dataset.name, card.dataset.url);
}

async function deleteClipCard(el) {
    const card = el.closest(".clip-card");
    if (!card) return;
    const filename = card.dataset.name;
    if (!confirm(`Delete clip "${filename}"?`)) return;

    try {
        const res = await apiRequest(`/api/media/clips?filename=${encodeURIComponent(filename)}`, { method: "DELETE" });
        if (res.ok) {
            showToast("Clip deleted successfully", "success");
            state.selectedClips.delete(filename);
            loadClips();
            initStoragePill();
        } else {
            const err = await res.json();
            showToast("Delete failed: " + (err.detail || "Server error"), "error");
        }
    } catch (err) {
        showToast("Network error deleting clip", "error");
    }
}

async function loadDownloads() {
    const grid = document.getElementById("downloadsGrid");
    const countBadge = document.getElementById("downloadCountBadge");

    if (!grid) return;

    try {
        const res = await apiRequest("/api/downloads");
        if (!res.ok) return;
        const data = await res.json();
        const downloads = data.downloads || [];
        state.downloads = downloads;

        if (countBadge) countBadge.textContent = downloads.length;

        if (downloads.length === 0) {
            grid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-muted);">
                    <div style="font-size: 42px; margin-bottom: 12px; opacity: 0.5;"><i class="fa-solid fa-cloud-arrow-down"></i></div>
                    <h3 style="color: #fff; margin-bottom: 6px;">No Downloaded Source Videos</h3>
                    <p style="font-size: 13.5px; margin-bottom: 18px;">When you submit a video URL in Studio, the downloaded source is saved here for instant re-slicing without re-downloading.</p>
                    <button class="btn-primary" onclick="switchView('studio')"><i class="fa-solid fa-wand-magic-sparkles"></i> Open Studio</button>
                </div>
            `;
            return;
        }

        grid.innerHTML = downloads.map((dl, index) => {
            const url = dl.url || `/media/downloads/${encodeURIComponent(dl.name)}`;
            const sizeMb = dl.size_mb ? `${dl.size_mb} MB` : (dl.size_bytes ? (dl.size_bytes / (1024 * 1024)).toFixed(1) + " MB" : "");
            const title = dl.clean_title || dl.name;
            const thumbUrl = dl.thumbnail || "";

            return `
                <div class="download-card" data-index="${index}" data-name="${escapeHtml(dl.name)}" data-url="${url}" data-yturl="${escapeHtml(dl.youtube_url || '')}" data-title="${escapeHtml(title)}">
                    <div class="download-thumb-wrap" onclick="previewDownloadCard(this)">
                        ${thumbUrl ? `<img src="${thumbUrl}" alt="Thumbnail" onerror="this.onerror=null; this.style.display='none'; this.nextElementSibling.style.display='block';">` : ''}
                        <video src="${url}" preload="metadata" muted playsinline style="${thumbUrl ? 'display: none;' : 'display: block;'}"></video>
                        <div style="position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; color: #fff;">
                            ${dl.video_id ? 'YouTube Source' : 'Downloaded Source'}
                        </div>
                        <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.3); opacity: 0; transition: opacity 0.2s;" onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=0">
                            <div style="width: 48px; height: 48px; border-radius: 50%; background: var(--accent-cyan); display: flex; align-items: center; justify-content: center; color: #fff; font-size: 18px; box-shadow: 0 4px 15px rgba(0,0,0,0.5);">
                                <i class="fa-solid fa-play" style="margin-left: 3px;"></i>
                            </div>
                        </div>
                    </div>
                    <div class="clip-info">
                        <div class="clip-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
                        <div class="clip-meta-row">
                            <span><i class="fa-regular fa-hard-drive"></i> ${sizeMb}</span>
                            <span style="color: var(--accent-cyan); font-weight: 600;"><i class="fa-solid fa-bolt"></i> Cached</span>
                        </div>
                        <div class="clip-actions-row">
                            <button type="button" class="btn-primary" style="flex: 1.4; padding: 7px 12px; font-size: 12px; background: linear-gradient(135deg, #0284c7, #06b6d4);" onclick="sliceSourceInStudio(this)">
                                <i class="fa-solid fa-scissors"></i> Slice in Studio
                            </button>
                            <a href="${url}" download="${escapeHtml(dl.name)}" class="btn-secondary" style="padding: 7px 10px; font-size: 12px; text-align: center;" title="Download Video File">
                                <i class="fa-solid fa-download"></i>
                            </a>
                            <button type="button" class="btn-secondary danger" style="padding: 7px 10px; font-size: 12px;" onclick="deleteDownloadCard(this)" title="Delete Downloaded Video">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join("");

    } catch (err) {
        console.error("Failed to load downloads:", err);
    }
}

function previewDownloadCard(el) {
    const card = el.closest(".download-card");
    if (!card) return;
    openPhoneModal(card.dataset.url, card.dataset.title);
}

function sliceSourceInStudio(el) {
    const card = el.closest(".download-card");
    if (!card) return;
    const ytUrl = card.dataset.yturl;
    const title = card.dataset.title;

    switchView("studio");

    const urlInput = document.getElementById("urlInput");
    const titleInput = document.getElementById("titleInput");

    if (ytUrl && urlInput) {
        urlInput.value = ytUrl;
        handleUrlChange();
    }
    if (title && titleInput) {
        titleInput.value = title;
    }

    showToast("Source video loaded in Studio! Adjust clipping settings and click Generate.", "success");
}

async function deleteDownloadCard(el) {
    const card = el.closest(".download-card");
    if (!card) return;
    const filename = card.dataset.name;
    if (!confirm(`Delete downloaded source "${filename}"?`)) return;

    try {
        const res = await apiRequest(`/api/media/downloads?filename=${encodeURIComponent(filename)}`, { method: "DELETE" });
        if (res.ok) {
            showToast("Downloaded video deleted", "success");
            loadDownloads();
            initStoragePill();
        } else {
            const err = await res.json();
            showToast("Delete failed: " + (err.detail || "Server error"), "error");
        }
    } catch (err) {
        showToast("Network error deleting download", "error");
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Connected Accounts Management
// ──────────────────────────────────────────────────────────────────────────────

async function loadAccounts() {
    const listContainer = document.getElementById("accountsListContainer");
    const countBadge = document.getElementById("headerAccountCount");
    const publishAccountsList = document.getElementById("publishAccountsList");

    try {
        const res = await apiRequest("/accounts");
        if (!res.ok) return;
        const data = await res.json();
        const accounts = data.accounts || [];
        state.accounts = accounts;

        if (countBadge) countBadge.textContent = accounts.length;

        // Render in Accounts View
        if (listContainer) {
            if (accounts.length === 0) {
                listContainer.innerHTML = `
                    <div style="text-align: center; padding: 40px; color: var(--text-muted); background: var(--bg-card); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                        <i class="fa-solid fa-tower-broadcast" style="font-size: 32px; margin-bottom: 10px; opacity: 0.5;"></i>
                        <p>No connected accounts found. Click "Connect Manually" or "Sync from .env" above.</p>
                    </div>
                `;
            } else {
                listContainer.innerHTML = accounts.map(acc => {
                    const isYT = acc.platform === "youtube";
                    const isIG = acc.platform === "instagram";
                    const icon = isYT ? "fa-brands fa-youtube" : isIG ? "fa-brands fa-instagram" : "fa-brands fa-facebook";
                    const brandColor = isYT ? "#ff0000" : isIG ? "#e1306c" : "#1877f2";

                    return `
                        <div class="card" style="display: flex; align-items: center; justify-content: space-between; padding: 18px 22px;">
                            <div style="display: flex; align-items: center; gap: 14px;">
                                <div style="width: 44px; height: 44px; border-radius: 12px; background: rgba(255,255,255,0.05); display: flex; align-items: center; justify-content: center; font-size: 22px; color: ${brandColor}; border: 1px solid var(--border-subtle);">
                                    <i class="${icon}"></i>
                                </div>
                                <div>
                                    <div style="font-weight: 700; color: #fff; font-size: 15px;">${escapeHtml(acc.alias || acc.channel_title || acc.platform)}</div>
                                    <div style="font-size: 12px; color: var(--text-dim); display: flex; align-items: center; gap: 8px;">
                                        <span style="text-transform: uppercase;">${acc.platform}</span>
                                        <span>•</span>
                                        <span style="color: var(--accent-emerald);"><i class="fa-solid fa-circle" style="font-size: 7px;"></i> Active</span>
                                        ${acc.channel_id ? `<span>• ID: ${escapeHtml(acc.channel_id)}</span>` : ""}
                                    </div>
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <button type="button" class="btn-danger" onclick="disconnectAccount('${acc.id}')">
                                    <i class="fa-solid fa-trash-can"></i> Disconnect
                                </button>
                            </div>
                        </div>
                    `;
                }).join("");
            }
        }

        // Render selectable accounts inside Publish Modal
        if (publishAccountsList) {
            if (accounts.length === 0) {
                publishAccountsList.innerHTML = `
                    <div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 13px;">
                        No accounts connected yet. Please connect your accounts first.
                    </div>
                `;
            } else {
                publishAccountsList.innerHTML = accounts.map(acc => {
                    const isYT = acc.platform === "youtube";
                    const isIG = acc.platform === "instagram";
                    const icon = isYT ? "fa-brands fa-youtube" : isIG ? "fa-brands fa-instagram" : "fa-brands fa-facebook";
                    const brandColor = isYT ? "#ff0000" : isIG ? "#e1306c" : "#1877f2";

                    return `
                        <label class="account-select-item" style="display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); cursor: pointer; margin-bottom: 8px;">
                            <input type="checkbox" value="${acc.id}" class="publish-account-checkbox" checked style="width: 16px; height: 16px; accent-color: var(--primary);">
                            <i class="${icon}" style="font-size: 18px; color: ${brandColor};"></i>
                            <div style="flex: 1;">
                                <div style="font-size: 13.5px; font-weight: 700; color: #fff;">${escapeHtml(acc.alias || acc.channel_title || acc.platform)}</div>
                                <div style="font-size: 11px; color: var(--text-dim); text-transform: uppercase;">${acc.platform}</div>
                            </div>
                        </label>
                    `;
                }).join("");
            }
        }

    } catch (err) {
        console.error("Failed to load accounts:", err);
    }
}

function openManualAccountModal() {
    const modal = document.getElementById("manualAccountModal");
    if (modal) modal.classList.add("active");
}

function closeManualAccountModal() {
    const modal = document.getElementById("manualAccountModal");
    if (modal) modal.classList.remove("active");
}

async function handleManualAccountSubmit(e) {
    e.preventDefault();
    const platform = document.getElementById("manualPlatform").value;
    const alias = document.getElementById("manualAlias").value.trim();
    const channel_id = document.getElementById("manualChannelId").value.trim();
    const access_token = document.getElementById("manualToken").value.trim();
    const refresh_token = document.getElementById("manualRefreshToken").value.trim() || null;

    try {
        const res = await apiRequest("/accounts/manual", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                platform,
                alias,
                channel_id: channel_id || alias,
                access_token,
                refresh_token
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Failed to save account");

        closeManualAccountModal();
        showToast(`Connected ${platform.toUpperCase()} account: ${alias}`, "success");
        loadAccounts();
    } catch (err) {
        showToast(err.message, "error");
    }
}

async function syncEnvAccounts() {
    showToast("Detecting and syncing accounts from .env...", "info");
    try {
        const res = await apiRequest("/accounts/sync-env", { method: "POST" });
        const data = await res.json();
        showToast(data.message || "Synced accounts from .env", "success");
        loadAccounts();
    } catch (err) {
        showToast("Sync failed: " + err.message, "error");
    }
}

async function disconnectAccount(accountId) {
    if (!confirm("Are you sure you want to disconnect this account?")) return;
    try {
        const res = await apiRequest(`/accounts/${accountId}`, { method: "DELETE" });
        if (res.ok) {
            showToast("Account disconnected", "info");
            loadAccounts();
        } else {
            showToast("Failed to disconnect", "error");
        }
    } catch (err) {
        showToast("Error: " + err.message, "error");
    }
}

function connectOAuth(platform) {
    const url = platform === "youtube" ? "/accounts/youtube/connect" : "/accounts/instagram/connect";
    apiRequest(url)
        .then(res => res.json())
        .then(data => {
            if (data.auth_url) {
                const popup = window.open(data.auth_url, "OAuthConnection", "width=600,height=700");
                const timer = setInterval(() => {
                    if (popup.closed) {
                        clearInterval(timer);
                        loadAccounts();
                    }
                }, 1000);
            } else {
                showToast("OAuth URL not configured for " + platform + ". Use 'Connect Manually' to add direct token.", "warning");
            }
        })
        .catch(err => showToast(err.message, "error"));
}

// ──────────────────────────────────────────────────────────────────────────────
// Social Publishing
// ──────────────────────────────────────────────────────────────────────────────

function openSinglePublishModal(clipName, clipUrl) {
    state.isBatchPublish = false;
    state.modalVideoName = clipName;
    state.modalVideoUrl = clipUrl;

    if (state.publishPollerTimer) {
        clearInterval(state.publishPollerTimer);
        state.publishPollerTimer = null;
    }

    const modal = document.getElementById("publishModal");
    const title = document.getElementById("publishModalTitleText");
    const video = document.getElementById("publishModalVideo");
    const badge = document.getElementById("publishClipBadge");
    const captionInput = document.getElementById("publishCaptionInput");
    const formState = document.getElementById("publishFormState");
    const progressState = document.getElementById("publishProgressState");
    const singleWrap = document.getElementById("publishSinglePreviewWrap");
    const multiWrap = document.getElementById("publishMultiPreviewWrap");
    const executeBtnText = document.getElementById("publishExecuteBtnText");

    if (formState) {
        formState.style.display = "block";
        formState.scrollTop = 0;
    }
    if (progressState) progressState.style.display = "none";
    if (singleWrap) singleWrap.style.display = "block";
    if (multiWrap) multiWrap.style.display = "none";

    if (title) title.innerHTML = `<i class="fa-solid fa-rocket" style="color: var(--accent-pink);"></i> Publish Clip to Socials`;
    if (executeBtnText) executeBtnText.textContent = "Publish Now";
    if (video) video.src = clipUrl;
    if (badge) badge.textContent = clipName;
    if (captionInput) captionInput.value = clipName.replace(".mp4", "").replace(/_/g, " ") + " #viral #reels #shorts";

    loadAccounts();
    if (modal) modal.classList.add("active");
}

function openPublishModalForSelected() {
    if (!state.selectedClips || state.selectedClips.size === 0) {
        showToast("Please select at least one clip using the checkboxes", "warning");
        return;
    }

    const selectedArray = Array.from(state.selectedClips);

    if (selectedArray.length === 1) {
        const clipName = selectedArray[0];
        const clipObj = (state.clips || []).find(c => c.name === clipName);
        const url = clipObj ? (clipObj.url || `/media/clips/${encodeURIComponent(clipObj.name)}`) : `/media/clips/${encodeURIComponent(clipName)}`;
        openSinglePublishModal(clipName, url);
        return;
    }

    // Multi-clip batch publishing modal mode
    state.isBatchPublish = true;
    state.modalVideoName = null;
    state.modalVideoUrl = null;

    if (state.publishPollerTimer) {
        clearInterval(state.publishPollerTimer);
        state.publishPollerTimer = null;
    }

    const modal = document.getElementById("publishModal");
    const title = document.getElementById("publishModalTitleText");
    const formState = document.getElementById("publishFormState");
    const progressState = document.getElementById("publishProgressState");
    const singleWrap = document.getElementById("publishSinglePreviewWrap");
    const multiWrap = document.getElementById("publishMultiPreviewWrap");
    const multiCount = document.getElementById("publishMultiCount");
    const executeBtnText = document.getElementById("publishExecuteBtnText");
    const captionInput = document.getElementById("publishCaptionInput");

    if (formState) {
        formState.style.display = "block";
        formState.scrollTop = 0;
    }
    if (progressState) progressState.style.display = "none";
    if (singleWrap) singleWrap.style.display = "none";
    if (multiWrap) multiWrap.style.display = "block";

    if (title) {
        title.innerHTML = `<i class="fa-solid fa-rocket" style="color: var(--accent-pink);"></i> Batch Publish (${selectedArray.length} Selected Clips)`;
    }
    if (multiCount) multiCount.textContent = selectedArray.length;
    if (executeBtnText) executeBtnText.textContent = `Publish ${selectedArray.length} Clips Now`;

    if (captionInput) {
        captionInput.value = "Best Highlights {part} #viral #reels #shorts";
    }

    renderSelectedClipsInModal();
    loadAccounts();
    if (modal) modal.classList.add("active");
}

function renderSelectedClipsInModal() {
    const listWrap = document.getElementById("publishMultiClipsList");
    const multiCount = document.getElementById("publishMultiCount");
    const executeBtnText = document.getElementById("publishExecuteBtnText");
    const title = document.getElementById("publishModalTitleText");

    const selectedArray = Array.from(state.selectedClips);
    if (multiCount) multiCount.textContent = selectedArray.length;
    if (executeBtnText) executeBtnText.textContent = `Publish ${selectedArray.length} Clips Now`;
    if (title) {
        title.innerHTML = `<i class="fa-solid fa-rocket" style="color: var(--accent-pink);"></i> Batch Publish (${selectedArray.length} Selected Clips)`;
    }

    if (!listWrap) return;

    if (selectedArray.length === 0) {
        listWrap.innerHTML = `<div style="color: var(--text-muted); font-size: 12.5px; padding: 12px 0; text-align: center;">No clips selected</div>`;
        return;
    }

    listWrap.innerHTML = selectedArray.map(name => {
        return `
            <div class="selected-clip-item" data-clip="${escapeHtml(name)}">
                <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; min-width: 0;">
                    <i class="fa-solid fa-film" style="color: var(--primary); font-size: 13px; flex-shrink: 0;"></i>
                    <span style="font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; color: #fff;" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
                </div>
                <button type="button" class="remove-clip-btn" onclick="removeSelectedClipFromModal('${escapeHtml(name)}')" title="Remove from batch">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        `;
    }).join("");
}

function removeSelectedClipFromModal(clipName) {
    state.selectedClips.delete(clipName);

    // Update checkbox on library page if visible
    const cb = document.querySelector(`.clip-select-checkbox[data-clipname="${CSS.escape ? CSS.escape(clipName) : clipName}"]`);
    if (cb) cb.checked = false;

    const card = document.querySelector(`.clip-card[data-name="${CSS.escape ? CSS.escape(clipName) : clipName}"]`);
    if (card) card.classList.remove("selected");

    updateClipSelectionUI();

    if (state.selectedClips.size === 0) {
        closePublishModal();
        showToast("All clips deselected", "info");
        return;
    }

    if (state.selectedClips.size === 1) {
        // Switch to single clip view inside modal
        const remainingClipName = Array.from(state.selectedClips)[0];
        const clipObj = (state.clips || []).find(c => c.name === remainingClipName);
        const url = clipObj ? (clipObj.url || `/media/clips/${encodeURIComponent(clipObj.name)}`) : `/media/clips/${encodeURIComponent(remainingClipName)}`;
        openSinglePublishModal(remainingClipName, url);
        return;
    }

    renderSelectedClipsInModal();
}

function closePublishModal() {
    const modal = document.getElementById("publishModal");
    const video = document.getElementById("publishModalVideo");
    if (state.publishPollerTimer) {
        clearInterval(state.publishPollerTimer);
        state.publishPollerTimer = null;
    }
    if (video) {
        video.pause();
        video.src = "";
    }
    if (modal) modal.classList.remove("active");
}

function appendHashtag(tag) {
    const captionInput = document.getElementById("publishCaptionInput");
    if (captionInput && !captionInput.value.includes(tag)) {
        captionInput.value = (captionInput.value.trim() + " " + tag).trim();
    }
}

async function executePublish() {
    const checkboxes = document.querySelectorAll(".publish-account-checkbox:checked");
    const accountIds = Array.from(checkboxes).map(cb => cb.value);
    const caption = document.getElementById("publishCaptionInput").value.trim();
    const btn = document.getElementById("publishExecuteBtn");

    if (accountIds.length === 0) {
        showToast("Please select at least one target account", "warning");
        return;
    }

    // Branch 1: Multi-Clip Batch Publishing
    if (state.isBatchPublish && state.selectedClips.size > 1) {
        const selectedClipsArray = Array.from(state.selectedClips);
        try {
            if (btn) btn.disabled = true;
            showToast(`Initiating batch publishing for ${selectedClipsArray.length} clips...`, "info");

            const targets = accountIds.map(accId => {
                const acc = state.accounts.find(a => a.id === accId);
                return {
                    account_id: accId,
                    platform: acc ? acc.platform : "youtube",
                    youtube_config: { title: "Clip Highlights", description: caption },
                    instagram_config: { caption: caption, share_to_feed: true },
                    facebook_config: { title: "Clip Highlights", description: caption, as_reel: true }
                };
            });

            const res = await apiRequest("/publish/batch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    clip_paths: selectedClipsArray,
                    caption: caption,
                    targets: targets
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "Batch publish request failed");

            // Transition modal to State 2: Live Publishing Progress
            const formState = document.getElementById("publishFormState");
            const progressState = document.getElementById("publishProgressState");
            const liveTitle = document.getElementById("publishLiveClipTitle");
            const overallBadge = document.getElementById("publishOverallBadge");
            const progressList = document.getElementById("publishTargetsProgressList");

            if (formState) formState.style.display = "none";
            if (progressState) progressState.style.display = "flex";
            if (progressList) progressList.scrollTop = 0;
            if (liveTitle) liveTitle.textContent = `Batch Publishing: ${data.total_clips} clips across selected channels`;
            if (overallBadge) {
                overallBadge.className = "progress-status-badge processing";
                overallBadge.textContent = "Uploading...";
            }

            renderBatchPublishProgress(data);
            startBatchPublishPoller(data.batch_id);

            showToast("Batch publishing dispatched! Tracking live progress...", "success");
        } catch (err) {
            showToast("Batch publishing failed: " + err.message, "error");
        } finally {
            if (btn) btn.disabled = false;
        }
        return;
    }

    // Branch 2: Single Clip Publishing
    if (!state.modalVideoName) {
        showToast("No clip selected for publishing", "warning");
        return;
    }

    try {
        if (btn) btn.disabled = true;
        showToast("Initiating publishing job...", "info");

        const targets = accountIds.map(accId => {
            const acc = state.accounts.find(a => a.id === accId);
            return {
                account_id: accId,
                platform: acc ? acc.platform : "youtube",
                youtube_config: { title: state.modalVideoName.replace(".mp4", ""), description: caption },
                instagram_config: { caption: caption, share_to_feed: true },
                facebook_config: { title: state.modalVideoName.replace(".mp4", ""), description: caption, as_reel: true }
            };
        });

        // Use the proper endpoint /publish
        const res = await apiRequest("/publish", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                clip_path: state.modalVideoName,
                caption: caption,
                targets: targets
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Publish request failed");

        // Transition modal to State 2: Live Publishing Progress
        const formState = document.getElementById("publishFormState");
        const progressState = document.getElementById("publishProgressState");
        const liveTitle = document.getElementById("publishLiveClipTitle");
        const overallBadge = document.getElementById("publishOverallBadge");
        const progressList = document.getElementById("publishTargetsProgressList");

        if (formState) formState.style.display = "none";
        if (progressState) progressState.style.display = "flex";
        if (progressList) progressList.scrollTop = 0;
        if (liveTitle) liveTitle.textContent = `Publishing "${state.modalVideoName}"`;
        if (overallBadge) {
            overallBadge.className = "progress-status-badge processing";
            overallBadge.textContent = "Uploading...";
        }

        renderPublishTargetsProgress(data.targets || []);
        startPublishPoller(data.job_id);

        showToast("Publishing dispatched! Tracking live progress...", "success");
    } catch (err) {
        showToast("Publishing failed: " + err.message, "error");
    } finally {
        if (btn) btn.disabled = false;
    }
}

function startBatchPublishPoller(batchId) {
    if (state.publishPollerTimer) {
        clearInterval(state.publishPollerTimer);
    }

    state.publishPollerTimer = setInterval(async () => {
        try {
            const res = await apiRequest(`/publish/batch/${batchId}/status`);
            if (!res.ok) return;
            const batchJob = await res.json();

            renderBatchPublishProgress(batchJob);

            if (batchJob.all_done) {
                clearInterval(state.publishPollerTimer);
                state.publishPollerTimer = null;

                let allTargets = [];
                (batchJob.clips || []).forEach(c => {
                    allTargets = allTargets.concat(c.targets || []);
                });

                const hasFailure = allTargets.some(t => t.status === "failed");
                const hasSuccess = allTargets.some(t => t.status === "success");

                const overallBadge = document.getElementById("publishOverallBadge");
                if (overallBadge) {
                    if (hasSuccess && !hasFailure) {
                        overallBadge.className = "progress-status-badge completed";
                        overallBadge.textContent = "Batch Published ✅";
                    } else if (hasSuccess && hasFailure) {
                        overallBadge.className = "progress-status-badge processing";
                        overallBadge.textContent = "Partial Success";
                    } else {
                        overallBadge.className = "progress-status-badge cancelled";
                        overallBadge.textContent = "Failed ❌";
                    }
                }

                showToast(hasFailure ? "Batch publishing completed with some issues" : `All ${batchJob.total_clips} clips published successfully!`, hasFailure ? "warning" : "success");
                loadPublishHistory();
            }
        } catch (e) {
            console.error("Batch publish poll error:", e);
        }
    }, 1200);
}

function renderBatchPublishProgress(batchJob) {
    const list = document.getElementById("publishTargetsProgressList");
    if (!list) return;

    const clips = batchJob.clips || [];
    if (clips.length === 0) return;

    list.innerHTML = clips.map((clip, idx) => {
        const targets = clip.targets || [];
        const doneCount = targets.filter(t => t.status === "success" || t.status === "failed").length;

        const targetsHtml = targets.map(t => {
            const p = (t.platform || "youtube").toLowerCase();
            const icon = p === "youtube" ? "fa-brands fa-youtube" : p === "instagram" ? "fa-brands fa-instagram" : "fa-brands fa-facebook";
            const status = t.status || "queued";
            const progress = t.progress || 0;

            let statusPill = "";
            if (status === "uploading") {
                statusPill = `<span class="progress-status-badge processing"><i class="fa-solid fa-cloud-arrow-up fa-bounce"></i> Uploading ${progress}%</span>`;
            } else if (status === "success") {
                statusPill = `<span class="progress-status-badge completed"><i class="fa-solid fa-circle-check"></i> Published</span>`;
            } else if (status === "failed") {
                statusPill = `<span class="progress-status-badge cancelled"><i class="fa-solid fa-circle-xmark"></i> Failed</span>`;
            } else {
                statusPill = `<span class="progress-status-badge queued">Queued</span>`;
            }

            const linkHtml = t.url ? `
                <div style="margin-top: 8px;">
                    <a href="${t.url}" target="_blank" rel="noopener noreferrer" class="publish-live-link">
                        <i class="fa-solid fa-arrow-up-right-from-square"></i> Open Live on ${p.toUpperCase()}
                    </a>
                </div>
            ` : "";

            const errHtml = t.error ? `
                <div class="publish-err-msg">
                    <i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(t.error)}
                </div>
            ` : "";

            return `
                <div class="target-progress-card ${status}" style="margin-top: 8px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span class="platform-badge ${p}"><i class="${icon}"></i> ${escapeHtml(t.account_alias || p)}</span>
                            <span style="font-size: 11px; color: var(--text-muted); text-transform: capitalize;">${p}</span>
                        </div>
                        ${statusPill}
                    </div>
                    <div class="progress-track" style="height: 6px; margin: 4px 0;">
                        <div class="progress-bar-fill" style="width: ${progress}%;"></div>
                    </div>
                    ${linkHtml}
                    ${errHtml}
                </div>
            `;
        }).join("");

        return `
            <div class="batch-clip-progress-group">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                    <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; min-width: 0;">
                        <span style="background: var(--primary-glow); color: var(--primary-light); font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 4px;">#${idx + 1}</span>
                        <span style="font-weight: 700; color: #fff; font-size: 13px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${escapeHtml(clip.clip_name)}">${escapeHtml(clip.clip_name)}</span>
                    </div>
                    <span style="font-size: 11.5px; color: var(--text-muted); flex-shrink: 0;">${doneCount}/${targets.length} done</span>
                </div>
                ${targetsHtml}
            </div>
        `;
    }).join("");
}

function startPublishPoller(jobId) {
    if (state.publishPollerTimer) {
        clearInterval(state.publishPollerTimer);
    }

    state.publishPollerTimer = setInterval(async () => {
        try {
            const res = await apiRequest(`/publish/${jobId}/status`);
            if (!res.ok) return;
            const job = await res.json();

            renderPublishTargetsProgress(job.targets || []);

            if (job.all_done) {
                clearInterval(state.publishPollerTimer);
                state.publishPollerTimer = null;

                const hasFailure = (job.targets || []).some(t => t.status === "failed");
                const hasSuccess = (job.targets || []).some(t => t.status === "success");

                const overallBadge = document.getElementById("publishOverallBadge");
                if (overallBadge) {
                    if (hasSuccess && !hasFailure) {
                        overallBadge.className = "progress-status-badge completed";
                        overallBadge.textContent = "Published ✅";
                    } else if (hasSuccess && hasFailure) {
                        overallBadge.className = "progress-status-badge processing";
                        overallBadge.textContent = "Partial Success";
                    } else {
                        overallBadge.className = "progress-status-badge cancelled";
                        overallBadge.textContent = "Failed ❌";
                    }
                }

                showToast(hasFailure ? "Publishing finished with some issues" : "Published successfully to all channels!", hasFailure ? "warning" : "success");
                loadPublishHistory();
            }
        } catch (e) {
            console.error("Publish poll error:", e);
        }
    }, 1200);
}

function renderPublishTargetsProgress(targets) {
    const list = document.getElementById("publishTargetsProgressList");
    if (!list) return;

    list.innerHTML = targets.map(t => {
        const p = (t.platform || "youtube").toLowerCase();
        const icon = p === "youtube" ? "fa-brands fa-youtube" : p === "instagram" ? "fa-brands fa-instagram" : "fa-brands fa-facebook";
        const status = t.status || "queued";
        const progress = t.progress || 0;

        let statusPill = "";
        if (status === "uploading") {
            statusPill = `<span class="progress-status-badge processing"><i class="fa-solid fa-cloud-arrow-up fa-bounce"></i> Uploading ${progress}%</span>`;
        } else if (status === "success") {
            statusPill = `<span class="progress-status-badge completed"><i class="fa-solid fa-circle-check"></i> Published</span>`;
        } else if (status === "failed") {
            statusPill = `<span class="progress-status-badge cancelled"><i class="fa-solid fa-circle-xmark"></i> Failed</span>`;
        } else {
            statusPill = `<span class="progress-status-badge queued">Queued</span>`;
        }

        const linkHtml = t.url ? `
            <div style="margin-top: 8px;">
                <a href="${t.url}" target="_blank" rel="noopener noreferrer" class="publish-live-link">
                    <i class="fa-solid fa-arrow-up-right-from-square"></i> Open Live on ${p.toUpperCase()}
                </a>
            </div>
        ` : "";

        const errHtml = t.error ? `
            <div class="publish-err-msg">
                <i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(t.error)}
            </div>
        ` : "";

        return `
            <div class="target-progress-card ${status}">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="platform-badge ${p}"><i class="${icon}"></i> ${escapeHtml(t.account_alias || p)}</span>
                        <span style="font-size: 11px; color: var(--text-muted); text-transform: capitalize;">${p}</span>
                    </div>
                    ${statusPill}
                </div>
                <div class="progress-track" style="height: 6px; margin: 4px 0;">
                    <div class="progress-bar-fill" style="width: ${progress}%;"></div>
                </div>
                ${linkHtml}
                ${errHtml}
            </div>
        `;
    }).join("");
}

// ──────────────────────────────────────────────────────────────────────────────
// Phone Preview Modal
// ──────────────────────────────────────────────────────────────────────────────

function openPhoneModal(url, name) {
    const modal = document.getElementById("phoneModal");
    const video = document.getElementById("phoneModalVideo");
    const saveLink = document.getElementById("phoneModalSaveLink");
    state.modalVideoUrl = url;
    state.modalVideoName = name;

    if (video) {
        video.src = url;
        video.play().catch(() => {});
    }
    if (saveLink) {
        saveLink.href = url;
        saveLink.download = name;
    }
    if (modal) modal.classList.add("active");
}

function closePhoneModal() {
    const modal = document.getElementById("phoneModal");
    const video = document.getElementById("phoneModalVideo");
    if (video) video.pause();
    if (modal) modal.classList.remove("active");
}

// ──────────────────────────────────────────────────────────────────────────────
// Video Preview Fetching & Presets
// ──────────────────────────────────────────────────────────────────────────────

let previewDebounceTimer = null;
function initForm() {
    const urlInput = document.getElementById("urlInput");
    const clearBtn = document.getElementById("clearUrlBtn");

    if (urlInput) {
        urlInput.addEventListener("input", (e) => {
            clearTimeout(previewDebounceTimer);
            const val = e.target.value.trim();
            if (clearBtn) clearBtn.style.display = val ? "block" : "none";

            if (val.includes("youtube.com") || val.includes("youtu.be")) {
                previewDebounceTimer = setTimeout(() => fetchVideoDetails(val), 600);
            }
        });
    }

    const clipForm = document.getElementById("clipForm");
    if (clipForm) {
        clipForm.addEventListener("submit", (e) => {
            e.preventDefault();
            submitJob(false);
        });
    }
}

function clearUrlInput() {
    const urlInput = document.getElementById("urlInput");
    const clearBtn = document.getElementById("clearUrlBtn");
    const previewCard = document.getElementById("previewCard");

    if (urlInput) {
        urlInput.value = "";
        urlInput.focus();
    }
    if (clearBtn) clearBtn.style.display = "none";
    if (previewCard) previewCard.style.display = "none";
}

async function fetchVideoDetails(url) {
    const previewCard = document.getElementById("previewCard");
    const previewThumb = document.getElementById("previewThumb");
    const previewTitle = document.getElementById("previewTitle");
    const previewChannel = document.getElementById("previewChannel");
    const previewDuration = document.getElementById("previewDuration");
    const titleInput = document.getElementById("titleInput");

    try {
        const res = await apiRequest(`/api/preview?url=${encodeURIComponent(url)}`);
        if (!res.ok) return;
        const info = await res.json();
        state.currentPreviewData = info;

        if (previewCard) previewCard.style.display = "flex";
        if (previewThumb) previewThumb.src = info.thumbnail || "";
        if (previewTitle) previewTitle.textContent = info.title || "YouTube Video";
        if (previewChannel) previewChannel.textContent = info.channel || "";
        if (previewDuration) previewDuration.textContent = info.duration_formatted || "";

        if (titleInput && (!titleInput.value || titleInput.value === "My Best Highlights")) {
            titleInput.value = info.title || "My Best Highlights";
        }
    } catch (err) {
        console.warn("Could not fetch YouTube preview:", err);
    }
}

function selectStyle(style) {
    state.selectedStyle = style;
    const bBlur = document.getElementById("styleBlur");
    const bBlack = document.getElementById("styleBlack");
    if (bBlur) bBlur.classList.toggle("active", style === "blur");
    if (bBlack) bBlack.classList.toggle("active", style === "black");
}

function setClipLengthPreset(seconds) {
    const input = document.getElementById("clipLength");
    if (input) input.value = seconds;

    // Toggle active chip
    const chips = input?.closest(".form-group")?.querySelectorAll(".preset-chip");
    chips?.forEach(c => {
        c.classList.toggle("active", c.textContent.trim() === `${seconds}s`);
    });
}

function setMaxClipsPreset(count) {
    const input = document.getElementById("maxClips");
    if (input) input.value = count;

    // Toggle active chip
    const chips = input?.closest(".form-group")?.querySelectorAll(".preset-chip");
    chips?.forEach(c => {
        c.classList.toggle("active", c.textContent.trim() === `${count}`);
    });
}

// ──────────────────────────────────────────────────────────────────────────────
// Storage Pill
// ──────────────────────────────────────────────────────────────────────────────

async function initStoragePill() {
    try {
        const res = await apiRequest("/api/media/storage");
        if (!res.ok) return;
        const data = await res.json();
        const storageText = document.getElementById("headerStorageMb");
        if (storageText) {
            const mb = data.total_storage_mb ?? data.total_mb ?? 0;
            storageText.textContent = `${mb} MB`;
        }
    } catch (e) {}
}

// ──────────────────────────────────────────────────────────────────────────────
// Toast Notifications & Utilities
// ──────────────────────────────────────────────────────────────────────────────

function showToast(msg, type = "info") {
    let container = document.getElementById("toastContainer");
    if (!container) {
        container = document.createElement("div");
        container.id = "toastContainer";
        container.style.cssText = "position: fixed; bottom: 24px; right: 24px; z-index: 99999; display: flex; flex-direction: column; gap: 8px;";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    const bg = type === "error" ? "#ef4444" : type === "warning" ? "#f59e0b" : type === "success" ? "#10b981" : "#6366f1";
    toast.style.cssText = `background: ${bg}; color: #fff; padding: 12px 20px; border-radius: 10px; font-size: 13.5px; font-weight: 600; box-shadow: 0 10px 25px rgba(0,0,0,0.5); opacity: 0; transform: translateY(10px); transition: all 0.25s ease;`;
    toast.textContent = msg;

    container.appendChild(toast);
    requestAnimationFrame(() => {
        toast.style.opacity = "1";
        toast.style.transform = "translateY(0)";
    });

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(10px)";
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ──────────────────────────────────────────────────────────────────────────────
// SUBTITLE & CAPTION STUDIO LOGIC
// ──────────────────────────────────────────────────────────────────────────────

const subState = {
    clipName: "",
    clipUrl: "",
    cues: [],
    styles: {
        font_name: "Arial Black",
        font_size: 68,
        text_color: "#FFFFFF",
        outline_color: "#000000",
        outline_width: 4,
        position_preset: "bottom",
        margin_v: 220,
        text_transform: "uppercase",
        box_style: "none"
    },
    activeTab: "bulk"
};

async function openSubtitleModal(clipName, clipUrl) {
    subState.clipName = clipName;
    subState.clipUrl = clipUrl;
    subState.cues = [];

    const modal = document.getElementById("subtitlesModal");
    const video = document.getElementById("subModalVideo");
    const clipBadge = document.getElementById("subModalClipNameBadge");
    const banner = document.getElementById("subStatusBanner");

    if (clipBadge) clipBadge.textContent = clipName;
    if (banner) {
        banner.style.display = "block";
        banner.style.background = "rgba(99, 102, 241, 0.15)";
        banner.style.border = "1px solid rgba(99, 102, 241, 0.35)";
        banner.style.color = "#a5b4fc";
        banner.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Retrieving transcript and slicing subtitles...';
    }

    if (video) {
        video.src = clipUrl;
        video.currentTime = 0;
        video.load();
    }

    if (modal) modal.classList.add("active");
    switchSubTab("bulk");

    try {
        const res = await apiRequest(`/api/clips/${encodeURIComponent(clipName)}/subtitles`);
        if (!res.ok) throw new Error("Could not load subtitles from server");
        const data = await res.json();

        subState.cues = Array.isArray(data.cues) ? data.cues : [];
        if (data.styles && typeof data.styles === "object" && Object.keys(data.styles).length > 0) {
            subState.styles = { ...subState.styles, ...data.styles };
        }

        // Check banner notices
        if (banner) {
            if (subState.cues.length > 0) {
                banner.style.display = "none";
            } else if (data.has_groq_key === false) {
                banner.style.background = "rgba(245, 158, 11, 0.15)";
                banner.style.border = "1px solid rgba(245, 158, 11, 0.35)";
                banner.style.color = "#fcd34d";
                banner.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> <strong>Groq API Key Not Set:</strong> Add <code>GROQ_API_KEY</code> to your <code>.env</code> file to auto-transcribe in seconds. You can also manually add cues in the One-by-One tab.';
            } else {
                banner.style.background = "rgba(59, 130, 246, 0.15)";
                banner.style.border = "1px solid rgba(59, 130, 246, 0.35)";
                banner.style.color = "#93c5fd";
                banner.innerHTML = '<i class="fa-solid fa-info-circle"></i> No existing speech detected or parent video not yet transcribed. Click "Add Cue Line" in One-by-One Edit to type custom captions.';
            }
        }

        syncSubStyleControlsFromState();
        renderSubCuesList();
        updateSubOverlay();

    } catch (err) {
        console.error("Error opening subtitles:", err);
        if (banner) {
            banner.style.display = "block";
            banner.style.background = "rgba(239, 68, 68, 0.15)";
            banner.style.border = "1px solid rgba(239, 68, 68, 0.35)";
            banner.style.color = "#fca5a5";
            banner.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> Error loading subtitles: ${err.message}`;
        }
    }
}

function closeSubtitleModal() {
    const modal = document.getElementById("subtitlesModal");
    const video = document.getElementById("subModalVideo");
    if (video) video.pause();
    if (modal) modal.classList.remove("active");
}

function switchSubTab(tab) {
    subState.activeTab = tab;
    const btnBulk = document.getElementById("subTabBtnBulk");
    const btnCues = document.getElementById("subTabBtnCues");
    const panelBulk = document.getElementById("subTabBulk");
    const panelCues = document.getElementById("subTabCues");

    if (btnBulk) btnBulk.classList.toggle("active", tab === "bulk");
    if (btnCues) btnCues.classList.toggle("active", tab === "cues");
    if (panelBulk) panelBulk.style.display = tab === "bulk" ? "block" : "none";
    if (panelCues) panelCues.style.display = tab === "cues" ? "block" : "none";

    if (tab === "cues") {
        renderSubCuesList();
    }
}

function syncSubStyleControlsFromState() {
    const s = subState.styles;
    const elFont = document.getElementById("subFontName");
    const elSize = document.getElementById("subFontSize");
    const elSizeVal = document.getElementById("subFontSizeVal");
    const elColor = document.getElementById("subTextColor");
    const elColorHex = document.getElementById("subTextColorHex");
    const elOutline = document.getElementById("subOutlineColor");
    const elOutlineHex = document.getElementById("subOutlineColorHex");
    const elOutlineW = document.getElementById("subOutlineWidth");
    const elOutlineWVal = document.getElementById("subOutlineWidthVal");
    const elTrans = document.getElementById("subTextTransform");

    if (elFont) elFont.value = s.font_name || "Arial Black";
    if (elSize) elSize.value = s.font_size || 68;
    if (elSizeVal) elSizeVal.textContent = s.font_size || 68;
    if (elColor) elColor.value = s.text_color || "#FFFFFF";
    if (elColorHex) elColorHex.textContent = s.text_color || "#FFFFFF";
    if (elOutline) elOutline.value = s.outline_color || "#000000";
    if (elOutlineHex) elOutlineHex.textContent = s.outline_color || "#000000";
    if (elOutlineW) elOutlineW.value = s.outline_width !== undefined ? s.outline_width : 4;
    if (elOutlineWVal) elOutlineWVal.textContent = s.outline_width !== undefined ? s.outline_width : 4;
    if (elTrans) elTrans.value = s.text_transform || "uppercase";

    setSubPosition(s.position_preset || "bottom", false);
}

function applySubPreset(preset) {
    if (preset === "hormozi") {
        subState.styles.font_name = "Impact";
        subState.styles.font_size = 72;
        subState.styles.text_color = "#FFE500";
        subState.styles.outline_color = "#000000";
        subState.styles.outline_width = 5;
        subState.styles.position_preset = "bottom";
        subState.styles.text_transform = "uppercase";
    } else if (preset === "clean") {
        subState.styles.font_name = "Montserrat ExtraBold";
        subState.styles.font_size = 58;
        subState.styles.text_color = "#FFFFFF";
        subState.styles.outline_color = "#000000";
        subState.styles.outline_width = 2.5;
        subState.styles.position_preset = "bottom";
        subState.styles.text_transform = "title";
    } else if (preset === "neon") {
        subState.styles.font_name = "Impact";
        subState.styles.font_size = 70;
        subState.styles.text_color = "#22C55E";
        subState.styles.outline_color = "#000000";
        subState.styles.outline_width = 4.5;
        subState.styles.position_preset = "bottom";
        subState.styles.text_transform = "uppercase";
    } else if (preset === "cyan") {
        subState.styles.font_name = "Bebas Neue";
        subState.styles.font_size = 76;
        subState.styles.text_color = "#06B6D4";
        subState.styles.outline_color = "#000000";
        subState.styles.outline_width = 4.5;
        subState.styles.position_preset = "middle";
        subState.styles.text_transform = "uppercase";
    }
    syncSubStyleControlsFromState();
    updateSubOverlay();
    showToast(`Applied preset: ${preset.toUpperCase()}`);
}

function updateSubStyle(key, value) {
    subState.styles[key] = value;
    if (key === "text_color") {
        const hex = document.getElementById("subTextColorHex");
        if (hex) hex.textContent = value.toUpperCase();
    } else if (key === "outline_color") {
        const hex = document.getElementById("subOutlineColorHex");
        if (hex) hex.textContent = value.toUpperCase();
    }
    updateSubOverlay();
}

function setSubPosition(pos, updateOverlayNow = true) {
    subState.styles.position_preset = pos;
    const btnTop = document.getElementById("subPosTop");
    const btnMid = document.getElementById("subPosMiddle");
    const btnBot = document.getElementById("subPosBottom");

    if (btnTop) btnTop.classList.toggle("active", pos === "top");
    if (btnMid) btnMid.classList.toggle("active", pos === "middle");
    if (btnBot) btnBot.classList.toggle("active", pos === "bottom");

    if (updateOverlayNow) {
        updateSubOverlay();
    }
}

function updateSubOverlay() {
    const overlay = document.getElementById("subOverlayCaption");
    const video = document.getElementById("subModalVideo");
    if (!overlay) return;

    const s = subState.styles;
    const currentTime = video ? video.currentTime : 0;

    // Find active cue
    let activeCue = null;
    for (const cue of subState.cues) {
        if (currentTime >= cue.start && currentTime <= cue.end) {
            activeCue = cue;
            break;
        }
    }

    let textToShow = "";
    if (activeCue && activeCue.text) {
        textToShow = activeCue.text;
    } else if (subState.cues.length > 0) {
        // If between cues while paused, display closest or placeholder preview
        textToShow = subState.cues[0].text;
    } else {
        textToShow = "SUBTITLE PREVIEW";
    }

    if (s.text_transform === "uppercase") {
        textToShow = textToShow.toUpperCase();
    } else if (s.text_transform === "title") {
        textToShow = textToShow.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
    }

    overlay.textContent = textToShow;

    // Font family mapping
    let fontFam = s.font_name || "Arial Black";
    if (fontFam.includes("Impact")) fontFam = "Impact, Haettenschweiler, sans-serif";
    else if (fontFam.includes("Montserrat")) fontFam = "'Montserrat', sans-serif";
    else if (fontFam.includes("Bebas")) fontFam = "'Bebas Neue', sans-serif";
    else if (fontFam.includes("Roboto")) fontFam = "'Roboto', sans-serif";
    else fontFam = "'Arial Black', sans-serif";

    overlay.style.fontFamily = fontFam;
    overlay.style.fontWeight = "900";
    overlay.style.color = s.text_color || "#FFFFFF";

    // Outline / Stroke emulation for CSS overlay
    const strokeW = parseFloat(s.outline_width) || 3;
    const strokeC = s.outline_color || "#000000";
    overlay.style.textShadow = `
        -${strokeW}px -${strokeW}px 0 ${strokeC},
         ${strokeW}px -${strokeW}px 0 ${strokeC},
        -${strokeW}px  ${strokeW}px 0 ${strokeC},
         ${strokeW}px  ${strokeW}px 0 ${strokeC},
         0px ${strokeW + 1}px 4px rgba(0,0,0,0.8)
    `;

    // Scale font size down to preview window (roughly 1/3 of 1080p canvas)
    const previewScale = 0.32;
    const computedFontSize = Math.max(14, Math.round((parseInt(s.font_size) || 68) * previewScale));
    overlay.style.fontSize = `${computedFontSize}px`;

    // Positioning
    overlay.style.top = "auto";
    overlay.style.bottom = "auto";
    if (s.position_preset === "top") {
        overlay.style.top = "14%";
    } else if (s.position_preset === "middle") {
        overlay.style.top = "46%";
    } else {
        overlay.style.bottom = "12%";
    }
}

function toggleSubVideoPlay() {
    const video = document.getElementById("subModalVideo");
    const icon = document.getElementById("subPlayIcon");
    if (!video) return;

    if (video.paused) {
        video.play();
        if (icon) icon.className = "fa-solid fa-pause";
    } else {
        video.pause();
        if (icon) icon.className = "fa-solid fa-play";
    }
}

function onSubVideoSeek(val) {
    const video = document.getElementById("subModalVideo");
    if (!video || !video.duration) return;
    video.currentTime = (val / 100) * video.duration;
    updateSubOverlay();
}

function onSubVideoTimeUpdate() {
    const video = document.getElementById("subModalVideo");
    const seek = document.getElementById("subVideoSeek");
    const display = document.getElementById("subVideoTimeDisplay");

    if (video && video.duration) {
        const pct = (video.currentTime / video.duration) * 100;
        if (seek) seek.value = pct;

        const curMins = Math.floor(video.currentTime / 60);
        const curSecs = Math.floor(video.currentTime % 60);
        const totMins = Math.floor(video.duration / 60);
        const totSecs = Math.floor(video.duration % 60);
        if (display) {
            display.textContent = `${curMins}:${curSecs.toString().padStart(2, "0")} / ${totMins}:${totSecs.toString().padStart(2, "0")}`;
        }
    }

    updateSubOverlay();

    // Highlight active cue in One-by-One list
    if (subState.activeTab === "cues" && video) {
        const cards = document.querySelectorAll(".sub-cue-card");
        cards.forEach(card => {
            const start = parseFloat(card.dataset.start);
            const end = parseFloat(card.dataset.end);
            const isActive = video.currentTime >= start && video.currentTime <= end;
            card.classList.toggle("active-playback", isActive);
        });
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// ONE-BY-ONE CUE EDITING
// ──────────────────────────────────────────────────────────────────────────────

function renderSubCuesList() {
    const container = document.getElementById("subCuesListContainer");
    const countBadge = document.getElementById("subCuesCount");
    if (!container) return;

    if (countBadge) countBadge.textContent = subState.cues.length;

    if (subState.cues.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 30px 10px; color: var(--text-dim);">
                <i class="fa-solid fa-comment-slash" style="font-size: 28px; opacity: 0.5; margin-bottom: 8px;"></i>
                <p style="font-size: 13px;">No subtitle cues found. Click "+ Add Cue Line" to create one.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = subState.cues.map((cue, index) => {
        return `
            <div class="sub-cue-card" data-index="${index}" data-start="${cue.start}" data-end="${cue.end}">
                <div class="sub-cue-header">
                    <span style="font-weight: 700; color: #fff;">#${index + 1}</span>
                    <div class="sub-cue-timing-inputs">
                        <label style="font-size: 11px;">In:</label>
                        <input type="number" step="0.1" min="0" class="sub-cue-time-input" value="${cue.start}" onchange="onSubCueTimeChange(${index}, 'start', this.value)">
                        <label style="font-size: 11px;">Out:</label>
                        <input type="number" step="0.1" min="0" class="sub-cue-time-input" value="${cue.end}" onchange="onSubCueTimeChange(${index}, 'end', this.value)">
                        <button type="button" class="btn-secondary danger" style="padding: 3px 7px; font-size: 11px; margin-left: 6px;" onclick="deleteSubCue(${index})" title="Delete Cue">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </div>
                <textarea class="sub-cue-textarea" placeholder="Subtitle text..." oninput="onSubCueTextChange(${index}, this.value)">${escapeHtml(cue.text || "")}</textarea>
            </div>
        `;
    }).join("");
}

function onSubCueTimeChange(index, field, value) {
    if (!subState.cues[index]) return;
    subState.cues[index][field] = parseFloat(value) || 0.0;
    updateSubOverlay();
}

function onSubCueTextChange(index, value) {
    if (!subState.cues[index]) return;
    subState.cues[index].text = value;
    updateSubOverlay();
}

function addNewSubCue() {
    const video = document.getElementById("subModalVideo");
    const currentTime = video ? round2(video.currentTime) : 0.0;
    const newCue = {
        id: subState.cues.length,
        start: currentTime,
        end: round2(currentTime + 2.5),
        text: "New subtitle text"
    };
    subState.cues.push(newCue);
    subState.cues.sort((a, b) => a.start - b.start);
    renderSubCuesList();
    updateSubOverlay();
}

function deleteSubCue(index) {
    subState.cues.splice(index, 1);
    renderSubCuesList();
    updateSubOverlay();
}

function round2(num) {
    return Math.round(num * 100) / 100;
}

// ──────────────────────────────────────────────────────────────────────────────
// BULK TOOLS
// ──────────────────────────────────────────────────────────────────────────────

function shiftAllCues(seconds) {
    if (subState.cues.length === 0) return;
    for (const cue of subState.cues) {
        cue.start = Math.max(0, round2(cue.start + seconds));
        cue.end = Math.max(cue.start + 0.1, round2(cue.end + seconds));
    }
    renderSubCuesList();
    updateSubOverlay();
    showToast(`Shifted all captions by ${seconds > 0 ? "+" : ""}${seconds}s`);
}

function bulkFindAndReplace() {
    const findInput = document.getElementById("subFindInput");
    const replaceInput = document.getElementById("subReplaceInput");
    if (!findInput || !replaceInput) return;

    const findWord = findInput.value.trim();
    const replaceWord = replaceInput.value;
    if (!findWord) {
        alert("Please enter a word to find.");
        return;
    }

    let replacements = 0;
    const regex = new RegExp(findWord, "gi");
    for (const cue of subState.cues) {
        if (cue.text && regex.test(cue.text)) {
            cue.text = cue.text.replace(regex, replaceWord);
            replacements++;
        }
    }

    renderSubCuesList();
    updateSubOverlay();
    showToast(`Replaced occurrences in ${replacements} cues.`);
}

async function saveSubtitlesDraft(notify = true) {
    if (!subState.clipName) return;
    try {
        const res = await apiRequest(`/api/clips/${encodeURIComponent(subState.clipName)}/subtitles/save`, {
            method: "POST",
            body: JSON.stringify({
                cues: subState.cues,
                styles: subState.styles
            })
        });
        if (!res.ok) throw new Error("Server error saving draft");
        if (notify) showToast("Saved subtitle edits successfully!");
    } catch (err) {
        console.error("Save error:", err);
        if (notify) alert("Failed to save subtitles: " + err.message);
    }
}

function downloadSubtitles(format) {
    if (!subState.clipName) return;
    saveSubtitlesDraft(false);
    const downloadUrl = `/api/clips/${encodeURIComponent(subState.clipName)}/subtitles/download?format=${format}`;
    window.open(downloadUrl, "_blank");
}

async function executeBurnSubtitles() {
    if (!subState.clipName) return;
    if (subState.cues.length === 0) {
        alert("Cannot burn subtitles: There are no subtitle cues.");
        return;
    }

    const btn = document.getElementById("subBurnExecuteBtn");
    const btnText = document.getElementById("subBurnExecuteText");

    if (btn) btn.disabled = true;
    if (btnText) btnText.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Rendering Subtitles...';

    try {
        const res = await apiRequest(`/api/clips/${encodeURIComponent(subState.clipName)}/subtitles/burn`, {
            method: "POST",
            body: JSON.stringify({
                cues: subState.cues,
                styles: subState.styles,
                replace_original: false
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Burning failed");

        showToast(`Subtitles burned successfully! Created: ${data.filename}`);
        closeSubtitleModal();
        renderClips();

    } catch (err) {
        console.error("Burn error:", err);
        alert(`Failed to burn subtitles: ${err.message}`);
    } finally {
        if (btn) btn.disabled = false;
        if (btnText) btnText.innerHTML = '<i class="fa-solid fa-fire-flame-curved"></i> Burn to Video';
    }
}

