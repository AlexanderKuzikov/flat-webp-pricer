const fs = require('node:fs/promises');
const sharp = require('sharp');

async function prepareModelImageDataUrl(sourcePath, maxWidth, jpegQuality) {
  const buffer = await sharp(sourcePath)
    .rotate()
    .resize({
      width: maxWidth,
      withoutEnlargement: true
    })
    .jpeg({
      quality: jpegQuality,
      mozjpeg: true
    })
    .toBuffer();

  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

async function copyOriginalToTarget(sourcePath, targetPath, overwriteExisting) {
  if (overwriteExisting) {
    await fs.copyFile(sourcePath, targetPath);
    return;
  }

  await fs.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
}

module.exports = {
  prepareModelImageDataUrl,
  copyOriginalToTarget
};