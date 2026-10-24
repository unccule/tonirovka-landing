/*
 * main.js — общее поведение страницы:
 * 1) подстановка контактов из config.js
 * 2) бургер-меню
 * 3) тень у шапки при прокрутке
 * 4) подсветка пункта меню текущего раздела
 * 5) карточка «Подберите затемнение» на главном экране
 * 6) плавное появление блоков при прокрутке
 */

/* ---------- 1. Контакты из config.js ---------- */
function applyConfig() {
  const config = window.SITE_CONFIG;
  if (!config) return; // если config.js не загрузился, останутся запасные значения из HTML

  // Значения, которые собираем из настроек
  const texts = { ...config, telegramName: config.telegram ? '@' + config.telegram : '' };
  const links = {
    phone: 'tel:' + config.phone,
    telegram: config.telegram ? 'https://t.me/' + config.telegram : '',
    // encodeURIComponent превращает пробелы и кириллицу в безопасный для ссылки вид
    map: 'https://yandex.ru/maps/?text=' + encodeURIComponent(config.address),
    email: 'mailto:' + config.ownerEmail,
  };

  // <span data-config="address"> → текст адреса
  document.querySelectorAll('[data-config]').forEach((el) => {
    const value = texts[el.dataset.config];
    if (!value) return;
    el.textContent = value;
    // Значения вида «[ФИО]» ещё не заполнены — подсвечиваем, чтобы их было видно
    el.classList.toggle('is-placeholder', value.startsWith('['));
  });

  // <a data-link="telegram"> → ссылка на Telegram
  document.querySelectorAll('[data-link]').forEach((el) => {
    const href = links[el.dataset.link];
    if (href) el.href = href;
  });

  // Telegram не указан: прячем всё, что есть только ради него (data-telegram-only),
  // а остальные кнопки «Написать в Telegram» ведут к форме записи
  if (!config.telegram) {
    document.querySelectorAll('[data-telegram-only]').forEach((el) => el.remove());
    document.querySelectorAll('a[data-link="telegram"]').forEach((el) => {
      el.href = '#booking';
      el.removeAttribute('target');
      el.textContent = 'Оставить заявку';
    });
  }

  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
}

/* ---------- 2. Бургер-меню ---------- */
// Каждая функция сначала проверяет, есть ли на странице её элементы:
// main.js подключён и к страницам политики, где нет ни меню, ни галереи
function initBurger() {
  const burger = document.getElementById('burger');
  const nav = document.getElementById('nav');
  if (!burger || !nav) return;

  function setOpen(isOpen) {
    nav.classList.toggle('is-open', isOpen);
    burger.classList.toggle('is-open', isOpen);
    burger.setAttribute('aria-expanded', String(isOpen));
    burger.setAttribute('aria-label', isOpen ? 'Закрыть меню' : 'Открыть меню');
    // Пока меню открыто, страница под ним не прокручивается
    document.body.classList.toggle('no-scroll', isOpen);
  }

  burger.addEventListener('click', () => {
    setOpen(!nav.classList.contains('is-open'));
  });

  // Клик по любой ссылке в меню закрывает его
  nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false);
  });

  // Клавиша Esc тоже закрывает
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setOpen(false);
  });

  // Если телефон повернули и экран стал широким — меню больше не нужно
  window.matchMedia('(min-width: 992px)').addEventListener('change', (event) => {
    if (event.matches) setOpen(false);
  });
}

/* ---------- 3. Тень у шапки ---------- */
function initHeaderShadow() {
  const header = document.getElementById('header');
  if (!header) return;
  const update = () => header.classList.toggle('is-scrolled', window.scrollY > 10);
  update();
  // passive: true — обещаем браузеру не отменять прокрутку, так она плавнее
  window.addEventListener('scroll', update, { passive: true });
}

/* ---------- 4. Активный пункт меню ---------- */
function initActiveLink() {
  const links = document.querySelectorAll('.nav__link');
  const sections = document.querySelectorAll('main section[id]');

  // IntersectionObserver сам сообщает, когда раздел попадает в нужную зону экрана.
  // Это экономнее, чем считать координаты на каждое событие прокрутки.
  // rootMargin: зона — узкая полоса чуть выше середины экрана.
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      links.forEach((link) => {
        const isActive = link.getAttribute('href') === '#' + entry.target.id;
        link.classList.toggle('is-active', isActive);
      });
    });
  }, { rootMargin: '-40% 0px -55% 0px' });

  sections.forEach((section) => observer.observe(section));
}

/* ---------- 5. Карточка «Подберите затемнение» ---------- */
function initTintPicker() {
  const glass = document.getElementById('tint-glass');
  if (!glass) return;

  const value = document.getElementById('tint-value');
  const desc = document.getElementById('tint-desc');
  const options = document.querySelectorAll('.tint-card__option');

  options.forEach((option) => {
    option.addEventListener('click', () => {
      // Данные берём из data-атрибутов кнопки: data-tint → dataset.tint
      glass.style.opacity = option.dataset.tint;
      value.textContent = option.textContent;
      desc.textContent = option.dataset.text;

      // Подсвечиваем только нажатую кнопку
      options.forEach((other) => {
        const isActive = other === option;
        other.classList.toggle('is-active', isActive);
        other.setAttribute('aria-pressed', String(isActive));
      });
    });
  });
}

/* ---------- 6. Анимации появления при прокрутке ---------- */
function initReveal() {
  const items = document.querySelectorAll('[data-reveal]');

  // Старый браузер без IntersectionObserver — просто показываем всё
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  // Задержка: своя из data-reveal-delay="300" или «волна» по соседям —
  // 1-я карточка в ряду сразу, 2-я через 0,1 с, 3-я через 0,2 с…
  // % 4 — после четвёртой счёт начинается заново, чтобы нижние ряды не ждали слишком долго
  items.forEach((el) => {
    let delay = el.dataset.revealDelay;
    if (delay === undefined) {
      const siblings = [...el.parentElement.children].filter((child) => child.hasAttribute('data-reveal'));
      delay = (siblings.indexOf(el) % 4) * 100;
    }
    el.style.setProperty('--reveal-delay', delay + 'ms');
  });

  // rootMargin -10% снизу: блок начинает появляться, когда уже немного заехал на экран
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target); // анимация — один раз, дальше следить не нужно
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });

  items.forEach((el) => observer.observe(el));
}

/* ---------- Запуск ---------- */
applyConfig();
initBurger();
initHeaderShadow();
initActiveLink();
initTintPicker();
// DOMContentLoaded наступает, когда выполнены ВСЕ скрипты с defer.
// Ждём его, потому что плитки галереи создаёт gallery.js — он запускается после main.js
document.addEventListener('DOMContentLoaded', initReveal);
