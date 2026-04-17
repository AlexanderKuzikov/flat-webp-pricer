const fs = require('node:fs/promises');
const path = require('node:path');

async function scanInputFiles(inputDir, supportedExtensions) {
  const stat = await fs.stat(inputDir).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Входная папка не существует или не является директорией: ${inputDir}`);
  }

  const out = [];
  await walk(inputDir, inputDir, supportedExtensions, out);
  out.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey, 'ru'));
  return out;
}

async function walk(rootDir, currentDir, supportedExtensions, out) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      await walk(rootDir, fullPath, supportedExtensions, out);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!supportedExtensions.has(ext)) {
      continue;
    }

    const relative = path.relative(rootDir, fullPath).split(path.sep).join('/');

    out.push({
      sourcePath: fullPath,
      sourceKey: relative
    });
  }
}

module.exports = {
  scanInputFiles
};