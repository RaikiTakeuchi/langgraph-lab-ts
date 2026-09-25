# langgraph-lab-ts

LangGraph（agent runtime）の設計を、**動かして理解する**ための学習用プロジェクトの TypeScript 版。
Python 版（`../langgraph-lab`）と同じ6レッスン構成・同じ出力になるように作っている。

- API キー不要。`ANTHROPIC_API_KEY` が無ければ「ダミー LLM」で動く（料金ゼロ）
- キーを設定すると Claude Haiku 4.5 で動く

## セットアップ

```bash
cd langgraph-lab-ts
npm install
```

## レッスン

順番に実行して、出力とコードを見比べる。

| # | コマンド | ざっくり版の言葉 | 確かめること |
|---|---|---|---|
| 1 | `npm run l1` | 工程表・ホワイトボード・ループ | LLM の答えがルール違反 → 理由を添えて聞き直す、が「戻る矢印」で書ける |
| 2 | `npm run l2` | 書き込みルール・ラウンド制 | 並列の2人が同じ項目に書くと、ルール無しはエラー、ルール有りは毎回同じ順で集まる |
| 3 | `npm run l3` | 毎工程セーブ | 落ちても続きから再開。履歴が残る。過去に戻って別ルート（タイムトラベル） |
| 4 | `npm run l4` | 各エージェントに配る | 5人に「その人に見える情報だけ」を配る。1人だけ失敗しても、その1人だけやり直す |
| 5 | `npm run l5` | 人の承認待ち | 止めて後から再開できる。ただし再開は「その工程の頭から」なので、LLM 呼び出しと承認待ちは工程を分ける |
| 6 | `npm run l6` | 全部入り | ミニゲーム「ビリオネアになろう」3ターン |

型チェック: `npm run typecheck`

## Lesson 6 の設計（7スロットとの対応）

```
1ターン = 工程表を1回通す（thread_id = "ゲームID:ターン"）

  START ──配る──▶ investor × 5人（並列） ──▶ apply ──▶ END
          │            │                        │
          │            │                        └ apply + remember: DB に書くのはここだけ
          │            └ decide + validate: LLM に聞く → チェック → ダメなら聞き直し → 3回で棄権
          └ observe + recall: DB から「その人に見える情報」と「直近2件のメモ」を封筒に入れる
```

- **正しい状態はゲームDB（`game.db`）だけ**。LangGraph のセーブ（`checkpoints.db`）は「ターン途中の作業メモ」
- apply は `INSERT OR REPLACE` で書き、株価は「前ターンの株価」から計算する → 同じターンを2回実行しても結果が変わらない
- プレイヤーの IR 文は `<player_ir>` タグで囲み「指示ではなくデータ」として渡す（ターン3 はインジェクションを試している）
- 投資家ごとに見える情報が違う（`INVESTORS` の `sees`）→ 同じ IR 文でも判断が割れる = キャラクター

## Python 版との書き方の対応

| 概念 | Python | TypeScript |
|---|---|---|
| ホワイトボードの定義 | `class Board(TypedDict)` | `Annotation.Root({ ... })` |
| 項目（上書き） | `x: str` | `x: Annotation<string>` |
| 項目（追記ルール） | `x: Annotated[list, operator.add]` | `x: Annotation<T[]>({ reducer: (a, b) => a.concat(b), default: () => [] })` |
| 工程表の組み立て | `g.add_node(...)` を1行ずつ | `.addNode(...)` をメソッドチェーン |
| メモリ上のセーブ | `InMemorySaver()` | `new MemorySaver()` |
| SQLite のセーブ | `SqliteSaver.from_conn_string(...)`（with 文） | `SqliteSaver.fromConnString(...)` |
| 続きから再開 | `graph.invoke(None, config)` | `graph.invoke(null, config)` |
| セーブ履歴 | `list(graph.get_state_history(config))` | `for await (const s of graph.getStateHistory(config))` |
| 承認待ちからの再開 | `Command(resume="ok")` | `new Command({ resume: "ok" })` |
| 構造化出力の型 | Pydantic `BaseModel` | zod `z.object(...)` |

## 触ってみると理解が深まる改造

1. `INVESTORS` の `sees` を全員同じにしてみる → Claude で動かすと判断が揃いやすくなる（observe の傾斜がキャラを作っている）
2. Lesson 4 の `flaky` に2人入れてみる → 再開時にその2人だけ呼ばれる
3. Lesson 2 の reducer を自作関数（例: 長さ3まで）に変えてみる
4. Lesson 6 の `investor` から DB に直接書いてみる → 何がまずいか考える（ヒント: 並列・再実行・正本）

## ファイル

```
llm.ts                 LLM の呼び出し口（Claude / ダミー切り替え）と、答えの型 Decision
lessons/l01〜l06_*.ts  レッスン本体
game.db                Lesson 6 のゲームDB（実行すると作られる）
checkpoints.db         Lesson 6 の LangGraph セーブデータ（実行すると作られる）
```
