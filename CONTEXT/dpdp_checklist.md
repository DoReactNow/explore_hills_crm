# DPDP Readiness Checklist

Status of what India's Digital Personal Data Protection Act needs from this product. **This is an engineering checklist, not legal advice.** The legal adviser's items must be closed before go-live (`Q-19`).

## Built and tested

- [x] Consent records: what, who, when and how, append-only (`P10-ERASE-08`)
- [x] Withdrawing consent stops WhatsApp messages and keeps no new recordings (`P10-ERASE-08`)
- [x] A customer's data can be exported, by a permitted role, with an audit line (`P10-ERASE-07`)
- [x] Erasure across leads, messages, calls, recordings and files, with retries (`P10-ERASE-01`, `-02`)
- [x] Retention by date, with holds (`P10-ERASE-09`, `-10`)
- [x] Audit trail: append-only, read only on screen, no personal data (`P10-AUDV-*`, `P10-ERASE-11`)
- [x] Logs redact personal data (`P10-ERASE-13`)
- [x] Privacy notice page and call-recording announcement, editable as settings (`P10-ERASE-12`, Decision 61)

## For the legal adviser to confirm

- [ ] The privacy notice wording, including every purpose and what is collected
- [ ] The call-recording announcement, in English and Hindi, and whether a notice alone is enough or recording needs a stated consent
- [ ] Whether a first WhatsApp message counts as consent (today it does, Decision 58)
- [ ] Which languages the notice must be offered in (today it is English only)
- [ ] Retention periods: 730 days for messages, 90 for recordings, 30 for webhook logs
- [ ] Keeping audit records indefinitely
- [ ] How long erased data may stay in backups
- [ ] The process and time limit for answering requests, and who the named contact is
- [ ] What must happen, and how quickly, after a data breach
- [ ] Contracts with the WhatsApp, calling, email and hosting providers
- [ ] Whether any data leaves India, and whether that is allowed

## For the owner, before go-live

- [ ] Replace the placeholder company name, support email and phone in `APP_CONFIG`
- [ ] Replace the draft notice in Settings once it is confirmed
- [ ] Link the notice from the WhatsApp profile and any website form
- [ ] Decide who handles requests, and give only them the `privacy:*` permissions

## For a later phase

- [ ] The real calling adapter must delete the provider's copy of an erased recording, and honour withdrawn recording consent at the provider (Phase 7, step 7)
- [ ] Set a backup expiry, and after any restore run erasure again for customers erased since that backup (Phase 12)
- [ ] Review who has access in production (Phase 11)
