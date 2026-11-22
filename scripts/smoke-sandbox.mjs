import assert from 'node:assert/strict';
import {access, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {makeHandlers} from '../modules/queue-handlers.mjs';
import {runSandbox} from '../modules/sandbox.mjs';
import {TaskQueue} from '../modules/task-queue.mjs';

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

  const file = join(workspace, '.omh', 'tasks.json');
  const worker = new TaskQueue(file, makeHandlers(workspace));
  const client = new TaskQueue(file);
  const failed = await worker.enqueue('sandbox.exec', {
    command: 'sh', args: ['-c', 'exit 7'], approved: true,
  });
  assert.match((await worker.runById(failed.id)).error, /exited with code 7/);
  const task = await worker.enqueue('sandbox.exec', {
    command: 'sh', args: ['-c', 'while true; do echo running >> heartbeat; sleep 0.05; done'],
    approved: true, timeoutMs: 8000, workspaceId: 'cancel',
  });
  const running = worker.runById(task.id);
  const sandbox = join(workspace, '.omh', 'sandboxes', 'cancel');
  try {
    let started = false;
    for (let attempt = 0; attempt < 40 && !started; attempt++) {
      started = await access(join(sandbox, 'heartbeat')).then(() => true, () => false);
      if (!started) await delay(50);
    }
    assert.equal(started, true);
    const requested = await client.cancel(task.id);
    assert.equal(requested.status, 'running');
    assert.ok(requested.cancelRequestedAt);
    assert.equal((await running).status, 'cancelled');
    const heartbeat = await readFile(join(sandbox, 'heartbeat'), 'utf8');
    await delay(300);
    assert.equal(await readFile(join(sandbox, 'heartbeat'), 'utf8'), heartbeat);
    console.log('The queue cancelled a running Bubblewrap task after the sandbox process closed.');
  } finally {
    await running;
  }
} finally {
  await rm(workspace, {recursive: true, force: true});
  await rm(privateRoot, {recursive: true, force: true});
}
