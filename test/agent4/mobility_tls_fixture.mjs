// Ephemeral test certificates only. Never imported by traveling programs or use
// archives; no trust-store installation or production identity modification.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
export async function certificates(root) {
  const directory = join(root, 'tls'); await mkdir(directory, { mode: 0o700 });
  const run = args => execFileSync('openssl', args, { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
  run(['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '1', '-subj', '/CN=MobilityFixtureRoot', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
  const result = { ca: await readFile(join(directory, 'ca.pem')) };
  await chmod(join(directory, 'ca.key'), 0o600);
  for (const name of ['A', 'B', 'C']) {
    run(['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', `/CN=MobilityFixture${name}`]);
    await writeFile(join(directory, `${name}.ext`), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth,clientAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n', { mode: 0o600 });
    run(['x509', '-req', '-in', `${name}.csr`, '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', `${name}.pem`, '-days', '1', '-extfile', `${name}.ext`]);
    await chmod(join(directory, `${name}.key`), 0o600);
    const cert = await readFile(join(directory, `${name}.pem`)), key = await readFile(join(directory, `${name}.key`));
    result[name] = { cert, key, fingerprint256: new X509Certificate(cert).fingerprint256 };
  }
  return result;
}
