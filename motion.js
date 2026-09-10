/* Motion layer: hover tilt, scroll reveals, inertia scrolling. Honors reduced motion. */
(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const titles = {
    capture: ['CAPTURE', 'Strip capture'],
    workers: ['WORKERS', 'Workers & shifts'],
    calibration: ['CALIBRATION', 'Local ε-SVR'],
    records: ['RECORDS', 'Shift exposure records']
  };

  function bindTilt() {
    if (reduce || window.matchMedia('(pointer: coarse)').matches) return;
    document.querySelectorAll('[data-tilt]').forEach(card => {
      const max = 7;
      card.addEventListener('pointermove', event => {
        const box = card.getBoundingClientRect();
        const x = (event.clientX - box.left) / box.width;
        const y = (event.clientY - box.top) / box.height;
        const rx = (0.5 - y) * max;
        const ry = (x - 0.5) * max;
        card.style.transform = `perspective(1100px) rotateX(${rx}deg) rotateY(${ry}deg) scale(1.02)`;
      });
      card.addEventListener('pointerleave', () => {
        card.style.transform = '';
      });
    });
  }

  function bindRevealReplay() {
    document.querySelectorAll('.tab').forEach(button => {
      button.addEventListener('click', () => {
        const targetView = button.dataset.view;

        // The continuous workspace background is panned by app.js.

        // ── Reveal animation replay ────────────────────────────
        const view = document.getElementById(targetView);
        if (!view) return;
        view.querySelectorAll('[data-reveal]').forEach((el, i) => {
          el.style.animation = 'none';
          void el.offsetWidth;
          el.style.animation = '';
          el.style.animationDelay = `${i * 70}ms`;
        });
        const pair = titles[targetView];
        if (pair) {
          const eyebrow = document.getElementById('pageEyebrow');
          const title   = document.getElementById('pageTitle');
          if (eyebrow) eyebrow.textContent = pair[0];
          if (title)   title.textContent   = pair[1];
        }
        window.TRACE_SCROLL?.scrollTo(0);
      });
    });
  }

  function inertiaScroll() {
    if (reduce) return;
    const root = document.scrollingElement || document.documentElement;
    let current = window.scrollY;
    let target = current;
    let vel = 0;
    let ticking = false;
    const friction = 0.92;
    const ease = 0.12;

    const step = () => {
      current += (target - current) * ease + vel;
      vel *= friction;
      if (Math.abs(target - current) < 0.15 && Math.abs(vel) < 0.15) {
        current = target;
        ticking = false;
        window.scrollTo(0, current);
        return;
      }
      window.scrollTo(0, current);
      requestAnimationFrame(step);
    };

    window.addEventListener('wheel', event => {
      if (event.ctrlKey) return;
      const dialog = document.querySelector('dialog[open]');
      if (dialog) return;
      event.preventDefault();
      const max = Math.max(0, root.scrollHeight - window.innerHeight);
      vel += event.deltaY * 0.08;
      target = Math.max(0, Math.min(max, target + event.deltaY));
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(step);
      }
    }, { passive: false });

    window.TRACE_SCROLL = {
      scrollTo(y) {
        target = y;
        vel = 0;
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(step);
        }
      }
    };
  }

  window.addEventListener('DOMContentLoaded', () => {
    bindTilt();
    bindRevealReplay();
    inertiaScroll();
    const backup = document.getElementById('sidebarBackupHint');
    backup?.addEventListener('click', () => {
      document.querySelector('[data-view="records"]')?.click();
      setTimeout(() => document.getElementById('exportData')?.focus(), 200);
    });
  });
})();
