#!/usr/bin/env node

const path = require('node:path');
const { loadRuntimeConfig } = require('./config');
const { scanInputFiles } = require('./scanner');
const { prepareModelImageDataUrl, copyOriginalToTarget } = require('./image');
const { probeServer, inferPriceFromImage } = require('./lmstudio');
const { parsePrice, classifyPrice } = require('./parser');
const { createRouter } = require('./router');
const { createState } = require('./state');
const { createReporter } = require('./reporter');
const { createRateController } = require('./rate-controller');

async function main() {
  const runtime = await loadRuntimeConfig();
  const reporter = createReporter();
  const state = await createState(runtime);
  const router = await createRouter(runtime);
  const rateController = createRateController(runtime);

  if (runtime.configMode === 'relaxed-json') {
    reporter.warn('config.json прочитан в tolerant-режиме. Для строгого JSON лучше использовать / или экранировать \\ как \\\\.');
  }

  const probe = await probeServer(runtime).catch((error) => ({
    ok: false,
    error: error.message,
    modelFound: false,
    modelCount: 0
  }));

  if (!probe.ok) {
    throw new Error(`LM Studio недоступен: ${probe.error}`);
  }

  if (!probe.modelFound) {
    reporter.warn(`Модель "${runtime.model}" не найдена в /v1/models. Продолжаю, но проверь загрузку модели в LM Studio.`);
  }

  const allFiles = await scanInputFiles(runtime.inputDir, runtime.supportedExtensions);
  const skippedFromState = runtime.resumeFromState
    ? allFiles.filter((file) => state.processedKeys.has(file.sourceKey)).length
    : 0;

  let queue = runtime.resumeFromState
    ? allFiles.filter((file) => !state.processedKeys.has(file.sourceKey))
    : allFiles.slice();

  if (runtime.stopAfter > 0) {
    queue = queue.slice(0, runtime.stopAfter);
  }

  const stats = {
    startedAt: Date.now(),
    scanned: allFiles.length,
    queued: queue.length,
    skippedFromState,
    done: 0,
    valid: 0,
    review: 0,
    apiErrors: 0,
    retriesUsed: 0,
    renamedByCollision: 0,
    copied: 0,
    failedCopies: 0,
    latencies: [],
    inputDir: runtime.inputDir,
    outputValidDir: runtime.outputValidDir,
    outputReviewDir: runtime.outputReviewDir,
    logsDir: runtime.logsDir,
    configMode: runtime.configMode,
    concurrency: runtime.concurrency,
    model: runtime.model,
    promptFile: runtime.promptFile,
    promptSha256: runtime.promptSha256,
    adaptiveSpeed: runtime.adaptiveSpeed,
    minGapMs: runtime.minGapMs,
    maxGapMs: runtime.maxGapMs
  };

  reporter.info(`Сканирование завершено: всего файлов ${stats.scanned}, в очереди ${stats.queued}, пропущено по state ${stats.skippedFromState}.`);
  reporter.info(`LM Studio: модель ${runtime.model}, concurrency ${runtime.concurrency}, adaptive ${runtime.adaptiveSpeed ? 'on' : 'off'}.`);
  reporter.info(`Prompt: ${runtime.promptFile}`);
  reporter.info(`Логи: ${state.paths.runDir}`);

  if (queue.length === 0) {
    reporter.info('Все файлы уже есть в state, обработка не требуется.');
    const summary = buildSummary(stats, rateController.getSnapshot());
    await state.writeSummary(summary);
    reporter.summary(summary);
    await state.close();
    return;
  }

  reporter.start(queue.length);

  await runWithConcurrency(queue, runtime.concurrency, async (file) => {
    reporter.update({
      done: stats.done,
      total: stats.queued,
      valid: stats.valid,
      review: stats.review,
      apiErrors: stats.apiErrors,
      retriesUsed: stats.retriesUsed,
      avgLatencyMs: average(stats.latencies),
      ewmaLatencyMs: rateController.getSnapshot().ewmaLatencyMs,
      currentGapMs: rateController.getSnapshot().currentGapMs,
      etaMs: estimateEtaMs(stats),
      ratePerMin: estimateRatePerMin(stats),
      currentFile: file.sourcePath,
      phase: 'resize'
    });

    const result = await processOne(file, runtime, router, rateController, reporter, stats);

    stats.done += 1;
    stats.retriesUsed += result.retriesUsed;
    stats.latencies.push(result.latencyMs);

    if (result.classification === 'valid') {
      stats.valid += 1;
    } else {
      stats.review += 1;
    }

    if (result.routeReason === 'api_error' || result.routeReason === 'resize_error') {
      stats.apiErrors += 1;
    }

    if (result.wasRenamed) {
      stats.renamedByCollision += 1;
    }

    if (result.copyOk) {
      stats.copied += 1;
    } else {
      stats.failedCopies += 1;
    }

    await state.appendResult(result);

    const rate = rateController.getSnapshot();

    reporter.tick({
      done: stats.done,
      total: stats.queued,
      valid: stats.valid,
      review: stats.review,
      apiErrors: stats.apiErrors,
      retriesUsed: stats.retriesUsed,
      avgLatencyMs: average(stats.latencies),
      ewmaLatencyMs: rate.ewmaLatencyMs,
      currentGapMs: rate.currentGapMs,
      etaMs: estimateEtaMs(stats),
      ratePerMin: estimateRatePerMin(stats),
      currentFile: file.sourcePath,
      phase: 'done'
    });
  });

  reporter.finish();

  const summary = buildSummary(stats, rateController.getSnapshot());
  await state.writeSummary(summary);
  reporter.summary(summary);
  await state.close();
}

async function processOne(file, runtime, router, rateController, reporter, stats) {
  const startedAt = Date.now();
  let imageDataUrl = null;
  let rawResponse = '';
  let parsed = { price: 0, parsedText: '', parseStatus: 'empty' };
  let retriesUsed = 0;
  let routeReason = 'api_error';
  let classification = 'review';
  let outputPath = '';
  let wasRenamed = false;
  let errorMessage = '';
  let copyOk = false;

  try {
    reporter.update(buildLiveState(stats, rateController, file.sourcePath, 'resize'));
    imageDataUrl = await prepareModelImageDataUrl(
      file.sourcePath,
      runtime.imageWidthForModel,
      runtime.jpegQualityForModel
    );
  } catch (error) {
    errorMessage = `resize: ${error.message}`;
    routeReason = 'resize_error';
  }

  if (imageDataUrl) {
    for (let attempt = 0; attempt <= runtime.maxRetries; attempt += 1) {
      const attemptStartedAt = Date.now();

      try {
        reporter.update(buildLiveState(stats, rateController, file.sourcePath, 'wait-gap'));
        await rateController.waitTurn();

        reporter.update(buildLiveState(stats, rateController, file.sourcePath, 'request'));
        rawResponse = await inferPriceFromImage(runtime, imageDataUrl);

        const latencyMs = Date.now() - attemptStartedAt;
        rateController.markSuccess(latencyMs);

        parsed = parsePrice(rawResponse);
        classification = classifyPrice(parsed.price, runtime.minValidPrice);
        routeReason = getRouteReason(parsed.price, classification, parsed.parseStatus);
        break;
      } catch (error) {
        const latencyMs = Date.now() - attemptStartedAt;
        rateController.markFailure(latencyMs);
        errorMessage = error.message;

        if (attempt < runtime.maxRetries) {
          retriesUsed += 1;
          reporter.update(buildLiveState(stats, rateController, file.sourcePath, 'retry-wait'));
          await sleep(runtime.retryBaseDelayMs * Math.max(1, attempt + 1));
          continue;
        }

        rawResponse = '';
        parsed = { price: 0, parsedText: '', parseStatus: 'api_error' };
        classification = 'review';
        routeReason = 'api_error';
      }
    }
  }

  const reserved = await router.reserveTarget({
    sourcePath: file.sourcePath,
    classification,
    price: parsed.price
  });

  outputPath = reserved.outputPath;
  wasRenamed = reserved.wasRenamed;

  try {
    reporter.update(buildLiveState(stats, rateController, file.sourcePath, 'copy'));
    await copyOriginalToTarget(file.sourcePath, outputPath, runtime.overwriteExisting);
    copyOk = true;
  } catch (error) {
    copyOk = false;
    errorMessage = errorMessage
      ? `${errorMessage}; copy: ${error.message}`
      : `copy: ${error.message}`;
  }

  return {
    finishedAt: new Date().toISOString(),
    sourceKey: file.sourceKey,
    sourcePath: file.sourcePath,
    outputPath,
    baseName: path.parse(file.sourcePath).name,
    ext: path.extname(file.sourcePath),
    classification,
    price: parsed.price,
    parsedText: parsed.parsedText,
    parseStatus: parsed.parseStatus,
    routeReason,
    rawResponse: limitText(rawResponse, 300),
    retriesUsed,
    latencyMs: Date.now() - startedAt,
    wasRenamed,
    copyOk,
    errorMessage
  };
}

function buildLiveState(stats, rateController, currentFile, phase) {
  const rate = rateController.getSnapshot();

  return {
    done: stats.done,
    total: stats.queued,
    valid: stats.valid,
    review: stats.review,
    apiErrors: stats.apiErrors,
    retriesUsed: stats.retriesUsed,
    avgLatencyMs: average(stats.latencies),
    ewmaLatencyMs: rate.ewmaLatencyMs,
    currentGapMs: rate.currentGapMs,
    etaMs: estimateEtaMs(stats),
    ratePerMin: estimateRatePerMin(stats),
    currentFile,
    phase
  };
}

function getRouteReason(price, classification, parseStatus) {
  if (classification === 'valid') {
    return 'valid_price';
  }

  if (parseStatus === 'api_error') {
    return 'api_error';
  }

  if (parseStatus === 'empty' || parseStatus === 'no_digits') {
    return 'no_price_detected';
  }

  if (price === 0) {
    return 'zero_price';
  }

  return 'price_below_threshold';
}

async function runWithConcurrency(items, limit, worker) {
  const workerCount = Math.max(1, Math.min(limit, items.length));
  let index = 0;

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const current = index;
        index += 1;

        if (current >= items.length) {
          return;
        }

        await worker(items[current], current);
      }
    })
  );
}

function buildSummary(stats, rate) {
  const durationMs = Date.now() - stats.startedAt;

  return {
    finishedAt: new Date().toISOString(),
    durationMs,
    durationSec: round(durationMs / 1000, 2),
    scanned: stats.scanned,
    queued: stats.queued,
    skippedFromState: stats.skippedFromState,
    done: stats.done,
    valid: stats.valid,
    review: stats.review,
    apiErrors: stats.apiErrors,
    retriesUsed: stats.retriesUsed,
    renamedByCollision: stats.renamedByCollision,
    copied: stats.copied,
    failedCopies: stats.failedCopies,
    avgLatencyMs: round(average(stats.latencies), 2),
    p50LatencyMs: round(percentile(stats.latencies, 50), 2),
    p95LatencyMs: round(percentile(stats.latencies, 95), 2),
    ratePerMin: round(estimateRatePerMin(stats), 2),
    inputDir: stats.inputDir,
    outputValidDir: stats.outputValidDir,
    outputReviewDir: stats.outputReviewDir,
    logsDir: stats.logsDir,
    configMode: stats.configMode,
    concurrency: stats.concurrency,
    model: stats.model,
    promptFile: stats.promptFile,
    promptSha256: stats.promptSha256,
    adaptiveSpeed: stats.adaptiveSpeed,
    minGapMs: stats.minGapMs,
    maxGapMs: stats.maxGapMs,
    finalGapMs: rate.currentGapMs,
    finalEwmaLatencyMs: rate.ewmaLatencyMs
  };
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function estimateRatePerMin(stats) {
  const elapsedMs = Date.now() - stats.startedAt;
  if (elapsedMs <= 0 || stats.done === 0) return 0;
  return (stats.done / elapsedMs) * 60000;
}

function estimateEtaMs(stats) {
  if (stats.done === 0) return 0;
  const elapsedMs = Date.now() - stats.startedAt;
  const ratePerMs = stats.done / elapsedMs;
  if (ratePerMs <= 0) return 0;
  return (stats.queued - stats.done) / ratePerMs;
}

function round(value, digits = 0) {
  const pow = 10 ** digits;
  return Math.round(value * pow) / pow;
}

function limitText(value, maxLength) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  process.stderr.write(`[FATAL] ${error.message}\n`);
  process.exitCode = 1;
});