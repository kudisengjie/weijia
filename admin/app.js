(function() {
    var loginView = document.getElementById('loginView');
    var dashboardView = document.getElementById('dashboardView');
    var loginForm = document.getElementById('loginForm');
    var loginError = document.getElementById('loginError');
    var rangeSelect = document.getElementById('rangeSelect');
    var refreshBtn = document.getElementById('refreshBtn');
    var logoutBtn = document.getElementById('logoutBtn');
    var adminOpenHelp = document.getElementById('adminOpenHelp');
    var lastRefreshText = document.getElementById('lastRefreshText');
    var refreshTimer = null;

    function showDashboard() {
        if (adminOpenHelp) adminOpenHelp.classList.remove('visible');
        loginView.classList.add('hidden');
        dashboardView.classList.remove('hidden');
        loadLogs();
        startAutoRefresh();
    }

    function showLogin() {
        stopAutoRefresh();
        dashboardView.classList.add('hidden');
        loginView.classList.remove('hidden');
    }

    function startAutoRefresh() {
        stopAutoRefresh();
        refreshTimer = window.setInterval(loadLogs, 60000);
    }

    function stopAutoRefresh() {
        if (refreshTimer) window.clearInterval(refreshTimer);
        refreshTimer = null;
    }

    function updateRefreshText() {
        if (!lastRefreshText) return;
        lastRefreshText.textContent = '已实时查询 CLS：' + new Date().toLocaleString('zh-CN', { hour12: false }) + '，每 60 秒自动刷新。';
    }

    function offlineMessage() {
        return '当前是静态文件预览，登录需要启动后台服务：在 E:\\codex\\weijia 运行 node admin\\server.mjs，然后打开 http://localhost:8787/admin/。';
    }

    function disconnectedMessage() {
        return '后台服务未连接，请确认已启动 node admin\\server.mjs，或已在服务器部署 /api/admin 接口。';
    }

    function request(url, options) {
        if (window.location.protocol === 'file:') {
            return Promise.reject(new Error(offlineMessage()));
        }
        return fetch(url, Object.assign({
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
            credentials: 'same-origin'
        }, options || {})).catch(function(error) {
            if (error instanceof TypeError) {
                throw new Error(offlineMessage());
            }
            throw error;
        }).then(function(response) {
            return response.json().catch(function() {
                if (!response.ok) {
                    throw new Error(disconnectedMessage());
                }
                return {};
            }).then(function(body) {
                if (!response.ok) {
                    throw new Error(body.error || '请求失败');
                }
                return body;
            });
        });
    }

    function renderList(targetId, items, formatter) {
        var target = document.getElementById(targetId);
        target.innerHTML = '';
        if (!items.length) {
            target.innerHTML = '<p class="muted">暂无数据</p>';
            return;
        }
        items.forEach(function(item) {
            var row = document.createElement('div');
            row.className = 'list-row';
            row.innerHTML = formatter(item);
            target.appendChild(row);
        });
    }

    function loadLogs() {
        request('/api/admin/crawler-logs?range=' + encodeURIComponent(rangeSelect.value) + '&_=' + Date.now())
            .then(function(data) {
                var summary = data.summary || { windows: {}, crawlers: [], paths: [] };
                document.getElementById('metricToday').textContent = summary.windows.today || 0;
                document.getElementById('metricSeven').textContent = summary.windows.sevenDays || 0;
                document.getElementById('metricThirty').textContent = summary.windows.thirtyDays || 0;
                document.getElementById('metricSource').textContent = String(data.source || 'CLS').toUpperCase();
                renderList('crawlerList', summary.crawlers || [], function(item) {
                    return '<span>' + item.name + '</span><strong>' + item.count + '</strong>';
                });
                renderList('pathList', summary.paths || [], function(item) {
                    return '<span title="' + item.path + '">' + item.path + '</span><strong>' + item.count + '</strong>';
                });
                renderRows(data.logs || []);
                updateRefreshText();
            })
            .catch(function(error) {
                document.getElementById('emptyState').textContent = error.message;
                document.getElementById('emptyState').style.display = 'block';
            });
    }

    function renderRows(logs) {
        var tbody = document.getElementById('logRows');
        var empty = document.getElementById('emptyState');
        tbody.innerHTML = '';
        empty.style.display = logs.length ? 'none' : 'block';
        logs.slice(0, 80).forEach(function(log) {
            var tr = document.createElement('tr');
            tr.innerHTML = [
                '<td>' + (log.time || '') + '</td>',
                '<td><span class="crawler-pill">' + (log.crawlerName || 'Other') + '</span></td>',
                '<td>' + (log.status || '') + '</td>',
                '<td title="' + (log.path || '') + '">' + (log.path || '') + '</td>',
                '<td>' + (log.ipHash || '') + '</td>',
                '<td>' + (log.cacheStatus || '') + '</td>'
            ].join('');
            tbody.appendChild(tr);
        });
    }


    var togglePassword = document.getElementById('togglePassword');
    var passwordInput = document.getElementById('passwordInput');
    if (togglePassword && passwordInput) {
        togglePassword.addEventListener('click', function() {
            var show = passwordInput.type === 'password';
            passwordInput.type = show ? 'text' : 'password';
            togglePassword.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
        });
    }
    loginForm.addEventListener('submit', function(event) {
        event.preventDefault();
        loginError.textContent = '';
        if (adminOpenHelp) adminOpenHelp.classList.remove('visible');
        var form = new FormData(loginForm);
        request('/api/admin/login', {
            method: 'POST',
            body: JSON.stringify({
                username: form.get('username'),
                password: form.get('password'),
                remember: Boolean(form.get('remember'))
            })
        }).then(showDashboard).catch(function(error) {
            loginError.textContent = error.message;
            if (adminOpenHelp && (error.message.indexOf('静态文件预览') !== -1 || error.message.indexOf('后台服务未连接') !== -1)) {
                adminOpenHelp.classList.add('visible');
            }
        });
    });

    refreshBtn.addEventListener('click', loadLogs);
    rangeSelect.addEventListener('change', loadLogs);
    logoutBtn.addEventListener('click', function() {
        request('/api/admin/logout', { method: 'POST', body: '{}' }).finally(showLogin);
    });

    request('/api/admin/session').then(function(data) {
        if (data.authenticated) showDashboard();
        else showLogin();
    }).catch(showLogin);
})();
