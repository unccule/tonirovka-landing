<?php
/*
 * ЗАПАСНОЙ ВАРИАНТ на случай перехода на ПЛАТНЫЙ тариф Beget (сейчас используется
 * Yandex Cloud Functions — см. server/yandex-function). Чтобы включить этот вариант:
 * загрузи файл в public_html/api/send.php и впиши в config.js formEndpoint: 'api/send.php'.
 *
 * send.php — принимает заявку с сайта и пересылает её мастеру в Telegram.
 *
 * Как это работает:
 *   браузер (form.js) → POST сюда с данными заявки в формате JSON
 *   → этот скрипт проверяет данные
 *   → отправляет сообщение через Telegram Bot API (токен бота известен только серверу)
 *   → отвечает браузеру {"ok": true} или {"ok": false, "error": "..."}
 *
 * Токен и chat_id лежат НЕ здесь, а в файле tg-config.php уровнем выше папки public_html —
 * туда у посетителей сайта нет доступа ни при каких условиях.
 *
 * ВАЖНО: на бесплатном тарифе Beget этот скрипт работать не будет — там запрещены
 * исходящие соединения на любой порт, кроме 80, а Telegram работает только по HTTPS (порт 443).
 * Подробности и альтернатива — в README.md.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

// Ответ браузеру и завершение скрипта
function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

// Обрезает пробелы по краям и ограничивает длину строки
function clean($value, int $maxLength): string
{
    return mb_substr(trim((string) $value), 0, $maxLength);
}

// 1. Принимаем только POST-запросы
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, ['ok' => false, 'error' => 'Method not allowed']);
}

// 2. Загружаем секретные настройки: ~/ваш-сайт/tg-config.php (рядом с public_html, а не внутри)
$configFile = __DIR__ . '/../../tg-config.php';
if (!is_file($configFile)) {
    error_log('tonirovka: tg-config.php not found at ' . $configFile);
    respond(500, ['ok' => false, 'error' => 'Server is not configured']);
}
$config = require $configFile;

// 3. Читаем JSON из тела запроса (не больше 10 КБ — заявке больше не нужно)
$raw = file_get_contents('php://input', false, null, 0, 10000);
$data = json_decode($raw ?: '', true);
if (!is_array($data)) {
    respond(400, ['ok' => false, 'error' => 'Invalid JSON']);
}

// 4. Ловушка для ботов: скрытое поле заполнено — «принимаем», но никуда не отправляем
if (!empty($data['website'])) {
    respond(200, ['ok' => true]);
}

// 5. Защита от частых повторов: с одного IP — не чаще одной заявки в 30 секунд
$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$lockFile = sys_get_temp_dir() . '/tonirovka_' . md5($ip);
if (is_file($lockFile) && time() - filemtime($lockFile) < 30) {
    respond(429, ['ok' => false, 'error' => 'Too many requests']);
}
touch($lockFile);

// 6. Проверяем поля ещё раз. Проверку в браузере легко обойти, поэтому сервер доверяет только себе
$name = clean($data['name'] ?? '', 50);
$car = clean($data['car'] ?? '', 60);
$service = clean($data['service'] ?? '', 60);
$date = clean($data['date'] ?? '', 10);
$comment = clean($data['comment'] ?? '', 500);

$phone = preg_replace('/\D/', '', (string) ($data['phone'] ?? ''));
if (strlen($phone) === 11 && $phone[0] === '8') {
    $phone = '7' . substr($phone, 1);
}

$services = [
    'Тонировка задней полусферы',
    'Тонировка передних стёкол',
    'Тонировка лобового стекла',
    'Полная тонировка',
    'Снятие плёнки',
    'Другое',
];

$errors = [];
if (mb_strlen($name) < 2) $errors[] = 'name';
if (strlen($phone) !== 11 || $phone[0] !== '7') $errors[] = 'phone';
if (mb_strlen($car) < 2) $errors[] = 'car';
if (!in_array($service, $services, true)) $errors[] = 'service';

// Дата необязательна. Если есть — должна быть настоящей датой: «2026-13-45» не пройдёт,
// потому что DateTime превратит её в другой день и строки не совпадут
$dateObject = null;
if ($date !== '') {
    $dateObject = DateTime::createFromFormat('!Y-m-d', $date);
    if (!$dateObject || $dateObject->format('Y-m-d') !== $date) $errors[] = 'date';
}

if ($errors) {
    respond(422, ['ok' => false, 'error' => 'Invalid fields: ' . implode(', ', $errors)]);
}

// 7. Собираем сообщение. htmlspecialchars экранирует < > & — иначе текст
//    вида «<b>» от посетителя сломал бы разметку сообщения в Telegram
$e = function (string $text): string {
    return htmlspecialchars($text, ENT_NOQUOTES, 'UTF-8');
};
$phoneText = sprintf('+7 (%s) %s-%s-%s',
    substr($phone, 1, 3), substr($phone, 4, 3), substr($phone, 7, 2), substr($phone, 9, 2));
$dateText = $dateObject ? $dateObject->format('d.m.Y') : 'не указана';

$lines = [
    '📩 <b>Новая заявка с сайта</b>',
    '',
    '👤 <b>Имя:</b> ' . $e($name),
    '📞 <b>Телефон:</b> ' . $phoneText,
    '🚗 <b>Авто:</b> ' . $e($car),
    '🛠 <b>Услуга:</b> ' . $e($service),
    '📅 <b>Дата:</b> ' . $dateText,
];
if ($comment !== '') {
    $lines[] = '💬 <b>Комментарий:</b> ' . $e($comment);
}

// 8. Отправляем в Telegram
$url = 'https://api.telegram.org/bot' . $config['token'] . '/sendMessage';
$payload = json_encode([
    'chat_id' => $config['chat_id'],
    'text' => implode("\n", $lines),
    'parse_mode' => 'HTML',
], JSON_UNESCAPED_UNICODE);

if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
    ]);
    $response = curl_exec($ch);
    $networkError = curl_error($ch);
    curl_close($ch);
} else {
    // Запасной способ, если на хостинге нет расширения curl
    $context = stream_context_create(['http' => [
        'method' => 'POST',
        'header' => "Content-Type: application/json\r\n",
        'content' => $payload,
        'timeout' => 10,
        'ignore_errors' => true,
    ]]);
    $response = @file_get_contents($url, false, $context);
    $networkError = $response === false ? 'file_get_contents failed' : '';
}

$result = json_decode((string) $response, true);
if (empty($result['ok'])) {
    // В лог пишем причину (без токена), посетителю — общий ответ
    error_log('tonirovka: Telegram error: ' . ($result['description'] ?? $networkError));
    respond(502, ['ok' => false, 'error' => 'Telegram API error']);
}

respond(200, ['ok' => true]);
