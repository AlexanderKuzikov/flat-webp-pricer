const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config.json');

async function loadRuntimeConfig() {
  const raw = await fs.readFile(CONFIG_PATH, 'utf8');
  const parsed = parseConfigText(raw);
  validateConfig(parsed.data);

  const config = parsed.data;
  const promptFile = resolveFlexiblePath(config.promptFile, PROJECT_ROOT);
  const prompt = await loadPrompt(promptFile);

  const runtime = {
    inputDir: resolveFlexiblePath(config.inputDir, PROJECT_ROOT),
    outputValidDir: resolveFlexiblePath(config.outputValidDir, PROJECT_ROOT),
    outputReviewDir: resolveFlexiblePath(config.outputReviewDir, PROJECT_ROOT),
    logsDir: resolveFlexiblePath(config.logsDir, PROJECT_ROOT),

    apiBaseUrl: String(config.apiBaseUrl).replace(/\/+$/, ''),
    model: String(config.model).trim(),

    promptFile,
    prompt,
    promptSha256: sha256(prompt),
    promptPreview: limitText(prompt, 120),

    imageWidthForModel: config.imageWidthForModel,
    jpegQualityForModel: config.jpegQualityForModel,

    temperature: config.temperature,
    topP: config.topP,
    maxTokens: config.maxTokens,
    seed: config.seed,

    concurrency: Math.max(1, config.concurrency),
    minRequestIntervalMs: config.minRequestIntervalMs,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    retryBaseDelayMs: config.retryBaseDelayMs,

    minValidPrice: config.minValidPrice,
    stopAfter: config.stopAfter,
    resumeFromState: Boolean(config.resumeFromState),
    overwriteExisting: Boolean(config.overwriteExisting),

    supportedExtensions: new Set(config.supportedExtensions.map(normalizeExtension)),
    configMode: parsed.configMode,

    adaptiveSpeed: Boolean(config.adaptiveSpeed),
    targetLatencyMs: config.targetLatencyMs,
    minGapMs: config.minGapMs,
    maxGapMs: config.maxGapMs,
    initialGapMs: config.initialGapMs,
    decreaseStepMs: config.decreaseStepMs,
    increaseFactor: config.increaseFactor,
    ewmaAlpha: config.ewmaAlpha,
    cooldownAfterErrorMs: config.cooldownAfterErrorMs
  };

  if (samePath(runtime.inputDir, runtime.outputValidDir)) {
    throw new Error('inputDir и outputValidDir не должны совпадать.');
  }

  if (samePath(runtime.inputDir, runtime.outputReviewDir)) {
    throw new Error('inputDir и outputReviewDir не должны совпадать.');
  }

  return runtime;
}

async function loadPrompt(promptFile) {
  const text = await fs.readFile(promptFile, 'utf8').catch(() => null);

  if (text === null) {
    throw new Error(`Не удалось прочитать promptFile: ${promptFile}`);
  }

  const cleaned = String(text).replace(/^\uFEFF/, '').trim();

  if (!cleaned) {
    throw new Error(`Файл prompt пустой: ${promptFile}`);
  }

  return cleaned;
}

function parseConfigText(rawText) {
  const raw = String(rawText).replace(/^\uFEFF/, '');

  try {
    return {
      data: JSON.parse(raw),
      configMode: 'strict-json'
    };
  } catch (_) {
    return {
      data: parseRelaxedConfig(raw),
      configMode: 'relaxed-json'
    };
  }
}

function parseRelaxedConfig(raw) {
  const source = stripComments(raw);

  return {
    inputDir: extractStringField(source, 'inputDir'),
    outputValidDir: extractStringField(source, 'outputValidDir'),
    outputReviewDir: extractStringField(source, 'outputReviewDir'),
    logsDir: extractStringField(source, 'logsDir'),

    apiBaseUrl: extractStringField(source, 'apiBaseUrl'),
    model: extractStringField(source, 'model'),
    promptFile: extractStringField(source, 'promptFile'),

    imageWidthForModel: extractIntegerField(source, 'imageWidthForModel'),
    jpegQualityForModel: extractIntegerField(source, 'jpegQualityForModel'),

    temperature: extractNumberField(source, 'temperature'),
    topP: extractNumberField(source, 'topP'),
    maxTokens: extractIntegerField(source, 'maxTokens'),
    seed: extractIntegerField(source, 'seed'),

    concurrency: extractIntegerField(source, 'concurrency'),
    minRequestIntervalMs: extractIntegerField(source, 'minRequestIntervalMs'),
    timeoutMs: extractIntegerField(source, 'timeoutMs'),
    maxRetries: extractIntegerField(source, 'maxRetries'),
    retryBaseDelayMs: extractIntegerField(source, 'retryBaseDelayMs'),

    minValidPrice: extractIntegerField(source, 'minValidPrice'),
    stopAfter: extractIntegerField(source, 'stopAfter'),
    resumeFromState: extractBooleanField(source, 'resumeFromState'),
    overwriteExisting: extractBooleanField(source, 'overwriteExisting'),

    supportedExtensions: extractArrayOfStringsField(source, 'supportedExtensions'),

    adaptiveSpeed: extractBooleanField(source, 'adaptiveSpeed'),
    targetLatencyMs: extractIntegerField(source, 'targetLatencyMs'),
    minGapMs: extractIntegerField(source, 'minGapMs'),
    maxGapMs: extractIntegerField(source, 'maxGapMs'),
    initialGapMs: extractIntegerField(source, 'initialGapMs'),
    decreaseStepMs: extractIntegerField(source, 'decreaseStepMs'),
    increaseFactor: extractNumberField(source, 'increaseFactor'),
    ewmaAlpha: extractNumberField(source, 'ewmaAlpha'),
    cooldownAfterErrorMs: extractIntegerField(source, 'cooldownAfterErrorMs')
  };
}

function validateConfig(config) {
  assertNonEmptyString(config.inputDir, 'inputDir');
  assertNonEmptyString(config.outputValidDir, 'outputValidDir');
  assertNonEmptyString(config.outputReviewDir, 'outputReviewDir');
  assertNonEmptyString(config.logsDir, 'logsDir');

  assertNonEmptyString(config.apiBaseUrl, 'apiBaseUrl');
  assertNonEmptyString(config.model, 'model');
  assertNonEmptyString(config.promptFile, 'promptFile');

  assertPositiveInteger(config.imageWidthForModel, 'imageWidthForModel');
  assertIntegerInRange(config.jpegQualityForModel, 'jpegQualityForModel', 1, 100);

  assertNumberInRange(config.temperature, 'temperature', 0, 2);
  assertNumberInRange(config.topP, 'topP', 0, 1);
  assertPositiveInteger(config.maxTokens, 'maxTokens');
  assertIntegerAtLeast(config.seed, 'seed', 0);

  assertPositiveInteger(config.concurrency, 'concurrency');
  assertIntegerAtLeast(config.minRequestIntervalMs, 'minRequestIntervalMs', 0);
  assertPositiveInteger(config.timeoutMs, 'timeoutMs');
  assertIntegerAtLeast(config.maxRetries, 'maxRetries', 0);
  assertPositiveInteger(config.retryBaseDelayMs, 'retryBaseDelayMs');

  assertPositiveInteger(config.minValidPrice, 'minValidPrice');
  assertIntegerAtLeast(config.stopAfter, 'stopAfter', 0);

  if (!Array.isArray(config.supportedExtensions) || config.supportedExtensions.length === 0) {
    throw new Error('supportedExtensions должен быть непустым массивом строк.');
  }

  for (const ext of config.supportedExtensions) {
    assertNonEmptyString(ext, 'supportedExtensions[]');
  }

  if (typeof config.adaptiveSpeed !== 'boolean') {
    throw new Error('adaptiveSpeed должен быть boolean.');
  }

  assertPositiveInteger(config.targetLatencyMs, 'targetLatencyMs');
  assertIntegerAtLeast(config.minGapMs, 'minGapMs', 0);
  assertIntegerAtLeast(config.maxGapMs, 'maxGapMs', 0);
  assertIntegerAtLeast(config.initialGapMs, 'initialGapMs', 0);
  assertPositiveInteger(config.decreaseStepMs, 'decreaseStepMs');
  assertNumberInRange(config.increaseFactor, 'increaseFactor', 1.01, 10);
  assertNumberInRange(config.ewmaAlpha, 'ewmaAlpha', 0.01, 1);
  assertIntegerAtLeast(config.cooldownAfterErrorMs, 'cooldownAfterErrorMs', 0);

  if (config.maxGapMs < config.minGapMs) {
    throw new Error('maxGapMs должен быть >= minGapMs.');
  }
}

function resolveFlexiblePath(value, baseDir) {
  const prepared = normalizeSlashes(String(value).trim());
  const normalized = path.normalize(prepared);
  return path.isAbsolute(normalized)
    ? normalized
    : path.resolve(baseDir, normalized);
}

function normalizeSlashes(value) {
  if (process.platform === 'win32') {
    return value.replace(/\//g, '\\');
  }

  return value.replace(/\\/g, '/');
}

function normalizeExtension(ext) {
  const trimmed = ext.trim().toLowerCase();
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

function samePath(a, b) {
  const left = path.resolve(a);
  const right = path.resolve(b);

  if (process.platform === 'win32') {
    return left.toLowerCase() === right.toLowerCase();
  }

  return left === right;
}

function stripComments(value) {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function extractStringField(source, name) {
  const key = `"${name}"`;
  const keyIndex = source.indexOf(key);
  if (keyIndex === -1) return undefined;

  const colonIndex = source.indexOf(':', keyIndex + key.length);
  if (colonIndex === -1) return undefined;

  let i = colonIndex + 1;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  if (source[i] !== '"') return undefined;

  i += 1;
  let value = '';

  while (i < source.length) {
    const ch = source[i];

    if (ch === '"') {
      let j = i + 1;
      while (j < source.length && /\s/.test(source[j])) j += 1;
      if (j >= source.length || source[j] === ',' || source[j] === '}') {
        return value;
      }
    }

    value += ch;
    i += 1;
  }

  return value;
}

function extractIntegerField(source, name) {
  const match = source.match(new RegExp(`"${escapeRegExp(name)}"\\s*:\\s*(-?\\d+)`, 'm'));
  return match ? Number.parseInt(match[1], 10) : undefined;
}

function extractNumberField(source, name) {
  const match = source.match(new RegExp(`"${escapeRegExp(name)}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, 'm'));
  return match ? Number(match[1]) : undefined;
}

function extractBooleanField(source, name) {
  const match = source.match(new RegExp(`"${escapeRegExp(name)}"\\s*:\\s*(true|false)`, 'm'));
  return match ? match[1] === 'true' : undefined;
}

function extractArrayOfStringsField(source, name) {
  const key = `"${name}"`;
  const keyIndex = source.indexOf(key);
  if (keyIndex === -1) return undefined;

  const colonIndex = source.indexOf(':', keyIndex + key.length);
  if (colonIndex === -1) return undefined;

  const openBracket = source.indexOf('[', colonIndex + 1);
  if (openBracket === -1) return undefined;

  let depth = 0;
  let closeBracket = -1;

  for (let i = openBracket; i < source.length; i += 1) {
    if (source[i] === '[') depth += 1;
    if (source[i] === ']') {
      depth -= 1;
      if (depth === 0) {
        closeBracket = i;
        break;
      }
    }
  }

  if (closeBracket === -1) return undefined;

  const body = source.slice(openBracket, closeBracket + 1);

  try {
    const parsed = JSON.parse(body);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch (_) {
    const items = [];
    const valuePattern = /"([^"]*)"/g;
    let match;
    while ((match = valuePattern.exec(body)) !== null) {
      items.push(match[1]);
    }
    return items;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function limitText(value, maxLength) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} должен быть непустой строкой.`);
  }
}

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} должен быть целым числом > 0.`);
  }
}

function assertIntegerAtLeast(value, name, min) {
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} должен быть целым числом >= ${min}.`);
  }
}

function assertIntegerInRange(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} должен быть целым числом от ${min} до ${max}.`);
  }
}

function assertNumberInRange(value, name, min, max) {
  if (typeof value !== 'number' || Number.isNaN(value) || value < min || value > max) {
    throw new Error(`${name} должен быть числом от ${min} до ${max}.`);
  }
}

module.exports = {
  loadRuntimeConfig
};