var START = "/export/Snapshots";
function directories(path, depth) {
  if (depth > 3) return [];
  return Array.from(xdmp.filesystemDirectory(path)).reduce(function (result, entry) {
    return result.concat([entry.pathname], directories(entry.pathname, depth + 1));
  }, []);
}
directories(START, 1).join("\n");
