// Thin client for the Meko Context Engine: MCP tools over JSON-RPC, plus the REST read routes.
import { execFileSync } from 'node:child_process';

const BASE = (process.env.MEKO_URL || 'http://127.0.0.1:7777').replace(/\/$/, '');
let token = process.env.MEKO_TOKEN || '';

function getToken() {
  if (!token) {
    try { token = execFileSync('meko', ['token'], { encoding: 'utf8' }).trim(); }
    catch { throw new Error('Set MEKO_TOKEN, or install Meko so `meko token` works.'); }
  }
  return token;
}

let rpcId = 0;
export const stats = { calls: 0, ms: 0 };

export async function tool(name, args = {}) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
  });
  const raw = await res.text();
  stats.calls++; stats.ms += performance.now() - t0;
  let body;
  try { body = JSON.parse(raw); }
  catch {
    const line = raw.split('\n').find((l) => l.startsWith('data:'));
    if (!line) throw new Error(`Meko ${name}: HTTP ${res.status} ${raw.slice(0, 200)}`);
    body = JSON.parse(line.slice(5));
  }
  if (body.error) throw new Error(`Meko ${name}: ${body.error.message}`);
  const text = body.result?.content?.[0]?.text ?? '{}';
  let out;
  try { out = JSON.parse(text); } catch { out = { text }; }
  if (out && out.error) throw new Error(`Meko ${name}: ${out.error} ${out.detail || ''}`);
  return out;
}

export async function rest(path, init = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Meko REST ${path}: ${res.status} ${JSON.stringify(body.error || body).slice(0, 200)}`);
  return body.data ?? body;
}

export const mekoUrl = BASE;
