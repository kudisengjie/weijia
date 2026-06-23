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
