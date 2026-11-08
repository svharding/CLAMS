# CLAMS Booking Hub

Whole-system CLAMS booking for the Nutrition & Lifestyle Lab, Memorial University.

## Implemented

- Public calendar: confirmed reservations, PI name and primary contact email only.
- Whole-week reservations at CAD $300/week; end date is the release date.
- Research, affiliation, FOAPAL and per-user training information captured privately.
- Email-link sign-in, owner-only booking records, administrator role allowlist. Google sign-in is reserved for administrator mailbox setup.
- Approval, request-more-information, decline, changes, cancellation and maintenance.
- Training verification and documented supervised-use override.
- Primary contact independent of PI; select an equipment user or enter another person.
- Excel workbook: bookings, registered users, participants, billing, activity.
- Gmail OAuth send-only scope; encrypted refresh token stored in database.
- Transactional mail queue; administrator and requester notices; individual notices to other active users on confirmation, rescheduling and cancellation.
- Weekday 8 a.m. and 2 p.m. Newfoundland mail worker with retry status and manual retry.
- Public calendar contains no FOAPAL, research title, funding or training data.

## Current status (2026-11-05)

Application deployed on Netlify. Google/Gmail authorization and end-to-end live email delivery still require verification.

Netlify project: `mun-clams-booking`
Netlify site ID: `736df73f-e9c4-444c-aab0-136b90ff12e3`
Team: `sharding-udvdlwo`
Dashboard: https://app.netlify.com/projects/mun-clams-booking
Mailbox: clams.booking.mun@gmail.com
Request notifications: sharding@mun.ca

The project initially has Netlify team-login protection. After secure sign-in/database setup and deployment verification, remove the outer visitor gate to allow the requested public calendar. Application-level authentication continues to protect private records.

No real booking records or emails were created during testing. The local QA server uses isolated in-memory data and never sends mail. It is not a deployable production server and is not imported by Netlify Functions.

## Local checks and preview

Requires Node 22+.

```sh
npm ci
npm test
npm run build
npm run dev
```

The local preview uses an in-memory PostgreSQL-compatible database. Its Sign in button opens a clearly labelled preview administrator. This bypass exists only in `server/dev.mjs`, outside the public directory and not referenced by production functions.

## GitHub and Netlify deployment

1. Source repository: `svharding/CLAMS`.
2. Upload this directory, excluding `node_modules`, `.env`, and `.netlify`.
3. Connect the existing Netlify project above to that repository. Build: `npm run build`; publish: `public`; functions: `netlify/functions`.
4. Netlify Database provisions through `@netlify/database`; committed migrations in `netlify/database/migrations` create the schema on deployment. It requires a compatible credit-based plan. Confirm availability before launch; do not switch to browser-only persistence.
5. Set the environment variables below and redeploy.
6. Configure Google, sign in with the booking mailbox, connect Gmail in Administration, and test live with an expressly approved test recipient before opening bookings.
7. Verify anonymous calendar access, protected admin/export endpoints, overlapping approvals, and actual email delivery. Only then make the calendar publicly accessible.

## Google setup

Create a Google Cloud project controlled by the booking-account owner. Enable the Gmail API. Configure an OAuth web client and consent screen. Use the deployed HTTPS origin and this exact callback:

`https://mun-clams-booking.netlify.app/api/auth/callback`

Scopes: `openid`, `email`, `profile`; the separate administrator-only Connect Gmail flow additionally requests `https://www.googleapis.com/auth/gmail.send`.

Users sign in through a one-time link sent to their email, including @mun.ca; no Google account is required. Links expire after 15 minutes and require the same browser that requested them. An explicit confirmation POST prevents passive email scanners from consuming links. Only token hashes are stored, and login emails are sent immediately rather than through the booking queue. Limits: five links per address per hour, ten per browser per hour, and fifty total per hour. Existing users and training records are preserved.

Before email-link sign-in can work, an allowlisted administrator uses the Administrator Google sign-in option, then Administration → Connect Gmail. Google sign-in is restricted to administrator addresses. The default administrator is the booking mailbox. Keep the Google OAuth client variables: they are still needed for mailbox authorization.

Set these in Netlify's environment variables, with Functions scope:

| Variable | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Google OAuth web-client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret, entered securely |
| `SESSION_SECRET` | Random secret of at least 32 characters; generate locally with a secure password manager or Node crypto |
| `ADMIN_EMAILS` | `clams.booking.mun@gmail.com` (comma-separated allowlist) |
| `REQUEST_EMAIL` | `sharding@mun.ca` |

Netlify supplies `URL` and database configuration. Do not paste secrets in chat or commit them to GitHub. Rotating `SESSION_SECRET` also invalidates the encrypted Gmail refresh token: reconnect Gmail afterward.

An external Google OAuth app left in Testing has short-lived authorization, commonly seven days for the Gmail grant. Complete Google's applicable publishing/verification requirements before claiming unattended production readiness. Consent-screen requirements depend on deployment audience and Google's review; clicking Connect Gmail alone does not create the Google Cloud client.

## Operational details

- Pending requests do not hold dates. Confirming/changing dates takes a database transaction and a table lock, then checks for overlapping confirmed bookings or maintenance, preventing two concurrent approvals from reserving the same dates.
- Bookings use date-only intervals `[start, release)` and seven-day multiples, so DST does not shorten a booking week.
- All bookings retain their rate for reporting. Cancellation stops the reservation; financial adjustment is an administrator decision. Billing is tracking/export only, not payment collection.
- User-group notices contain only PI, dates, contact and booking status. They are sent individually, without disclosing the mailing list.
- Delivery is at-least-once. A crash after Gmail accepts a message but before the sent status saves can cause a duplicate on retry. Failed sends retry up to eight times; the admin dashboard shows failures.
- Up to 50 messages are processed in concurrent batches of five per weekday 08:00/14:00 America/St_Johns check, with a 15-second batch-start budget and 8-second send timeouts. Remaining messages wait for the next check or manual Send/retry. Weekend mail waits until Monday. Sign-in links remain immediate. UTC cron covers both DST offsets; a local-time guard skips alternate slots before importing database code.
- Maintenance is blocked in whole-week units in this version and carries no charge.
- Returning users can view their requests. Pre-filling past study details and automatic reminder emails are not implemented.
- No backups are configured by this repository; configure provider backup/recovery and retention appropriate for the lab before entering production records.

## Validation

`npm test` exercises real SQL against isolated PGlite PostgreSQL: role checks, private record ownership, training gate/override, fee and date rules, pending-to-confirmed behavior, conflicting and adjacent bookings, maintenance collisions, billing and XLSX generation, public field minimization, mail recipient content, cancellation, CSRF origin rejection, OAuth state tampering and token encryption.

Live Google OAuth, Gmail delivery, Netlify deployment and database provisioning require account setup and remain unverified until those steps are completed. The concurrent-lock strategy is implemented but not load-tested against hosted PostgreSQL.

## Credit monitoring

Scheduled mail checks log only counts, elapsed milliseconds and failure state, never recipient addresses or message content. Compare Netlify billing compute (database versus functions where available), production deploys, requests and bandwidth daily. Logs are operational evidence, not billed-credit measurements. Do not poll app APIs for monitoring: that wakes the database. Before change, the user reported 262.5 compute, 60 deployment and 1.1 traffic/bandwidth credits for the previous team billing cycle; a new-cycle baseline must be read from Netlify billing.
