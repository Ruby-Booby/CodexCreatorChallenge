import { app, BrowserWindow, ipcMain, dialog, safeStorage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import net from 'node:net';
import extractZip from 'extract-zip';
import * as fssync from 'node:fs';
import os from 'node:os';
import { WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = process.env.VITE_DEV_SERVER_URL || process.env.NODE_ENV === 'development';
const isDebug = process.env.PB_DEBUG === '1' || process.argv.includes('--pb-debug');

function logPath() {
  return path.join(app.getPath('userData'), 'logs', 'project-brain.log');
}

function logLine(line) {
  try {
    const p = logPath();
    fssync.mkdirSync(path.dirname(p), { recursive: true });
    fssync.appendFileSync(p, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
  } catch {
    // If we can't write logs, don't crash the app.
  }
}

let localSignalServer = null;
let localSignalInfo = null;

function getLocalIPv4() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const entries of Object.values(ifaces)) {
    for (const entry of entries || []) {
      if (entry && entry.family === 'IPv4' && !entry.internal) ips.push(entry.address);
    }
  }
  return ips;
}

async function ensureLocalSignalServer() {
  if (localSignalServer && localSignalInfo) return localSignalInfo;

  const clientsById = new Map(); // peerId -> ws
  const roomByCode = new Map(); // code -> { hostId, hostName, hostWs, clientIds:Set }

  const wss = new WebSocketServer({ port: 0, host: '0.0.0.0' });
  localSignalServer = wss;

  const info = await new Promise((resolve) => {
    wss.on('listening', () => {
      const addr = wss.address();
      resolve({ port: typeof addr === 'object' && addr ? addr.port : null });
    });
  });

  localSignalInfo = {
    port: info.port || 0,
    urls: [`ws://127.0.0.1:${info.port}`],
    lanUrls: getLocalIPv4().map((ip) => `ws://${ip}:${info.port}`)
  };

  function send(ws, payload) {
    try {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
    } catch {
      // ignore
    }
  }

  function broadcastToRoom(code, payload, excludeWs) {
    const room = roomByCode.get(code);
    if (!room) return;
    if (room.hostWs && room.hostWs !== excludeWs) send(room.hostWs, payload);
    for (const id of room.clientIds || []) {
      const cws = clientsById.get(id);
      if (cws && cws !== excludeWs) send(cws, payload);
    }
  }

  wss.on('connection', (ws) => {
    const peerId = crypto.randomUUID();
    ws.__peerId = peerId;
    ws.__role = null;
    ws.__code = null;
    ws.__name = null;
    clientsById.set(peerId, ws);

    ws.on('message', (raw) => {
      let msg = null;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg?.type) return;

      if (msg.type === 'register') {
        const code = String(msg.code || '').toUpperCase();
        const role = msg.role === 'host' ? 'host' : 'client';
        const name = String(msg.name || '').slice(0, 80) || (role === 'host' ? 'Host' : 'Client');

        ws.__role = role;
        ws.__code = code;
        ws.__name = name;

        if (!code) {
          send(ws, { type: 'error', message: 'Missing code.' });
          return;
        }

        if (role === 'host') {
          roomByCode.set(code, { hostId: peerId, hostName: name, hostWs: ws, clientIds: new Set() });
          send(ws, { type: 'registered', peerId });
          return;
        }

        const room = roomByCode.get(code);
        if (!room) {
          send(ws, { type: 'registered', peerId });
          send(ws, { type: 'host_offline' });
          return;
        }
        room.clientIds.add(peerId);
        send(ws, { type: 'registered', peerId });
        send(room.hostWs, {
          type: 'join_request',
          requestId: crypto.randomUUID(),
          name,
          code,
          peerId
        });
        return;
      }

      if (msg.targetId) {
        const target = clientsById.get(msg.targetId);
        if (target) {
          send(target, { ...msg, fromId: ws.__peerId, fromName: ws.__name });
        }
      }
    });

    ws.on('close', () => {
      clientsById.delete(peerId);
      const code = ws.__code;
      if (!code) return;
      const room = roomByCode.get(code);
      if (!room) return;
      if (room.hostId === peerId) {
        broadcastToRoom(code, { type: 'host_offline' }, ws);
        roomByCode.delete(code);
        return;
      }
      room.clientIds.delete(peerId);
    });
  });

  return localSignalInfo;
}

async function stopLocalSignalServer() {
  if (!localSignalServer) return false;
  try {
    await new Promise((resolve) => localSignalServer.close(() => resolve()));
  } catch {
    // ignore
  }
  localSignalServer = null;
  localSignalInfo = null;
  return true;
}


function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 900,
    minHeight: 600,
    title: 'Project Brain',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    logLine(`did-fail-load code=${errorCode} desc=${errorDescription} url=${validatedURL}`);
  });

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    // level: 0=log, 1=warn, 2=error
    logLine(`renderer console level=${level} ${sourceId}:${line} ${message}`);
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    logLine(`render-process-gone reason=${details?.reason} exitCode=${details?.exitCode}`);
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    if (isDebug) win.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
  logLine(`App starting. version=${app.getVersion()} isDev=${Boolean(isDev)} isDebug=${Boolean(isDebug)}`);
  process.on('uncaughtException', (err) => logLine(`uncaughtException: ${err?.stack || err}`));
  process.on('unhandledRejection', (reason) => logLine(`unhandledRejection: ${reason?.stack || reason}`));
  app.on('child-process-gone', (_event, details) => {
    logLine(`child-process-gone type=${details?.type} reason=${details?.reason} exitCode=${details?.exitCode}`);
  });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('app:getVersion', () => app.getVersion());

ipcMain.handle('signal:startLocal', async () => {
  try {
    const info = await ensureLocalSignalServer();
    return { ok: true, ...info };
  } catch (err) {
    logLine(`signal:startLocal failed: ${err?.stack || err}`);
    return { ok: false, detail: 'Unable to start local signaling server.' };
  }
});

ipcMain.handle('signal:stopLocal', async () => {
  const stopped = await stopLocalSignalServer();
  return { ok: stopped };
});

ipcMain.handle('project:selectRoot', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'release', 'build', '.next']);
const MAX_FILES = 200;
const MAX_BYTES = 8000;

function summarizeFileContent(filePath, content) {
  const ext = path.extname(filePath).toLowerCase();
  const lines = content.split(/\r?\n/).map((line) => line.trim());
  const firstNonEmpty = lines.find((line) => line.length > 0) || '';

  if (ext === '.md') {
    return firstNonEmpty.replace(/^#+\s*/, '').slice(0, 160) || 'Markdown documentation';
  }

  if (ext === '.json') {
    return firstNonEmpty.includes('{') ? 'Configuration/data file' : firstNonEmpty.slice(0, 160);
  }

  const commentLine = lines.find((line) => line.startsWith('//') || line.startsWith('#'));
  if (commentLine) {
    return commentLine.replace(/^\/\/|^#/, '').trim().slice(0, 160);
  }

  if (firstNonEmpty.startsWith('import ') || firstNonEmpty.startsWith('export ')) {
    return 'Source module defining project logic or UI.';
  }

  return firstNonEmpty.slice(0, 160) || 'Source file';
}

async function walkDirectory(rootPath) {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (results.length >= MAX_FILES) break;
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const nested = await walkDirectory(fullPath);
      results.push(...nested);
      if (results.length >= MAX_FILES) break;
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }

  return results;
}

ipcMain.handle('project:scan', async (_event, rootPath) => {
  if (!rootPath) return [];
  const files = await walkDirectory(rootPath);
  const summaries = [];

  for (const filePath of files.slice(0, MAX_FILES)) {
    try {
      const buffer = await fs.readFile(filePath);
      const content = buffer.slice(0, MAX_BYTES).toString('utf8');
      summaries.push({
        id: crypto.randomUUID(),
        path: path.relative(rootPath, filePath),
        summary: summarizeFileContent(filePath, content)
      });
    } catch {
      summaries.push({
        id: crypto.randomUUID(),
        path: path.relative(rootPath, filePath),
        summary: 'Unreadable file'
      });
    }
  }

  return summaries;
});

ipcMain.handle('file:save', async (_event, data) => {
  const result = await dialog.showSaveDialog({
    title: 'Save Project Brain Data',
    defaultPath: 'project-brain-backup.json'
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, JSON.stringify(data, null, 2), 'utf8');
  return result.filePath;
});

ipcMain.handle('file:open', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open Project Brain Data',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const content = await fs.readFile(result.filePaths[0], 'utf8');
  return content;
});

ipcMain.handle('storage:load', async () => {
  try {
    const dataPath = path.join(app.getPath('userData'), 'project-brain-data.json');
    const content = await fs.readFile(dataPath, 'utf8');
    return content;
  } catch {
    return null;
  }
});

ipcMain.handle('storage:save', async (_event, data) => {
  try {
    const dataPath = path.join(app.getPath('userData'), 'project-brain-data.json');
    await fs.writeFile(dataPath, JSON.stringify(data, null, 2), 'utf8');
    return dataPath;
  } catch {
    return null;
  }
});

function isPathInside(rootPath, targetPath) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget.startsWith(resolvedRoot + path.sep);
}

ipcMain.handle('file:read', async (_event, data) => {
  if (!data?.rootPath || !data?.relativePath) return null;
  const fullPath = path.join(data.rootPath, data.relativePath);
  if (!isPathInside(data.rootPath, fullPath)) return null;
  try {
    const content = await fs.readFile(fullPath, 'utf8');
    return content;
  } catch {
    return null;
  }
});

ipcMain.handle('file:write', async (_event, data) => {
  if (!data?.rootPath || !data?.relativePath) return false;
  const fullPath = path.join(data.rootPath, data.relativePath);
  if (!isPathInside(data.rootPath, fullPath)) return false;
  try {
    // Allow creating new files in nested folders (e.g. src/foo/bar.js).
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, data.content ?? '', 'utf8');
    return true;
  } catch {
    return false;
  }
});

function secretsPath() {
  return path.join(app.getPath('userData'), 'project-brain-secrets.json');
}

async function loadSecrets() {
  try {
    const raw = await fs.readFile(secretsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
    return {};
  } catch {
    return {};
  }
}

async function saveSecrets(secrets) {
  await fs.writeFile(secretsPath(), JSON.stringify(secrets, null, 2), 'utf8');
}

ipcMain.handle('secrets:set', async (_event, data) => {
  if (!data?.key) return false;
  if (typeof data.value !== 'string') return false;
  if (!safeStorage.isEncryptionAvailable()) return false;

  const secrets = await loadSecrets();
  const encrypted = safeStorage.encryptString(data.value).toString('base64');
  secrets[data.key] = encrypted;
  await saveSecrets(secrets);
  return true;
});

ipcMain.handle('secrets:has', async (_event, data) => {
  if (!data?.key) return false;
  const secrets = await loadSecrets();
  return Boolean(secrets[data.key]);
});

ipcMain.handle('secrets:get', async (_event, data) => {
  if (!data?.key) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  const secrets = await loadSecrets();
  const blob = secrets[data.key];
  if (!blob) return null;
  try {
    return safeStorage.decryptString(Buffer.from(blob, 'base64'));
  } catch {
    return null;
  }
});

ipcMain.handle('secrets:clear', async (_event, data) => {
  if (!data?.key) return false;
  const secrets = await loadSecrets();
  delete secrets[data.key];
  await saveSecrets(secrets);
  return true;
});

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(250, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function findOllama() {
  return new Promise((resolve) => {
    execFile('where.exe', ['ollama'], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      const line = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      resolve(line || null);
    });
  });
}

let ollamaProcess = null;

ipcMain.handle('ollama:ensureRunning', async () => {
  const isUp = await canConnect(11434);
  if (isUp) return { ok: true, running: true, detail: 'Ollama already running.' };

  const ollamaPath = await findOllama();
  if (!ollamaPath) {
    return {
      ok: false,
      running: false,
      detail: 'Ollama not found. Install Ollama for Windows to use local LLM mode.'
    };
  }

  if (!ollamaProcess || ollamaProcess.killed) {
    ollamaProcess = spawn(ollamaPath, ['serve'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    ollamaProcess.unref();
  }

  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const up = await canConnect(11434);
    if (up) return { ok: true, running: true, detail: 'Ollama server started.' };
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 200));
  }

  return { ok: false, running: false, detail: 'Failed to start Ollama server.' };
});

ipcMain.handle('ollama:pull', async (_event, data) => {
  const model = (data?.model || '').trim();
  if (!model) return { ok: false, detail: 'Missing model name.' };
  const ollamaPath = await findOllama();
  if (!ollamaPath) return { ok: false, detail: 'Ollama not found.' };

  return new Promise((resolve) => {
    execFile(
      ollamaPath,
      ['pull', model],
      { windowsHide: true, timeout: 1000 * 60 * 20 },
      (err, stdout, stderr) => {
        if (err) {
          return resolve({
            ok: false,
            detail: (stderr || stdout || err.message || 'Pull failed.').trim()
          });
        }
        resolve({ ok: true, detail: (stdout || 'Pulled.').trim() });
      }
    );
  });
});

ipcMain.handle('ollama:list', async () => {
  const ollamaPath = await findOllama();
  if (!ollamaPath) return { ok: false, models: [], detail: 'Ollama not found.' };
  return new Promise((resolve) => {
    execFile(ollamaPath, ['list'], { windowsHide: true }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, models: [], detail: (stderr || err.message || '').trim() });
      const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const models = lines.slice(1).map((line) => line.split(/\s+/)[0]).filter(Boolean);
      resolve({ ok: true, models, detail: '' });
    });
  });
});

function builtinRoot() {
  return path.join(app.getPath('userData'), 'builtin-llm');
}

function builtinRuntimeDir() {
  return path.join(builtinRoot(), 'runtime');
}

function builtinModelsDir() {
  return path.join(builtinRoot(), 'models');
}

function builtinRuntimeMetaPath() {
  return path.join(builtinRuntimeDir(), 'runtime.json');
}

function llamaServerPath() {
  return path.join(builtinRuntimeDir(), 'llama-server.exe');
}

async function loadBuiltinRuntimeMeta() {
  try {
    const raw = await fs.readFile(builtinRuntimeMetaPath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveBuiltinRuntimeMeta(meta) {
  await fs.writeFile(builtinRuntimeMetaPath(), JSON.stringify(meta, null, 2), 'utf8');
}

async function resolvedLlamaServerPath() {
  const meta = await loadBuiltinRuntimeMeta();
  const candidate = meta?.llamaServerPath;
  if (candidate && (await exists(candidate))) return candidate;
  if (await exists(llamaServerPath())) return llamaServerPath();
  return null;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function downloadToFile(url, outPath) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'ProjectBrain/1.0'
    }
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, buf);
}

async function getLatestLlamaCppWinZipUrl() {
  const res = await fetch('https://api.github.com/repos/ggerganov/llama.cpp/releases/latest', {
    headers: {
      'User-Agent': 'ProjectBrain/1.0',
      Accept: 'application/vnd.github+json'
    }
  });
  if (!res.ok) throw new Error('Unable to fetch llama.cpp release metadata');
  const json = await res.json();
  const assets = Array.isArray(json.assets) ? json.assets : [];
  const match = assets.find((a) => {
    const name = (a.name || '').toLowerCase();
    return name.includes('win') && name.includes('x64') && name.endsWith('.zip') && name.includes('bin');
  });
  return match?.browser_download_url || null;
}

async function findFileRecursive(rootDir, fileNameLower) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      // eslint-disable-next-line no-await-in-loop
      const nested = await findFileRecursive(fullPath, fileNameLower);
      if (nested) return nested;
    } else if (entry.isFile()) {
      if (entry.name.toLowerCase() === fileNameLower) return fullPath;
    }
  }
  return null;
}

async function ensureBuiltinRuntime(download) {
  await fs.mkdir(builtinRuntimeDir(), { recursive: true });
  await fs.mkdir(builtinModelsDir(), { recursive: true });
  if (await resolvedLlamaServerPath()) {
    return { ok: true, detail: 'Built-in runtime is ready.' };
  }
  if (!download) {
    return { ok: false, detail: 'Built-in runtime not installed. Click Install runtime.' };
  }

  try {
    const url = await getLatestLlamaCppWinZipUrl();
    if (!url) {
      return {
        ok: false,
        detail: 'Could not find a Windows runtime asset for llama.cpp.'
      };
    }
    const zipPath = path.join(builtinRuntimeDir(), 'llama.zip');
    await downloadToFile(url, zipPath);
    await extractZip(zipPath, { dir: builtinRuntimeDir() });
    await fs.unlink(zipPath).catch(() => {});

    // Find llama-server.exe somewhere under runtime dir and remember its full path.
    const serverFound = await findFileRecursive(builtinRuntimeDir(), 'llama-server.exe');
    if (serverFound) {
      await saveBuiltinRuntimeMeta({ llamaServerPath: serverFound });
    }

    if (!(await resolvedLlamaServerPath())) {
      return { ok: false, detail: 'Runtime downloaded but llama-server.exe was not found.' };
    }
    return { ok: true, detail: 'Built-in runtime downloaded.' };
  } catch (err) {
    return { ok: false, detail: err?.message || 'Failed to set up runtime.' };
  }
}

ipcMain.handle('builtin:ensureRuntime', async (_event, data) =>
  ensureBuiltinRuntime(Boolean(data?.download))
);

ipcMain.handle('builtin:downloadModel', async (_event, data) => {
  const url = (data?.url || '').trim();
  const fileName = (data?.fileName || '').trim();
  if (!url || !fileName) return { ok: false, detail: 'Missing model url or filename.' };
  try {
    await fs.mkdir(builtinModelsDir(), { recursive: true });
    const outPath = path.join(builtinModelsDir(), fileName);
    await downloadToFile(url, outPath);
    return { ok: true, detail: `Downloaded ${fileName}` };
  } catch (err) {
    return { ok: false, detail: err?.message || 'Model download failed.' };
  }
});

ipcMain.handle('builtin:listModels', async () => {
  try {
    await fs.mkdir(builtinModelsDir(), { recursive: true });
    const files = await fs.readdir(builtinModelsDir());
    const models = files.filter((f) => f.toLowerCase().endsWith('.gguf'));
    return { ok: true, models, detail: '' };
  } catch (err) {
    return { ok: false, models: [], detail: err?.message || 'Unable to list models.' };
  }
});

let builtinServer = null;
let builtinServerModel = null;

ipcMain.handle('builtin:startServer', async (_event, data) => {
  const modelFile = (data?.modelFile || '').trim();
  const port = Number.isFinite(data?.port) ? data.port : 8081;
  if (!modelFile) return { ok: false, detail: 'Missing model file.' };

  const modelPath = path.join(builtinModelsDir(), modelFile);
  if (!(await exists(modelPath))) return { ok: false, detail: 'Model file not found. Download it first.' };

  const runtimeOk = await ensureBuiltinRuntime(false);
  if (!runtimeOk.ok) return runtimeOk;

  if (builtinServer && !builtinServer.killed && builtinServerModel === modelFile) {
    return { ok: true, detail: 'Built-in server already running.' };
  }

  if (builtinServer && !builtinServer.killed) {
    builtinServer.kill();
    builtinServer = null;
  }

  builtinServerModel = modelFile;
  const serverPath = await resolvedLlamaServerPath();
  if (!serverPath) return { ok: false, detail: 'Built-in runtime missing. Click Install runtime.' };
  builtinServer = spawn(serverPath, ['-m', modelPath, '--host', '127.0.0.1', '--port', String(port)], {
    windowsHide: true,
    stdio: 'ignore'
  });

  // Wait briefly for it to accept connections.
  for (let i = 0; i < 15; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const up = await canConnect(port);
    if (up) return { ok: true, detail: `Built-in server running on ${port}.`, port };
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 200));
  }

  return { ok: false, detail: 'Failed to start built-in server.' };
});

ipcMain.handle('builtin:stopServer', async () => {
  if (builtinServer && !builtinServer.killed) {
    builtinServer.kill();
  }
  builtinServer = null;
  builtinServerModel = null;
  return { ok: true };
});


