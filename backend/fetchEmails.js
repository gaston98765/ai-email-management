// Updated server.js: Refresh fetches new emails only, keeps summaries client-side
require('dotenv').config({ path: __dirname + '/.env' });

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const app = express();
const PORT = 3001;

app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));

async function fetchNewEmails() {
  const config = {
    imap: {
      user: process.env.EMAIL_USER,
      password: process.env.EMAIL_PASS,
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT),
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 5000,
    }
  };

  const connection = await imaps.connect(config);
  await connection.openBox('INBOX');

  const results = await connection.search(['UNSEEN'], { bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)', 'TEXT'], struct: true });

  const emails = await Promise.all(results.map(async (res) => {
    const parsed = await simpleParser(res.parts[0].body);
    return {
      uid: res.attributes.uid,
      subject: parsed.subject || '(Sans sujet)',
      sender: parsed.from.text,
      body: parsed.text,
      receivedAt: parsed.date?.toISOString() || new Date().toISOString(),
      summary: null,
      flags: res.attributes.flags,
    };
  }));

  connection.end();
  return emails.filter(email => !email.flags.includes('\\Deleted'));
}

app.get('/messages', async (_req, res) => {
  try {
    const emails = await fetchNewEmails();
    res.json(emails);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'IMAP error' });
  }
});

app.post('/summarize', async (req, res) => {
  const { body, model = 'deepseek-coder:instruct', style = 'normal' } = req.body;

  if (!body || !body.trim()) {
    return res.json({ summary: '(contenu vide)' });
  }

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

    const summary = result.response?.trim() || '(résumé vide)';
    res.json({ summary });
  } catch (err) {
    console.error('❌ Résumé échoué :', err.message);
    res.status(500).json({ summary: '', error: 'Erreur backend' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Backend démarré sur http://localhost:${PORT}`);
});