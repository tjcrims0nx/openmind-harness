import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runSandbox} from '../modules/sandbox.mjs';

const workspace = await mkdtemp(join(tmpdir(), 'omh-sandbox-'));
const privateRoot = await mkdtemp(join(tmpdir(), 'omh-host-'));
const secretFile = join(privateRoot, 'private.txt');

try {
  await writeFile(secretFile, 'host fixture');
  const isolated = await runSandbox({
    workspace,
    command: 'python3',
    args: ['-c', `
import os
import sys
from pathlib import Path

assert Path.cwd() == Path('/workspace')
assert not Path('/etc/passwd').exists()
assert not Path(sys.argv[1]).exists()
assert not Path('/proc', sys.argv[2]).exists()
assert 'OMH_SANDBOX_HOST_FIXTURE' not in os.environ
assert len(Path('/proc/net/route').read_text().splitlines()) == 1
interfaces = Path('/proc/net/dev').read_text().splitlines()[2:]
assert [line.split(':')[0].strip() for line in interfaces] == ['lo']
Path('/workspace/result.txt').write_text('isolated')
`, secretFile, String(process.pid)],
  });
  assert.equal(isolated.exitCode, 0, isolated.stderr);
  assert.equal(await readFile(join(workspace, 'result.txt'), 'utf8'), 'isolated');
  const exit = await runSandbox({workspace, command: 'sh', args: ['-c', 'exit 7']});
  assert.equal(exit.exitCode, 7);
  const timed = await runSandbox({workspace, command: 'sh', args: ['-c', 'exec sleep 10'], timeoutMs: 500});
  assert.equal(timed.timedOut, true);
  const overflow = await runSandbox({
    workspace, command: 'sh', args: ['-c', 'exec yes'], maxOutputBytes: 1024,
  });
  assert.equal(overflow.outputTruncated, true);
  assert.ok(Buffer.byteLength(overflow.stdout) + Buffer.byteLength(overflow.stderr) <= 1024);
  await assert.rejects(runSandbox({workspace, command: 'bash'}), /not allowed/);
  console.log('Bubblewrap verified workspace writes, private host paths, process/network namespaces, exit status, timeout, and output limits.');
} finally {
  await rm(workspace, {recursive: true, force: true});
  await rm(privateRoot, {recursive: true, force: true});
}
