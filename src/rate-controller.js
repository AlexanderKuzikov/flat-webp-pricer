function createRateController(config) {
  const enabled = Boolean(config.adaptiveSpeed);
  const minGapMs = Math.max(0, config.minGapMs || 0);
  const maxGapMs = Math.max(minGapMs, config.maxGapMs || minGapMs);
  const targetLatencyMs = Math.max(1, config.targetLatencyMs || 4000);
  const decreaseStepMs = Math.max(1, config.decreaseStepMs || 100);
  const increaseFactor = Math.max(1.05, config.increaseFactor || 1.7);
  const ewmaAlpha = clamp(config.ewmaAlpha ?? 0.2, 0.01, 1);
  const cooldownAfterErrorMs = Math.max(0, config.cooldownAfterErrorMs || 0);

  let currentGapMs = clamp(config.initialGapMs ?? config.minRequestIntervalMs ?? 0, minGapMs, maxGapMs);
  let ewmaLatencyMs = 0;
  let lastErrorAt = 0;
  let started = 0;
  let succeeded = 0;
  let failed = 0;
  let adjustments = 0;
  let requestGate = Promise.resolve();
  let nextAllowedAt = 0;

  return {
    enabled,

    async waitTurn() {
      let release;
      const previous = requestGate;
      requestGate = new Promise((resolve) => {
        release = resolve;
      });

      await previous;

      try {
        const now = Date.now();
        const waitMs = Math.max(0, nextAllowedAt - now);
        if (waitMs > 0) {
          await sleep(waitMs);
        }
        started += 1;
      } finally {
        release();
      }
    },

    markSuccess(latencyMs) {
      succeeded += 1;
      ewmaLatencyMs = ewmaLatencyMs === 0
        ? latencyMs
        : ewmaLatencyMs * (1 - ewmaAlpha) + latencyMs * ewmaAlpha;

      if (!enabled) {
        nextAllowedAt = Date.now() + currentGapMs;
        return snapshot();
      }

      const now = Date.now();
      const inCooldown = cooldownAfterErrorMs > 0 && (now - lastErrorAt) < cooldownAfterErrorMs;

      if (!inCooldown) {
        if (ewmaLatencyMs <= targetLatencyMs * 0.92) {
          const nextGap = clamp(currentGapMs - decreaseStepMs, minGapMs, maxGapMs);
          if (nextGap !== currentGapMs) {
            currentGapMs = nextGap;
            adjustments += 1;
          }
        } else if (ewmaLatencyMs >= targetLatencyMs * 1.15) {
          const nextGap = clamp(Math.ceil(Math.max(currentGapMs + 1, currentGapMs * increaseFactor)), minGapMs, maxGapMs);
          if (nextGap !== currentGapMs) {
            currentGapMs = nextGap;
            adjustments += 1;
          }
        }
      }

      nextAllowedAt = Date.now() + currentGapMs;
      return snapshot();
    },

    markFailure(latencyMs) {
      failed += 1;
      lastErrorAt = Date.now();

      if (latencyMs > 0) {
        ewmaLatencyMs = ewmaLatencyMs === 0
          ? latencyMs
          : ewmaLatencyMs * (1 - ewmaAlpha) + latencyMs * ewmaAlpha;
      }

      if (enabled) {
        const nextGap = clamp(
          Math.ceil(Math.max(currentGapMs + 1, currentGapMs * increaseFactor, minGapMs + 1)),
          minGapMs,
          maxGapMs
        );

        if (nextGap !== currentGapMs) {
          currentGapMs = nextGap;
          adjustments += 1;
        }
      }

      nextAllowedAt = Date.now() + currentGapMs;
      return snapshot();
    },

    getSnapshot() {
      return snapshot();
    }
  };

  function snapshot() {
    return {
      enabled,
      currentGapMs,
      ewmaLatencyMs: round(ewmaLatencyMs, 2),
      started,
      succeeded,
      failed,
      adjustments,
      targetLatencyMs
    };
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 0) {
  const pow = 10 ** digits;
  return Math.round(value * pow) / pow;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  createRateController
};