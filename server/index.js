// HTTP API: runs the race (same stream, siloed vs shared memory) and streams it to the browser.
import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { run } from './engine.js';
import { rest, mekoUrl } from './meko.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const app = express();
const runs = new Map(); // runId -> { mem, decisions }

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
    const [silo, shared] = await Promise.all([
      run({ mode: 'silo', seed, emit: send('silo'), signal: ac.signal }),
      run({ mode: 'shared', seed, delay, emit: send('shared'), signal: ac.signal }),
    ]);
    runs.set(shared.result.st.runId, shared);
    void silo;
    send('race')({ k: 'finished' });
  } catch (err) {
    send('race')({ k: 'error', error: err.message });
  }
  res.end();
});

// The stored trace of one decision, read back from Meko: the turn, its plan and reasoning, the
// memories it produced and every Meko call the agents made for it.
app.get('/api/trace/:runId/:decision', async (req, res) => {
  const r = runs.get(req.params.runId);
  const d = r?.result.decisions.find((x) => x.id === req.params.decision);
  if (!d?.ref?.message) return res.status(404).json({ error: 'No stored trace for that decision.' });
  try {
    res.json({ turn: await r.mem.trace(d.ref), ref: d.ref });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

const dist = path.join(ROOT, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`Tripwire API on http://localhost:${port} (Meko at ${mekoUrl})`));
