var menuToggle = document.querySelector('.menu-toggle');
var navLinks = document.querySelector('.nav-links');

if (menuToggle) {
    menuToggle.addEventListener('click', function() {
        this.classList.toggle('active');
        navLinks.classList.toggle('active');
    });

    document.querySelectorAll('.nav-links a').forEach(function(link) {
        link.addEventListener('click', function() {
            menuToggle.classList.remove('active');
            navLinks.classList.remove('active');
        });
    });
}

document.querySelectorAll('a[href^="#"]').forEach(function(anchor) {
    anchor.addEventListener('click', function (e) {
        var targetId = this.getAttribute('href');
        if (targetId === '#' || targetId.length < 2) return;
        e.preventDefault();
        var targetElement = document.querySelector(targetId);
        if (targetElement) {
            var offset = 80;
            var top = targetElement.getBoundingClientRect().top + window.pageYOffset - offset;
            window.scrollTo({ top: top, behavior: 'smooth' });
        }
    });
});

window.addEventListener('scroll', function() {
    var navbar = document.querySelector('.navbar');
    if (navbar) {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    }
});

var formEl = document.querySelector('form');
if (formEl) {
    formEl.addEventListener('submit', function(e) {
        e.preventDefault();
        alert('感谢您的咨询，我们会尽快与您联系！');
        this.reset();
    });
}

var observerOptions = {
    threshold: 0.05,
    rootMargin: '0px 0px -20px 0px'
};

var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
        }
    });
}, observerOptions);

document.querySelectorAll('.hub-card, .case-card, .pricing-card, .blog-post, .resource-card, .faq-item, .ai-course-card, .profile-intro, .profile-quote, .cooperation-intro, .solutions-intro, .insights-intro, .contact-card, .contact-form-card').forEach(function(el) {
    el.classList.add('animate-in');
    observer.observe(el);
});

requestAnimationFrame(function() {
    document.querySelectorAll('.animate-in').forEach(function(el) {
        var rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) {
            el.classList.add('visible');
        }
    });
});

document.addEventListener('DOMContentLoaded', function() {
    try {
        var year = new Date().getFullYear();
        document.querySelectorAll('.auto-year').forEach(function(el) {
            el.textContent = year;
        });
    } catch(e) {}
});

var scrollObserver = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
        if (entry.isIntersecting) {
            entry.target.classList.add('animate');
        }
    });
}, {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
});

document.querySelectorAll('.scroll-animate').forEach(function(el) {
    scrollObserver.observe(el);
});

requestAnimationFrame(function() {
    document.querySelectorAll('.scroll-animate').forEach(function(el) {
        var rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight * 0.85 && rect.bottom > 0) {
            el.classList.add('animate');
        }
    });
});

function getSiteLang() {
    return localStorage.getItem('lang') === 'en' || document.documentElement.lang === 'en' ? 'en' : 'zh';
}

function updateCrawlerConsoleEntry(entry) {
    if (!entry) return;
    var isEnglish = getSiteLang() === 'en';
    entry.textContent = isEnglish ? 'Data' : '\u6570\u636e';
    entry.setAttribute('aria-label', isEnglish ? 'Crawler data management admin' : '\u722c\u866b\u6293\u53d6\u6570\u636e\u7ba1\u7406\u540e\u53f0');
}

document.addEventListener('DOMContentLoaded', function() {
    var footerBottom = document.querySelector('.footer-bottom');
    if (!footerBottom || document.body.classList.contains('crawler-console-page')) return;
    var entry = document.createElement('a');
    entry.className = 'crawler-console-entry';
    var isNestedPage = location.pathname.indexOf('/articles/') !== -1 || location.pathname.indexOf('/blog/') !== -1;
    entry.href = location.protocol === 'file:' ? 'http://localhost:8787/admin/' : (isNestedPage ? '../admin/index.html' : 'admin/index.html');
    entry.rel = 'nofollow noopener';
    updateCrawlerConsoleEntry(entry);
    footerBottom.appendChild(entry);

    document.querySelectorAll('.lang-switch, .lang-switch-mobile').forEach(function(btn) {
        btn.addEventListener('click', function() {
            window.setTimeout(function() { updateCrawlerConsoleEntry(entry); }, 0);
        });
    });

    window.addEventListener('storage', function(event) {
        if (event.key === 'lang') updateCrawlerConsoleEntry(entry);
    });
});

function updateArticleBreadcrumbSource() {
    var breadcrumb = document.querySelector(".article-breadcrumb");
    if (!breadcrumb) return;
    var fromFaq = false;
    try {
        var params = new URLSearchParams(window.location.search);
        fromFaq = params.get("from") === "faq";
    } catch (e) {}
    if (!fromFaq && document.referrer) {
        fromFaq = document.referrer.indexOf("/support.html") !== -1;
    }
    if (!fromFaq) return;

    breadcrumb.textContent = "";
    appendBreadcrumbNode(breadcrumb, "\u9996\u9875", "../index.html");
    appendBreadcrumbNode(breadcrumb, ">");
    appendBreadcrumbNode(breadcrumb, "\u5e38\u89c1\u95ee\u9898", "../support.html");
    appendBreadcrumbNode(breadcrumb, ">");
    appendBreadcrumbNode(breadcrumb, "\u8fd1\u671f\u6587\u7ae0", "../support.html#recent-articles");
}

function appendBreadcrumbNode(parent, text, href) {
    var node = href ? document.createElement("a") : document.createElement("span");
    node.textContent = text;
    if (href) node.href = href;
    parent.appendChild(node);
}

document.addEventListener("DOMContentLoaded", updateArticleBreadcrumbSource);

function initBrandCarousel() {
    var carousel = document.querySelector('[data-brand-carousel]');
    if (!carousel) return;

    var slides = Array.prototype.slice.call(carousel.querySelectorAll('[data-carousel-slide]'));
    var dots = Array.prototype.slice.call(carousel.querySelectorAll('.brand-carousel__dots button'));
    var previous = carousel.querySelector('.brand-carousel__control--prev');
    var next = carousel.querySelector('.brand-carousel__control--next');
    var current = 0;

    function render(index, shouldFocus) {
        current = (index + slides.length) % slides.length;
        slides.forEach(function(slide, slideIndex) {
            var active = slideIndex === current;
            slide.classList.toggle('is-active', active);
            slide.setAttribute('aria-hidden', active ? 'false' : 'true');
        });
        dots.forEach(function(dot, dotIndex) {
            var active = dotIndex === current;
            dot.classList.toggle('is-active', active);
            dot.setAttribute('aria-selected', active ? 'true' : 'false');
            dot.setAttribute('tabindex', active ? '0' : '-1');
        });
        if (shouldFocus && dots[current]) dots[current].focus();
    }

    previous.addEventListener('click', function() { render(current - 1, false); });
    next.addEventListener('click', function() { render(current + 1, false); });
    dots.forEach(function(dot, index) {
        dot.addEventListener('click', function() { render(index, true); });
    });

    carousel.addEventListener('keydown', function(event) {
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            render(current - 1, false);
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            render(current + 1, false);
        }
    });

    render(0, false);
}

document.addEventListener('DOMContentLoaded', initBrandCarousel);
