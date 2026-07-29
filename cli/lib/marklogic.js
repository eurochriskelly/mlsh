import fs from 'fs';
import os from 'os';
import path from 'path';
import { runProcess } from './process.js';

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@%+,-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

export class MarkLogicClient {
  constructor({ environment, logger, processEnvironment = process.env }) {
    this.environment = environment;
    this.logger = logger;
    this.timeout = positiveNumber(processEnvironment.MLSH_CURL_TIMEOUT, 120);
    this.heartbeat = positiveNumber(processEnvironment.MLSH_CURL_HEARTBEAT, 5);
  }

  get baseUrl() {
    const { protocol = 'http', host, port } = this.environment;
    return `${protocol}://${host}:${port}`;
  }

  authenticatedArgs() {
    return ['--silent', '--show-error', '--digest', '-u', `${this.environment.user}:${this.environment.pass}`];
  }

  async curl(label, args, { timeout = this.timeout } = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mlsh-curl-'));
    const bodyFile = path.join(directory, 'body');
    const fullArgs = ['--max-time', String(timeout), ...args, '-o', bodyFile, '-w', '%{http_code}'];
    const rendered = fullArgs.map(shellQuote).join(' ');
    this.logger.info(`${label} request: curl ${this.logger.redact(rendered)} (timeout=${timeout}s)`);

    const started = Date.now();
    let waited = 0;
    const ticker = setInterval(() => {
      waited += this.heartbeat;
      this.logger.warn(`${label} still waiting after ${waited}s (server has not responded yet; will give up at ${timeout}s)`);
    }, this.heartbeat * 1000);

    try {
      const result = await runProcess('curl', fullArgs);
      const elapsed = Math.floor((Date.now() - started) / 1000);
      const body = fs.existsSync(bodyFile) ? fs.readFileSync(bodyFile) : Buffer.alloc(0);
      const status = result.stdout.toString().trim();
      const stderr = result.stderr.toString().trim();
      if (stderr) this.logger.debug(`${label} curl: ${stderr}`);
      if (result.code === 28) this.logger.error(`${label} TIMED OUT after ${elapsed}s`);
      else if (result.code !== 0) this.logger.error(`${label} transport failure: curl exit=${result.code} after ${elapsed}s`);
      else this.logger.info(`${label} response: status=${status} bytes=${body.length} elapsed=${elapsed}s`);
      if (body.length) {
        const log = status.startsWith('2') ? this.logger.trace : this.logger.warn;
        log(`${label} body | ${body.toString().replace(/\r?\n/g, `\n${label} body | `)}`);
      }
      return { ...result, status, body, elapsed };
    } finally {
      clearInterval(ticker);
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  async request(endpoint, args = []) {
    const result = await this.curl(`fetch ${endpoint.split('?')[0]}`, [
      ...this.authenticatedArgs(),
      `${this.baseUrl}${endpoint}`,
      ...args
    ]);
    return { ...result, ok: result.code === 0 && result.status.startsWith('2') };
  }

  async evaluate(script, database, params) {
    const args = [
      ...this.authenticatedArgs(),
      '-X', 'POST', `${this.baseUrl}/v1/eval`,
      '-H', 'Content-Type: application/x-www-form-urlencoded',
      '--data-urlencode', `xquery@${script}`,
      '--data-urlencode', `db=${database}`
    ];
    if (params) args.push('--data-urlencode', `vars=${params}`);
    return this.curl(`eval ${path.basename(script)}`, args);
  }
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function evalErrorDetail(body) {
  const text = Buffer.isBuffer(body) ? body.toString() : String(body || '');
  try {
    const error = JSON.parse(text).errorResponse;
    if (error) return `  ${error.messageCode || '?'}: ${error.message || ''}\n  ${error.formatString || ''}`.trimEnd();
  } catch {
    // MarkLogic may return XML or multipart text instead of JSON.
  }
  const codes = text.match(/(?:XDMP|SEC|REST|MANAGE)-[A-Z0-9]+[^<"\r\n]*/g);
  if (codes?.length) return codes.slice(0, 5).map(line => `  ${line}`).join('\n');
  return text.split(/\r?\n/).slice(0, 20).map(line => `  ${line}`).join('\n');
}
