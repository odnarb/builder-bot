function createEmptyState() {
  return {
    localPlanCount: 0,
    aiPlanCount: 0,
    aiPatchPlanCount: 0,
    localPlanSuccessCount: 0,
    aiPlanSuccessCount: 0,
    failedBuildCount: 0,
  };
}

const state = createEmptyState();

function normalizeSource(source) {
  return String(source || '').trim().toLowerCase() === 'local' ? 'local' : 'ai';
}

function recordPlanSourceInState(targetState, source, options = {}) {
  const normalizedSource = normalizeSource(source);
  const isPatch = Boolean(options.isPatch);

  if (normalizedSource === 'local') {
    targetState.localPlanCount += 1;
    return;
  }

  if (isPatch) {
    targetState.aiPatchPlanCount += 1;
  } else {
    targetState.aiPlanCount += 1;
  }
}

function recordBuildOutcomeInState(targetState, { source, success }) {
  if (success) {
    if (normalizeSource(source) === 'local') {
      targetState.localPlanSuccessCount += 1;
    } else {
      targetState.aiPlanSuccessCount += 1;
    }
    return;
  }

  targetState.failedBuildCount += 1;
}

function snapshotState(targetState) {
  const totalInitialPlans = targetState.localPlanCount + targetState.aiPlanCount;
  const localPlanRatio = totalInitialPlans > 0
    ? Number((targetState.localPlanCount / totalInitialPlans).toFixed(4))
    : 0;

  return {
    ...targetState,
    totalInitialPlans,
    localPlanRatio,
  };
}

export function recordPlanSource(source, options = {}) {
  recordPlanSourceInState(state, source, options);
}

export function recordBuildOutcome({ source, success }) {
  recordBuildOutcomeInState(state, { source, success });
}

export function getDecisionTelemetrySnapshot() {
  return snapshotState(state);
}

export function createDecisionTelemetryScope() {
  const scopedState = createEmptyState();

  return {
    recordPlanSource(source, options = {}) {
      recordPlanSource(source, options);
      recordPlanSourceInState(scopedState, source, options);
    },
    recordBuildOutcome({ source, success }) {
      recordBuildOutcome({ source, success });
      recordBuildOutcomeInState(scopedState, { source, success });
    },
    getSnapshot() {
      return snapshotState(scopedState);
    },
  };
}

export function resetDecisionTelemetry() {
  state.localPlanCount = 0;
  state.aiPlanCount = 0;
  state.aiPatchPlanCount = 0;
  state.localPlanSuccessCount = 0;
  state.aiPlanSuccessCount = 0;
  state.failedBuildCount = 0;
}
