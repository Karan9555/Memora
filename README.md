# 🧠 Memora  
> **An offline-first archive explorer for your ChatGPT history.**  
> Import, search, recall, merge, and export conversations — all in your browser, with a GitHub-dark inspired UI.  

<p align="center">
  <!-- Custom project identity badge -->
  <img src="https://img.shields.io/badge/Memora-Archive%20Explorer-purple?style=for-the-badge&logo=archivebox&logoColor=white" alt="Memora badge" />
  <!-- Release -->
  <img src="https://img.shields.io/github/v/release/NeurosynLabs/Memora?style=for-the-badge" alt="release" />
  <!-- Last Commit -->
  <img src="https://img.shields.io/github/last-commit/NeurosynLabs/Memora?style=for-the-badge" alt="last commit" />
  <!-- Vercel deployment badge -->
  <img src="https://img.shields.io/github/deployments/NeurosynLabs/Memora/Production?label=vercel&style=for-the-badge" alt="vercel" />
  <!-- Offline-first -->
  <img src="https://img.shields.io/badge/Static%20Site-Offline--First-blue?style=for-the-badge" alt="offline" />
  <!-- Live Demo -->
  <a href="https://memora-amber.vercel.app/">
    <img src="https://img.shields.io/badge/Live-Demo-brightgreen?style=for-the-badge&logo=vercel" alt="live demo" />
  </a>
</p>

---

## ✨ Features

- 📂 **Drag & Drop Import** – Load your `conversations.json`, `user.json`, and more.  
- 🔎 **Fast Search & Recall** – Keyword search with a live progress bar.  
- 🧩 **Thread Merge** – Combine conversations by keyword into a single transcript.  
- 📤 **Export Anywhere** – Save as `.txt`, `.md`, `.json`, or print/export as PDF.  
- 🎨 **GitHub-Dark Theme** – Sleek, minimal interface with mobile-friendly design.  
- 🔒 **Privacy First** – Runs entirely client-side; your data never leaves your browser.  

---

## 🚀 Quickstart

1. **Export your ChatGPT data**  
   - In ChatGPT go to *Settings → Data Controls → Export Data*.  
   - You’ll receive a ZIP file by email. Download and unzip it.  
   - Inside the folder, you’ll see several files. Memora works with these in particular:  
     - `conversations.json` → all your conversation threads  
     - `user.json` → your account metadata  
     - `message_feedback.json` → thumbs up/down and feedback you gave  
     - `chat.html` → a single HTML file with your entire chat history  

2. **Open Memora**  
   👉 **[Live Demo on Vercel](https://memora-amber.vercel.app/)**  

3. **Drop in your files**  
   Drag any or all of the files above (`conversations.json`, `user.json`, `message_feedback.json`, `chat.html`) into the page.

4. **Search & Recall**  
   Enter a keyword or `$RECALL topic` to find threads across time. Results appear in a floating overlay.

5. **Merge & Export**  
   Use **Merge Results** → choose your format → get your conversations in `.txt`, `.md`, `.json`, or `.pdf`.

---

## 🖼 Screenshots

<p align="center">
  <img src="https://raw.githubusercontent.com/NeurosynLabs/Memora/refs/heads/main/img/Screenshot_20250901-171052.Chrome%7E2.png" 
       width="85%" 
       alt="Memora dark mode screenshot" />
</p>

---

## 🛠 Development

Clone the repo:

```bash
git clone https://github.com/NeurosynLabs/Memora.git
cd Memora
