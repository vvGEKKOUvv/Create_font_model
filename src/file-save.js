function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function write(handle, text) {
  const stream = await handle.createWritable();
  try { await stream.write(text); await stream.close(); }
  catch (error) { await stream.abort().catch(() => {}); throw error; }
}
export async function saveObjFiles(obj, mtl, chooseDirectory = false) {
  if (chooseDirectory && typeof window.showDirectoryPicker === "function") {
    try {
      const directory = await window.showDirectoryPicker({mode:"readwrite"});
      let stem = "model", suffix = 2;
      const exists = async name => {
        try { await directory.getFileHandle(name); return true; }
        catch (error) { if (error.name === "NotFoundError") return false; throw error; }
      };
      while (await exists(`${stem}.obj`) || await exists(`${stem}.mtl`)) stem = `model-${suffix++}`;
      await write(await directory.getFileHandle(`${stem}.mtl`, {create:true}), mtl);
      await write(await directory.getFileHandle(`${stem}.obj`, {create:true}), obj.replace(/^mtllib model\.mtl$/m, `mtllib ${stem}.mtl`));
      return "directory";
    } catch (error) { if (error.name === "AbortError") return null; if (!["SecurityError", "NotSupportedError"].includes(error.name)) throw error; }
  }
  download(obj, "model.obj", "text/plain");
  download(mtl, "model.mtl", "text/plain");
  return "download";
}
export async function saveProjectFile(text) {
  if (typeof window.showSaveFilePicker === "function") {
    try {
      const handle = await window.showSaveFilePicker({suggestedName:"project.pathform", types:[{description:"PathForm の状態", accept:{"application/json":[".pathform"]}}]});
      await write(handle, text); return true;
    } catch (error) { if (error.name === "AbortError") return false; if (!["SecurityError", "NotSupportedError"].includes(error.name)) throw error; }
  }
  download(text, "project.pathform", "application/json"); return true;
}
