/*
 * Пересылка заявок с сайта в Telegram. Работает в Yandex Cloud Functions
 * (бесплатно до 1 млн вызовов в месяц), сам сайт лежит на бесплатном Beget.
 * Что делает: проверяет данные заявки → отправляет сообщение в Telegram → отвечает сайту.
 *
 * Секреты задаются в настройках функции как переменные окружения (их видит только владелец облака):
 *   TELEGRAM_TOKEN   — токен бота от @BotFather
 *   TELEGRAM_CHAT_ID — куда присылать заявки
 *   ALLOWED_ORIGIN   — адрес сайта без / в конце, например http://my-site.beget.tech
 *                      Можно несколько через запятую: на время проверки добавь http://localhost:5500
 *
 * Среда выполнения: Node.js 18 или новее (там есть встроенный fetch).
 * Пошаговая инструкция — в README.md.
 */

const SERVICES = [
  'Тонировка задней полусферы',
  'Тонировка передних стёкол',
  'Тонировка лобового стекла',
  'Полная тонировка',
  'Снятие плёнки',
  'Другое',
];

/*
 * CORS. Сайт (my-site.beget.tech) и функция (functions.yandexcloud.net) — разные адреса.
 * Браузер по умолчанию не даёт странице отправлять такие запросы. Заголовок
 * Access-Control-Allow-Origin говорит браузеру: «запросы с этого сайта разрешены».
 */
const allowedOrigins = () =>
  (process.env.ALLOWED_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean);

// Имена заголовков могут прийти как «Origin» или «origin» — ищем без учёта регистра
function getHeader(event, name) {
  const headers = event.headers || {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : '';
}

// В ответ браузеру отдаём именно тот адрес, с которого пришёл запрос, если он в списке разрешённых
function corsHeaders(origin) {
  const list = allowedOrigins();
  const allowed = list.length === 0 ? '*' : list.includes(origin) ? origin : list[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function respond(statusCode, body, origin) {
  return { statusCode, headers: corsHeaders(origin), body: JSON.stringify(body) };
}

const clean = (value, maxLength) => String(value ?? '').trim().slice(0, maxLength);

// Экранируем < > & — иначе текст посетителя вида «<b>» сломал бы разметку сообщения
const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

module.exports.handler = async (event) => {
  const origin = getHeader(event, 'origin');
  // reply — короткая запись: ответить с CORS-заголовками для адреса этого запроса
  const reply = (statusCode, body) => respond(statusCode, body, origin);

  // Перед «чужим» POST браузер сначала спрашивает разрешения запросом OPTIONS
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(origin), body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'Method not allowed' });

  // Браузер и сам не пустит запрос с чужого сайта, но проверяем и здесь — на всякий случай
  const list = allowedOrigins();
  if (list.length === 0) {
    console.warn('ALLOWED_ORIGIN не задан — принимаю запросы с любого сайта. Задай адрес сайта в настройках функции');
  } else if (origin && !list.includes(origin)) {
    return reply(403, { ok: false, error: 'Origin not allowed' });
  }

  const { TELEGRAM_TOKEN, TELEGRAM_CHAT_ID } = process.env;
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('TELEGRAM_TOKEN or TELEGRAM_CHAT_ID is not set');
    return reply(500, { ok: false, error: 'Server is not configured' });
  }

  // Тело запроса может прийти закодированным в base64 — так устроен Yandex Cloud
  let data;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
    if (raw.length > 10000) return reply(413, { ok: false, error: 'Payload too large' });
    data = JSON.parse(raw);
  } catch {
    return reply(400, { ok: false, error: 'Invalid JSON' });
  }
  if (!data || typeof data !== 'object') return reply(400, { ok: false, error: 'Invalid JSON' });

  // Ловушка для ботов
  if (data.website) return reply(200, { ok: true });

  // Повторная проверка полей — проверку в браузере легко обойти
  const name = clean(data.name, 50);
  const car = clean(data.car, 60);
  const service = clean(data.service, 60);
  const date = clean(data.date, 10);
  const comment = clean(data.comment, 500);
  let phone = String(data.phone ?? '').replace(/\D/g, '');
  if (phone.length === 11 && phone[0] === '8') phone = '7' + phone.slice(1);

  const errors = [];
  if (name.length < 2) errors.push('name');
  if (phone.length !== 11 || phone[0] !== '7') errors.push('phone');
  if (car.length < 2) errors.push('car');
  if (!SERVICES.includes(service)) errors.push('service');

  // Дата должна быть настоящей: «2026-13-45» превратится в другой день, и строки не совпадут
  let dateText = 'не указана';
  if (date) {
    const parsed = new Date(date + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(parsed) || parsed.toISOString().slice(0, 10) !== date) {
      errors.push('date');
    } else {
      dateText = date.split('-').reverse().join('.');
    }
  }

  if (errors.length) return reply(422, { ok: false, error: 'Invalid fields: ' + errors.join(', ') });

  const phoneText = `+7 (${phone.slice(1, 4)}) ${phone.slice(4, 7)}-${phone.slice(7, 9)}-${phone.slice(9, 11)}`;
  const lines = [
    '📩 <b>Новая заявка с сайта</b>',
    '',
    '👤 <b>Имя:</b> ' + escapeHtml(name),
    '📞 <b>Телефон:</b> ' + phoneText,
    '🚗 <b>Авто:</b> ' + escapeHtml(car),
    '🛠 <b>Услуга:</b> ' + escapeHtml(service),
    '📅 <b>Дата:</b> ' + dateText,
  ];
  if (comment) lines.push('💬 <b>Комментарий:</b> ' + escapeHtml(comment));

  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: lines.join('\n'), parse_mode: 'HTML' }),
      signal: AbortSignal.timeout(10000),
    });
    const result = await response.json();
    if (!result.ok) {
      console.error('Telegram error:', result.description); // токен в лог не попадает
      return reply(502, { ok: false, error: 'Telegram API error' });
    }
  } catch (error) {
    console.error('Telegram request failed:', error.message);
    return reply(502, { ok: false, error: 'Telegram API error' });
  }

  return reply(200, { ok: true });
};
