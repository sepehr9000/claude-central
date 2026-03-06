const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notesAPI', {
  saveFileDialog: (content) => ipcRenderer.invoke('notes-save-dialog', content),
  saveFile: (filePath, content) => ipcRenderer.invoke('notes-save-file', filePath, content),
});
