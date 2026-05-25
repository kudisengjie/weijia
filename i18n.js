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
        }
        this.bindSwitcher();
    },

    bindSwitcher: function() {
        var self = this;
        var btn = document.querySelector('.lang-switch');
        if (btn) {
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                var newLang = self.currentLang === 'zh' ? 'en' : 'zh';
                self.switchLang(newLang);
            });
        }
    },

    switchLang: function(lang) {
        this.currentLang = lang;
        localStorage.setItem('lang', lang);

        var btn = document.querySelector('.lang-switch');
        if (btn) {
            btn.textContent = lang === 'zh' ? 'EN' : '中文';
        }

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

i18n.translations.zh = {};

i18n.translations.en = {
    'nav.home': 'Home',
    'nav.about': 'About',
    'nav.blog': 'Blog',
    'nav.geo': 'GEO Guide',
    'nav.cases': 'Cases',
    'nav.faq': 'FAQ',
    'nav.lang': 'EN',

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
