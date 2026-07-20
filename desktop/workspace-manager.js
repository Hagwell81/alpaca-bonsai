/**
 * Workspace Manager
 *
 * Manages user workspaces including:
 * - Local folder selection and tracking
 * - Virtual sandbox workspace in app data
 * - Workspace state persistence
 * - File tree caching
 */

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

class WorkspaceManager extends EventEmitter {
  constructor({ app, store, logger = console } = {}) {
    super();
    this.app = app;
    this.store = store;
    this.logger = logger;
    this.sandboxDir = null;
    this.activeFolder = null;
    this.fileTreeCache = new Map();
  }

  async init() {
    if (this.app) {
      this.sandboxDir = path.join(this.app.getPath('userData'), 'workspace-sandbox');
    } else {
      this.sandboxDir = path.join(require('os').homedir(), '.alpaca', 'workspace-sandbox');
    }
    if (!fs.existsSync(this.sandboxDir)) {
      fs.mkdirSync(this.sandboxDir, { recursive: true });
      this.logger.log('[WorkspaceManager] Created sandbox directory:', this.sandboxDir);
    }

    // Restore persisted folder if valid
    if (this.store) {
      const saved = this.store.get('workspace.activeFolder', null);
      if (saved && fs.existsSync(saved)) {
        this.activeFolder = saved;
      }
    }
  }

  getState() {
    return {
      activeFolder: this.activeFolder,
      sandboxDir: this.sandboxDir,
      isSandboxActive: !this.activeFolder || this.activeFolder === this.sandboxDir
    };
  }

  setFolder(folderPath) {
    if (!folderPath || !fs.existsSync(folderPath)) {
      throw new Error('Folder does not exist');
    }
    const stat = fs.statSync(folderPath);
    if (!stat.isDirectory()) {
      throw new Error('Path is not a directory');
    }
    this.activeFolder = folderPath;
    if (this.store) {
      this.store.set('workspace.activeFolder', folderPath);
    }
    this.fileTreeCache.delete(folderPath);
    this.emit('folderChanged', folderPath);
    this.logger.log('[WorkspaceManager] Active folder set to:', folderPath);
    return { success: true, folderPath };
  }

  openSandbox() {
    this.activeFolder = this.sandboxDir;
    if (this.store) {
      this.store.set('workspace.activeFolder', this.sandboxDir);
    }
    this.fileTreeCache.delete(this.sandboxDir);
    this.emit('folderChanged', this.sandboxDir);
    this.logger.log('[WorkspaceManager] Switched to sandbox');
    return { success: true, folderPath: this.sandboxDir };
  }

  getFileTree(folderPath, depth = 2) {
    const target = folderPath || this.activeFolder || this.sandboxDir;
    if (!target || !fs.existsSync(target)) {
      return { error: 'No active workspace folder' };
    }

    const cacheKey = `${target}:${depth}`;
    if (this.fileTreeCache.has(cacheKey)) {
      return this.fileTreeCache.get(cacheKey);
    }

    const buildTree = (dir, currentDepth) => {
      if (currentDepth <= 0) return null;
      const entries = [];
      try {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
          if (item.name.startsWith('.')) continue;
          const fullPath = path.join(dir, item.name);
          if (item.isDirectory()) {
            const children = buildTree(fullPath, currentDepth - 1);
            entries.push({ name: item.name, type: 'directory', path: fullPath, children: children || [] });
          } else {
            entries.push({ name: item.name, type: 'file', path: fullPath });
          }
        }
      } catch (err) {
        this.logger.warn('[WorkspaceManager] Error reading directory:', err.message);
      }
      return entries;
    };

    const tree = {
      root: target,
      entries: buildTree(target, depth)
    };
    this.fileTreeCache.set(cacheKey, tree);
    return tree;
  }

  readFile(filePath) {
    if (!fs.existsSync(filePath)) {
      return { error: 'File not found' };
    }
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return { success: true, content };
    } catch (err) {
      return { error: err.message };
    }
  }

  writeFile(filePath, content) {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, content, 'utf8');
      // Invalidate cache for parent directory
      this.fileTreeCache.forEach((_, key) => {
        if (filePath.startsWith(key.split(':')[0])) {
          this.fileTreeCache.delete(key);
        }
      });
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  }

  async copyToSandbox(sourcePaths) {
    const results = [];
    for (const src of sourcePaths) {
      if (!fs.existsSync(src)) {
        results.push({ path: src, success: false, error: 'Source not found' });
        continue;
      }
      const dest = path.join(this.sandboxDir, path.basename(src));
      try {
        if (fs.statSync(src).isDirectory()) {
          this._copyDirRecursive(src, dest);
        } else {
          fs.copyFileSync(src, dest);
        }
        results.push({ path: src, dest, success: true });
      } catch (err) {
        results.push({ path: src, success: false, error: err.message });
      }
    }
    this.fileTreeCache.clear();
    return results;
  }

  _copyDirRecursive(src, dest) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this._copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

module.exports = { WorkspaceManager };
