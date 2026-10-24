/*
 * gallery.js — галерея работ:
 * 1) строит сетку фото из списка SITE_CONFIG.gallery (config.js)
 * 2) лайтбокс: просмотр фото на весь экран, листание кнопками,
 *    стрелками на клавиатуре и свайпом на телефоне
 */

const GALLERY_PATH = 'images/gallery/';
const THUMBS_PATH = 'images/gallery/thumbs/';

/* ---------- 1. Сетка ---------- */
function renderGallery(grid, photos) {
  photos.forEach((photo, index) => {
    const item = document.createElement('li');
    item.className = 'gallery__cell';
    if (photo.wide) item.classList.add('gallery__cell--wide');
    item.dataset.reveal = ''; // плитка будет плавно появляться при прокрутке (см. main.js)

    // Обычная ссылка на крупное фото. Если JavaScript по какой-то причине
    // не сработает, ссылка просто откроет фото — галерея не «сломается»
    const link = document.createElement('a');
    link.className = 'gallery__item';
    link.href = GALLERY_PATH + photo.file;
    link.dataset.index = index;

    const img = document.createElement('img');
    img.src = THUMBS_PATH + photo.file;
    img.alt = photo.alt;
    img.loading = 'lazy';

    const caption = document.createElement('span');
    caption.className = 'gallery__caption';
    caption.textContent = photo.caption;

    link.append(img, caption);
    item.append(link);
    grid.append(item);
  });
}

/* ---------- 2. Лайтбокс ---------- */
function initLightbox(grid, photos) {
  const dialog = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  const caption = document.getElementById('lightbox-caption');
  const counter = document.getElementById('lightbox-counter');
  const stage = document.getElementById('lightbox-stage');

  let current = 0; // номер открытого фото

  function show(index) {
    // Остаток от деления «закольцовывает» листание:
    // после последнего фото идёт первое, перед первым — последнее
    current = (index + photos.length) % photos.length;
    const photo = photos[current];

    // Прячем старое фото и показываем новое, когда оно загрузится —
    // так не будет «мигания» половинкой картинки
    img.classList.remove('is-visible');
    img.src = GALLERY_PATH + photo.file;
    img.alt = photo.alt;
    if (img.complete) {
      img.classList.add('is-visible');
    } else {
      img.onload = img.onerror = () => img.classList.add('is-visible');
    }

    caption.textContent = photo.caption;
    counter.textContent = `${current + 1} / ${photos.length}`;

    // Заранее подгружаем соседние фото, чтобы листание было мгновенным
    [current - 1, current + 1].forEach((i) => {
      const neighbor = photos[(i + photos.length) % photos.length];
      new Image().src = GALLERY_PATH + neighbor.file;
    });
  }

  function open(index) {
    show(index);
    dialog.showModal();                      // showModal — окно поверх всего, с блокировкой фона
    document.body.classList.add('no-scroll');
  }

  // Событие close приходит при любом закрытии: крестик, Esc, клик по фону
  dialog.addEventListener('close', () => {
    document.body.classList.remove('no-scroll');
  });

  // Один обработчик на всю сетку вместо девяти — это называется «делегирование».
  // closest() находит ссылку, даже если кликнули по картинке внутри неё
  grid.addEventListener('click', (event) => {
    const link = event.target.closest('.gallery__item');
    if (!link) return;
    event.preventDefault(); // не переходим по ссылке — открываем лайтбокс
    open(Number(link.dataset.index));
  });

  document.getElementById('lightbox-close').addEventListener('click', () => dialog.close());
  document.getElementById('lightbox-prev').addEventListener('click', () => show(current - 1));
  document.getElementById('lightbox-next').addEventListener('click', () => show(current + 1));

  // Клик по тёмному фону вокруг фото закрывает окно
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog || event.target === stage) dialog.close();
  });

  // Стрелки на клавиатуре. Esc <dialog> обрабатывает сам
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') show(current - 1);
    if (event.key === 'ArrowRight') show(current + 1);
  });

  // Свайп на телефоне: запоминаем, где палец коснулся экрана, и где отпустил.
  // Если сдвиг по горизонтали больше 50px и больше, чем по вертикали — листаем
  let startX = 0;
  let startY = 0;

  stage.addEventListener('touchstart', (event) => {
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
  }, { passive: true });

  stage.addEventListener('touchend', (event) => {
    const dx = event.changedTouches[0].clientX - startX;
    const dy = event.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      show(dx < 0 ? current + 1 : current - 1); // палец влево — следующее фото
    }
  });
}

/* ---------- Запуск ---------- */
(function initGallery() {
  const grid = document.getElementById('gallery-grid');
  const photos = window.SITE_CONFIG && window.SITE_CONFIG.gallery;
  if (!grid || !photos || photos.length === 0) return;

  renderGallery(grid, photos);
  initLightbox(grid, photos);
})();
