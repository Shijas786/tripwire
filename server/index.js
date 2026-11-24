// HTTP API: runs the race (same stream, siloed vs shared memory) and streams it to the browser.
import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { run } from './engine.js';
import { rest, mekoUrl } from './meko.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const app = express();
const UUID = /^[0-9a-f-]{36}$/i;

app.get('/api/health', async (_req, res) => {
  try {
    const packs = await rest('/datapacks');
    res.json({ ok: true, meko: mekoUrl, datapacks: Array.isArray(packs) ? packs.length : (packs.datapacks || []).length });
  } catch (err) {
    res.json({ ok: false, meko: mekoUrl, error: err.message });
  }
});

app.get('/api/race', async (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const ac = new AbortController();
  req.on('close', () => ac.abort());
  const seed = Number(req.query.seed) || 7;
  const delay = Math.max(0, Math.min(200, Number(req.query.delay) || 0));
  const send = (mode) => (msg) => { if (!ac.signal.aborted) res.write(`data: ${JSON.stringify({ mode, ...msg })}\n\n`); };
  try {
    await Promise.all([
      run({ mode: 'silo', seed, emit: send('silo'), signal: ac.signal }),
      run({ mode: 'shared', seed, delay, emit: send('shared'), signal: ac.signal }),
    ]);
    send('race')({ k: 'finished' });
  } catch (err) {
    send('race')({ k: 'error', error: err.message });
  }
  res.end();
});

// The stored trace of one decision, read back from Meko: the turn, its plan and reasoning, the
// memories it produced and every Meko call the agents made for it. Each decision carries its ref.
app.get('/api/trace', async (req, res) => {
  const { datapack, conversation, message } = req.query;
  if (![datapack, conversation, message].every((x) => typeof x === 'string' && UUID.test(x))) return res.status(400).json({ error: 'Pass datapack, conversation and message ids.' });
  try {
    const data = await rest(`/datapacks/${datapack}/conversations/${conversation}`);
    const turn = (data.conversation?.thread || []).find((t) => t.message_id === message);
    if (!turn) return res.status(404).json({ error: 'No stored trace for that decision.' });
    res.json({ turn, ref: { datapack, conversation, message } });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

const dist = path.join(ROOT, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// The API spends the server's Meko token, so it listens on loopback unless HOST says otherwise.
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => console.log(`Tripwire API on http://${host}:${port} (Meko at ${mekoUrl})`));
