// Medblaze AI Portal Frontend Logic

// State management
let applications = [];
let activeTab = 'home';
let currentAppId = null;
let healthCheckInterval = null;
let systemStatsInterval = null;
let logsInterval = null;
let lastLogLength = 0;

// Application status map: 'online', 'starting', 'offline'
let appStatusMap = {};

// DOM Elements
const sidebarAppLinks = document.getElementById('sidebar-app-links');
const appCardsGrid = document.getElementById('appCardsGrid');
const appContainer = document.getElementById('appContainer');
const sidebar = document.getElementById('sidebar');
const pageTitle = document.getElementById('pageTitle');
const appIframe = document.getElementById('appIframe');
const appLoadingScreen = document.getElementById('appLoadingScreen');
const loadingAppTitle = document.getElementById('loadingAppTitle');
const progressBarFill = document.getElementById('progressBarFill');
const loadingLogText = document.getElementById('loadingLogText');
const themeToggleBtn = document.getElementById('themeToggleBtn');
const themeBtnIcon = document.getElementById('themeBtnIcon');

// 1. Initialize application
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    loadConfig();
    
    // Start health polling
    startHealthPolling();
    // Start diagnostics polling
    startDiagnosticsPolling();
    
    // Check url hash for deep linking
    handleHashRouting();
    window.addEventListener('hashchange', handleHashRouting);
});

// 2. Theme management
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
}

function updateThemeIcon(theme) {
    themeBtnIcon.textContent = theme === 'light' ? '🌙' : '☀️';
}

// 3. Load configurations
async function loadConfig() {
    try {
        const response = await fetch('portal_config.json');
        applications = await response.json();
        
        renderNavigation();
        renderHomeCards();
        updateSidebarStatusOverview();
    } catch (error) {
        console.error('Error loading portal configurations:', error);
        appendConsoleLog('[ERROR] Failed to load portal_config.json configurations.');
    }
}

// 4. Render UI components based on config
function renderNavigation() {
    sidebarAppLinks.innerHTML = '';
    applications.forEach(app => {
        const item = document.createElement('a');
        item.href = `#app-${app.id}`;
        item.className = 'menu-item';
        item.id = `nav-link-${app.id}`;
        
        // Icon and label
        item.innerHTML = `
            <span class="menu-icon">${app.icon}</span>
            <span>${app.name}</span>
        `;
        
        item.onclick = (e) => {
            e.preventDefault();
            launchApplication(app.id);
        };
        
        sidebarAppLinks.appendChild(item);
    });
}

function renderHomeCards() {
    appCardsGrid.innerHTML = '';
    applications.forEach(app => {
        const card = document.createElement('div');
        card.className = 'app-card';
        card.id = `app-card-${app.id}`;
        
        // Status Badge
        const statusHTML = app.placeholder 
            ? `<span class="badge badge-warning">Incoming</span>`
            : `<span class="badge badge-danger" id="badge-${app.id}">🔴 Offline</span>`;
            
        // Button
        const btnHTML = app.placeholder
            ? `<button class="btn btn-outline btn-sm" disabled>Coming Soon</button>`
            : `<button class="btn btn-primary btn-sm" onclick="launchApplication('${app.id}')">Open Application →</button>`;

        card.innerHTML = `
            <div class="app-card-header">
                <div class="app-card-icon">${app.icon}</div>
                ${statusHTML}
            </div>
            <div class="app-card-body">
                <h4 class="app-card-title">${app.name}</h4>
                <p class="app-card-desc">${app.description}</p>
            </div>
            <div class="app-card-footer">
                ${btnHTML}
            </div>
        `;
        
        appCardsGrid.appendChild(card);
    });
}

// 5. Sidebar Toggle
function toggleSidebar() {
    sidebar.classList.toggle('collapsed');
}

// 6. Navigation Tabs switching
function switchTab(tabId) {
    activeTab = tabId;
    currentAppId = null;
    
    // Update active nav links
    document.querySelectorAll('.sidebar-menu .menu-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // De-activate iframe source
    appIframe.src = 'about:blank';
    
    // Hide all views, display selected
    document.querySelectorAll('.view-section').forEach(section => {
        section.classList.remove('active');
    });
    
    if (tabId === 'home') {
        document.getElementById('view-home').classList.add('active');
        pageTitle.textContent = 'Home Dashboard';
        document.querySelector('a[href="#home"]').classList.add('active');
        window.location.hash = 'home';
    } else if (tabId === 'system') {
        document.getElementById('view-system').classList.add('active');
        pageTitle.textContent = 'System Status';
        document.querySelector('a[href="#system"]').classList.add('active');
        window.location.hash = 'system';
        fetchSystemStats();
    } else if (tabId === 'logs') {
        document.getElementById('view-logs').classList.add('active');
        pageTitle.textContent = 'Logs Console';
        document.querySelector('a[href="#logs"]').classList.add('active');
        window.location.hash = 'logs';
        fetchOrchestratorLogs();
    }
}

// 7. Dynamic hash routing helper
function handleHashRouting() {
    const hash = window.location.hash || '#home';
    if (hash === '#home') {
        switchTab('home');
    } else if (hash === '#system') {
        switchTab('system');
    } else if (hash === '#logs') {
        switchTab('logs');
    } else if (hash.startsWith('#app-')) {
        const appId = hash.replace('#app-', '');
        launchApplication(appId);
    }
}

// 8. Launch & Manage Iframe Applications (Lazy Load with Sequence Animation)
async function launchApplication(appId) {
    const app = applications.find(a => a.id === appId);
    if (!app || app.placeholder) return;
    
    currentAppId = appId;
    activeTab = `app-${appId}`;
    window.location.hash = `app-${appId}`;
    
    // Update active navigation state
    document.querySelectorAll('.sidebar-menu .menu-item').forEach(item => {
        item.classList.remove('active');
    });
    const activeLink = document.getElementById(`nav-link-${appId}`);
    if (activeLink) activeLink.classList.add('active');
    
    // Switch view
    document.querySelectorAll('.view-section').forEach(section => {
        section.classList.remove('active');
    });
    document.getElementById('view-app-workspace').classList.add('active');
    pageTitle.textContent = app.name;
    
    // Set up loading animations
    appLoadingScreen.style.display = 'flex';
    appLoadingScreen.style.opacity = '1';
    loadingAppTitle.textContent = `Starting ${app.name}`;
    progressBarFill.style.width = '0%';
    
    // Sequence loading logs
    let progress = 0;
    const logs = [
        'Preparing isolated Python workspace...',
        'Loading application configuration...',
        'Checking server connection status...',
        'Syncing Streamlit runtime parameters...',
        'Establishing secure handshake...',
        'Launching Streamlit canvas...'
    ];
    
    const sequenceInterval = setInterval(() => {
        if (progress < 95) {
            progress += Math.floor(Math.random() * 15) + 5;
            if (progress > 95) progress = 95;
            progressBarFill.style.width = `${progress}%`;
            
            const logIdx = Math.floor((progress / 100) * logs.length);
            loadingLogText.textContent = logs[Math.min(logIdx, logs.length - 1)];
        }
    }, 400);
    
    // Check health status to determine loading end
    const checkState = async () => {
        const isOnline = await checkSingleAppHealth(app);
        if (isOnline) {
            clearInterval(sequenceInterval);
            progressBarFill.style.width = '100%';
            loadingLogText.textContent = 'Connected successfully!';
            
            setTimeout(() => {
                // Set Iframe src
                const targetUrl = `${window.location.protocol}//${window.location.hostname}:${app.port}/`;
                if (appIframe.src !== targetUrl) {
                    appIframe.src = targetUrl;
                }
                
                // Hide loading screen
                appLoadingScreen.style.opacity = '0';
                setTimeout(() => {
                    appLoadingScreen.style.display = 'none';
                }, 300);
            }, 300);
        } else {
            // Keep checking
            setTimeout(checkState, 1500);
        }
    };
    
    checkState();
}

// 9. Fullscreen management
function toggleFullscreen() {
    appContainer.classList.toggle('fullscreen');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    
    if (appContainer.classList.contains('fullscreen')) {
        fullscreenBtn.innerHTML = `<span class="btn-icon">↙</span><span class="btn-text">Exit Full Screen</span>`;
        // Append floating Exit button if not exists
        if (!document.getElementById('fullscreenExitBtn')) {
            const exitBtn = document.createElement('button');
            exitBtn.id = 'fullscreenExitBtn';
            exitBtn.className = 'btn btn-primary';
            exitBtn.innerHTML = 'Exit Full Screen';
            exitBtn.onclick = toggleFullscreen;
            document.body.appendChild(exitBtn);
        }
    } else {
        fullscreenBtn.innerHTML = `<span class="btn-icon">⛶</span><span class="btn-text">Full Screen</span>`;
        const exitBtn = document.getElementById('fullscreenExitBtn');
        if (exitBtn) exitBtn.remove();
    }
}

// 10. Polling application health and process API
async function startHealthPolling() {
    healthCheckInterval = setInterval(checkAllAppsHealth, 3000);
    checkAllAppsHealth(); // immediate check
}

async function checkAllAppsHealth() {
    try {
        const response = await fetch('/api/status');
        if (!response.ok) throw new Error('API down');
        
        const data = await response.json();
        
        applications.forEach(app => {
            if (app.placeholder) return;
            
            const appInfo = data.find(d => d.id === app.id);
            const status = appInfo ? appInfo.status : 'offline';
            
            const prevStatus = appStatusMap[app.id];
            appStatusMap[app.id] = status;
            
            // Auto reload iframe if state changed from offline/starting to online
            if (currentAppId === app.id && status === 'online' && (prevStatus === 'offline' || prevStatus === 'starting' || !prevStatus)) {
                const targetUrl = `${window.location.protocol}//${window.location.hostname}:${app.port}/`;
                if (appIframe.src === 'about:blank' || appIframe.src === '') {
                    appIframe.src = targetUrl;
                }
            }
            
            updateStatusUI(app.id, status);
        });
        
        updateSidebarStatusOverview();
        updateSystemProcessTable(data);
    } catch (error) {
        console.error('Error in health checking:', error);
        // Set all to offline
        applications.forEach(app => {
            if (app.placeholder) return;
            appStatusMap[app.id] = 'offline';
            updateStatusUI(app.id, 'offline');
        });
        updateSidebarStatusOverview();
    }
}

async function checkSingleAppHealth(app) {
    try {
        const res = await fetch(`/api/status`);
        if (!res.ok) return false;
        const data = await res.json();
        const appInfo = data.find(d => d.id === app.id);
        return appInfo && appInfo.status === 'online';
    } catch (e) {
        return false;
    }
}

function updateStatusUI(appId, status) {
    const badge = document.getElementById(`badge-${appId}`);
    if (!badge) return;
    
    badge.className = 'badge';
    if (status === 'online') {
        badge.classList.add('badge-success');
        badge.innerHTML = '🟢 Online';
    } else if (status === 'starting') {
        badge.classList.add('badge-warning');
        badge.innerHTML = '🟡 Starting...';
    } else {
        badge.classList.add('badge-danger');
        badge.innerHTML = '🔴 Offline';
    }
}

function updateSidebarStatusOverview() {
    const sidebarStatusGrid = document.getElementById('status-grid-sidebar');
    if (!sidebarStatusGrid) return;
    
    sidebarStatusGrid.innerHTML = '';
    
    // Add App health entries
    applications.forEach(app => {
        if (app.placeholder) return;
        
        const status = appStatusMap[app.id] || 'offline';
        const item = document.createElement('div');
        item.className = 'status-item';
        
        item.innerHTML = `
            <span class="status-name">${app.icon} ${app.name}</span>
            <span class="status-badge-dot ${status}" title="${status}"></span>
        `;
        sidebarStatusGrid.appendChild(item);
    });
    
    // Add Environment health details
    const pyItem = document.createElement('div');
    pyItem.className = 'status-item';
    pyItem.innerHTML = `
        <span class="status-name">🐍 Python runtime</span>
        <span class="status-badge-dot online" title="Active"></span>
    `;
    sidebarStatusGrid.appendChild(pyItem);
}

// 11. System diagnostics & processes table
function startDiagnosticsPolling() {
    systemStatsInterval = setInterval(fetchSystemStats, 4000);
    logsInterval = setInterval(fetchOrchestratorLogs, 3000);
}

async function fetchSystemStats() {
    try {
        const response = await fetch('/api/system');
        if (!response.ok) return;
        const data = await response.json();
        
        // Update UI metrics
        document.getElementById('sys-cpu').textContent = `${data.cpu}%`;
        document.getElementById('cpuBar').style.width = `${data.cpu}%`;
        
        document.getElementById('sys-mem').textContent = `${data.memory}%`;
        document.getElementById('memBar').style.width = `${data.memory}%`;
        
        document.getElementById('sys-pyver').textContent = data.python_version;
        document.getElementById('sys-port').textContent = data.portal_port || '8500';
    } catch (e) {
        console.error('Failed to fetch system stats:', e);
    }
}

function updateSystemProcessTable(data) {
    const tableBody = document.getElementById('system-process-table');
    if (!tableBody || activeTab !== 'system') return;
    
    tableBody.innerHTML = '';
    data.forEach(proc => {
        const tr = document.createElement('tr');
        
        const statusClass = proc.status === 'online' ? 'badge-success' : (proc.status === 'starting' ? 'badge-warning' : 'badge-danger');
        
        tr.innerHTML = `
            <td><strong>${proc.name}</strong></td>
            <td><code>${proc.port}</code></td>
            <td><code>/${proc.folder}</code></td>
            <td><code>${proc.pid || 'N/A'}</code></td>
            <td><span class="badge ${statusClass}">${proc.status}</span></td>
            <td>
                <button class="btn btn-outline btn-sm" onclick="controlProcess('${proc.id}', 'restart')" ${proc.status === 'offline' ? 'disabled' : ''}>
                    🔄 Restart
                </button>
            </td>
        `;
        tableBody.appendChild(tr);
    });
}

async function controlProcess(appId, action) {
    try {
        appendConsoleLog(`[PORTAL] Sending control command: ${action} to ${appId}`);
        const response = await fetch(`/api/control?app=${appId}&action=${action}`, { method: 'POST' });
        if (response.ok) {
            appendConsoleLog(`[PORTAL] Command executed successfully for ${appId}`);
            checkAllAppsHealth();
        } else {
            appendConsoleLog(`[ERROR] Command failed for ${appId}`);
        }
    } catch (err) {
        appendConsoleLog(`[ERROR] Control request failed: ${err.message}`);
    }
}

// 12. Orchestrator live logging console streaming
async function fetchOrchestratorLogs() {
    try {
        const response = await fetch('/api/logs');
        if (!response.ok) return;
        const text = await response.text();
        
        const consoleOutput = document.getElementById('logConsoleOutput');
        if (consoleOutput) {
            consoleOutput.textContent = text;
            // Scroll to bottom if new content added
            if (text.length > lastLogLength) {
                const consoleContainer = consoleOutput.parentElement;
                consoleContainer.scrollTop = consoleContainer.scrollHeight;
                lastLogLength = text.length;
            }
        }
    } catch (e) {
        console.error('Failed to fetch logs:', e);
    }
}

function clearConsoleLog() {
    fetch('/api/logs?clear=true', { method: 'POST' })
        .then(() => {
            document.getElementById('logConsoleOutput').textContent = '';
            lastLogLength = 0;
        });
}

function appendConsoleLog(message) {
    const consoleOutput = document.getElementById('logConsoleOutput');
    if (consoleOutput) {
        const timeStr = new Date().toLocaleTimeString();
        consoleOutput.textContent += `[${timeStr}] ${message}\n`;
        const consoleContainer = consoleOutput.parentElement;
        consoleContainer.scrollTop = consoleContainer.scrollHeight;
    }
}
