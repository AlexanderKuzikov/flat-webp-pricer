const fs = require('node:fs/promises');
const path = require('node:path');

async function createRouter(runtime) {
  await fs.mkdir(runtime.outputValidDir, { recursive: true });
  await fs.mkdir(runtime.outputReviewDir, { recursive: true });

  const reserved = {
    valid: await loadReservedNames(runtime.outputValidDir),
    review: await loadReservedNames(runtime.outputReviewDir)
  };

  return {
    async reserveTarget({ sourcePath, classification, price }) {
      const targetDir = classification === 'valid'
        ? runtime.outputValidDir
        : runtime.outputReviewDir;

      const dirKey = classification === 'valid' ? 'valid' : 'review';
      const ext = path.extname(sourcePath) || '.webp';
      const base = sanitizeBaseName(path.parse(sourcePath).name);

      const desiredBase = classification === 'valid'
        ? `${base}__${price}`
        : base;

      const assigned = assignUniqueName(desiredBase, ext, reserved[dirKey]);

      return {
        outputPath: path.join(targetDir, assigned.fileName),
        wasRenamed: assigned.wasRenamed
      };
    }
  };
}

async function loadReservedNames(dirPath) {
  const set = new Set();
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (entry.isFile()) {
      set.add(normalizeNameKey(entry.name));
    }
  }

  return set;
}

function assignUniqueName(baseName, ext, reservedNames) {
  let counter = 1;
  let fileName = `${baseName}${ext}`;

  while (reservedNames.has(normalizeNameKey(fileName))) {
    counter += 1;
    fileName = `${baseName}__${counter}${ext}`;
  }

  reservedNames.add(normalizeNameKey(fileName));

  return {
    fileName,
    wasRenamed: counter > 1
  };
}

function sanitizeBaseName(value) {
  const cleaned = String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .trim();

  return cleaned || 'image';
}

function normalizeNameKey(name) {
  return process.platform === 'win32'
    ? String(name).toLowerCase()
    : String(name);
}

module.exports = {
  createRouter
};