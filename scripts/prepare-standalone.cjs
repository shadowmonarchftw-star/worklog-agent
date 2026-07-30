const fs = require("node:fs");
const path = require("node:path");

function materializeSymlinks(rootPath) {
  if (!fs.existsSync(rootPath)) {
    return;
  }

  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    const entryPath = path.join(rootPath, entry.name);
    const stat = fs.lstatSync(entryPath);

    if (stat.isSymbolicLink()) {
      const targetPath = fs.realpathSync(entryPath);
      fs.rmSync(entryPath);
      fs.cpSync(targetPath, entryPath, {
        dereference: true,
        recursive: true,
      });
      continue;
    }

    if (stat.isDirectory()) {
      materializeSymlinks(entryPath);
    }
  }
}

if (require.main === module) {
  materializeSymlinks(path.join(process.cwd(), ".next", "standalone"));
}

module.exports = { materializeSymlinks };
