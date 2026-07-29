var FOLDER_TO_DELETE = "/export/Snapshots/Security";
var messages = [];
Array.from(xdmp.hosts()).map(xdmp.hostName).forEach(function (host) {
  try {
    xdmp.filesystemDirectoryDelete("file://" + host + FOLDER_TO_DELETE);
    messages.push("Deleted " + host + FOLDER_TO_DELETE);
  } catch (error) {
    messages.push("Could not delete " + host + FOLDER_TO_DELETE + ": " + error);
  }
});
messages.join("\n");
