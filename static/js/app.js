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
    loadAccounts();
    loadJobsList();
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
        loadJobsList();
    } else if (viewName === "library") {
        loadClips();
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
        if (pct >= 20) pDownload.className = "step-pill done";
        else if (pct >= 10) pDownload.className = "step-pill active";
        else pDownload.className = "step-pill";
    }
    if (pSlice) {
        if (pct >= 95) pSlice.className = "step-pill done";
        else if (pct >= 20) pSlice.className = "step-pill active";
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
// Clips Library
// ──────────────────────────────────────────────────────────────────────────────

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

        if (clips.length === 0) {
            grid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-muted);">
                    <div style="font-size: 42px; margin-bottom: 12px; opacity: 0.5;"><i class="fa-solid fa-film"></i></div>
                    <h3 style="color: #fff; margin-bottom: 6px;">No Clips Generated Yet</h3>
                    <p style="font-size: 13.5px; margin-bottom: 18px;">Paste a YouTube link in the Studio tab to generate vertical 9:16 reels.</p>
                    <button class="btn-primary" onclick="switchView('studio')"><i class="fa-solid fa-wand-magic-sparkles"></i> Open Studio</button>
                </div>
            `;
            return;
        }

        grid.innerHTML = clips.map((clip) => {
            const url = clip.url || `/media/clips/${encodeURIComponent(clip.name)}`;
            const sizeMb = clip.size_bytes ? (clip.size_bytes / (1024 * 1024)).toFixed(1) + " MB" : "";

            return `
                <div class="clip-card">
                    <div class="clip-thumb-wrap" onclick="openPhoneModal('${url}', '${escapeHtml(clip.name)}')">
                        <video src="${url}" preload="metadata" muted playsinline></video>
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
                            <span style="color: var(--accent-emerald); font-weight: 600;"><i class="fa-solid fa-circle-check"></i> Ready</span>
                        </div>
                        <div class="clip-actions-row">
                            <a href="${url}" download="${clip.name}" class="btn-secondary" style="flex: 1; padding: 7px 10px; font-size: 12px;">
                                <i class="fa-solid fa-download"></i> Save
                            </a>
                            <button type="button" class="btn-primary" style="flex: 1.2; padding: 7px 12px; font-size: 12px;" onclick="openSinglePublishModal('${escapeHtml(clip.name)}', '${url}')">
                                <i class="fa-solid fa-rocket"></i> Publish
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join("");

    } catch (err) {
        console.error("Failed to load clips:", err);
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
    const modal = document.getElementById("publishModal");
    const title = document.getElementById("publishModalTitleText");
    const video = document.getElementById("publishModalVideo");
    const badge = document.getElementById("publishClipBadge");
    const captionInput = document.getElementById("publishCaptionInput");

    state.modalVideoName = clipName;
    state.modalVideoUrl = clipUrl;

    if (title) title.textContent = "Publish Clip to Social Media";
    if (video) video.src = clipUrl;
    if (badge) badge.textContent = clipName;
    if (captionInput) captionInput.value = clipName.replace(".mp4", "").replace(/_/g, " ") + " #viral #reels #shorts";

    loadAccounts();
    if (modal) modal.classList.add("active");
}

function closePublishModal() {
    const modal = document.getElementById("publishModal");
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
                clip_path: `data/clips/my_clips/${state.modalVideoName}`,
                caption: caption,
                targets: targets
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Publish request failed");

        closePublishModal();
        showToast("Publishing dispatched! Check your social channels shortly.", "success");
    } catch (err) {
        showToast("Publishing failed: " + err.message, "error");
    } finally {
        if (btn) btn.disabled = false;
    }
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
            storageText.textContent = `${data.total_mb || 0} MB`;
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
