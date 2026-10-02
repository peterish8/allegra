# Personal data breach response

The operator in `packages/shared/legal.ts` leads the response; the grievance officer handles listener
communications. Assign a backup and monitored contact before publishing. Counsel must confirm the
obligations and reporting channels for each incident.

1. **Record and contain immediately.** Start a restricted log with discovery time (UTC), affected
   environments, facts and owners. Disable compromised endpoints, revoke affected sessions and
   rotate exposed server credentials. Preserve logs; do not paste personal data or tokens into
   public issues.
2. **Determine scope.** Check Convex profiles, auth, library, shares, reports, devices and storage;
   Vercel API logs; and Sentry. Identify whose email, listening data, contact details or credentials
   were exposed, when, to whom, and whether access continues. Ask processors for verified facts.
3. **Check notification duties immediately.** Assess reportable incidents under the
   [CERT-In directions](https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf),
   including the six-hour reporting clock where applicable. Do not wait for a complete investigation.
4. **Prepare DPDP notifications.** Under Rule 7 once effective, notify affected people and the Board
   without delay and submit the detailed Board report within 72 hours of awareness (or an allowed
   extension). Describe nature, timing, extent, likely impact, containment, practical protective
   steps and a contact in plain language. Record exactly who was notified and when.
5. **Recover and follow up.** Verify the fix, restore minimum access, monitor recurrence and update
   those affected as facts change. Record root cause, corrective actions, owners and dates. Keep
   evidence securely with a documented retention decision.

Sources checked on 2 October 2026: [DPDP Rules 2025, Rules 1 and 7](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf).
The breach/consent provisions are in the 18-month commencement group; confirm the effective date
and amendments with counsel. Maintain readiness before May 2027. Do not describe future duties
as already in force or confuse DPDP and CERT-In reporting clocks.

The repo sends no incident notices automatically. The operator authorises and sends notices;
engineering supplies verified facts. Session replay remains off on both web and Android.
