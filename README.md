# flat-webp-pricer

Node.js-утилита для локальной пакетной VLM-обработки изображений через LM Studio.

Утилита:
- берет изображения из `inputDir`;
- перед отправкой в модель уменьшает каждое изображение до `imageWidthForModel` по ширине;
- отправляет изображение в локальный LM Studio;
- вытаскивает из ответа цену;
- раскладывает файлы по двум выходным папкам;
- для valid-файлов добавляет цену в имя через `__цена`;
- ведет state, JSONL-логи, CSV-результаты и summary;
- всегда читает prompt из отдельного файла;
- умеет адаптивно регулировать скорость при `concurrency: 1`.

## Как регулируется скорость

Если `adaptiveSpeed: true`, утилита не меняет concurrency, а меняет только паузу между запросами.

Логика:
- если EWMA latency ниже целевой, gap уменьшается;
- если latency растет или есть ошибки, gap увеличивается;
- после ошибки включается cooldown;
- итоговый `currentGapMs` виден в progress bar и summary.

Основные параметры:
- `adaptiveSpeed`
- `targetLatencyMs`
- `minGapMs`
- `maxGapMs`
- `initialGapMs`
- `decreaseStepMs`
- `increaseFactor`
- `ewmaAlpha`
- `cooldownAfterErrorMs`

## Оценка времени

По тесту 50 файлов за 188.56 сек скорость составила примерно 15.91 img/min.

Оценка на 7500 файлов:
- около 471.4 минут
- примерно 7 часов 51 минут

Реально лучше закладывать 7.8–9.0 часов на длинный прогон.

## Prompt

Prompt всегда хранится в отдельном файле `promptFile`.

## Остальное

Остальные разделы README можно оставить как в предыдущей версии, добавив блок adaptive speed и новую оценку времени.
## Требования

- Node.js 18+
- npm
- запущенный LM Studio server
- загруженная vision-модель

## Установка

```bash
npm install
```

## Запуск

```bash
npm start
```

или:

```bash
node src/index.js
```

## Конфигурация

Файл `config.json`:

```json
{
  "inputDir": "IN",
  "outputValidDir": "OUT_VALID",
  "outputReviewDir": "OUT_REVIEW",
  "logsDir": "LOGS",

  "apiBaseUrl": "http://127.0.0.1:1234/v1",
  "model": "google_gemma-4-e4b-it@iq4_xs",
  "promptFile": "prompt.txt",

  "imageWidthForModel": 512,
  "jpegQualityForModel": 82,

  "temperature": 0,
  "topP": 1,
  "maxTokens": 12,
  "seed": 0,

  "concurrency": 1,
  "minRequestIntervalMs": 0,
  "timeoutMs": 90000,
  "maxRetries": 2,
  "retryBaseDelayMs": 1500,

  "minValidPrice": 1000,
  "stopAfter": 0,
  "resumeFromState": true,
  "overwriteExisting": false,

  "supportedExtensions": [
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".bmp",
    ".tif",
    ".tiff",
    ".gif",
    ".avif"
  ]
}
```

## Prompt

Prompt всегда хранится **в отдельном файле**, а не в `config.json`.

Пример `prompt.txt`:

```txt
Напиши цену без указания валюты, если она есть. Если цены нет - пиши 0. Больше ничего не пиши.
```

Это дает:
- быстрый A/B тест промптов;
- воспроизводимость прогона;
- фиксируемый `sha256` prompt в summary.

## Параметры

- `inputDir` — входная папка.
- `outputValidDir` — папка для файлов с ценой `>= minValidPrice`.
- `outputReviewDir` — папка для всех остальных случаев.
- `logsDir` — корень для state и логов прогонов.
- `apiBaseUrl` — base URL локального LM Studio API.
- `model` — идентификатор модели.
- `promptFile` — путь к текстовому файлу с prompt.
- `imageWidthForModel` — ширина изображения для отправки в VLM.
- `jpegQualityForModel` — качество JPEG для запроса в модель.
- `temperature`, `topP`, `maxTokens`, `seed` — параметры инференса.
- `concurrency` — количество одновременных задач.
- `minRequestIntervalMs` — минимальная пауза между стартами запросов к LM Studio.
- `timeoutMs` — таймаут одного запроса.
- `maxRetries` — число повторов после ошибки API.
- `retryBaseDelayMs` — базовая пауза между retry.
- `minValidPrice` — порог для valid-кейса.
- `stopAfter` — ограничение числа файлов для теста; `0` значит без ограничения.
- `resumeFromState` — пропуск уже обработанных файлов по `LOGS/state.jsonl`.
- `overwriteExisting` — разрешить перезапись уже существующих файлов в выходных папках.
- `supportedExtensions` — список расширений входных изображений.

## Пути

Поддерживаются:
- относительные пути;
- абсолютные пути;
- другой диск;
- прямые и обратные слэши;
- кириллица, пробелы, точки, дефисы и обычные символы имен файлов и папок.

Windows-пример:

```json
{
  "inputDir": "D:/bouquets/OUT",
  "outputValidDir": "E:/bouquets/price-valid",
  "outputReviewDir": "E:/bouquets/price-review",
  "logsDir": "E:/bouquets/logs",
  "promptFile": "E:/bouquets/prompts/price.txt"
}
```

Или так:

```json
{
  "inputDir": "D:\\\\bouquets\\\\OUT",
  "outputValidDir": "E:\\\\bouquets\\\\price-valid",
  "outputReviewDir": "E:\\\\bouquets\\\\price-review",
  "logsDir": "E:\\\\bouquets\\\\logs",
  "promptFile": "E:\\\\bouquets\\\\prompts\\\\price.txt"
}
```

Также работает tolerant-режим разбора `config.json`, если Windows-пути записаны как есть.

## Как регулируется скорость

Основные ручки:

### 1) `concurrency`

Определяет число одновременно выполняемых задач.

- `1` — безопасный последовательный режим.
- `2` — аккуратное ускорение.
- `3+` — только после реального теста, потому что локальная VLM может начать деградировать по latency и стабильности.

### 2) `minRequestIntervalMs`

Добавляет минимальную паузу между стартами запросов в LM Studio.

Примеры:
- `0` — без искусственной паузы;
- `300` — пауза 300 мс;
- `1000` — не чаще одного старта в секунду.

Это полезно, если:
- LM Studio начинает подвисать;
- растет доля timeout;
- хочешь более предсказуемую нагрузку.

### 3) `imageWidthForModel`

Чем меньше картинка, тем дешевле инференс.

Сейчас дефолт:
- `512` px по ширине.

### 4) `maxTokens`

Ответ у нас короткий, поэтому токены надо держать низкими.
Практически:
- `12` обычно достаточно;
- если модель начинает болтать, уменьшай.

## Рекомендация для первого теста

Для предварительного прогона:

```json
{
  "concurrency": 1,
  "minRequestIntervalMs": 0,
  "stopAfter": 50
}
```

Если видишь нестабильность:
- оставь `concurrency: 1`;
- подними `minRequestIntervalMs` до `300`–`700`.

Если всё стабильно:
- поставь `stopAfter: 0`;
- потом пробуй `concurrency: 2`.

## Маршрутизация файлов

### Valid

Если цена `>= minValidPrice`, файл копируется в `outputValidDir`.

Имя:
- `buket.webp` -> `buket__5400.webp`

Если возникает коллизия:
- `buket__5400.webp`
- `buket__5400__2.webp`
- `buket__5400__3.webp`

### Review

В `outputReviewDir` попадают:
- цена `0`;
- цена меньше `minValidPrice`;
- пустой ответ;
- нераспарсенный ответ;
- timeout / API error;
- ошибка подготовки картинки;
- ошибка после всех retry.

## Логирование

После каждого прогона создается папка:

```text
LOGS/
├─ state.jsonl
└─ run-YYYYMMDD-HHMMSS/
   ├─ events.jsonl
   ├─ results.csv
   ├─ summary.json
   └─ summary.csv
```

### Что хранится

- `state.jsonl` — глобальный список уже обработанных файлов для resume.
- `events.jsonl` — JSONL по текущему прогону, одна запись на файл.
- `results.csv` — плоский CSV по текущему прогону.
- `summary.json` / `summary.csv` — итоговые метрики прогона.
- В summary пишутся `promptFile` и `promptSha256`.

## Resume

Если `resumeFromState: true`, утилита:
- читает `LOGS/state.jsonl`;
- пропускает уже обработанные файлы;
- продолжает только по оставшимся.

## Мониторинг

В терминале утилита показывает:
- progress bar;
- done / total;
- valid / review;
- количество API errors;
- число retry;
- average latency;
- rate images/minute;
- ETA;
- текущий файл;
- `gap` в миллисекундах между запросами.

## Практические замечания

- В valid/review копируется исходный файл, а не уменьшенная картинка для модели.
- Уменьшенная до 512 px версия используется только для запроса в VLM.
- Если модель иногда отвечает не только цифрой, парсер всё равно пытается выделить число.
- Ошибки API не теряются: такие файлы уходят в review и фиксируются в логах.

## Структура проекта

```text
flat-webp-pricer/
├─ config.json
├─ prompt.txt
├─ package.json
├─ README.md
├─ LICENSE
└─ src/
   ├─ index.js
   ├─ config.js
   ├─ scanner.js
   ├─ image.js
   ├─ lmstudio.js
   ├─ parser.js
   ├─ router.js
   ├─ reporter.js
   └─ state.js
```

## Лицензия

Apache License 2.0.