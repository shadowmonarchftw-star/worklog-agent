const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const projectRoot = path.join(__dirname, "..");
const buildDir = path.join(projectRoot, "build");
const source = path.join(buildDir, "icon.svg");
const png = path.join(buildDir, "icon.png");

async function generateIcons() {
  await fs.mkdir(buildDir, { recursive: true });
  await sharp(source).png().resize(1024, 1024).toFile(png);
}

generateIcons().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
