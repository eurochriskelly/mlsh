import fs from 'fs';
import os from 'os';
import path from 'path';
import tls from 'tls';
import { commandExists, runProcess } from './process.js';

// A shared, persistent Java trust store used only by the bundled MLCP
// runner's forked JVM (see gradle/mlcp/build.gradle). It never replaces or
// touches the JDK's own default trust store used elsewhere. The password
// isn't a secret - the store only ever holds public server certificates,
// never private keys - it's just required by the JKS format.
export const TRUST_STORE_PASSWORD = 'mlsh-trust-store';

export function trustStorePath(home = os.homedir()) {
  return path.join(home, '.mlsh', 'trust-store.jks');
}

export function certificateAlias(host, port) {
  return `${host}_${port}`.replace(/[^A-Za-z0-9_.-]/g, '_');
}

// Connects just far enough to grab the server's presented TLS certificate,
// without validating it (that's the whole point - we're establishing trust
// for the first time, like SSH's "trust this host key" prompt).
export function fetchPeerCertificatePem(host, port, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: Number(port), rejectUnauthorized: false, timeout }, () => {
      const certificate = socket.getPeerCertificate();
      socket.end();
      if (!certificate || !certificate.raw) return reject(new Error(`No certificate presented by ${host}:${port}.`));
      const base64 = certificate.raw.toString('base64');
      const lines = base64.match(/.{1,64}/g) || [];
      resolve(`-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`);
    });
    socket.on('timeout', () => { socket.destroy(); reject(new Error(`Timed out connecting to ${host}:${port}.`)); });
    socket.on('error', reject);
  });
}

async function aliasAlreadyTrusted(storePath, alias) {
  if (!fs.existsSync(storePath)) return false;
  const result = await runProcess('keytool', ['-list', '-keystore', storePath, '-storepass', TRUST_STORE_PASSWORD, '-alias', alias]);
  return result.code === 0;
}

// Ensures a single host:port's certificate is trusted in MLSH's shared trust
// store, fetching and importing it (trust-on-first-use) if it isn't already.
export async function ensureTrustedCertificate({ host, port }, home = os.homedir()) {
  const storePath = trustStorePath(home);
  const alias = certificateAlias(host, port);
  if (await aliasAlreadyTrusted(storePath, alias)) return;

  if (!(await commandExists('keytool'))) {
    throw new Error("'keytool' was not found on PATH. It ships with every JDK; install one (Java 17+) to use insecure=true environments with mlcp.");
  }

  fs.mkdirSync(path.dirname(storePath), { recursive: true, mode: 0o700 });
  const pem = await fetchPeerCertificatePem(host, port);
  const tempFile = path.join(os.tmpdir(), `mlsh-trust-${process.pid}-${Date.now()}.pem`);
  fs.writeFileSync(tempFile, pem);
  try {
    const result = await runProcess('keytool', [
      '-importcert', '-noprompt',
      '-alias', alias,
      '-file', tempFile,
      '-keystore', storePath,
      '-storepass', TRUST_STORE_PASSWORD
    ]);
    if (result.code !== 0) {
      throw new Error(`keytool failed to import the certificate for ${host}:${port}: ${result.stderr.toString().trim()}`);
    }
  } finally {
    fs.rmSync(tempFile, { force: true });
  }
}

// Ensures every given host:port is trusted, deduplicating repeats (e.g. a
// copy job whose source and destination happen to share a host). Returns the
// shared trust store's path/password if there was anything to trust, or null
// if the list was empty.
export async function ensureTrustedCertificates(entries, home = os.homedir()) {
  const unique = [...new Map(entries.map(entry => [`${entry.host}:${entry.port}`, entry])).values()];
  if (!unique.length) return null;
  for (const entry of unique) await ensureTrustedCertificate(entry, home);
  return { trustStorePath: trustStorePath(home), trustStorePassword: TRUST_STORE_PASSWORD };
}
