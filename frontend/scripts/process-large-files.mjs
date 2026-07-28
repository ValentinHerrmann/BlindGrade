import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';

const gzipPipeline = promisify(zlib.gzip);

const targetDir = process.argv[2] || 'build';
const MAX_FILE_SIZE = 24 * 1024 * 1024; // 24MB limit for Cloudflare Pages
const CHUNK_SIZE = 20 * 1024 * 1024;    // 20MB chunk size for splitting

const manifest = {};

async function processDirectory(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await processDirectory(fullPath);
    } else if (entry.isFile()) {
      const stats = fs.statSync(fullPath);
      if (stats.size > MAX_FILE_SIZE) {
        console.log(`Processing large file (${(stats.size / 1024 / 1024).toFixed(2)} MB): ${fullPath}`);
        
        const fileContent = fs.readFileSync(fullPath);
        console.log(`  Compressing with gzip -9...`);
        const gzipped = await gzipPipeline(fileContent, { level: 9 });
        
        const relPath = '/' + path.relative(targetDir, fullPath).replace(/\\/g, '/');
        const chunks = [];

        if (gzipped.length <= MAX_FILE_SIZE) {
          const gzPath = fullPath + '.bin';
          fs.writeFileSync(gzPath, gzipped);
          chunks.push(relPath + '.bin');
          console.log(`  Created single gzip archive (${(gzipped.length / 1024 / 1024).toFixed(2)} MB): ${gzPath}`);
        } else {
          console.log(`  Gzipped size (${(gzipped.length / 1024 / 1024).toFixed(2)} MB) exceeds 24MB. Chunking into 20MB parts...`);
          let offset = 0;
          let partIndex = 0;
          while (offset < gzipped.length) {
            const end = Math.min(offset + CHUNK_SIZE, gzipped.length);
            const chunkBuffer = gzipped.subarray(offset, end);
            const partPath = `${fullPath}.bin.part${partIndex}`;
            const partRelPath = `${relPath}.bin.part${partIndex}`;
            
            fs.writeFileSync(partPath, chunkBuffer);
            chunks.push(partRelPath);
            console.log(`    Part ${partIndex}: ${(chunkBuffer.length / 1024 / 1024).toFixed(2)} MB -> ${partPath}`);

            offset = end;
            partIndex++;
          }
        }

        // Delete original uncompressed file
        fs.unlinkSync(fullPath);
        console.log(`  Deleted original file: ${fullPath}`);

        manifest[relPath] = {
          chunks,
          gzipped: true,
          originalSize: stats.size,
          gzippedSize: gzipped.length
        };
      }
    }
  }
}

async function main() {
  const absoluteTarget = path.resolve(targetDir);
  if (!fs.existsSync(absoluteTarget)) {
    console.error(`Target directory does not exist: ${absoluteTarget}`);
    process.exit(1);
  }

  console.log(`Scanning for files > 24MB in: ${absoluteTarget}`);
  await processDirectory(absoluteTarget);

  const manifestPath = path.join(absoluteTarget, 'core', 'busytex', 'chunk-manifest.json');
  const manifestDir = path.dirname(manifestPath);
  if (!fs.existsSync(manifestDir)) {
    fs.mkdirSync(manifestDir, { recursive: true });
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Manifest successfully written to: ${manifestPath}`);
  console.log(`Processed ${Object.keys(manifest).length} large files.`);
}

main().catch(err => {
  console.error("Error processing large files:", err);
  process.exit(1);
});
