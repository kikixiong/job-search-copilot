# Application safety policy

## Field classes

Use the packet core to classify fields. `safe` applies only to a known, user-approved identity/contact value or an existing resume/link. `confirm` covers unsupported or changeable employment facts, including salary, availability, visa/work authorization, sponsorship, and relocation. `manual_only` always includes EEO/demographic, disability, veteran, consent, signature, CAPTCHA/MFA, and final submission; do not supply values for them.

## Browser boundary

Browser work is user-visible and user-triggered. On a supported official application page, present each proposed safe value and stop before any review or submission action. LinkedIn, Indeed, Workday, and unknown domains always use a field-by-field copy table rather than browser filling.

Never log in, reuse cookies, bypass access controls, solve CAPTCHA/MFA, accept consent, sign, send a message, or submit an application. If access fails, show the failure and copy fallback. The user manually completes sensitive fields and final submission.
