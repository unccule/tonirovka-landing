/*
 * form.js — форма записи:
 * 1) маска телефона: +7 (900) 123-45-67
 * 2) проверка полей с понятными подсказками под каждым полем
 * 3) отправка заявки (или демо-режим, пока сервер не готов)
 * 4) кнопки «Записаться» в карточках услуг сами выбирают услугу в форме
 */

(function initBookingForm() {
  const form = document.getElementById('booking');
  if (!form) return;

  const status = document.getElementById('booking-status');
  const submitButton = form.querySelector('.booking__submit');
  const phoneInput = form.elements.phone;
  const serviceSelect = form.elements.service;
  const dateInput = form.elements.date;

  /* ---------- Вспомогательные функции ---------- */

  // Сегодняшняя дата в формате 2026-10-13 (так её понимает <input type="date">).
  // Поправка на часовой пояс: toISOString() считает время по Гринвичу
  function todayISO() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  // Из любого ввода оставляем только цифры и приводим к виду 7XXXXXXXXXX:
  // «8 900...» и «900...» тоже превращаются в «7900...»
  function phoneDigits(value) {
    let digits = value.replace(/\D/g, '');   // \D — всё, что не цифра
    if (digits.startsWith('8')) digits = '7' + digits.slice(1);
    if (digits && !digits.startsWith('7')) digits = '7' + digits;
    return digits.slice(0, 11);
  }

  // Разделители добавляем, только когда после них уже есть цифра —
  // иначе Backspace «застревал» бы на скобке или пробеле
  function formatPhone(digits) {
    if (!digits) return '';
    let result = '+7';
    if (digits.length > 1) result += ' (' + digits.slice(1, 4);
    if (digits.length > 4) result += ') ' + digits.slice(4, 7);
    if (digits.length > 7) result += '-' + digits.slice(7, 9);
    if (digits.length > 9) result += '-' + digits.slice(9, 11);
    return result;
  }

  /* ---------- 1. Маска телефона ---------- */
  phoneInput.addEventListener('input', () => {
    phoneInput.value = formatPhone(phoneDigits(phoneInput.value));
  });

  // В прошлое записаться нельзя: календарь не даст выбрать прошедшие дни
  dateInput.min = todayISO();

  /* ---------- 2. Проверка полей ---------- */

  // Для каждого поля — функция, которая возвращает текст ошибки или пустую строку
  const validators = {
    name: (input) => (input.value.trim().length < 2 ? 'Введите имя — хотя бы 2 буквы' : ''),
    phone: (input) => {
      const digits = phoneDigits(input.value);
      if (!digits) return 'Введите номер телефона';
      return digits.length < 11 ? 'Номер неполный: нужно +7 и ещё 10 цифр' : '';
    },
    car: (input) => (input.value.trim().length < 2 ? 'Укажите марку автомобиля' : ''),
    service: (input) => (input.value ? '' : 'Выберите услугу'),
    date: (input) => (input.value && input.value < todayISO() ? 'Эта дата уже прошла' : ''),
    consent: (input) => (input.checked ? '' : 'Без согласия мы не сможем с вами связаться'),
  };

  function setError(input, message) {
    const error = document.getElementById(input.id + '-error');
    input.classList.toggle('is-invalid', Boolean(message));
    // aria-invalid и aria-describedby: экранный диктор скажет «ошибка» и прочитает текст подсказки
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    input.setAttribute('aria-describedby', error.id);
    error.textContent = message;
  }

  function validateField(input) {
    const message = validators[input.name](input);
    setError(input, message);
    return !message;
  }

  // Проверяем поле, когда человек из него ушёл (blur)…
  Object.keys(validators).forEach((name) => {
    const input = form.elements[name];
    input.addEventListener('blur', () => {
      if (input.value || input.classList.contains('is-invalid')) validateField(input);
    });
    // …а если ошибка уже показана — проверяем на каждый символ, чтобы она исчезла сразу после исправления
    const liveEvent = input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'input';
    input.addEventListener(liveEvent, () => {
      if (input.classList.contains('is-invalid')) validateField(input);
    });
  });

  /* ---------- 3. Отправка ---------- */

  function showStatus(type, message) {
    status.hidden = false;
    status.className = 'booking__status booking__status--' + type;
    status.replaceChildren(...message);
  }

  function setLoading(isLoading) {
    submitButton.disabled = isLoading;
    submitButton.classList.toggle('is-loading', isLoading);
    submitButton.textContent = isLoading ? 'Отправляем…' : 'Отправить заявку';
  }

  async function sendRequest(data) {
    const endpoint = window.SITE_CONFIG && window.SITE_CONFIG.formEndpoint;

    // Сайт открыт на своём компьютере (файлом или через localhost), а не на хостинге
    const isLocal = location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(location.hostname);

    if (!endpoint) {
      // ДЕМО-РЕЖИМ только на своём компьютере: делаем вид, что отправляем (1 секунда)
      if (isLocal) {
        console.info('Демо-режим: заявка никуда не отправлена. Вот что ушло бы мастеру:', data);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return;
      }
      // На настоящем сайте без адреса НЕ притворяемся: иначе клиент думал бы,
      // что записался, а мастер заявку не получил бы. Лучше честная ошибка
      throw new Error('В config.js не указан formEndpoint — заявки некуда отправлять');
    }

    // Если сервер не ответил за 15 секунд — считаем это ошибкой, а не ждём вечно
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) {
        throw new Error(result.error || 'Сервер ответил ошибкой ' + response.status);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault(); // не перезагружаем страницу — отправляем сами

    // Проверяем все поля и ставим курсор в первое поле с ошибкой
    const inputs = Object.keys(validators).map((name) => form.elements[name]);
    const invalid = inputs.filter((input) => !validateField(input));
    if (invalid.length > 0) {
      invalid[0].focus();
      return;
    }

    const name = form.elements.name.value.trim();
    const data = {
      name,
      phone: '+' + phoneDigits(phoneInput.value),
      car: form.elements.car.value.trim(),
      service: serviceSelect.value,
      date: dateInput.value,
      comment: form.elements.comment.value.trim(),
      website: form.elements.website.value, // ловушка для ботов, сервер проверит её ещё раз
    };

    setLoading(true);
    status.hidden = true;

    try {
      // Бот заполнил скрытое поле — тихо «принимаем» заявку, но никуда её не отправляем
      if (!data.website) await sendRequest(data);

      showStatus('success', [
        `Спасибо, ${name}! Заявка отправлена — скоро перезвоню, чтобы подтвердить время.`,
      ]);
      form.reset();
      dateInput.min = todayISO();
    } catch (error) {
      console.error('Заявка не отправлена:', error);
      // Другой способ связаться берём из config.js: Telegram, а если его нет — телефон
      const config = window.SITE_CONFIG;
      const contact = document.createElement('a');
      if (config.telegram) {
        contact.href = 'https://t.me/' + config.telegram;
        contact.target = '_blank';
        contact.rel = 'noopener';
        contact.textContent = 'напишите в Telegram';
      } else {
        contact.href = 'tel:' + config.phone;
        contact.textContent = 'позвоните ' + config.phoneDisplay;
      }
      showStatus('error', ['Не получилось отправить заявку. Попробуйте ещё раз или ', contact, '.']);
    } finally {
      setLoading(false);
    }
  });

  /* ---------- 4. «Записаться» в карточке услуги ---------- */
  // У кнопки есть data-service="Полная тонировка" — выбираем эту услугу в форме.
  // Сама прокрутка к форме происходит обычной ссылкой href="#booking"
  document.addEventListener('click', (event) => {
    const link = event.target.closest('[data-service]');
    if (!link) return;

    serviceSelect.value = link.dataset.service;
    if (serviceSelect.classList.contains('is-invalid')) validateField(serviceSelect);

    // Короткая подсветка, чтобы человек заметил, что услуга уже выбрана
    serviceSelect.classList.remove('is-highlighted');
    void serviceSelect.offsetWidth; // «перезапуск» анимации, если кликнули второй раз
    serviceSelect.classList.add('is-highlighted');
  });
})();
