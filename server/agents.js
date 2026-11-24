// The four specialist agents. Each sees one kind of event and scores it with what it knows locally.
// A factor is {k, s, why}: a named reason with a risk weight in [0, 1].

export const AGENTS = {
  'login-sentry': { name: 'Login Sentry', sees: ['login'], color: '#5ad1ff' },
  'support-listener': { name: 'Support Listener', sees: ['support'], color: '#c792ff' },
  'identity-warden': { name: 'Identity Warden', sees: ['profile_change'], color: '#ffd166' },
  'payments-hawk': { name: 'Payments Hawk', sees: ['payee_add', 'transfer'], color: '#7dffb0' },
};
export const ARBITER = 'arbiter';

export const agentFor = (type) => Object.keys(AGENTS).find((a) => AGENTS[a].sees.includes(type));

const RECOVERY = /(2fa|codes?|passcodes?|number|email|address you hold|payee|limit|cap|authenticator|reset)/i;

export function describe(e) {
  switch (e.type) {
    case 'login': return `Login to ${e.account} from device ${e.device} on ${e.asn}`;
    case 'support': return `Support ${e.channel} on ${e.account}: "${e.text}"`;
    case 'profile_change': return `${e.field} changed on ${e.account} from device ${e.device}`;
    case 'payee_add': return `New payee ${e.payee} added on ${e.account} from device ${e.device}`;
    case 'transfer': return `Transfer of $${e.amount.toFixed(2)} from ${e.account} to ${e.payee}`;
    default: return JSON.stringify(e);
  }
}

// Local scoring: only what this agent can know from its own event and the customer's profile.
export function scoreLocal(e, acct, recentPayees) {
  const f = [];
  const newDevice = e.device && e.device !== acct.device;
  if (e.type === 'login') {
    if (newDevice) f.push({ k: 'login.new_device', s: 0.25, why: `first login from device ${e.device}` });
    if (/hosting/.test(e.asn)) f.push({ k: 'login.hosting', s: 0.2, why: `network ${e.asn} is a hosting provider` });
    else if (e.asn !== acct.asn) f.push({ k: 'login.travel', s: 0.12, why: `unusual network ${e.asn}` });
  } else if (e.type === 'support') {
    if (RECOVERY.test(e.text)) f.push({ k: 'support.recovery', s: 0.3, why: 'asks to change how the account is recovered or paid from' });
  } else if (e.type === 'profile_change') {
    if (e.field !== 'address') f.push({ k: 'profile.contact', s: 0.25, why: `${e.field} on file was replaced` });
    if (newDevice) f.push({ k: 'profile.odd_device', s: 0.15, why: `change made from unrecognized device ${e.device}` });
  } else if (e.type === 'payee_add') {
    f.push({ k: 'payee.new', s: 0.2, why: `new payee ${e.payee}` });
    if (newDevice) f.push({ k: 'payee.odd_device', s: 0.15, why: `payee added from unrecognized device ${e.device}` });
  } else if (e.type === 'transfer') {
    if (recentPayees.has(e.payee)) f.push({ k: 'transfer.new_payee', s: 0.3, why: `first transfer to recently added payee ${e.payee}` });
    if (e.amount > Math.max(3 * acct.typical, 2000)) f.push({ k: 'transfer.large', s: 0.45, why: `$${e.amount.toFixed(0)} is far above this customer's usual $${acct.typical.toFixed(0)}` });
  }
  return f;
}

// Noisy-or over the strongest instance of each distinct factor.
export function combine(factors) {
  const best = new Map();
  for (const f of factors) if (!best.has(f.k) || best.get(f.k).s < f.s) best.set(f.k, f);
  let p = 1;
  for (const f of best.values()) p *= 1 - f.s;
  return { risk: 1 - p, factors: [...best.values()].sort((a, b) => b.s - a.s) };
}

export const HOLD_AT = 0.7;
export const WINDOW = 220;
export const tokens = (s) => Math.ceil(String(s).length / 4);
