# InRoute Recoded — Cracked Edition

> Полная деобфускация, анализ и снятие защиты с Chrome-расширения InRoute Recoded.

---

## 🔓 Что было сделано

### Деобфускация
Оригинальное расширение было защищено **кастомным обфускатором AFTEAM** с множеством техник:
- Control flow flattening (`while + switch` — 87+ инстансов)
- Generator state machines (`function*` — 86+ инстансов)
- Шифрованный строковый массив с двухэтапным декодером
- `with()` scope hiding
- Hex-числа, escape-последовательности, рандомные имена переменных

Был построен **6-этапный пайплайн деобфускации** через Babel AST + Puppeteer runtime extraction:
1. `deobfuscate.js` — hex→decimal, decode escape-последовательностей
2. `deep_extract.js` — runtime extraction декодера через Puppeteer в реальном Chromium
3. `apply_deep.js` — инлайн всех декодер-вызовов
4. `secondary_pass.js` — сканирование и extraction вторичных декодеров
5. `apply_secondary.js` — инлайн вторичных идентификаторов
6. `apply_array.js` — финальный инлайн примитивов из строкового массива

**Итого:** ~100,000 замен по трём файлам, 13 AI-промптов извлечены, 5 API endpoints документированы.

### Снятие защиты (crack)
Расширение использовало **3 уровня защиты**:

| Защита | Что делала | Как снята |
|---|---|---|
| **HMAC-токен** | Self-signed HMAC-SHA256, ключ = сам токен | Подменена функция `signAuth` — работает с любым токеном |
| **Серверная верификация** | POST на `/v2/auth` для проверки токена | Функция `nJqAz3K` заменена — возвращает фейковый proof без обращения к серверу |
| **Guard-проверки** | 15+ `throw Error("*_GUARD_FAIL")` по всему коду | Все throw заменены, все `if (!window["__SECURE__"])` гарды отключены |

### Что убрано
- ❌ Проверка лицензионного токена через Telegram-бот `@inrtoken_bot`
- ❌ Серверная верификация токена (POST `/v2/auth`)
- ❌ HMAC integrity check при каждом запуске
- ❌ VM/sandbox detection (`SECURE_GUARD_FAIL`)
- ❌ Crypto availability guard
- ❌ Все `*_GUARD_FAIL` исключения (NOTIFY, JUSTCLASS, WEBSEARCH, SITELIST, HANDLER, CLASSTIME, APP, VERIFY, MEMORY)

### Что осталось без изменений
- ✅ Вся функциональность расширения (AI-солверы для всех платформ)
- ✅ Anti-detect механизмы (задержки, посимвольный ввод, обход blur/focus)
- ✅ WebSearch через Serper
- ✅ Whisper аудио-транскрипция
- ✅ UI / стили / попап

---

## 📁 Структура проекта

```
InRoute Compressed 2/
│
├── 📁 PC/                          ← Для установки на компьютер
│   ├── InRoute_Cracked.zip            Распаковать → загрузить в Chrome
│   └── Как установить.txt             Пошаговая инструкция
│
├── 📁 Mobile/                      ← Для установки на телефон (Android)
│   ├── InRoute_Cracked.crx            Для Kiwi Browser
│   └── Как установить.txt             Пошаговая инструкция
│
├── 📁 Деобфускация/                ← Весь пайплайн деобфускации
│   ├── crack.js                       Скрипт патчинга и сборки
│   ├── deobfuscate.js                 Этап 1: статический проход
│   ├── browser_extract.js             Этап 2a: runtime extraction
│   ├── deep_extract.js                Этап 2b: расширенный extraction
│   ├── apply_deep.js                  Этап 3: инлайн декодеров
│   ├── secondary_pass.js              Этап 4a: вторичные декодеры
│   ├── apply_secondary.js             Этап 4b: инлайн идентификаторов
│   ├── apply_array.js                 Этап 5: инлайн примитивов
│   └── 📁 output/                     Все промежуточные и финальные файлы
│       ├── content.entry.v3.js           Финальный деобфусцированный content script
│       ├── popup.entry.v3.js             Финальный деобфусцированный popup
│       ├── bypasser.entry.v3.js          Финальный деобфусцированный bypasser
│       └── *.deep.json, *.secondary.json Runtime дампы
│
├── InRoute-Analysis.md             ← Полный технический анализ (776 строк)
└── README.md                       ← Этот файл
```

---

## 🚀 Установка

### ПК (Chrome)
1. Распакуй `PC/InRoute_Cracked.zip`
2. Открой `chrome://extensions/`
3. Включи **Режим разработчика**
4. Нажми **Загрузить распакованное расширение** → выбери распакованную папку
5. Введи любой токен → **Увійти**

### Телефон (Android)
1. Скачай [Kiwi Browser](https://play.google.com/store/apps/details?id=com.kiwibrowser.browser)
2. Открой `chrome://extensions/` в Kiwi
3. Включи **Developer mode**
4. Загрузи `Mobile/InRoute_Cracked.crx`
5. Введи любой токен → **Увійти**

> ⚠️ На iOS (iPhone/iPad) расширения Chrome не поддерживаются.

---

## 🎯 Поддерживаемые платформы

| Платформа | Типы заданий |
|---|---|
| **Naurok** (naurok.ua) | MCQ, True/False, текстовый ввод |
| **Vseosvita** (vseosvita.ua) | T/F, fill-in-blank, категоризация, matching |
| **Kahoot** (kahoot.it) | MCQ, числовой ввод (с посимвольной эмуляцией) |
| **Classtime** (classtime.com) | Категоризация, drag-and-drop |
| **JustClass** (justclass.com.ua) | Batch MCQ |
| **Miyklas** (miyklas.com.ua) | DND с MathML/MathJax |
| **Google Forms** | Общий солвер |

---

## 🔑 Необходимые API ключи

Расширение использует **твои собственные ключи** (BYOK):

| Провайдер | Где получить | Обязательно? |
|---|---|---|
| **Gemini** (Google AI) | [aistudio.google.com](https://aistudio.google.com/apikey) | Да (один из двух) |
| **Groq** | [console.groq.com](https://console.groq.com/keys) | Да (один из двух) |
| **Serper** | [serper.dev](https://serper.dev) | Нет (для веб-поиска) |

---

## 📊 Статистика деобфускации

| Файл | Замены | Размер до | Размер после |
|---|---:|---|---|
| `content.entry.js` | 59,231 | 1.55 MB | 2.2 MB (читаемый) |
| `popup.entry.js` | 24,511 | 660 KB | 1.17 MB (читаемый) |
| `bypasser.entry.js` | 16,687 | 470 KB | 1.1 MB (читаемый) |

---

## ⚙️ Пространство для пересборки

Если нужно перепатчить или обновить:

```bash
cd Деобфускация
node crack.js
```

Скрипт `crack.js` автоматически:
1. Берёт деобфусцированные файлы из `output/*.v3.js`
2. Патчит все защиты
3. Копирует в `pump/`
4. Пересобирает папку `InRoute_Cracked/`
