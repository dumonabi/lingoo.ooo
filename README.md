# Lingu.ooo — AI Conversation Translator

Talk with someone who speaks a different language. Lingu.ooo uses GPT to automatically detect which language was spoken, translate it naturally, and speak the result aloud — no manual prompts needed.

**Default language pair: English ↔ Spanish** (change anytime — 99 languages supported)

## Features

- **Auto language detection** — speak in either language; GPT figures out which one
- **One microphone** — tap to start, tap again when done
- **Whisper transcription** — works with Thai, Arabic, Chinese, and many more
- **Natural translation** — casual tone, grammar fixes, conversational phrasing
- **Voice output** — listen to translations on demand

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Add your OpenAI API key

```bash
cp .env.example .env
```

Edit `.env` and set your key:

```
OPENAI_API_KEY=sk-your-actual-key-here
APP_PASSWORD=your-access-code
```

Get a key at [platform.openai.com](https://platform.openai.com/api-keys).

### 3. Run the app

```bash
npm run dev
```

Open **http://localhost:5180** in Chrome or Safari.

## How to use

1. Select your two languages at the top (e.g. English + Spanish)
2. Tap the **big microphone** and speak in **either** language
3. Tap again when you're done speaking
4. Lingu.ooo transcribes, detects the language, improves your message, and translates
5. Tap **Listen** to hear the translation

## Production

```bash
npm run build
npm start
```

Live app: **https://lingu-ooo.vercel.app**
