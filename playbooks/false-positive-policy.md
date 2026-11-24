# False positive policy

A hold stops a customer from using their money. One weak signal is never enough: a new device,
a VPN, a changed phone number or a large transfer each happen to honest customers every day.

- Hold only when several independent signals agree (a single factor, however strong, stays below the
  threshold), or when a confirmed attacker pattern matches.
- Every hold is reviewed by an analyst. A hold released as legitimate is logged against the signals
  that caused it.
- Every decision must be explainable from stored context: which agent contributed which signal, when,
  and which pattern or playbook section applied.
