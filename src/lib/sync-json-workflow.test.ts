import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

/**
 * Sync JSON Data ワークフローの dispatch 条件を守る。
 *
 * 管理画面が書いた CSV のコミットは、JSON がまだ古い中間状態で main に入る。JSON を
 * 作り直す bot commit は GITHUB_TOKEN による push なので on:push を起動せず、CI から
 * 明示的に dispatch しないと同期後の木が一度も検証されない。
 */

const WORKFLOW_PATH = path.join(
  process.cwd(),
  '.github',
  'workflows',
  'sync-json-data.yml',
);

interface JobState {
  /** 同期コミットを push できたか（`commit-json` ステップの出力） */
  pushed: boolean;
  /** それより前のステップが失敗しているか（R2 アップロード、ISR 再検証など） */
  earlierFailure: boolean;
  cancelled: boolean;
}

/**
 * GitHub Actions の `if` を、この 2 ステップが使う書き方の範囲で評価する。
 *
 * 肝は「ステータス判定関数（success / failure / always / cancelled）を含まない条件には
 * 暗黙の success() が付く」という仕様。`steps.x.outputs.pushed == 'true'` だけを書くと
 * 「前のステップが全部成功していて、かつ pushed が true」になる。
 */
function runsStep(condition: string, state: JobState): boolean {
  const hasStatusFunction = /\b(success|failure|always|cancelled)\s*\(/.test(condition);
  const statusGate = hasStatusFunction
    ? /!\s*cancelled\s*\(\s*\)/.test(condition)
      ? !state.cancelled
      : true
    : !state.earlierFailure && !state.cancelled;
  const pushedGate = /steps\.commit-json\.outputs\.pushed == 'true'/.test(condition)
    ? state.pushed
    : true;
  return statusGate && pushedGate;
}

function conditionOf(workflow: string, stepName: string): string {
  const match = workflow.match(
    new RegExp(`- name: ${stepName}\\s*\\n\\s*if: (.+)`),
  );
  assert.ok(match, `${stepName} の if が読めない`);
  return match[1]!.trim();
}

test('同期コミットを push できたら、配信が失敗しても CI を要求する', async () => {
  const workflow = await readFile(WORKFLOW_PATH, 'utf8');
  const condition = conditionOf(workflow, 'Trigger CI on the synced tree');

  assert.equal(
    runsStep(condition, { pushed: true, earlierFailure: false, cancelled: false }),
    true,
    '通常どおり同期できたら起動する',
  );
  assert.equal(
    runsStep(condition, { pushed: true, earlierFailure: true, cancelled: false }),
    true,
    'R2 アップロードや ISR 再検証が落ちても、push 済みのコミットは検証する',
  );
  assert.equal(
    runsStep(condition, { pushed: false, earlierFailure: false, cancelled: false }),
    false,
    'コミットしていないなら検証するものが無い',
  );
  assert.equal(
    runsStep(condition, { pushed: true, earlierFailure: false, cancelled: true }),
    false,
    'ジョブがキャンセルされたら起動しない',
  );
});

test('配信の dispatch は、前段が失敗したら走らせない', async () => {
  // CI（コードの検証）と違い、配信は前段の成否に意味がある。R2 が古いまま本番の
  // フォント反映まで進めたくないので、こちらは暗黙の success() のままにしておく
  const workflow = await readFile(WORKFLOW_PATH, 'utf8');
  const condition = conditionOf(
    workflow,
    'Trigger production font activation or candidate upload',
  );

  assert.equal(
    runsStep(condition, { pushed: true, earlierFailure: false, cancelled: false }),
    true,
  );
  assert.equal(
    runsStep(condition, { pushed: true, earlierFailure: true, cancelled: false }),
    false,
  );
});

test('CI ワークフローは dispatch を受け付ける', async () => {
  const ci = await readFile(
    path.join(process.cwd(), '.github', 'workflows', 'ci.yml'),
    'utf8',
  );
  assert.match(ci, /^\s{2}workflow_dispatch:\s*$/m);
});
