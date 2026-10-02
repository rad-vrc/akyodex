# Dify answer routing update

Do not publish until the corresponding search Worker has passed review and is
deployed. Changes below are saved as an unpublished Dify draft. No new LLM,
model, credentials or inference call is required. Count/filter/clarification
answers bypass the LLM entirely.

## Deterministic answer path

Prompt instructions alone were insufficient: the configured GLM model received
`total: 487, count: 1` and nevertheless answered "1体" in a node test. The Worker
therefore returns a `directAnswer` for `count`, `filtered`, `needs-context` and
`clarification`. The limited example `count` remains unchanged for compatibility.

The draft graph is:

```text
Start -> existing Template -> existing HTTP -> Code -> IF/ELSE
                                              nonempty -> Answer 2
                                              empty    -> existing LLM -> existing Answer
```

Add a Python3 Code node after HTTP. Input `arg1` is HTTP `body` (String), output
`result` is String. Use this exact code:

```python
import json

def main(arg1: str) -> dict:
    failure = "図鑑データを取得できませんでした。もう一度試してください。"
    try:
        data = json.loads(arg1)
    except (TypeError, ValueError):
        return {"result": failure}
    if not isinstance(data, dict) or data.get("error") or not data.get("searchMode"):
        return {"result": failure}
    if data["searchMode"] in ("count", "filtered", "needs-context", "clarification"):
        answer = data.get("directAnswer")
        return {"result": answer if isinstance(answer, str) and answer.strip() else failure}
    return {"result": ""}
```

IF tests Code `result` **is not empty**. Its true branch is an Answer node whose
entire content is the Code `result` variable. ELSE connects to the existing LLM.
Keep the existing LLM-to-Answer edge. Never send direct answers back through the
LLM for rewriting, counting or merging with conversation history.

Clear the LLM's optional **Context** selection, but retain the normal HTTP `body`
variable in the SYSTEM prompt. Selecting HTTP `body` as knowledge context caused
it to become an empty RAG attribution object in the node-only test. With Context
unset, the actual model input contains the JSON string. Normal MenmeAkyo lookup
completed through the new graph and its LLM output was verified in Last Run.

Keep the anti-fabrication and individual-record templates. The following SYSTEM
section is also in the draft (defensive only for the direct modes, which normally
cannot reach it). Replace `【判定】` through `【アバター用出力形式】`, not the HTTP
request or USER message.

## Replacement

```text
【判定】
参照データが空、errorを含む、またはsearchModeを読み取れない場合は「図鑑データを取得できませんでした。もう一度試してください。」と答えること。取得失敗を0件と解釈してはならない。

次の順序で判定すること。1〜4に当てはまるときは、下の個体紹介テンプレートを使わないこと。

1. searchMode が "needs-context" の場合:
「どのAkyoについての質問ですか？ 名前を入れて質問してください。」とだけ答えること。会話履歴から別のAkyoを選んだり、今回取得していない情報で対応機種を断定してはならない。

2. searchMode が "clarification" の場合:
「条件を正確に読み取れませんでした。作者名・対応機種・色など、探したい条件を確認させてください。」と答えること。0件だったとは断定しないこと。

3. searchMode が "count" の場合:
該当総数は total であり、count や results の長さではない。filters の条件と、アバターかワールドかを明示して「図鑑の該当するアバターは{total}体です」または「図鑑の該当するワールドは{total}件です」と答えること。total が0なら0件と答えること。results は例示であって全件ではなく、例の数から総数を推測しないこと。個体紹介を代わりに返してはならない。

4. searchMode が "filtered" の場合:
filters の条件で絞り込んだ結果である。total が0なら「指定条件に一致するものは図鑑データで確認できません。」と答えること。total が1以上なら、その総数と今回の紹介件数を示し、results 内の各レコードを順に番号付きで紹介すること。各項目は nickname、author、category、同じレコードのurlを簡潔に記すこと。entryType が world ならワールドと呼び、アバターとは呼ばないこと。返っていないレコードで指定数を埋めてはならない。番号付きリストの番号は並び順であり、図鑑の番号として扱わないこと。

5. searchMode が "specific-name" かつ nameMatch が false の場合、または count が0の場合:
「そのAkyoは図鑑データで確認できません。」とのみ回答すること。

6. それ以外:
results の先頭レコードだけを回答対象にし、下の個体紹介テンプレートを使うこと。対応機種など個別の項目を聞かれた場合は、同じレコードのcategoryなどに明記された内容だけを簡潔に答えること。情報がない場合は「図鑑データでは確認できません」と答え、別の個体に置き換えてはならない。
```

## Previous section (rollback)

```text
【判定】
searchMode が "specific-name" かつ nameMatch が false の場合、または count が 0 の場合は、「そのAkyoは図鑑データで確認できません。」とのみ回答すること。前置きや説明を加えないこと。
それ以外は results の先頭レコードだけを回答対象にすること。
```

## Scope and rollout

- The Japanese question parser is intentionally bounded and not a general
  natural-language query engine. It supports explicit platform/color AND filters,
  exact author counts and worlds. Unknown conditions ask for clarification only
  on counts. Lists containing any unsupported condition retain ordinary discovery
  without applying only the recognized subset or claiming an exact total.
- An ambiguous `Xを教えて`, `Xを知りたい` or `Xを説明して` name miss returns to
  discovery, including polite forms stripped by preprocessing; `Xについて...`
  and public display numbers remain strict. Exact name matches still avoid semantic search.
  A partial-name match alone does not suppress discovery for these ambiguous
  requests: ordinary discovery retains both lexical and semantic candidates.
- Japanese aliases query the JA catalog and return `language: "ja"`, even if the
  caller requested another response language. They never compare Japanese category
  tokens against translated rows. Current synchronization is JA-only.
- Category tokens are complete comma-separated tokens, not substring matches.
  Renaming the corresponding category requires updating the aliases; they do not
  infer an old category's replacement. A zero result triggers an existence check
  for each condition across the whole JA catalog. Missing categories ask for
  clarification on counts and revert to discovery on lists; missing authors ask
  for the registered spelling. Existing conditions with an empty intersection
  still report zero, as do known world-only authors when asked about avatars.
  Counts describe synchronized data, not
  every Akyo or author on VRChat. World/avatar classification follows the existing
  search payload's URL-based contract.
- Counts exclude worlds unless the question explicitly asks for worlds. `total`
  is the full matching count; `count` remains the number of returned examples for
  compatibility. Explicit list sizes are clamped to the existing 1-8 limit.
- Follow-up references deliberately ask for a name. Automatic resolution of
  conversation history before retrieval remains future work; it is not safe to
  answer about an unrelated semantic match or rely on old generated prose.
  The guard requires a particle after the subject, so `このAkyo図鑑` is not
  mistaken for an unresolved reference. The bounded `そのAkyoの名前はXです`
  form uses a recognizable supplied name via strict D1 lookup. It does not
  recover history or ask an LLM to infer the missing subject.
- Numeric lookup uses the website's public display numbers, never internal IDs.
  `#Avatar0896` and `#Avatar0896のAkyoについて教えて` both refer to the
  site's Avatar0896. `#World0001` refers to the site's World0001. Bare numbers
  shared by both series return `clarification` with a `directAnswer` instructing
  the visitor to resend a full prefixed number. The Worker does not remember a
  previous question, so replying only `アバター` is insufficient. The Code node
  must pass this direct answer through unchanged; test this path in the draft.
- After explicit approval: sync the additive D1 `publicId` column, verify a
  zero-diff dry run, deploy the search Worker, test the saved Dify draft, then
  publish and repeat the real conversation tests. The public-number sync is
  row-only and needs no re-embedding. Automatic sync is enabled: to require a
  dry run before writes, disable `AI_CATALOG_SYNC_ENABLED` before merge (with
  release approval). These operations are separate from website activation.
- To roll back, restore the previous Dify published version/graph and the recorded
  Worker version. The original graph connects HTTP directly to LLM, with no Code,
  IF/ELSE or Answer 2 node. The old Context selection is HTTP `body`.

## Draft verification and remaining checks

- The Python Code node returned the exact 487-avatar answer from a synthetic
  Worker response, and IF/ELSE selected its true branch. Both used 0 model tokens.
- A complete draft run for MenmeAkyo traversed the ordinary LLM path. Last Run
  reported SUCCESS and contained the correct MenmeAkyo/AkyoMenme record.
- Dify's variable inspector hit `Cannot read properties of undefined (reading
  'is_truncated')` during testing. Reloading recovered the editor and execution
  records. A second complete MenmeAkyo run with the inspector closed displayed
  the full correct answer in the draft chat. This was verified visually, not
  inferred from the backend SUCCESS alone.
- Edited HTTP cache variables were reset before the complete draft run. The
  draft still uses the production search URL; the new Worker is not deployed.
  Full direct-answer conversations therefore remain a post-deployment check.
- No Dify publication, Worker deployment, merge or website activation was done.

## Review regression checks

The review found discovery regressions beyond the original ten questions. The
local tests now exercise actual Worker routing and SQLite queries, with a fake
AI/Vectorize candidate that must survive the discovery path. This proves routing,
not the relevance of live embeddings or the final Dify prose.

- Eighteen exploratory list questions cover unknown subjects/adjectives, requested
  quantities, worlds, mixed known/unknown conditions, negation and OR. They retain
  discovery instead of clarification, partial deterministic filtering or an empty
  strict-name result. Unsupported counts still ask for clarification.
- Name-first requests cover query and keyword inputs, successful names, absent
  explicit subjects, numeric IDs, and the supplied-name follow-up form.
  A suffix matrix additionally covers all three Japanese request verbs and their
  polite forms through both query and keyword inputs: 36 exploratory requests
  retain semantic candidates, 12 known-name requests avoid AI, and 24 missing
  explicit-name/ID requests remain strict without semantic substitution.
- Website questions do not ask which Akyo is meant. Unresolved references still do.
- Author spelling misses and renamed/unused category aliases do not assert zero.
  Legitimate zero intersections and world-only authors remain valid zero results.
- Common aliases for eleven color families use whole category tokens. Counts and
  results for the real catalog still agree with independently filtered source rows.

These changes preserve the four `directAnswer` modes and need no additional Dify
graph edit. The draft remains unpublished; post-rollout chat checks are still required.

## Baseline conversation audit (2026-10-02)

Ten real messages were sent before these fixes, with a new conversation per
case except the deliberate follow-up. Three met the expected behavior.

| Question | Observed answer | Outcome |
| --- | --- | --- |
| 最新のAkyoについて教えて | Not found | Wrong latest intent |
| 最新のAkyoは？ | MenmeAkyo | Correct |
| そのAkyoはQuestでも使えますか？ | スーパー汎用Akyo | Wrong referent |
| #0001のAkyoについて教えて | Empty answer bubble | Incorrect; exact lookup also missed |
| MenmeAkyoについて教えて | MenmeAkyo | Correct |
| Quest対応のAkyoは何体ありますか？ | A PC-only world introduction | Wrong operation/type |
| Holimondさんが作ったAkyoは何体ありますか？ | A world by another author | Wrong operation/author |
| 青色でQuest対応のAkyoを3体教えて | Includes an entry without Quest | Conditions not enforced |
| Akyoのいるワールドを3つ教えて | Not found | Wrong operation/type |
| 存在しないテスト専用XYZ987Akyoについて教えて | Not found | Correct |

The Worker fixes and prompt changes are not proof that generated public answers
are fixed. In particular, the empty bubble's full Dify/model cause was not
established by the missing lookup alone. Verify it after rollout. Do not claim
10/10 production success based on local deterministic retrieval tests.
