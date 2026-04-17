const readline = require('node:readline');

function createReporter() {
  const stdout = process.stdout;
  const stderr = process.stderr;
  const isTTY = Boolean(stdout.isTTY);

  let active = false;
  let renderedLines = 0;
  let latest = null;
  let total = 0;
  let timer = null;
  let startedAt = 0;
  let lastNonTtyAt = 0;

  if (isTTY && typeof stdout.on === 'function') {
    stdout.on('resize', () => {
      if (active && latest) {
        render(true);
      }
    });
  }

  return {
    info(message) {
      suspendForMessage();
      stdout.write(`${message}\n`);
      resumeAfterMessage();
    },

    warn(message) {
      suspendForMessage();
      stderr.write(`[WARN] ${message}\n`);
      resumeAfterMessage();
    },

    start(totalFiles) {
      total = totalFiles;
      startedAt = Date.now();
      active = true;
      latest = {
        done: 0,
        total,
        valid: 0,
        review: 0,
        apiErrors: 0,
        retriesUsed: 0,
        avgLatencyMs: 0,
        ewmaLatencyMs: 0,
        currentGapMs: 0,
        etaMs: 0,
        ratePerMin: 0,
        currentFile: '',
        phase: 'idle'
      };

      render(true);

      if (isTTY) {
        timer = setInterval(() => {
          if (active) {
            render(false);
          }
        }, 150);

        if (typeof timer.unref === 'function') {
          timer.unref();
        }
      }
    },

    update(snapshot) {
      latest = {
        ...latest,
        ...snapshot
      };
    },

    tick(snapshot) {
      latest = {
        ...latest,
        ...snapshot
      };

      if (!isTTY) {
        render(false);
      }
    },

    finish() {
      stopTimer();

      if (!active) {
        return;
      }

      render(true);
      clearActiveBlock();
      active = false;
      latest = null;
    },

    summary(summary) {
      const lines = [
        '',
        'Готово.',
        `Модель          : ${summary.model}`,
        `Prompt file     : ${summary.promptFile}`,
        `Prompt sha256   : ${summary.promptSha256}`,
        `Режим конфига   : ${summary.configMode}`,
        `Input           : ${summary.inputDir}`,
        `OUT valid       : ${summary.outputValidDir}`,
        `OUT review      : ${summary.outputReviewDir}`,
        `Логи            : ${summary.logsDir}`,
        `Concurrency     : ${summary.concurrency}`,
        `Adaptive speed  : ${summary.adaptiveSpeed}`,
        `Gap ms final    : ${summary.finalGapMs}`,
        `Gap ms min/max  : ${summary.minGapMs}/${summary.maxGapMs}`,
        `EWMA ms final   : ${summary.finalEwmaLatencyMs}`,
        `Сканировано     : ${summary.scanned}`,
        `В очереди       : ${summary.queued}`,
        `Пропущено state : ${summary.skippedFromState}`,
        `Valid           : ${summary.valid}`,
        `Review          : ${summary.review}`,
        `API errors      : ${summary.apiErrors}`,
        `Retries used    : ${summary.retriesUsed}`,
        `Коллизии имен   : ${summary.renamedByCollision}`,
        `Avg ms          : ${summary.avgLatencyMs}`,
        `P50 ms          : ${summary.p50LatencyMs}`,
        `P95 ms          : ${summary.p95LatencyMs}`,
        `Rate img/min    : ${summary.ratePerMin}`,
        `Duration sec    : ${summary.durationSec}`
      ];

      stdout.write(`${lines.join('\n')}\n`);
    }
  };

  function render(force) {
    if (!active || !latest) return;

    const columns = Math.max(60, Number(stdout.columns) || 100);
    const done = latest.done;
    const totalLocal = latest.total || total || 0;
    const percent = totalLocal > 0 ? Math.floor((done / totalLocal) * 100) : 100;

    const prefix = `${padLeft(done, String(totalLocal).length)}/${totalLocal} ${padLeft(percent, 3)}% `;
    const staticPrefix = 'flat-webp-pricer ';
    const barWidth = Math.max(10, Math.min(26, columns - staticPrefix.length - prefix.length - 1));
    const filled = totalLocal > 0 ? Math.round((done / totalLocal) * barWidth) : barWidth;
    const bar = `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, barWidth - filled))}`;

    const elapsedMs = Date.now() - startedAt;

    const line1 = fitLine(`${staticPrefix}${prefix}${bar}`, columns);
    const line2 = fitLine(
      `valid:${latest.valid} review:${latest.review} err:${latest.apiErrors} retry:${latest.retriesUsed} gap:${latest.currentGapMs}ms ewma:${Math.round(latest.ewmaLatencyMs)}ms avg:${Math.round(latest.avgLatencyMs)}ms elapsed:${formatEta(elapsedMs)} eta:${formatEta(latest.etaMs)} rate:${latest.ratePerMin.toFixed(1)}/min`,
      columns
    );
    const line3 = fitLine(
      `phase:${latest.phase || 'idle'}  file:${latest.currentFile || '—'}`,
      columns
    );

    if (!isTTY) {
      const now = Date.now();
      if (force || now - lastNonTtyAt > 15000 || done === totalLocal) {
        lastNonTtyAt = now;
        stdout.write(`${line1}\n${line2}\n${line3}\n`);
      }
      return;
    }

    clearActiveBlock();
    stdout.write(`${line1}\n${line2}\n${line3}`);
    renderedLines = 3;
  }

  function suspendForMessage() {
    stopTimer();

    if (active) {
      clearActiveBlock();
    }
  }

  function resumeAfterMessage() {
    if (!active || !isTTY) {
      return;
    }

    render(true);

    timer = setInterval(() => {
      if (active) {
        render(false);
      }
    }, 150);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function clearActiveBlock() {
    if (!isTTY || renderedLines === 0) return;

    readline.cursorTo(stdout, 0);

    for (let i = 0; i < renderedLines; i += 1) {
      readline.clearLine(stdout, 0);

      if (i < renderedLines - 1) {
        readline.moveCursor(stdout, 0, 1);
        readline.cursorTo(stdout, 0);
      }
    }

    for (let i = 0; i < renderedLines - 1; i += 1) {
      readline.moveCursor(stdout, 0, -1);
      readline.cursorTo(stdout, 0);
    }

    renderedLines = 0;
  }
}

function fitLine(text, width) {
  const safeWidth = Math.max(10, width);
  const value = String(text || '');

  if (value.length <= safeWidth) {
    return value;
  }

  if (safeWidth <= 1) {
    return value.slice(0, safeWidth);
  }

  return `${value.slice(0, safeWidth - 1)}…`;
}

function padLeft(value, width) {
  return String(value).padStart(width, ' ');
}

function formatEta(ms) {
  if (!ms || ms < 1000) return '—';

  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

module.exports = {
  createReporter
};