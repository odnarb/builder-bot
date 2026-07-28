# Open Issues

- AI usage accounting can undercount planner, executor-retry, and fallback provider calls because final accounting is based mainly on the serialized result. Address this in a focused AI metering change, separate from decision-engine safety work.
