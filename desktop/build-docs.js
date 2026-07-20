const fs = require('fs');
const path = require('path');

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();

  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach(childItemName => {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

// ============================================================================
// Copy Docusaurus documentation built files
// ============================================================================
// The Docusaurus docs site (../docs) is configured to build to ../docs/build.
// We copy those static files into desktop/docs so electron-builder
// can bundle them.
// ============================================================================

const docsBuildDir = path.join(__dirname, '..', 'docs', 'build');
const docsTargetDir = path.join(__dirname, 'docs');

console.log('Copying docs from', docsBuildDir, 'to', docsTargetDir);

if (!fs.existsSync(docsBuildDir)) {
  console.warn(`Docs build directory not found at ${docsBuildDir}.`);
  console.warn('Build the docs first: cd ../docs && npm run build');
  process.exit(1);
} else {
  if (!fs.existsSync(docsTargetDir)) {
    fs.mkdirSync(docsTargetDir, { recursive: true });
  }
  copyRecursiveSync(docsBuildDir, docsTargetDir);
  console.log('Docs copy complete!');
}
