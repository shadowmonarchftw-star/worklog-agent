const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

// Each macOS architecture is built on its own runner, so electron-builder emits
// a latest-mac.yml that lists only that runner's files. electron-updater picks
// the right download by looking for "arm64" in the file name, so both entries
// must end up in a single published latest-mac.yml or half of the Mac users are
// offered the wrong architecture -- or nothing at all.
function mergeUpdateMetadata(documents) {
  const parsed = documents.filter(Boolean);
  if (!parsed.length) {
    throw new Error("No update metadata documents to merge.");
  }

  const versions = new Set(parsed.map((document) => document.version));
  if (versions.size > 1) {
    throw new Error(`Refusing to merge mismatched versions: ${[...versions].join(", ")}`);
  }

  const files = [];
  const seen = new Set();
  for (const document of parsed) {
    for (const file of document.files || []) {
      if (seen.has(file.url)) continue;
      seen.add(file.url);
      files.push(file);
    }
  }
  files.sort((left, right) => left.url.localeCompare(right.url));

  const releaseDate = parsed
    .map((document) => document.releaseDate)
    .filter(Boolean)
    .sort()
    .pop();

  // path/sha512 are the legacy single-file fields. Point them at a non-arm64
  // build so an older client without arch filtering still gets something it can
  // actually run.
  const fallback = files.find((file) => !file.url.includes("arm64")) || files[0];

  return {
    version: parsed[0].version,
    files,
    path: fallback.url,
    sha512: fallback.sha512,
    ...(releaseDate ? { releaseDate } : {}),
  };
}

function main(argv) {
  const output = argv[0];
  const inputs = argv.slice(1);
  if (!output || !inputs.length) {
    throw new Error("Usage: merge-update-metadata.cjs <output.yml> <input.yml...>");
  }

  const documents = inputs.map((file) => yaml.load(fs.readFileSync(file, "utf8")));
  const merged = mergeUpdateMetadata(documents);
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, yaml.dump(merged, { lineWidth: -1 }));
  return merged;
}

if (require.main === module) {
  const merged = main(process.argv.slice(2));
  console.log(`Merged ${merged.files.length} update file entries for ${merged.version}.`);
}

module.exports = { mergeUpdateMetadata };
