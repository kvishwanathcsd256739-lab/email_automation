import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const scrypt = promisify(scryptCallback);
const COOKIE = 'mailroom_session';
export async function writeAccount(directory, username, password) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  const account = { username, salt, hash };
  writeFileSync(join(directory, 'auth.json'), JSON.stringify(account), { mode: 0o600 });
  return account;
}

export async function createAuth(directory, { username = process.env.ADMIN_USERNAME || 'admin', password = process.env.ADMIN_PASSWORD, sessionTtl = 8 * 60 * 60 * 1000 } = {}) {
  const file = join(directory, 'auth.json');
  let account;
  if (existsSync(file)) account = JSON.parse(readFileSync(file, 'utf8'));
  else {
    if (!password) throw new Error('Set ADMIN_PASSWORD in .env to create the initial admin account.');
    account = await writeAccount(directory, username, password);
  }
  const sessions = new Map(), attempts = new Map();
  const tokenFor = req => /(?:^|;\s*)mailroom_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  const prune = () => {
    const now = Date.now();
    for (const [token, session] of sessions) if (session.expires <= now) sessions.delete(token);
    for (const [address, record] of attempts) if (record.until <= now) attempts.delete(address);
  };
  return {
    session(req) { prune(); return sessions.get(tokenFor(req)); },
    async login(req, res, body) {
      prune();
      const address = req.socket.remoteAddress;
      const record = attempts.get(address) || { count: 0, until: Date.now() + 15 * 60 * 1000 };
      if (record.count >= 5) return { status:429, error:'Too many attempts. Please try again in 15 minutes.' };
      record.count++; attempts.set(address, record);
      const validInput = typeof body.username === 'string' && typeof body.password === 'string' && body.password.length <= 1024;
      const supplied = await scrypt(validInput ? body.password : '', account.salt, 64);
      if (!validInput || !timingSafeEqual(supplied, Buffer.from(account.hash, 'hex')) || body.username !== account.username) return { status:401, error:'Incorrect username or password.' };
      attempts.delete(address);
      sessions.delete(tokenFor(req));
      const token = randomBytes(32).toString('hex');
      const session = { username:account.username, expires:Date.now() + sessionTtl };
      sessions.set(token, session);
      res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.ceil(sessionTtl / 1000)}`);
      return { status:200, username:account.username };
    },
    logout(req, res) {
      sessions.delete(tokenFor(req));
      res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    }
  };
}
