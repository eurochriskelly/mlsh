import fs from 'fs';
import os from 'os';
import path from 'path';
import tls from 'tls';
import { spawnSync } from 'child_process';
import { commandExists, runProcess } from './process.js';

// A shared, persistent Java trust store used only by the bundled MLCP
// runner's forked JVM (see gradle/mlcp/build.gradle). It never replaces or
// touches the JDK's own default trust store used elsewhere. The password
// isn't a secret - the store only ever holds public server certificates,
// never private keys - it's just required by the keystore format.
//
// Explicitly PKCS12 (not JKS): since JDK 9, `keytool` defaults to creating
// PKCS12 stores even when the file is named *.jks, and the JVM's
// javax.net.ssl.trustStoreType system property must match the file's actual
// format or the custom trust store silently fails to load (falling back to
// the default cacerts, and reproducing the exact "unable to find valid
// certification path" error insecure=true is meant to fix). Passing
// -storetype explicitly here keeps that pinned regardless of keytool's
// default, on any JDK version.
export const TRUST_STORE_PASSWORD = 'mlsh-trust-store';
export const TRUST_STORE_TYPE = 'PKCS12';

export function trustStorePath(home = os.homedir()) {
  return path.join(home, '.mlsh', 'trust-store.jks');
}

export function certificateAlias(host, port) {
  return `${host}_${port}`.replace(/[^A-Za-z0-9_.-]/g, '_');
}

// Connects just far enough to grab the server's presented TLS certificate
// chain, without validating it (that's the whole point - we're establishing
// trust for the first time, like SSH's "trust this host key" prompt).
// Returns an array of PEM strings, leaf certificate first.
export function fetchPeerCertificateChainPem(host, port, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: Number(port), rejectUnauthorized: false, timeout }, () => {
      const chain = [];
      let certificate = socket.getPeerCertificate(true);
      const seen = new Set();
      while (certificate && certificate.raw && !seen.has(certificate.fingerprint256)) {
        seen.add(certificate.fingerprint256);
        chain.push(certificate);
        certificate = certificate.issuerCertificate;
      }
      socket.end();
      if (!chain.length) return reject(new Error(`No certificate presented by ${host}:${port}.`));
      resolve(chain.map(entry => toPem(entry.raw)));
    });
    socket.on('timeout', () => { socket.destroy(); reject(new Error(`Timed out connecting to ${host}:${port}.`)); });
    socket.on('error', reject);
  });
}

function toPem(raw) {
  const lines = raw.toString('base64').match(/.{1,64}/g) || [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

async function deleteAliasIfPresent(storePath, alias) {
  await runProcess('keytool', ['-delete', '-keystore', storePath, '-storetype', TRUST_STORE_TYPE, '-storepass', TRUST_STORE_PASSWORD, '-alias', alias]);
}

// Ensures a single host:port's full certificate chain (leaf through root) is
// trusted in MLSH's shared trust store. Always re-fetches and re-imports
// (rather than skipping if an alias already exists): earlier MLSH versions
// only imported the leaf certificate, which is not enough for servers that
// present an intermediate CA, so a stale single-cert entry must not be
// silently trusted as "already done". Returns the list of imported aliases
// with each certificate's subject, for logging/diagnostics.
export async function ensureTrustedCertificate({ host, port }, home = os.homedir()) {
  const storePath = trustStorePath(home);
  const baseAlias = certificateAlias(host, port);

  if (!(await commandExists('keytool'))) {
    throw new Error("'keytool' was not found on PATH. It ships with every JDK; install one (Java 17+) to use insecure=true environments with mlcp.");
  }

  fs.mkdirSync(path.dirname(storePath), { recursive: true, mode: 0o700 });
  const chainPems = await fetchPeerCertificateChainPem(host, port);
  const imported = [];

  for (const [index, pem] of chainPems.entries()) {
    const alias = index === 0 ? baseAlias : `${baseAlias}-${index}`;
    const tempFile = path.join(os.tmpdir(), `mlsh-trust-${process.pid}-${Date.now()}-${index}.pem`);
    fs.writeFileSync(tempFile, pem);
    try {
      await deleteAliasIfPresent(storePath, alias);
      const result = await runProcess('keytool', [
        '-importcert', '-noprompt',
        '-alias', alias,
        '-file', tempFile,
        '-keystore', storePath,
        '-storetype', TRUST_STORE_TYPE,
        '-storepass', TRUST_STORE_PASSWORD
      ]);
      if (result.code !== 0) {
        throw new Error(`keytool failed to import a certificate for ${host}:${port} (alias ${alias}): ${result.stderr.toString().trim()}`);
      }
      imported.push({ alias, subject: subjectOf(pem) });
    } finally {
      fs.rmSync(tempFile, { force: true });
    }
  }

  return imported;
}

// Best-effort human-readable subject line for a PEM cert, using `openssl` if
// available (purely for diagnostics/logging; never used for trust decisions).
function subjectOf(pem) {
  try {
    const result = spawnSync('openssl', ['x509', '-noout', '-subject', '-issuer'], { input: pem, encoding: 'utf8' });
    if (result.status === 0) return result.stdout.trim().replace(/\n/g, ', ');
  } catch {
    // openssl isn't required; this is only used for nicer log output.
  }
  return '(subject unavailable - install openssl for details)';
}

// Ensures every given host:port is trusted, deduplicating repeats (e.g. a
// copy job whose source and destination happen to share a host). Returns the
// shared trust store's path/password/type plus every alias imported (across
// all entries) for logging/diagnostics, or null if the list was empty.
export async function ensureTrustedCertificates(entries, home = os.homedir()) {
  const unique = [...new Map(entries.map(entry => [`${entry.host}:${entry.port}`, entry])).values()];
  if (!unique.length) return null;
  const imported = [];
  for (const entry of unique) imported.push(...(await ensureTrustedCertificate(entry, home)));
  return { trustStorePath: trustStorePath(home), trustStorePassword: TRUST_STORE_PASSWORD, trustStoreType: TRUST_STORE_TYPE, imported };
}
