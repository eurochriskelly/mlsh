var DATABASES = ["Security", "Schemas"];
var PATH = "/export/Snapshots";
var IGNORE_HOST = [];
var messages = [];
DATABASES.forEach(function (name) {
  var forests = xdmp.databaseForests(xdmp.database(name));
  Array.from(xdmp.hosts()).map(xdmp.hostName).filter(function (host) { return !IGNORE_HOST.includes(host); }).forEach(function (host) {
    xdmp.filesystemDirectoryCreate("file://" + host + PATH + "/" + name);
  });
  messages.push("Backing up " + name + " (" + fn.count(forests) + " forests)");
  messages.push(String(xdmp.databaseBackup(forests, PATH + "/" + name, false, null)));
});
messages.join("\n");
