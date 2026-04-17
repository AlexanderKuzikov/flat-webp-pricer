const fs = require('node:fs/promises');
const path = require('node:path');

async function createState(runtime) {
  await fs.mkdir(runtime.logsDir, { recursive: true });

  const stateFile = path.join(runtime.logsDir, 'state.jsonl');
  const runDir = path.join(runtime.logsDir, `run-${timestampId()}`);
  await fs.mkdir(runDir, { recursive: true });

  const eventsFile = path.join(runDir, 'events.jsonl');
  const resultsCsvFile = path.join(runDir, 'results.csv');
  const summaryJsonFile = path.join(runDir, 'summary.json');
  const summaryCsvFile = path.join(runDir, 'summary.csv');

  const processedKeys = runtime.resumeFromState
    ? await loadProcessedKeys(stateFile)
    : new Set();

  const stateWriter = createAppendWriter(stateFile);
  const eventsWriter = createAppendWriter(eventsFile);
  const csvWriter = createAppendWriter(resultsCsvFile);

  await csvWriter.append(csvHeader());

  return {
    processedKeys,
    paths: {
      stateFile,
      runDir,
      eventsFile,
      resultsCsvFile,
      summaryJsonFile,
      summaryCsvFile
    },

    async appendResult(result) {
      processedKeys.add(result.sourceKey);

      const line = JSON.stringify(result);
      await Promise.all([
        stateWriter.append(`${line}\n`),
        eventsWriter.append(`${line}\n`),
        csvWriter.append(toCsvRow(result))
      ]);
    },

    async writeSummary(summary) {
      await fs.writeFile(summaryJsonFile, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
      await fs.writeFile(summaryCsvFile, summaryToCsv(summary), 'utf8');
    },

    async close() {
      await Promise.all([
        stateWriter.flush(),
        eventsWriter.flush(),
        csvWriter.flush()
      ]);
    }
  };
}

async function loadProcessedKeys(stateFile) {
  const text = await fs.readFile(stateFile, 'utf8').catch(() => '');
  const set = new Set();

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;

    try {
      const record = JSON.parse(line);
      if (record && record.sourceKey) {
        set.add(record.sourceKey);
      }
    } catch (_) {
    }
  }

  return set;
}

function createAppendWriter(filePath) {
  let queue = Promise.resolve();

  return {
    append(text) {
      queue = queue.then(() => fs.appendFile(filePath, text, 'utf8'));
      return queue;
    },
    flush() {
      return queue;
    }
  };
}

function timestampId() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function csvHeader() {
  return [
    'finishedAt',
    'sourceKey',
    'sourcePath',
    'outputPath',
    'classification',
    'price',
    'parseStatus',
    'routeReason',
    'retriesUsed',
    'latencyMs',
    'wasRenamed',
    'copyOk',
    'parsedText',
    'rawResponse',
    'errorMessage'
  ].join(',') + '\n';
}

function toCsvRow(record) {
  const values = [
    record.finishedAt,
    record.sourceKey,
    record.sourcePath,
    record.outputPath,
    record.classification,
    record.price,
    record.parseStatus,
    record.routeReason,
    record.retriesUsed,
    record.latencyMs,
    record.wasRenamed,
    record.copyOk,
    record.parsedText,
    record.rawResponse,
    record.errorMessage
  ];

  return values.map(escapeCsv).join(',') + '\n';
}

function summaryToCsv(summary) {
  const keys = Object.keys(summary);
  const header = keys.join(',');
  const row = keys.map((key) => escapeCsv(summary[key])).join(',');
  return `${header}\n${row}\n`;
}

function escapeCsv(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

module.exports = {
  createState
};