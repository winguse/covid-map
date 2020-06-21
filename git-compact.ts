import { assert, equal } from "https://deno.land/std/testing/asserts.ts";
import { readJson, exists } from "https://deno.land/std@0.51.0/fs/mod.ts";
import { Result } from './index.d.ts';

const GH_TOKEN = Deno.env.get('ACCESS_TOKEN');
const BRANCH = 'gh-pages';
const OWNER = 'winguse';
const REPO = 'covid-map';
const remoteURL = `https://x-access-token:${GH_TOKEN}@github.com/${OWNER}/${REPO}.git`;

async function run(cmd: string[], cwd = `./${BRANCH}`) {
  console.log('run: ', cmd.join(' '));
  const process = Deno.run({
    cmd,
    cwd,
    stdout: 'piped',
  });
  assert((await process.status()).success, `${cmd.join(' ')} should success`);
  return process;
}

if (await exists(BRANCH)) {
  await Deno.remove(BRANCH, { recursive: true });
}

await run(['git', 'clone', '--single-branch', '--branch', BRANCH, remoteURL, BRANCH], '.')
await run(['git', 'remote', 'rm', 'origin']);
await run(['git', 'remote', 'add', 'origin', remoteURL]);
await run(['git', 'config', 'user.email', `${Deno.env.get('GITHUB_ACTOR')}@users.noreply.github.com`])
await run(['git', 'config', 'user.name', `${Deno.env.get('GITHUB_ACTOR')}`]);

const logCommand = await run(['git', 'log', '--oneline', '--format=%H'])
const gitLog = await logCommand.output().then(arr => new TextDecoder("utf-8").decode(arr));
const hashes = gitLog.split('\n').filter(l => l).reverse();


let previousIndex: undefined | Result[] = undefined;
const compacts: string[][] = [];

for (const hash of hashes) {
  const gitCheckoutIndex = Deno.run({
    cmd: [
      'git', 'checkout',
      hash,
      '--', 'index.json'
    ],
    stderr: 'piped',
    cwd: `./${BRANCH}`
  });
  const { success } = await gitCheckoutIndex.status();
  if (!success) {
    const stderr = await gitCheckoutIndex.stderrOutput().then(arr => new TextDecoder("utf-8").decode(arr));
    assert(stderr.trim() === "error: pathspec 'index.json' did not match any file(s) known to git", 'should error about index.json missing');
    continue;
  }
  const currentIndex = await readJson(`./${BRANCH}/index.json`) as Result[];
  if (previousIndex) {
    const pre = previousIndex.map(o => ({ ...o }));
    const cur = currentIndex.map(o => ({ ...o }));
    pre.forEach(o => delete o.syncAt);
    cur.forEach(o => delete o.syncAt);
    if (equal(pre, cur)) {
      compacts[compacts.length - 1][1] = hash;
    } else {
      compacts.push([hash, '']);
    }
  } else {
    compacts.push([hash, '']);
  }
  previousIndex = currentIndex;
}

while (compacts.length && compacts[0][1] === '') {
  compacts.shift();
}

if (compacts.length) {
  await run(['git', 'reset', '--hard', `${compacts[0][0]}~1`]);
  for (const compact of compacts) {
    await run(['git', 'cherry-pick', compact[0]]);
    if (compact[1] !== '') {
      await run(['git', 'cherry-pick', '-n', compact.join('...')]);
      await run(['git', 'commit', '--amend', '--no-edit',]);
    }
  }

  await run(['git', 'push', 'origin', '--force', BRANCH]);
}

