const fs = require("node:fs");
const path = require("node:path");

function scalar(value) {
  const trimmed = value.trim();
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed.replace(/^['"]|['"]$/g, "");
}

// electron-builder's updater metadata is a small, flat YAML document. Keeping
// this parser local lets the release job publish without installing app deps.
function readMetadata(text) {
  const document = { files: [] };
  let file;
  for (const line of text.split(/\r?\n/)) {
    const fileMatch = line.match(/^\s+-\s+([^:]+):\s*(.*)$/);
    const fieldMatch = line.match(/^\s{4}([^:]+):\s*(.*)$/);
    const topMatch = line.match(/^([^:]+):\s*(.*)$/);
    if (fileMatch) {
      file = {};
      document.files.push(file);
      file[fileMatch[1].trim()] = scalar(fileMatch[2]);
    } else if (fieldMatch && file) {
      file[fieldMatch[1].trim()] = scalar(fieldMatch[2]);
    } else if (topMatch && topMatch[1] !== "files") {
      document[topMatch[1].trim()] = scalar(topMatch[2]);
    }
  }
  return document;
}

function quote(value) {
  return JSON.stringify(String(value));
}

function writeMetadata(document) {
  const lines = [`version: ${quote(document.version)}`, "files:"];
  for (const file of document.files || []) {
    const entries = Object.entries(file);
    if (!entries.length) continue;
    lines.push(`  - ${entries[0][0]}: ${typeof entries[0][1] === "number" ? entries[0][1] : quote(entries[0][1])}`);
    for (const [key, value] of entries.slice(1)) {
      lines.push(`    ${key}: ${typeof value === "number" ? value : quote(value)}`);
    }
  }
  for (const [key, value] of Object.entries(document)) {
    if (key === "version" || key === "files" || value == null) continue;
    lines.push(`${key}: ${typeof value === "number" ? value : quote(value)}`);
  }
  return `${lines.join("\n")}\n`;
}

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

  const documents = inputs.map((file) => readMetadata(fs.readFileSync(file, "utf8")));
  const merged = mergeUpdateMetadata(documents);
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, writeMetadata(merged));
  return merged;
}

if (require.main === module) {
  const merged = main(process.argv.slice(2));
  console.log(`Merged ${merged.files.length} update file entries for ${merged.version}.`);
}

module.exports = { mergeUpdateMetadata };
