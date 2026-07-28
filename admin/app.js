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
    var togglePassword = document.getElementById('togglePassword');
    var passwordInput = document.getElementById('passwordInput');
    var refreshTimer = null;
    var lastRefreshAt = null;

    var adminTranslations = {
        zh: {
            'page.title': 'GEO优化平台 - 爬虫日志后台',
            'brand': 'GEO优化平台',
            'login.hero.eyebrow': '欢迎使用',
            'login.hero.title': 'GEO优化全链路平台',
            'login.hero.subtitle': '智能知识体积累 · 行业高频问生成 · GEO内容生态与优化',
            'login.title': '用户登录',
            'login.username.label': '手机号 / 邮箱',
            'login.username.placeholder': '请输入手机号或邮箱',
            'login.password.label': '密码',
            'login.password.placeholder': '请输入密码',
            'login.password.show': '显示密码',
            'login.password.hide': '隐藏密码',
            'login.remember': '记住我',
            'login.forgot': '忘记密码?',
            'login.submit': '登录',
            'login.noAccount': '还没有账号?',
            'login.adminOnly': '仅限管理员访问',
            'login.localHelp': '本地查看请先运行：node admin/server.mjs，然后打开 http://localhost:8787/admin/',
            'dashboard.title': 'AI爬虫抓取数据管理后台',
            'dashboard.subtitle': '通过 EdgeOne / CLS 观察豆包、DeepSeek、元宝、百度等爬虫抓取官网页面的真实请求。',
            'dashboard.live.initial': '实时查询 CLS，登录后每 60 秒自动刷新。',
            'dashboard.live.updated': '已实时查询 CLS：{time}，每 60 秒自动刷新。',
            'dashboard.rangeLabel': '日志范围',
            'dashboard.refresh': '刷新',
            'dashboard.logout': '退出',
            'range.24h': '24小时',
            'range.7d': '7天',
            'range.30d': '30天',
            'metric.today': '今日抓取',
            'metric.seven': '7天抓取',
            'metric.thirty': '30天抓取',
            'metric.source': '数据源',
            'panel.crawlers': '爬虫分布',
            'panel.paths': '高频页面',
            'panel.recent': '最近请求',
            'table.time': '时间',
            'table.crawler': '爬虫',
            'table.status': '状态',
            'table.path': '路径',
            'table.ipHash': 'IP哈希',
            'table.cache': '缓存',
            'empty.noLogs': '暂无日志。请确认 EdgeOne 实时日志已投递到 CLS，并配置 TENCENT_CLS_TOPIC_ID。',
            'empty.noData': '暂无数据',
            'crawler.other': '其他',
            'message.offline': '当前是静态文件预览，登录需要启动后台服务：在 E:\\codex\\weijia 运行 node admin\\server.mjs，然后打开 http://localhost:8787/admin/。',
            'message.disconnected': '后台服务未连接，请确认已启动 node admin\\server.mjs，或已在服务器部署 /api/admin 接口。',
            'message.requestFailed': '请求失败'
        },
        en: {
            'page.title': 'GEO Optimization Platform - Crawler Log Admin',
            'brand': 'GEO Optimization Platform',
            'login.hero.eyebrow': 'Welcome',
            'login.hero.title': 'GEO Optimization Full-Funnel Platform',
            'login.hero.subtitle': 'Knowledge assets · Industry question generation · GEO content ecosystem',
            'login.title': 'User Login',
            'login.username.label': 'Phone / Email',
            'login.username.placeholder': 'Enter phone or email',
            'login.password.label': 'Password',
            'login.password.placeholder': 'Enter password',
            'login.password.show': 'Show password',
            'login.password.hide': 'Hide password',
            'login.remember': 'Remember me',
            'login.forgot': 'Forgot password?',
            'login.submit': 'Login',
            'login.noAccount': 'No account?',
            'login.adminOnly': 'Admin access only',
            'login.localHelp': 'Local preview: run node admin/server.mjs, then open http://localhost:8787/admin/',
            'dashboard.title': 'AI Crawler Data Management',
            'dashboard.subtitle': 'Inspect real website requests from Doubao, DeepSeek, Yuanbao, Baidu and other crawlers through EdgeOne / CLS.',
            'dashboard.live.initial': 'Live CLS query. Auto-refreshes every 60 seconds after login.',
            'dashboard.live.updated': 'CLS queried at {time}. Auto-refreshes every 60 seconds.',
            'dashboard.rangeLabel': 'Log range',
            'dashboard.refresh': 'Refresh',
            'dashboard.logout': 'Logout',
            'range.24h': '24 hours',
            'range.7d': '7 days',
            'range.30d': '30 days',
            'metric.today': 'Today',
            'metric.seven': '7 days',
            'metric.thirty': '30 days',
            'metric.source': 'Source',
            'panel.crawlers': 'Crawler Distribution',
            'panel.paths': 'Top Pages',
            'panel.recent': 'Recent Requests',
            'table.time': 'Time',
            'table.crawler': 'Crawler',
            'table.status': 'Status',
            'table.path': 'Path',
            'table.ipHash': 'IP Hash',
            'table.cache': 'Cache',
            'empty.noLogs': 'No logs yet. Confirm that EdgeOne real-time logs are delivered to CLS and TENCENT_CLS_TOPIC_ID is configured.',
            'empty.noData': 'No data',
            'crawler.other': 'Other',
            'message.offline': 'This is a static file preview. Login requires the admin service: run node admin\\server.mjs in E:\\codex\\weijia, then open http://localhost:8787/admin/.',
            'message.disconnected': 'The admin service is not connected. Start node admin\\server.mjs or deploy the /api/admin endpoint on your server.',
            'message.requestFailed': 'Request failed'
        }
    };

    var currentLang = localStorage.getItem('lang') === 'en' ? 'en' : 'zh';

    function t(key) {
        return (adminTranslations[currentLang] && adminTranslations[currentLang][key]) || adminTranslations.zh[key] || key;
    }

    function applyLanguage(lang) {
        currentLang = lang === 'en' ? 'en' : 'zh';
        localStorage.setItem('lang', currentLang);
        document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';
        document.title = t('page.title');

        document.querySelectorAll('[data-i18n]').forEach(function(el) {
            el.textContent = t(el.getAttribute('data-i18n'));
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
            el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
        });
        document.querySelectorAll('[data-i18n-aria]').forEach(function(el) {
            el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
        });
        document.querySelectorAll('[data-admin-lang-switch]').forEach(function(btn) {
            btn.textContent = currentLang === 'zh' ? 'English' : '中文';
        });
        syncPasswordToggleLabel();
        if (lastRefreshAt) {
            setRefreshText(lastRefreshAt);
        }
    }

    function setRefreshText(date) {
        if (!lastRefreshText) return;
        var locale = currentLang === 'zh' ? 'zh-CN' : 'en-US';
        var time = date.toLocaleString(locale, { hour12: false });
        lastRefreshText.textContent = t('dashboard.live.updated').replace('{time}', time);
    }

    function updateRefreshText() {
        lastRefreshAt = new Date();
        setRefreshText(lastRefreshAt);
    }

    function offlineMessage() {
        return t('message.offline');
    }

    function disconnectedMessage() {
        return t('message.disconnected');
    }

    function isConnectionMessage(message) {
        return message === offlineMessage() ||
            message === disconnectedMessage() ||
            message.indexOf('node admin') !== -1 ||
            message.indexOf('/api/admin') !== -1;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
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
                    throw new Error(body.error || t('message.requestFailed'));
                }
                return body;
            });
        });
    }

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

    function renderList(targetId, items, formatter) {
        var target = document.getElementById(targetId);
        target.innerHTML = '';
        if (!items.length) {
            target.innerHTML = '<p class="muted">' + escapeHtml(t('empty.noData')) + '</p>';
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
                    return '<span>' + escapeHtml(item.name) + '</span><strong>' + escapeHtml(item.count) + '</strong>';
                });
                renderList('pathList', summary.paths || [], function(item) {
                    return '<span title="' + escapeHtml(item.path) + '">' + escapeHtml(item.path) + '</span><strong>' + escapeHtml(item.count) + '</strong>';
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
            var crawlerName = log.crawlerName || t('crawler.other');
            tr.innerHTML = [
                '<td>' + escapeHtml(log.time) + '</td>',
                '<td><span class="crawler-pill">' + escapeHtml(crawlerName) + '</span></td>',
                '<td>' + escapeHtml(log.status) + '</td>',
                '<td title="' + escapeHtml(log.path) + '">' + escapeHtml(log.path) + '</td>',
                '<td>' + escapeHtml(log.ipHash) + '</td>',
                '<td>' + escapeHtml(log.cacheStatus) + '</td>'
            ].join('');
            tbody.appendChild(tr);
        });
    }

    function syncPasswordToggleLabel() {
        if (!togglePassword || !passwordInput) return;
        var show = passwordInput.type === 'password';
        togglePassword.setAttribute('aria-label', t(show ? 'login.password.show' : 'login.password.hide'));
    }

    if (togglePassword && passwordInput) {
        togglePassword.addEventListener('click', function() {
            var show = passwordInput.type === 'password';
            passwordInput.type = show ? 'text' : 'password';
            syncPasswordToggleLabel();
        });
    }

    document.querySelectorAll('[data-admin-lang-switch]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            applyLanguage(currentLang === 'zh' ? 'en' : 'zh');
        });
    });

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
            if (adminOpenHelp && isConnectionMessage(error.message)) {
                adminOpenHelp.classList.add('visible');
            }
        });
    });

    refreshBtn.addEventListener('click', loadLogs);
    rangeSelect.addEventListener('change', loadLogs);
    logoutBtn.addEventListener('click', function() {
        request('/api/admin/logout', { method: 'POST', body: '{}' }).finally(showLogin);
    });

    applyLanguage(currentLang);

    request('/api/admin/session').then(function(data) {
        if (data.authenticated) showDashboard();
        else showLogin();
    }).catch(showLogin);
})();