# Open Issues

- AI usage accounting can undercount planner, executor-retry, and fallback provider calls because final accounting is based mainly on the serialized result. Address this in a focused AI metering change, separate from decision-engine safety work.
- The security audit gate currently reports unallowlisted high-severity advisories for `@grpc/grpc-js` and `form-data` in the root/API/Stripe workspaces, plus `react-router` in the web UI. Address these in a focused dependency update.
