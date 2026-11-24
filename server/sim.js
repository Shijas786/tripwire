// Deterministic synthetic event stream: legitimate banking traffic with planted account takeovers.
// No real data: every account, device, network and payee is generated from the seed.

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOME_ASNS = ['AS7922 Comcast', 'AS701 Verizon', 'AS7018 AT&T', 'AS20115 Charter', 'AS22773 Cox', 'AS5650 Frontier'];
const TRAVEL_ASNS = ['AS3320 Deutsche Telekom', 'AS2856 BT', 'AS4713 NTT', 'AS1221 Telstra', 'AS3215 Orange'];
const LEGIT_SUPPORT = [
  'I forgot my password and the reset email never arrived.',
  'Can you explain the pending charge on my statement?',
  'I moved house and need to update my mailing address.',
  'My card was declined at a grocery store, is something wrong?',
  'How do I raise my daily transfer limit for a house deposit?',
  'I got a new phone and my authenticator app is gone, how do I set it up again?',
];

// Three crews. They rotate what is cheap (mule payees, networks) and reuse what is expensive
// (device farms, the social-engineering story), paraphrasing the story between calls.
const CREWS = {
  kestrel: {
    devices: ['fp_k3a91c', 'fp_k77e02'],
    asn: { 1: 'AS9009 M247 (hosting)', 2: 'AS60068 Datacamp (hosting)' },
    mules: { 1: ['payee_M-4471', 'payee_M-9920'], 2: ['payee_M-3158', 'payee_M-7742', 'payee_M-5306'] },
    scripts: {
      1: ['I lost my phone on holiday and cannot receive codes, please switch 2FA to my new number.',
          'My phone was stolen abroad, I need the verification texts sent to a different number.'],
      2: ['Phone got pinched while travelling so the security codes go nowhere, move them to this new mobile please.',
          'Lost handset overseas, cannot get one-time passcodes, kindly point them at my replacement number.'],
    },
  },
  marrow: {
    devices: { 1: ['fp_m19d44'], 2: 'fresh' },
    asn: { 1: 'AS14061 DigitalOcean (hosting)', 2: 'AS14061 DigitalOcean (hosting)' },
    mules: { 1: ['payee_M-2085'], 2: ['payee_M-8834', 'payee_M-1297'] },
    scripts: {
      1: ['I am locked out and my email was hacked, please change the email on file so I can reset.',
          'Someone got into my mailbox, update my contact email urgently before they get my bank too.'],
      2: ['My inbox has been compromised, swap the address you hold for me right away so I can recover access.',
          'Email account breached, I need the login address replaced now to do a reset.'],
    },
  },
  vesper: {
    devices: { 2: 'fresh' },
    asn: { 2: 'AS16276 OVH (hosting)' },
    mules: { 2: ['payee_M-6613', 'payee_M-4029'] },
    scripts: {
      2: ['I am the account holder calling from hospital, add my carer as a payee and lift the limit today.',
          'Calling for my elderly father who is in care, we need a new payee enabled and the cap raised.'],
    },
  },
};

const pad = (n, w = 4) => String(n).padStart(w, '0');
const money = (n) => Math.round(n * 100) / 100;

export function generate(seed = 7, opts = {}) {
  const r = rng(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const N_ACCOUNTS = opts.accounts ?? 140;
  const N_TICKS = opts.ticks ?? 1700;

  const accounts = [];
  for (let i = 0; i < N_ACCOUNTS; i++) {
    accounts.push({
      id: `acct_${pad(i + 1)}`,
      device: `fp_${Math.floor(r() * 0xffffff).toString(16).padStart(6, '0')}`,
      asn: pick(HOME_ASNS),
      typical: money(60 + r() * 900),
      payees: [`payee_${pad(Math.floor(r() * 9000) + 1000)}`, `payee_${pad(Math.floor(r() * 9000) + 1000)}`],
    });
  }

  // Plant the takeovers. Wave 1 trains memory; wave 2 tests whether anyone remembers.
  const victims = [...accounts].sort(() => r() - 0.5);
  let v = 0;
  const plans = [];
  const plant = (crew, wave, count, lowAndSlow) => {
    for (let i = 0; i < count; i++) {
      const lo = wave === 1 ? 0.06 : 0.56;
      const start = Math.floor(N_TICKS * (lo + r() * 0.3));
      plans.push({ id: `atk_${pad(plans.length + 1, 2)}`, crew, wave, account: victims[v++], start, lowAndSlow: lowAndSlow && i % 2 === 0 });
    }
  };
  plant('kestrel', 1, 4, false);
  plant('marrow', 1, 3, true);
  plant('kestrel', 2, 5, true);
  plant('marrow', 2, 4, true);
  plant('vesper', 2, 3, true);

  const slots = Array.from({ length: N_TICKS + 400 }, () => []);
  const attacked = new Set(plans.map((p) => p.account.id));

  for (const p of plans) {
    const c = CREWS[p.crew];
    const devs = Array.isArray(c.devices) ? c.devices : c.devices[p.wave];
    // 'fresh': a new anti-detect browser profile per victim, so the device is never seen twice.
    const device = devs === 'fresh' ? `fp_${p.crew[0]}${Math.floor(r() * 0xfffff).toString(16).padStart(5, '0')}` : pick(devs);
    const asn = c.asn[p.wave];
    const mule = pick(c.mules[p.wave]);
    const script = pick(c.scripts[p.wave]);
    // Low-and-slow crews keep each transfer just under the amount that would look unusual for the victim.
    const amount = p.lowAndSlow ? money(Math.max(3 * p.account.typical, 2000) * (0.82 + r() * 0.15)) : money(2400 + r() * 6200);
    p.device = device; p.asn = asn; p.mule = mule; p.amount = amount;
    const a = p.account.id;
    const chain = [
      { type: 'login', account: a, device, asn, ok: true },
      { type: 'support', account: a, channel: 'chat', text: script },
      { type: 'profile_change', account: a, field: p.crew === 'marrow' ? 'email' : 'phone', device, asn },
      { type: 'payee_add', account: a, payee: mule, device },
      { type: 'transfer', account: a, payee: mule, amount, device },
    ];
    let t = p.start;
    chain.forEach((e, stage) => {
      t += stage === 0 ? 0 : 6 + Math.floor(r() * 22);
      slots[t].push({ ...e, attack: p.id, stage: stage + 1 });
    });
    p.end = t;
  }

  // Legitimate traffic, including the innocent look-alikes that make single signals useless.
  for (let t = 0; t < N_TICKS; t++) {
    const acct = pick(accounts);
    if (attacked.has(acct.id) && r() < 0.7) { t--; continue; }
    const x = r();
    let e;
    if (x < 0.52) {
      const odd = r();
      e = { type: 'login', account: acct.id, ok: true,
        device: odd < 0.05 ? `fp_${Math.floor(r() * 0xffffff).toString(16).padStart(6, '0')}` : acct.device,
        asn: odd < 0.09 ? pick(TRAVEL_ASNS) : acct.asn };
    } else if (x < 0.86) {
      const odd = r();
      e = { type: 'transfer', account: acct.id, device: acct.device,
        payee: odd < 0.05 ? `payee_${pad(Math.floor(r() * 9000) + 1000)}` : pick(acct.payees),
        amount: odd > 0.965 ? money(2200 + r() * 5200) : money(acct.typical * (0.3 + r() * 1.1)) };
    } else if (x < 0.92) {
      e = { type: 'support', account: acct.id, channel: pick(['chat', 'phone']), text: pick(LEGIT_SUPPORT) };
    } else if (x < 0.96) {
      e = { type: 'payee_add', account: acct.id, payee: `payee_${pad(Math.floor(r() * 9000) + 1000)}`, device: acct.device };
    } else {
      e = { type: 'profile_change', account: acct.id, field: pick(['phone', 'email', 'address']), device: acct.device, asn: acct.asn };
    }
    slots[t].push(e);
  }

  const events = [];
  slots.forEach((s, t) => s.forEach((e) => events.push({ id: `evt_${pad(events.length + 1, 5)}`, t, ...e })));

  return {
    seed,
    accounts: Object.fromEntries(accounts.map((a) => [a.id, a])),
    events,
    attacks: plans.map((p) => ({ id: p.id, crew: p.crew, wave: p.wave, account: p.account.id, device: p.device, asn: p.asn, mule: p.mule, amount: p.amount, lowAndSlow: p.lowAndSlow })),
  };
}
