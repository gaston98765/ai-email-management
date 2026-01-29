// server.js (Express backend)
require('dotenv').config({ path: __dirname + '/.env' });

const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const nodemailer = require('nodemailer');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));
app.use(express.json());

const MSG_FILE = path.join(__dirname, 'messages.json');
function readMsgs() {
  return fs.existsSync(MSG_FILE) ? JSON.parse(fs.readFileSync(MSG_FILE, 'utf-8')) : [];
}
function writeMsgs(data) {
  fs.writeFileSync(MSG_FILE, JSON.stringify(data, null, 2));
}

async function fetchEmails() {
  const config = {
    imap: {
      user: process.env.EMAIL_USER,
      password: process.env.EMAIL_PASS,
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT),
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 5000
    }
  };

  try {
    const connection = await imaps.connect(config);
    await connection.openBox('INBOX');
    const results = await connection.search(['ALL'], { bodies: [''], markSeen: false });
    const db = readMsgs();
    let imported = 0;

    for (const res of results) {
      const raw = res.parts[0].body;
      const parsed = await simpleParser(raw);
      if (db.some(m => m.uid === res.attributes.uid)) continue;
      db.push({
        uid: res.attributes.uid,
        subject: parsed.subject || '(Sans sujet)',
        sender: parsed.from.text,
        body: parsed.text,
        receivedAt: parsed.date?.toISOString() || new Date().toISOString(),
        summary: null
      });
      imported++;
    }

    if (imported > 0) writeMsgs(db);
    connection.end();
  } catch (err) {
    console.error('❌ IMAP error:', err.message);
  }
}

app.get('/messages', async (_req, res) => {
  await fetchEmails();
  res.json(readMsgs());
});

app.post('/summarize', async (req, res) => {
  const { body, model = 'deepseek-coder:instruct', style = 'normal' } = req.body;
  if (!body?.trim()) return res.json({ summary: '(contenu vide)' });

  try {
    const check = await fetch('http://localhost:11434/api/show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model })
    }).then(r => r.json());

    if (check.error) {
      await fetch('http://localhost:11434/api/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model })
      });
    }

    let prompt = `Résume ce mail en 3 phrases maximum, même langue :\n\n${body}\n\nRésumé :`;
    if (style === 'short') prompt = `Résume ce mail en UNE phrase, même langue :\n\n${body}\n\nRésumé :`;
    if (style === 'detailed') prompt = `Fais un résumé détaillé (~150 mots), même langue :\n\n${body}\n\nRésumé :`;

    const result = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false })
    }).then(r => r.json());

    res.json({ summary: result.response?.trim() || '(résumé vide)' });
  } catch (err) {
    console.error('❌ Résumé échoué :', err.message);
    res.status(500).json({ summary: '', error: 'Erreur backend' });
  }
});

app.post('/api/ai-reply', async (req, res) => {
  const { subject, body } = req.body;
  try {
    const prompt = `Rédige une réponse professionnelle à ce mail :\n\nSujet : ${subject}\n\n${body}`;
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-coder:instruct', prompt, stream: false })
    });

    const result = await response.json();
    res.json({ replyText: result.response });
  } catch (error) {
    console.error('Erreur génération AI :', error);
    res.status(500).json({ error: 'Erreur IA' });
  }
});

app.post('/api/reply', async (req, res) => {
  const { to, subject, replyText } = req.body;
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'intelligentagent847@gmail.com',
        pass: process.env.APP_PASSWORD,
      },
    });

    await transporter.sendMail({
      from: 'intelligentagent847@gmail.com',
      to,
      subject: `Re: ${subject}`,
      text: replyText,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Erreur envoi email :', error);
    res.status(500).json({ error: 'Erreur SMTP' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Backend démarré sur http://localhost:${PORT}`);
  fetchEmails();
  setInterval(fetchEmails, 5 * 60_000);
});
