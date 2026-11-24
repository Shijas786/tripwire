export const AGENTS = {
  'login-sentry': { name: 'Login Sentry', short: 'LOGIN', color: '#5ad1ff', glyph: '⌁' },
  'support-listener': { name: 'Support Listener', short: 'SUPPORT', color: '#c792ff', glyph: '☏' },
  'identity-warden': { name: 'Identity Warden', short: 'IDENTITY', color: '#ffd166', glyph: '◈' },
  'payments-hawk': { name: 'Payments Hawk', short: 'PAYMENTS', color: '#7dffb0', glyph: '$' },
  arbiter: { name: 'Arbiter', short: 'ARBITER', color: '#ff8a5c', glyph: '⚖' },
};
export const ORDER = ['login-sentry', 'support-listener', 'identity-warden', 'payments-hawk'];
export const STAGES = ['Login', 'Support call', 'Contact swap', 'New payee', 'Transfer'];
export const FACTOR_LABEL = {
  'login.new_device': 'New device', 'login.hosting': 'Hosting network', 'login.travel': 'Unusual network',
  'support.recovery': 'Recovery request', 'profile.contact': 'Contact replaced', 'profile.odd_device': 'Change from new device',
  'payee.new': 'New payee', 'payee.odd_device': 'Payee from new device', 'transfer.new_payee': 'First transfer to new payee',
  'transfer.large': 'Unusually large', 'infra.device_shared': 'Device seen on other accounts',
  'pattern.device': 'Confirmed attacker device', 'pattern.payee': 'Confirmed mule', 'pattern.script': 'Confirmed script',
};
export const money = (n) => `$${Math.round(n || 0).toLocaleString('en-US')}`;
