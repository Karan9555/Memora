# 🧠 Memora  
> **An offline-first memory vault for your ChatGPT history — supercharged with Puter.**  
> Import, search, recall, merge, summarize, and export conversations — all in your browser, with a GitHub-dark inspired UI.  

<p align="center">
  <!-- Custom project identity badge -->
  <img src="https://img.shields.io/badge/Memora-Archive%20Explorer-purple?style=for-the-badge&logo=archivebox&logoColor=white" alt="Memora badge" />
  <!-- Release -->
  <img src="https://img.shields.io/github/v/release/NeurosynLabs/Memora?style=for-the-badge" alt="release" />
  <!-- Last Commit -->
  <img src="https://img.shields.io/github/last-commit/NeurosynLabs/Memora?style=for-the-badge" alt="last commit" />
  <!-- Vercel deployment badge -->
  <img src="https://img.shields.io/github/deployments/NeurosynLabs/Memora/Production?label=vercel&style=for-the-badge" alt="vercel" />
</p>

<p align="center">
  <a href="https://memora-amber.vercel.app/" target="_blank"><b>🌐 Live Demo</b></a>
</p>

---

## ✨ Features  

- **Offline-first archive explorer**: Browse your ChatGPT history directly in the browser.  
- **Import conversations**: Drag-and-drop JSON exports from ChatGPT.  
- **Fast search**: Full-text search across all conversations.  
- **Semantic recall**: AI-assisted retrieval using embeddings + relevance ranking.  
- **Conversation tools**:  
  - Merge multiple threads into one timeline  
  - Summarize long chats with Puter’s AI API  
  - Copy or export to Markdown / JSON  
- **Modern UI**: GitHub-dark inspired interface with keyboard shortcuts.  
- **Authentication with Puter**:  
  - Continue as guest (local-only)  
  - Log in / sign up to sync via Puter Web OS  
- **Sync & Cloud storage** *(optional)*: Use `puter.fs.*` APIs to persist archives across devices.  
- **AI enhancements**:  
  - Summarization (`puter.ai.chat`)  
  - Potential image support (vision and OCR ready)  
  - Future: voice notes (`puter.ai.txt2speech`)  

---

## 🚀 Getting Started  

1. Clone the repo and install dependencies:  
   ```bash
   git clone https://github.com/NeurosynLabs/Memora.git
   cd Memora
   npm install
   ```
2. Run locally:  
   ```bash
   npm run dev
   ```
3. Open `http://localhost:3000` in your browser.  

Or try it right away here: **[Live Demo](https://memora-amber.vercel.app/)**  

---

## 🛠 How It Works  

- **Frontend-only**: Everything runs in your browser with IndexedDB for offline storage.  
- **Worker-powered indexing**: A Web Worker handles background search + embedding.  
- **Puter.js integration**:  
  - `puter.auth.signIn()` → login / guest session  
  - `puter.fs.write`, `puter.fs.read`, `puter.fs.readdir` → optional cloud sync  
  - `puter.ai.chat()` → summarization and semantic recall  
- **Zero lock-in**: All data is yours; export anytime.  

---

## 📦 Tech Stack  

- **Vanilla JS + Puter.js SDK**  
- **IndexedDB** (offline storage)  
- **Service Worker** (offline PWA support)  
- **Web Workers** (fast indexing & search)  
- **Tailored dark theme UI**  

---

## 🔮 Roadmap  

- Multi-model summarization (Claude, Gemini, etc via Puter.ai)  
- Richer metadata filters (date ranges, participants)  
- Voice note playback with `puter.ai.txt2speech`  
