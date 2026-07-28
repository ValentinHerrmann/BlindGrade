import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const assetsDir = path.join(__dirname, '../static/latex-assets');
const outputFile = path.join(assetsDir, 'index.json');

function walkDir(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
        if (file === 'index.json') continue; // Skip the index file itself
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(walkDir(filePath));
        } else {
            // Get path relative to latex-assets dir, e.g. "sty/Schulaufgabe.sty"
            const relativePath = path.relative(assetsDir, filePath);
            // Ensure forward slashes for URLs
            results.push(relativePath.split(path.sep).join('/'));
        }
    }
    return results;
}

try {
    if (!fs.existsSync(assetsDir)) {
        console.warn(`[Assets Index] Directory not found: ${assetsDir}`);
        process.exit(0);
    }
    const files = walkDir(assetsDir);
    fs.writeFileSync(outputFile, JSON.stringify(files, null, 2));
    console.log(`[Assets Index] Generated index.json with ${files.length} files.`);
} catch (error) {
    console.error('[Assets Index] Failed to generate index:', error);
    process.exit(1);
}
