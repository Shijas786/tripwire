# Account takeover response playbook

## Hold before credentials change
When combined risk on an account crosses the hold threshold before a contact detail (phone or email)
has been replaced, freeze the pending change, keep the session alive and call the customer back on the
number that was on file before the session started. Never verify on a number supplied in the same session.

## Hold at login on a known attacker device
When a login arrives from a device fingerprint that is a confirmed attacker pattern, hold the session
at login, invalidate its tokens and require in-branch or video re-verification. Do not reveal which signal fired.

## Social-engineering scripts
Attackers reuse a story (lost phone abroad, hacked mailbox, relative in care) and paraphrase it between
calls. When a support contact resembles a confirmed script, the support agent must not change 2FA, email,
payees or limits in that contact. Route to the fraud desk and record the wording.

## Mule payees
A payee confirmed as a mule is blocked for every customer. Add the payee to confirmed patterns as soon
as the first takeover is confirmed, and reverse any pending transfer to it.
