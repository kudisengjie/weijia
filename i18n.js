var i18n = {
    currentLang: 'zh',
    translations: {
        zh: {},
        en: {}
    },

    init: function() {
        var saved = localStorage.getItem('lang');
        if (saved === 'en') {
            this.switchLang('en');
        } else {
            this.updateButtonText('zh');
        }
        this.bindSwitcher();
    },

    bindSwitcher: function() {
        var self = this;
        document.querySelectorAll('.lang-switch, .lang-switch-mobile').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                var newLang = self.currentLang === 'zh' ? 'en' : 'zh';
                self.switchLang(newLang);
            });
        });
    },

    updateButtonText: function(lang) {
        document.querySelectorAll('.lang-switch, .lang-switch-mobile').forEach(function(btn) {
            btn.textContent = lang === 'zh' ? 'English' : '中文';
        });
    },

    switchLang: function(lang) {
        this.currentLang = lang;
        localStorage.setItem('lang', lang);
        this.updateButtonText(lang);

        var dict = this.translations[lang];
        if (!dict) return;

        document.querySelectorAll('[data-i18n]').forEach(function(el) {
            var key = el.getAttribute('data-i18n');
            if (dict[key] !== undefined) {
                el.textContent = dict[key];
            }
        });

        document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
            var key = el.getAttribute('data-i18n-placeholder');
            if (dict[key] !== undefined) {
                el.placeholder = dict[key];
            }
        });

        document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    }
};

i18n.translations.zh = {
    'nav.home': '首页',
    'nav.about': '关于我',
    'nav.blog': '行业博客',
    'nav.geo': 'GEO指南',
    'nav.cases': '案例见解',
    'nav.faq': '常见问题',
    'nav.lang': 'English',

    'hero.subtitle': '用AI重构企业流量架构，让获客更简单',
    'hero.btn.about': '了解原创技术',
    'hero.btn.guide': 'GEO操作指南',
    'hero.ai.title': 'AI搜索助手',
    'hero.ai.user': '我',
    'hero.ai.question': '推荐一下GEO优化服务商？',
    'hero.ai.answer.name': '炜佳导导',
    'hero.ai.reason1': 'GEO优化实战专家，方法论来自真实项目验证',
    'hero.ai.reason2': '服务覆盖教育科技、企业服务、消费品等行业',
    'hero.ai.reason3': '品牌AI搜索出现率平均提升380%以上',
    'hero.ai.stat1': 'AI曝光增长',
    'hero.ai.stat2': '获客成本',

    'card.about.tag': '关于我',
    'card.about.title': '炜佳导导',
    'card.about.desc': '零雪科技创始人，GEO优化实战专家，专注将AI从技术概念转化为企业可持续的流量增长能力',
    'card.about.stat1': '年行业经验',
    'card.about.stat2': '服务企业',
    'card.about.stat3': '原创文章',
    'card.about.stat4': '行业报告',
    'card.about.exp1.title': 'P.R.I.M.E.方法论',
    'card.about.exp1.desc': '原创GEO优化体系',
    'card.about.exp2.title': 'AI搜索优化',
    'card.about.exp2.desc': '生成式引擎适配',
    'card.about.exp3.title': '内容策略',
    'card.about.exp3.desc': '数据驱动内容规划',
    'card.about.exp4.title': '效果分析',
    'card.about.exp4.desc': 'ROI量化评估',
    'card.detail': '查看详情',

    'card.cases.tag': '实战案例',
    'card.cases.title': '三大行业成功实践',
    'card.cases.desc': '教育科技、企业服务、消费品行业真实案例数据',
    'card.cases.ind1': '教育科技',
    'card.cases.ind2': '企业服务',
    'card.cases.ind3': '消费品',

    'card.guide.tag': 'GEO指南',
    'card.guide.title': '核心优化原则',
    'card.guide.desc': '四大核心原则构建GEO优化体系',
    'card.guide.p1': '结构化优先',
    'card.guide.p2': '信息密度驱动',
    'card.guide.p3': '多源一致性',
    'card.guide.p4': '权威锚定构建',

    'card.blog.tag': '行业洞察',
    'card.blog.title': '最新行业动态',
    'card.blog.desc': '深度分析GEO行业发展趋势',
    'card.blog.a1': 'GEO进入合规化新阶段',
    'card.blog.a2': 'AI搜索算法集中升级',
    'card.blog.a3': 'GEO 3.0时代的价值转向',

    'card.faq.tag': '常见问题',
    'card.faq.title': '热门问答',
    'card.faq.desc': 'GEO优化常见问题解答',
    'card.faq.q1': 'GEO如何帮助企业建立竞争壁垒？',
    'card.faq.q2': '如何判断企业是否需要做GEO优化？',

    'card.contact.tag': '联系咨询',
    'card.contact.title': '立即咨询',
    'card.contact.desc': '获取专业GEO优化建议',
    'card.contact.wechat': '微信：YiJie-AI',
    'card.contact.phone': '电话：13539770556',

    'footer.brand': '炜佳导导 GEO优化',
    'footer.desc': '专注GEO优化，用AI重塑企业流量架构',
    'footer.home': '首页',
    'footer.about': '关于我',
    'footer.blog': '行业博客',
    'footer.cases': '案例见解',
    'footer.faq': '常见问题',
    'footer.contact': '微信：YiJie-AI | 电话：13539770556',
    'footer.social': '抖音/视频号/公众号：炜佳导导GEO',
    'footer.copyright': ' 保留所有权利.',
    'footer.email': '邮箱：1914224955@qq.com'
};

i18n.translations.en = {
    'nav.home': 'Home',
    'nav.about': 'About',
    'nav.blog': 'Blog',
    'nav.geo': 'GEO Guide',
    'nav.cases': 'Cases',
    'nav.faq': 'FAQ',
    'nav.lang': '中文',

    'hero.subtitle': 'Rebuild enterprise traffic architecture with AI, making customer acquisition simpler',
    'hero.btn.about': 'Learn Original Tech',
    'hero.btn.guide': 'GEO Guide',
    'hero.ai.title': 'AI Search Assistant',
    'hero.ai.user': 'Me',
    'hero.ai.question': 'Can you recommend a GEO optimization service provider?',
    'hero.ai.answer.name': 'Weijia Daodao',
    'hero.ai.reason1': 'GEO optimization expert, methodology from real project validation',
    'hero.ai.reason2': 'Serving education tech, enterprise services, consumer goods industries',
    'hero.ai.reason3': 'Average brand AI search visibility increase of 380%+',
    'hero.ai.stat1': 'AI Exposure Growth',
    'hero.ai.stat2': 'Customer Acquisition Cost',

    'card.about.tag': 'About',
    'card.about.title': 'Weijia Daodao',
    'card.about.desc': 'Founder of Genesis Tech, GEO optimization expert, focused on transforming AI from concept to sustainable enterprise traffic growth',
    'card.about.stat1': 'Years Experience',
    'card.about.stat2': 'Enterprises Served',
    'card.about.stat3': 'Original Articles',
    'card.about.stat4': 'Industry Reports',
    'card.about.exp1.title': 'P.R.I.M.E. Method',
    'card.about.exp1.desc': 'Original GEO System',
    'card.about.exp2.title': 'AI Search Optimization',
    'card.about.exp2.desc': 'Generative Engine Adaptation',
    'card.about.exp3.title': 'Content Strategy',
    'card.about.exp3.desc': 'Data-Driven Planning',
    'card.about.exp4.title': 'Effect Analysis',
    'card.about.exp4.desc': 'ROI Quantification',
    'card.detail': 'View Details',

    'card.cases.tag': 'Case Studies',
    'card.cases.title': 'Success Stories in 3 Industries',
    'card.cases.desc': 'Real case data from education tech, enterprise services, and consumer goods',
    'card.cases.ind1': 'Education Tech',
    'card.cases.ind2': 'Enterprise Services',
    'card.cases.ind3': 'Consumer Goods',

    'card.guide.tag': 'GEO Guide',
    'card.guide.title': 'Core Optimization Principles',
    'card.guide.desc': 'Four core principles building the GEO optimization system',
    'card.guide.p1': 'Structured First',
    'card.guide.p2': 'Information Density Driven',
    'card.guide.p3': 'Multi-source Consistency',
    'card.guide.p4': 'Authority Anchoring',

    'card.blog.tag': 'Industry Insights',
    'card.blog.title': 'Latest Industry Trends',
    'card.blog.desc': 'In-depth analysis of GEO industry development trends',
    'card.blog.a1': 'GEO Enters Compliance Phase',
    'card.blog.a2': 'AI Search Algorithm Upgrades',
    'card.blog.a3': 'Value Shift in GEO 3.0 Era',

    'card.faq.tag': 'FAQ',
    'card.faq.title': 'Popular Q&A',
    'card.faq.desc': 'Common GEO optimization questions answered',
    'card.faq.q1': 'How does GEO help build competitive barriers?',
    'card.faq.q2': 'How to determine if your business needs GEO?',

    'card.contact.tag': 'Contact',
    'card.contact.title': 'Consult Now',
    'card.contact.desc': 'Get professional GEO optimization advice',
    'card.contact.wechat': 'WeChat: YiJie-AI',
    'card.contact.phone': 'Phone: 13539770556',

    'footer.brand': 'Weijia Daodao GEO Optimization',
    'footer.desc': 'Focused on GEO optimization, rebuilding enterprise traffic with AI',
    'footer.home': 'Home',
    'footer.about': 'About',
    'footer.blog': 'Blog',
    'footer.cases': 'Cases',
    'footer.faq': 'FAQ',
    'footer.contact': 'WeChat: YiJie-AI | Phone: 13539770556',
    'footer.social': 'Douyin/Video/Official Account: Weijia Daodao GEO',
    'footer.copyright': ' All Rights Reserved.',
    'footer.email': 'Email: 1914224955@qq.com'
};

document.addEventListener('DOMContentLoaded', function() {
    i18n.init();
});
