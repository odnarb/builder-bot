# Marketing Plan Comparison (Website-Ready)

Last updated: **2026-02-21**
Source of truth: `apps/api/config/tier-policy.js` and `apps/api/config/sku-catalog.js`

## Goal
Help visitors quickly understand what each plan can do, who it is for, and when to upgrade.

## Public Plan Names (Use These Everywhere)
- `Free`
- `Starter`
- `Pro`
- `Admin`

Keep checkout SKUs aligned with these monthly plans only:
- `starter_monthly`
- `pro_monthly`
- `admin_monthly`

## What Everyone Gets
- Build with normal language prompts.
  Example: "Build a stone tower with windows."
- In-game chat control.
- Server-side safety checks on build plans.
- Access to core BuilderBot building flow.

## Plan Comparison (Simple)

| Plan | Price | Best For | Max Build Size | Build Requests | Builds Running At Once | Command Blocks |
|---|---:|---|---:|---|---:|---|
| **Free** | $0 | First-time users testing the bot | 50 blocks/build | 12 per day, 100 per month | 1 | No |
| **Starter** | $4.99/mo | Regular players building small-to-medium projects | 500 blocks/build | 80 per day, 1,000 per month | 2 | No |
| **Pro** | $12.99/mo | Serious builders making larger projects | 2,000 blocks/build | 300 per day, 5,000 per month | 4 | Yes |
| **Admin** | $24.99/mo | Power users and server owners needing highest limits | 6,000 blocks/build | 900 per day, 15,000 per month | 8 | Yes |

## How To Explain The Upgrades
- **Free → Starter**: "Build bigger and build more often."
- **Starter → Pro**: "Unlock command blocks and much larger builds."
- **Pro → Admin**: "Get the highest limits and highest concurrency for heavy usage."

## Short Plan Card Copy

### Free
Great for trying BuilderBot. Build small projects and learn how it works.

### Starter
A solid everyday plan. Bigger builds, more requests, and smoother progress.

### Pro
For serious creative builds. Command blocks + much larger projects.

### Admin
For high-volume usage. Biggest limits, most parallel builds, and full advanced access.

## Website Clarity Rules
- Always use "up to" for limits.
- Do not use "unlimited" in plan cards.
- Keep names and prices exactly aligned with backend policy.
- Show the same order everywhere: `Free`, `Starter`, `Pro`, `Admin`.

## FAQ Snippets
- **Can I use BuilderBot for free?**
  Yes. Free includes up to 50-block builds and monthly usage limits.

- **When should I upgrade to Pro?**
  Upgrade when you want command blocks and larger build limits.

- **Who should use Admin?**
  Users who run many large builds and need the highest request and concurrency limits.
