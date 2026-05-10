# InRoute Recoded — Полный технический анализ

> Результат reverse engineering сессии. Все ссылки `(line N)` указывают на `deobfuscator/output/content.entry.v3.js`, если не указано иное.

---

## Содержание

1. [Что это за продукт](#1-что-это-за-продукт)
2. [Технологии и структура](#2-технологии-и-структура)
3. [Обфускация — что использовалось](#3-обфускация--что-использовалось)
4. [Pipeline деобфускации](#4-pipeline-деобфускации)
5. [Архитектура — 8 слоёв](#5-архитектура--8-слоёв)
6. [Security layer](#6-security-layer)
7. [AI Handler слой](#7-ai-handler-слой)
8. [Платформы-солверы](#8-платформы-солверы)
9. [Каталог промптов](#9-каталог-промптов-13)
10. [Anti-detect механизмы](#10-anti-detect-механизмы)
11. [WebSearch слой](#11-websearch-слой)
12. [API endpoints](#12-api-endpoints)
13. [Lifecycle одного запроса](#13-lifecycle-одного-запроса)
14. [Live payload-примеры](#14-live-payload-примеры)
15. [Статистика деобфускации](#15-статистика-деобфускации)
16. [Файлы проекта](#16-файлы-проекта)

---

## 1. Что это за продукт

**InRoute Recoded** — Chrome-расширение (Manifest V3), AI-помощник для прохождения онлайн-тестов на украинских и международных образовательных платформах.

**Категория:** AI middleware с domain-specific UI hooks.

**Бизнес-модель:** Bring-your-own-key (BYOK). Расширение использует API-ключи самого пользователя (Gemini/Groq/Serper), не имеет своего серверного бэкенда. Лицензия — оффлайн HMAC по токену из Telegram-бота `@inrtoken_bot`.

**Поддерживаемые платформы:**
- `naurok.ua` / `naurok.com.ua`
- `vseosvita.ua`
- `kahoot.it`
- `classtime.com`
- `justclass.com.ua` / `justclass.me`
- `miyklas.com.ua`
- `lcloud.in.ua`
- Google Forms

---

## 2. Технологии и структура

### Stack
- Vanilla JavaScript (обфусцирован)
- CSS3 с glassmorphism эффектами
- Font Awesome 6.5.1, Google Fonts (Inter, JetBrains Mono)
- Chrome Extension Manifest V3

### AI-провайдеры
- **Gemini** (Google) — `gemini-2.5-flash`
- **Groq** — `gpt-oss-120b` (default), fallback `llama-3.3-70b-versatile`
- **Whisper** через Groq — `whisper-large-v3`
- **Serper** (Google search wrapper) — опционально

### Структура файлов

```
InRoute Compressed 2/
├── manifest.json                    # 2.7 KB
├── popup.html                       # 8.6 KB
├── LICENSE.txt                      # 4.1 KB (украинский)
├── html/
│   ├── background.js                # 85 KB (service worker)
│   ├── styles.css                   # 40 KB
│   └── icon{16,32,48,64,128}.png
└── pump/                            # обфусцированные content scripts
    ├── content.entry.js             # 1.55 MB — основная логика
    ├── popup.entry.js               # 660 KB — UI
    └── bypasser.entry.js            # 470 KB — обход защит
```

### Permissions (manifest.json)
- `storage`, `activeTab`, `scripting`, `tabs`
- Host permissions для всех целевых платформ + AI API endpoints

### Порядок загрузки
1. `bypasser.entry.js` → `document_start`
2. `content.entry.js` → `document_end`

---

## 3. Обфускация — что использовалось

**Тип:** кастомный обфускатор с лицензией "AFTEAM".

### Ключевые техники

| Техника | Пример |
|---|---|
| **Control flow flattening** | `while(...)+with(...)+switch(...)` — 87+ instances |
| **Generator state machines** | `function*_BDXcF(...)` — 86+ instances |
| **String array** (cipher pool) | `JR5NBN[0x1ea]` accessed via index |
| **Two-stage decoder** | `c96YSn(JR5NBN[N])` — value goes through cipher |
| **`with` scope hiding** | переменные живут внутри `CVpIgIm.yVDuX4` |
| **Hex числа** | `0x148`, `0xfc` вместо decimal |
| **Escape sequences** | `"\x68"` вместо `"h"` |
| **Random identifier names** | `nmo1lo`, `DmABGu`, `_BDXcF` |
| **Dynamic case conditions** | `case nmo1lo + DmABGu - 0x57:` |

### Имена ключевых символов

| File | String array | Primary decoder | Secondary |
|---|---|---|---|
| `content.entry` | `JR5NBN` | `c96YSn` | `qFNLim0`, `OsnYUr1` |
| `popup.entry` | `_vyhog` | `WCvPxDZ` | `eWRt3tn`, `O9Zi99` |
| `bypasser.entry` | `viHiQ9F` | `uNvOE3Q` | `n9c2tTJ`, `RdjLazb` |

**Критическая особенность:** code не оборачивается в IIFE, исполняется top-level. Но `JR5NBN`/`c96YSn` НЕ глобальные — они живут как `CVpIgIm.yVDuX4.JR5NBN` через `with(CVpIgIm.M2iGPbe || CVpIgIm)` scope.

### Anti-VM защита
Есть `SECURE_GUARD_FAIL` exception, который кидается при детекте sandbox среды — например, в `vm.runInContext` Node.js.

---

## 4. Pipeline деобфускации

Построен поэтапный pipeline из 6 скриптов в `deobfuscator/`:

### 4.1 `deobfuscate.js` — статический проход
- Парсит AST через Babel
- Hex → decimal (40K+ замен на content)
- Decode `\xNN` / `\uNNNN` escape-последовательностей
- Pretty-print через Prettier
- **Output:** `*.deob.js`

### 4.2 `browser_extract.js` → `deep_extract.js` — runtime extraction
Самый важный шаг. Запускает обфусцированный JS в **настоящем Chromium через Puppeteer** с моками `chrome.*` API.

**Трюк:** `Object.prototype` setter перехватывает момент когда генератор присваивает декодер на свой internal context-объект:

```js
Object.defineProperty(Object.prototype, "c96YSn", {
  set(fn) {
    Object.defineProperty(this, "c96YSn", {value:fn, writable:true, configurable:true});
    if (typeof fn === "function") {
      window.__capturedCtx = this;  // ← это и есть CVpIgIm.yVDuX4
    }
  },
});
```

После выполнения (даже если `SECURE_GUARD_FAIL` сработал) бьём декодер для всего диапазона:
- `dec(JR5NBN[i])` для всех i (читает значения из массива)
- `dec(N)` для N=0..4000 (прямые числовые вызовы)

**Output:** `*.deep.json` с полями:
- `primaryArray` — полный дамп строкового массива
- `primaryViaArray` — `{idx: decodedString}` через массив
- `primaryDirect` — `{N: decodedString}` для прямых вызовов
- `funcCtorCalls`, `evalCalls`, `cryptoCalls`, `fetchCalls`, `xhrCalls`, `wsCalls`

### 4.3 `apply_deep.js` — инлайн декодер-вызовов
Заменяет:
- `(1, c96YSn)(JR5NBN[490])` → `"transition"`
- `c96YSn(2966)` → `"naurok\\.(ua|com\\.ua)$"`
- Также `yVDuX4.c96YSn(yVDuX4.JR5NBN[N])` (namespace-aware)

**Output:** `*.final.js`

### 4.4 `secondary_pass.js` + `apply_secondary.js` — secondary decoders
После primary прохода в `.final.js` появляются строковые аргументы вида `OsnYUr1("xkTDz84")`. Сканируем их, повторяем runtime extraction для каждого аргумента, получаем mapping:

```
OsnYUr1("xkTDz84") → fetch
OsnYUr1("OgdQl6")  → console
OsnYUr1("o59juPu") → chrome
OsnYUr1("t6tQq4")  → JSON
OsnYUr1("cvRKVb")  → Promise
OsnYUr1("qlzd_e")  → crypto
OsnYUr1("AmXWjjw") → location
... (всего 41 mapping)
```

**Output:** `*.v2.js` (с заменёнными identifiers)

### 4.5 `apply_array.js` — финальный инлайн примитивов
Прямые обращения `JR5NBN[N]` (вне декодера) — инлайнятся из `primaryArray` дампа для всех string/number/boolean entries.

**Output:** `*.v3.js` — финальный читаемый код.

---

## 5. Архитектура — 8 слоёв

```
Layer 0: TRANSPORT      — manifest, content scripts injection
Layer 1: SECURITY       — HMAC self-signed token, crypto guard, VM detection
Layer 2: ANTI-DETECT    — bypasser API restoration, timings, watermark mask
Layer 3: SITE REGISTRY  — __INROUTE_SITES__.register({pattern, solver})
Layer 4: PROMPT ROUTER  — 1 router + 13 шаблонов (НЕ 6 разных солверов!)
Layer 5: WEB SEARCH     — Groq YES/NO classifier → Serper → re-prompt
Layer 6: AI HANDLER     — callGemini / callGroq / callWhisper
Layer 7: RENDERER       — regex extract → DOM action (click / type / highlight)
```

### Глобальные namespace
```js
window.__INROUTE_INJECTOR__   // UI status indicator
window.__INROUTE_SITES__      // platform registry
window.__INROUTE_HANDLER__    // AI calls
window.__INROUTE_NOTIFY__     // notifications
window.__INROUTE_WEBSEARCH__  // Serper integration
window.__INROUTE_NAUROK__     // platform solvers
window.__INROUTE_VSEOSVITA__
window.__INROUTE_KAHOOT__
window.__INROUTE_CLASSTIME__
window.__INROUTE_JUSTCLASS__
window.__INROUTE_MIYKLAS__
window.__SECURE__             // license / guard functions
```

---

## 6. Security layer

### Объект `__SECURE__` (line 14625)
```js
window["__SECURE__"] = {
  signAuth:           Nb3HGZ,    // HMAC-SHA256 подпись
  checkAuthIntegrity: VnWOSH,    // проверка integrity
  cryptoAvailable:    RMepbrf,   // проверка наличия crypto.subtle
}
```

### HMAC схема (line 1653-1674)
```js
const data = authToken + "|" + timestamp;
const key = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(authToken),  // ← КЛЮЧ HMAC = САМ ТОКЕН
  { name: "HMAC", hash: "SHA-256" },
  false, ["sign"]
);
const sig = await crypto.subtle.sign("HMAC", key, encode(data));
```

**Это self-signed scheme:** ключ HMAC = сам токен. Криптографически слабая модель — пригодна только для anti-tamper (защита от случайной порчи cache), не от атакующего.

### Хранение
В `chrome.storage.local`:
- `authToken`
- `authVerifiedAt` (Unix timestamp)
- `authSig` (hex HMAC)

### Где блокирует
- **Crypto guard** (line 14670): `if (!cryptoAvailable()) throw 'SECURE_GUARD_FAIL'`
- **VM/integrity guard** (line 90): `throw 'NOTIFY_GUARD_FAIL'`
- Если guard сработал — **весь скрипт прерывается на старте**

### Telegram-бот в runtime
**Не используется.** Никаких runtime-запросов к Telegram API. Бот — только канал распространения токенов out-of-band.

---

## 7. AI Handler слой

### `__INROUTE_HANDLER__` (line 16140-16177)

#### `callGemini(apiKey, messages, retryCount?, options?)` (line 2259-2369)
```http
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=<apiKey>
Content-Type: application/json

{
  "contents": [
    { "role": "user", "parts": [{"text": "..."} | {"inline_data": {"mimeType":"image/jpeg", "data":"<base64>"}}] }
  ],
  "system_instruction": { "parts": [{"text": "..."}] },
  "generationConfig": { "maxOutputTokens": <number> }
}
```
- system messages выделяются в `system_instruction.parts`
- картинки base64-инлайнятся как `inline_data`

#### `callGroq(apiKey, messages, retryCount?, useFallback?, options?)` (line 2370-2532)
```http
POST https://api.groq.com/openai/v1/chat/completions
Authorization: Bearer <apiKey>
Content-Type: application/json

{
  "model": "openai/gpt-oss-120b",
  "messages": [{"role": "system|user|assistant", "content": "..."}],
  "max_tokens": 2024,
  "temperature": 0.1
}
```
- Default model: `gpt-oss-120b`
- Fallback на 429 rate-limit: `llama-3.3-70b-versatile` (line 2431)
- **Temperature жёстко 0.1** для детерминизма

#### `callWhisper(apiKey, audioBlob)` (line 2533-2570)
```http
POST https://api.groq.com/openai/v1/audio/transcriptions
Authorization: Bearer <apiKey>

FormData:
  file: <Blob audio/wav>
  model: whisper-large-v3
  response_format: text
```

### Выбор модели
Через `chrome.storage.local.modelProvider` — `"gemini"` или `"groq"`. Хендлер выбирается солвером в момент запроса, не глобально.

---

## 8. Платформы-солверы

### __INROUTE_NAUROK__ (line 21294)
| | |
|---|---|
| **URL pattern** | `naurok\.(ua\|com\.ua)$` |
| **Trigger** | setTimeout polling 650ms |
| **DOM input** | `[data-p3-hint]`, `.v-test-questions-title`, `innerText` |
| **Logic** | Single/multi-question; T/F, MCQ, text input |
| **AI** | Gemini/Groq |
| **Output** | `V7bICEc.click()` после 650ms задержки, classList highlight |

### __INROUTE_VSEOSVITA__ (line 20180)
| | |
|---|---|
| **URL pattern** | `vseosvita\.ua$` |
| **Trigger** | MutationObserver |
| **DOM input** | `.v-test-questions-title .content-box`, `[data-testid="category-header-cell"]`, `tr[data-testid="question-answer-row"]` |
| **Logic** | T/F, fill-in-blank `[_____]`, categorization, matching |
| **AI** | Gemini |
| **Output** | `textContent` injection, click simulation |

### __INROUTE_KAHOOT__ (line 14469)
| | |
|---|---|
| **URL pattern** | `kahoot\.it$` |
| **Trigger** | `[data-testid="fitg-pointer-choice"]` detection |
| **DOM input** | `.n-kahoot-p`, кнопки опций |
| **Logic** | MCQ, нумерованные опции |
| **AI** | Groq |
| **Output** | **Посимвольный ввод 15ms/char** + dot animation 400ms (anti-detect) |

### __INROUTE_CLASSTIME__ (line 16862)
| | |
|---|---|
| **URL pattern** | `classtime\.com$` |
| **Trigger** | `[data-testid="student-categorizer-answers-form"]` |
| **DOM input** | `[data-p3-hint]`, category headers |
| **Logic** | Categorization, drag-and-drop |
| **AI** | Gemini |
| **Output** | SVG спиннер, opacity/transform анимация |

### __INROUTE_JUSTCLASS__ (line 11506)
| | |
|---|---|
| **URL pattern** | `justclass\.(com\.ua\|me)$` |
| **DOM input** | `childNodes` рекурсивный обход, button-ответы |
| **Logic** | Multi-question batch — собирает в буфер `eJ6fAZK` |
| **AI** | Groq |
| **Output** | classList highlight, textContent updates |

### __INROUTE_MIYKLAS__ (line 20478)
| | |
|---|---|
| **URL pattern** | `miyklas\.com\.ua$` |
| **DOM input** | DND поля `DND_FIELD_N`, опции `OPTION_N: text` |
| **Logic** | DND с **MathML/MathJax** поддержкой (фракции, корни) |
| **AI** | Groq |
| **Output** | opacity/transform, native click handlers, regex `FINAL_ANSWER:` или `Відповідь:` (укр.) |

### Общие утилиты
- Декодер `(1, vHfEPsx)` → AI inference
- Регекс `FINAL_ANSWER:\s*(...)` для извлечения
- SVG спиннер `<svg class="ir-spin">` (rgba(194,58,43,0.2) / `#c23a2b`)
- `__SECURE__` guard в каждом

### Ключевой инсайт
**Это не 6 разных солверов — это унифицированный prompt-router.**

Все 6 платформ используют ОДНИ И ТЕ ЖЕ функции `callGemini`/`callGroq`. Различие только в:
- какой DOM селектор парсить
- какой prompt template подставить
- какой regex использовать для извлечения
- как кликнуть/напечатать ответ

---

## 9. Каталог промптов (13)

### Классификаторы
| # | Промпт | Платформа | Где |
|---|---|---|---|
| 1 | `"You are a strict classifier. Reply only YES or NO."` | все (gating: web search) | line 2626 |
| 2 | `"You are solving a True/False question on vseosvita.ua...FINAL_ANSWER: TRUE/FALSE"` | vseosvita | line 20263 |

### Солверы
| # | Промпт | Платформа | Формат | Где |
|---|---|---|---|---|
| 3 | `"...filling in blank(s)...vseosvita.ua...FINAL_ANSWER: answer"` | vseosvita | blank-fill | line 20278 |
| 4 | `"...vseosvita.ua open-ended...image attached..."` | vseosvita | visual open | line 13289 |
| 5 | `"...matching...LEFT items...RIGHT items...FINAL_MATCH: 1=А,2=Б,..."` | vseosvita | matching | line 14101 |
| 6 | `"...expert academic solver for Miyklas...MathML/MathJax..."` | miyklas | DND+math | line 13162 |
| 7 | `"Ukrainian academic MCQ...FINAL_ANSWER: X"` | все | MCQ | line 13230 |
| 8 | `"...world-class academic expert...short, precise...Ukrainian"` | все (concise) | text | line 13478 |

### Reformatter / search
| # | Промпт | Где |
|---|---|---|
| 9 | `"You are a search query generator. Output ONLY [SEARCH=...]"` | line 3772 |
| 10 | `"...academic engine...[SEARCH=your query]...DO NOT provide answers"` | line 13492 |

### Visual
| # | Промпт | Где |
|---|---|---|
| 11 | `"You are extracting content from answer option images...OPTION X:..."` | line 5127 |
| 12 | `"...visual content from images has been extracted..."` | line 5175 |

### Generic шаблоны (множество мест)
| Промпт | Случаи использования |
|---|---|
| `"You are an advanced AI solver."` | базовый |
| `"You are an advanced AI solver. NO MORE SEARCHES."` | после web search |
| `"You are an advanced AI solver. Use web search results to answer."` | with search |
| `"You are an advanced AI solver. Use the visual context provided to reason correctly."` | post-OCR |
| `"You are an advanced academic solver."` | альтернатива |
| `"You are an AI solver."` | минимальный |

---

## 10. Anti-detect механизмы

### Задержка 650ms (line 21480, NAUROK)
```js
setTimeout(() => { /* submit */ }, 650);
```
Медианное human reaction time ≈ 500-700ms. Naurok трекает submission velocity — мгновенный submit (<200ms) = бот.

### Посимвольный ввод Kahoot (line 13942-13960)
```js
setInterval(() => {
  if (i < answer.length) input.textContent += answer.charAt(i++);
  else { clearInterval(...); /* dot animation 400ms */ }
}, 15);
```
- 15ms/char — быстрее человека, но не мгновенно
- 400ms dot animation — buffer для Kahoot processing
- **Зачем:** Kahoot пишет KEYDOWN/KEYUP timing в analytics. `input.value = "56"` без событий = детект.

### Watermark detection (lines 1774, 13952, 14278, 21382)
```js
get ["watermarkEnabled"]() { ... }   // читается из конфига Kahoot
vyMKCyg.M44r4k = setInterval(...)    // хранит interval ID
if (vyMKCyg.M44r4k) { ... }          // активна ли
```
Watermark = визуальный маркер "test is proctored". Расширение **не убирает** его (уберёшь — спалишься), а блокирует его функциональные хуки, оставляя визуально активным.

### DOM hooks bypass (bypasser.entry.v3.js, lines 5941, 6160)
```js
const origAddListener = window.addEventListener;
// ... позже ...
window.addEventListener = origAddListener;
```
Цели на платформах:
- `addEventListener` обёртки
- `blur/focus` (детект потери фокуса)
- `visibilitychange` (детект таб-свича — Kahoot теряет балл)
- DevTools detection (`debugger;` traps)
- `console.log` overrides

### Stealth mode (lines 3356, 15914, 20847)
- Скрывает UI индикатор InRoute
- Глушит `console.log`
- Никаких уведомлений / спиннеров
- Запросы идут без visible feedback

---

## 11. WebSearch слой

### Когда вызывается Serper
3 условия одновременно (line 3731-3733):
1. `webSearchEnabled === true` (chrome.storage settings)
2. `serperKey` (есть ключ)
3. **YES-classifier** — Groq отвечает "YES" на "нужен ли поиск?"

### Что считается "YES"
- Фактовые/lookup-запросы (даты, имена, столицы)
- Текущие события
- Определения

### Что "NO"
- Чистая логика/математика
- Reasoning-задачи

### Запрос (line 9051)
```http
POST https://google.serper.dev/search
X-API-KEY: <user_serper_key>
Content-Type: application/json

{
  "q": "столиця Франції",
  "num": 5,
  "hl": "uk",
  "gl": "ua"
}
```

### Парсинг (line 9064-9100)
Извлекаются:
- `answerBox` (featured snippet)
- `knowledgeGraph` (sidebar info)
- Top-5 `organic` results (title + snippet)

Формат: `"[AnswerBox] ...\n[KnowledgeGraph] ...: ...\n[1] title\nsnippet\n[2] ..."`

### Re-prompt (line 3818-3829)
```js
const formatted = XIULFEi(question, options, query, searchResults, ctx);
await callGroq(apiKey, [
  { role: "system", content: "You are an advanced AI solver. NO MORE SEARCHES." },
  { role: "user", content: formatted }
]);
```

### Защита от рекурсии
`"NO MORE SEARCHES"` — это **prompt engineering**, не runtime-флаг. Но даже если LLM проигнорирует и попросит поиск, фронтенд просто извлечёт `FINAL_ANSWER` regex-ом.

---

## 12. API endpoints

| Endpoint | Метод | Body | Где |
|---|---|---|---|
| `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent` | POST | `contents/parts/text+inline_data, system_instruction, generationConfig` | line 2326 |
| `https://api.groq.com/openai/v1/chat/completions` | POST | `model, messages, max_tokens=2024, temperature=0.1` | line 2433 |
| `https://api.groq.com/openai/v1/audio/transcriptions` | POST | FormData(file, model="whisper-large-v3", response_format="text") | line 2606 |
| `https://google.serper.dev/search` | POST | `q, num, hl, gl` | line 9051 |
| `https://www.google.com/generate_204?t=...` | HEAD | (no-cors, 4s timeout) — connectivity check | line 1857 |

### Что **НЕ** существует
- ❌ Нет серверов InRoute (никаких backend endpoints автора)
- ❌ Нет relay/proxy для AI-запросов
- ❌ Нет server-side license validation
- ❌ Нет analytics/telemetry в runtime

API ключи пользователя уходят **прямо** в Google/Groq/Serper (`?key=...` в URL Gemini или `Authorization: Bearer` для остальных).

---

## 13. Lifecycle одного запроса

```
[T=0ms]   DOM mutation: появляется новый вопрос на naurok.ua
              │
[T=10ms]  MutationObserver fires → __INROUTE_SITES__.match(URL)
              │ URL соответствует /naurok\.ua/
              ▼
[T=15ms]  __INROUTE_NAUROK__.detect()
              • querySelector('.v-test-questions-title') → "Яка столиця Франції?"
              • parse options: ["Лондон","Париж","Берлін","Рим"]
              • parse type: MCQ single-choice
              │
[T=20ms]  build prompt (line 13230)
              • system: "Ukrainian academic MCQ..."
              • user: "Питання: ...\nOPTION 1: ...\n..."
              │
[T=25ms]  needsWebSearch? (если webSearchEnabled && serperKey)
              ├─ callGroq classifier "YES or NO" → response in ~600ms
              │  └─ если YES → __INROUTE_WEBSEARCH__.search(query, serperKey)
              │     └─ POST https://google.serper.dev/search
              │     → re-prompt с system "NO MORE SEARCHES"
              │
[T=600ms] callGemini / callGroq
              POST https://...?key=USER_KEY
              {contents: [{role:user, parts:[{text}]}], system_instruction: {...}}
              │
[T=2.5s]  AI response: "...FINAL_ANSWER: 2"
              │
[T=2.5s]  regex extract (line 351)
              /FINAL_ANSWER:\s*(?:OPTION\s*)?(\d[\d,\s]*.*)/i
              → "2"
              │
[T=2.5s]  ВАЖНО: задержка 650ms (anti-detect)
              │
[T=3.15s] DOM mutation
              • highlight option (.style.outline = "2px solid #4ade80")
              • V7bICEc.click() // submit
              │
[T=3.2s]  __INROUTE_NOTIFY__.show("Готово", "success")
              ir-spin SVG спиннер убирается
```

**Полный цикл: ~3 секунды** (с web search) / **~2 секунды** (без).

---

## 14. Live payload-примеры

### Кейс 1: NAUROK MCQ
**Сценарий:** "Яка столиця Франції?" → опции: Лондон / Париж / Берлін / Рим

**Request:**
```http
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=AIzaSy_USER_KEY
Content-Type: application/json

{
  "contents": [{
    "role": "user",
    "parts": [{
      "text": "Питання: Яка столиця Франції?\nOPTION 1: Лондон\nOPTION 2: Париж\nOPTION 3: Берлін\nOPTION 4: Рим"
    }]
  }],
  "system_instruction": {
    "parts": [{"text": "Ukrainian academic MCQ. Reason briefly..."}]
  },
  "generationConfig": { "maxOutputTokens": 1024 }
}
```

**Response:**
```json
{
  "candidates": [{
    "content": { "parts": [{ "text": "Париж є столицею Франції...\nFINAL_ANSWER: 2" }] },
    "finishReason": "STOP"
  }]
}
```

**Extract → Click 2-й кнопки.**

### Кейс 2: VSEOSVITA TRUE/FALSE
**Сценарий:** "Сонце — це планета."

**Request body:**
```json
{
  "contents": [{ "role": "user", "parts": [{"text": "Сонце — це планета."}] }],
  "system_instruction": {
    "parts": [{ "text": "You are solving a True/False question on vseosvita.ua...\nFINAL_ANSWER: TRUE or FINAL_ANSWER: FALSE" }]
  }
}
```

**Response:** `"...FINAL_ANSWER: FALSE"` → regex `/FINAL_ANSWER:\s*(TRUE|FALSE)/i` → highlight `[data-answer="false"]`.

### Кейс 3: KAHOOT (численный ответ + посимвольный ввод)
**Сценарий:** "What is 7 × 8?"

**Request:**
```json
{
  "model": "openai/gpt-oss-120b",
  "messages": [
    { "role": "system", "content": "You are a world-class academic expert..." },
    { "role": "user", "content": "What is 7 × 8?" }
  ],
  "max_tokens": 2024,
  "temperature": 0.1
}
```

**Response:** `"FINAL_ANSWER: 56"`

**Type-loop (line 13942):**
```js
// answer = "56"
setInterval(() => {
  if (i < answer.length) input.textContent += answer.charAt(i++);  // 15ms/char
  else clearInterval(...);
}, 15);
// T=0ms: "" → T=15ms: "5" → T=30ms: "56" → T=430ms: submit
```

---

## 15. Статистика деобфускации

### Замены по этапам

| Файл | hex→dec | escapes | dec(arr[N]) | dec(N) | secondary | array primitives | **Итого** |
|---|---:|---:|---:|---:|---:|---:|---:|
| `content.entry` | 40,950 | 3,299 | 5,896 | 877 | 890 | 7,319 | **59,231** |
| `popup.entry` | 17,332 | 1,364 | 1,292 | 237 | 173 | 4,113 | **24,511** |
| `bypasser.entry` | 12,005 | 818 | 51 | 42 | 18 | 3,753 | **16,687** |

### Что осталось нетронутым
- Имена локальных переменных (`nmo1lo`, `DmABGu`, `_BDXcF`) — утеряны навсегда
- `while+switch` control flow flattening (структурно сложно, но логика читается)
- Несколько dynamic indexed accesses — пренебрежимо

### Качественный результат
- 13 уникальных AI промптов извлечены полностью
- 5 API endpoints документированы с полной структурой
- 6 платформенных солверов проанализированы по DOM селекторам и логике
- 41 mapping `OsnYUr1(N)` → global identifier
- Полная картина security model

---

## 16. Файлы проекта

### Pipeline scripts (`deobfuscator/`)
```
deobfuscator/
├── package.json
├── deobfuscate.js          # этап 1: hex→dec, escapes, format
├── browser_extract.js      # этап 2a: первый runtime extraction
├── deep_extract.js         # этап 2b: расширенный (dec(0..4000), Function/eval/crypto/fetch hooks)
├── apply_deep.js           # этап 3: инлайн декодер-вызовов
├── secondary_pass.js       # этап 4a: scan + run secondary decoders
├── apply_secondary.js      # этап 4b: инлайн identifiers (fetch/console/Math/...)
└── apply_array.js          # этап 5: финальный инлайн примитивов JR5NBN[N]
```

### Output (`deobfuscator/output/`)
```
output/
├── content.entry.deob.js          2.8 MB   ← после статического прохода
├── content.entry.final.js         2.5 MB   ← + decoder calls inlined
├── content.entry.v2.js            2.4 MB   ← + secondary identifiers
├── content.entry.v3.js            2.2 MB   ← FINAL — все примитивы инлайнены
├── content.entry.deep.json        452 KB   ← runtime dump
├── content.entry.secondary.json   9 KB     ← OsnYUr1/qFNLim0 mappings
├── content.entry.string_map.json  36 KB    ← простой map idx→str
│
├── popup.entry.{deob,final,v2,v3}.js
├── popup.entry.{deep,secondary,string_map}.json
│
└── bypasser.entry.{deob,final,v2,v3}.js
    bypasser.entry.{deep,secondary,string_map}.json
```

### Использование
```powershell
cd deobfuscator
# Полный pipeline для одного файла:
node deobfuscate.js     "..\pump\content.entry.js"
node deep_extract.js    "..\pump\content.entry.js" c96YSn JR5NBN qFNLim0 OsnYUr1
node apply_deep.js      "output\content.entry.deep.json"      "output\content.entry.deob.js"
node secondary_pass.js  "..\pump\content.entry.js" "output\content.entry.final.js" qFNLim0 OsnYUr1
node apply_secondary.js "output\content.entry.secondary.json" "output\content.entry.final.js"
node apply_array.js     "output\content.entry.deep.json"      "output\content.entry.v2.js"
# → output\content.entry.v3.js — финальный читаемый файл
```

---

## Финальная характеристика продукта

**InRoute = "ChatGPT-prompts-as-a-service" для украинских школьных платформ + слой защиты от детектирования.**

**Технически:**
- Standalone Chrome extension
- Никаких серверов автора
- BYOK к 3 поставщикам (Google / Groq / Serper)
- Лицензия — оффлайн HMAC (фактически honor system)

**Сильные стороны:**
- Anti-detect timings (попотевший reverse engineering целевых платформ)
- Domain prompts (конкретно под украинский edu-segment)
- UX упаковка для не-технических пользователей

**Слабые стороны:**
- Криптомодель не выдерживает критики (self-signed HMAC)
- Реальная защита от копирования = только обфускация JS (которую мы прошли)
- Без AI-провайдеров продукта нет — это обёртка

**Categorization:** AI middleware с domain-specific UI hooks. **Не** classical automation tool, **не** standalone AI product.
