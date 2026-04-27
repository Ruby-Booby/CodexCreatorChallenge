import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('projectBrain', {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  selectProjectRoot: () => ipcRenderer.invoke('project:selectRoot'),
  scanProject: (rootPath) => ipcRenderer.invoke('project:scan', rootPath),
  saveFile: (data) => ipcRenderer.invoke('file:save', data),
  openFile: () => ipcRenderer.invoke('file:open'),
  loadData: () => ipcRenderer.invoke('storage:load'),
  saveData: (data) => ipcRenderer.invoke('storage:save', data),
  readFile: (data) => ipcRenderer.invoke('file:read', data),
  writeFile: (data) => ipcRenderer.invoke('file:write', data),
  secretsSet: (data) => ipcRenderer.invoke('secrets:set', data),
  secretsGet: (data) => ipcRenderer.invoke('secrets:get', data),
  secretsHas: (data) => ipcRenderer.invoke('secrets:has', data),
  secretsClear: (data) => ipcRenderer.invoke('secrets:clear', data),
  ollamaEnsureRunning: () => ipcRenderer.invoke('ollama:ensureRunning'),
  ollamaPull: (data) => ipcRenderer.invoke('ollama:pull', data),
  ollamaList: () => ipcRenderer.invoke('ollama:list'),
  builtinEnsureRuntime: (data) => ipcRenderer.invoke('builtin:ensureRuntime', data),
  builtinDownloadModel: (data) => ipcRenderer.invoke('builtin:downloadModel', data),
  builtinListModels: () => ipcRenderer.invoke('builtin:listModels'),
  builtinStartServer: (data) => ipcRenderer.invoke('builtin:startServer', data),
  builtinStopServer: () => ipcRenderer.invoke('builtin:stopServer')
});
