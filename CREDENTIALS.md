# Fresha Salon App Credentials

These are the synthetic demo credentials seeded into the Aiven database on 31
August 2026.

## Production app

- App: <https://fresha-salon-app-prod.onrender.com>
- Aiven PostgreSQL host: `pg-304f6ad0-sanpatel323-ce9d.f.aivencloud.com`
- Aiven connection string: stored in local `prod.env` only

## Customer accounts

| Name | Email | Password |
| --- | --- | --- |
| Jane Doe | `jane@example.com` | `customer123` |
| John Smith | `john@example.com` | `customer123` |

Use the customer portal.

## Salon owner accounts

| Salon | Email | Password |
| --- | --- | --- |
| Orchid Luxury Hair & Spa | `owner@orchid.com` | `salon123` |
| Aura Mens Grooming & Co | `owner@aura.com` | `salon123` |
| Vibe Quick Cuts & Styles | `owner@vibe.com` | `salon123` |

Use the salon-owner portal.

## Staff accounts

| Name | Email | Password | Salon |
| --- | --- | --- | --- |
| Dr. Sarah Jenkins | `sarah@orchid.com` | `staff123` | Orchid Luxury Hair & Spa |
| Marcus Aurelius | `marcus@orchid.com` | `staff123` | Orchid Luxury Hair & Spa |
| James Oliver | `james@aura.com` | `staff123` | Aura Mens Grooming & Co |
| Tina Miller | `tina@vibe.com` | `staff123` | Vibe Quick Cuts & Styles |

Use the staff portal.

## Admin account

- Username: `admin`
- Password: `ADMIN_PASS` in `prod.env` or the Render service environment
- Portal: <https://fresha-salon-app-prod.onrender.com/admin>

## Protected configuration

The following values are intentionally not copied into this Markdown file:

- `DATABASE_URL`
- `JWT_SECRET`
- `ADMIN_PASS`
- `BREVO_API_KEY`
- `CASHFREE_APP_ID`
- `CASHFREE_SECRET_KEY`

Local values are in `prod.env`. Render values are in the service's protected
Environment settings. Do not commit or share those values in plaintext.
