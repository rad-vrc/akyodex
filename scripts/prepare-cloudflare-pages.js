#!/usr/bin/env node

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Prepare OpenNext build output for Cloudflare Pages deployment
 *
 * Cloudflare Pages expects:
 * - _worker.js at the root of the output directory
 * - Static assets at the root (not in assets/ subdirectory)
 */

const fs = require('fs');
const path = require('path');

const openNextDir = path.join(__dirname, '../.open-next');
const assetsDir = path.join(openNextDir, 'assets');
const workerSrc = path.join(openNextDir, 'worker.js');
const workerDest = path.join(openNextDir, '_worker.js');
const workerEntrySrc = path.join(
  __dirname,
  'cloudflare-pages-worker-entry.mjs'
);

console.log('📦 Preparing OpenNext output for Cloudflare Pages...');

// Keep worker.js as the OpenNext implementation and install the Pages entry
// wrapper as _worker.js. Preview-only restrictions are selected at runtime.
if (fs.existsSync(workerSrc) && fs.existsSync(workerEntrySrc)) {
  fs.copyFileSync(workerEntrySrc, workerDest);
  console.log('✅ Created guarded _worker.js');
} else {
  console.error('❌ worker.js or the Pages worker entry was not found!');
  process.exit(1);
}

// Move assets from assets/ to root
if (fs.existsSync(assetsDir)) {
  console.log('📁 Moving static assets to root...');

  const items = fs.readdirSync(assetsDir);
  let movedCount = 0;

  for (const item of items) {
    const srcPath = path.join(assetsDir, item);
    const destPath = path.join(openNextDir, item);

    // Skip if destination already exists (avoid conflicts)
    if (fs.existsSync(destPath)) {
      console.log(`⚠️  Skipping ${item} (already exists at root)`);
      continue;
    }

    // Move the item
    fs.renameSync(srcPath, destPath);
    movedCount++;
  }

  console.log(`✅ Moved ${movedCount} items from assets/ to root`);

  // Remove empty assets directory
  try {
    fs.rmdirSync(assetsDir);
    console.log('✅ Removed empty assets/ directory');
  } catch (err) {
    console.log('⚠️  Could not remove assets/ directory (may not be empty):', err);
  }
} else {
  console.warn('⚠️  assets/ directory not found');
}

// Create _routes.json for proper static asset handling
// Ref: https://developers.cloudflare.com/pages/functions/routing/#create-a-_routesjson-file
const routesConfig = {
  version: 1,
  description: "Cloudflare Pages routing configuration for Next.js with OpenNext",
  include: [
    "/*"
  ],
  exclude: [
    // Next.js static assets (automatically cached by Cloudflare)
    "/_next/static/*",

    // Static files in root
    "/favicon.ico",
    "/sw.js",

    // All images (wildcard matches any depth)
    "/images/*",

    // Build-bundled complete catalog fallback
    "/catalog/*"
  ]
};

const routesPath = path.join(openNextDir, '_routes.json');
fs.writeFileSync(routesPath, JSON.stringify(routesConfig, null, 2));
console.log('✅ Created _routes.json for static asset routing');

console.log('✨ Ready for Cloudflare Pages deployment!');
