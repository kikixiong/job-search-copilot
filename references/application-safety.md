# Application safety policy

## Field classes

Use the packet core to classify fields. `safe` applies only to a known, user-approved identity/contact value or an existing resume/link. `confirm` covers unsupported or changeable employment facts, including salary, availability, visa/work authorization, sponsorship, and relocation. `manual_only` always includes EEO/demographic, disability, veteran, CAPTCHA/MFA, and multilingual or generic consent, terms acceptance, attestation, electronic signature/signature, submit/apply-now, and final-submission controls; do not supply values for them. Unknown wording fails closed rather than relying on one ATS key convention.

## Browser boundary

Browser work is user-visible and user-triggered. Reviewed prefill is allowed only when the current official-page audit covers the destination, the proposed values are non-sensitive, and the URL hostname is exactly one of: `boards.greenhouse.io`, `jobs.lever.co`, or `jobs.ashbyhq.com`. Do not treat a redirect, a subdomain, a lookalike hostname, or a company-owned domain as allowlisted.

LinkedIn, Indeed, Workday, every company-owned unknown domain, and every other domain always use a field-by-field copy table rather than browser filling. Never log in, reuse cookies, bypass access controls, solve CAPTCHA/MFA, accept consent, sign, send a message, or submit an application. If access fails, show the failure and copy fallback. The user manually completes sensitive fields and final submission.
