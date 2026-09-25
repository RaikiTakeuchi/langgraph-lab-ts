/**
 * Lesson 3: 毎工程セーブ（checkpoint）
 *
 * 学ぶこと
 * 1. 途中で落ちても、最後のセーブから再開できる（終わった工程はやり直さない）
 * 2. セーブの履歴が全部残っている
 * 3. 過去のセーブに戻って、中身を書き換えて別ルートを試せる（タイムトラベル）
 *
 * 「セーブデータの1本の系列」を thread と呼ぶ。thread_id を変えれば別のセーブデータ。
 *
 * 実行: npx tsx lessons/l03_save.ts
 */
import { Annotation, END, MemorySaver, START, StateGraph } from "@langchain/langgraph";

const calls = { research: 0, write_ir: 0, publish: 0 }; // 各工程が何回実行されたか
let networkDown = true; // publish 工程を1回目だけ失敗させるためのスイッチ

const Board = Annotation.Root({
  company: Annotation<string>,
  facts: Annotation<string>,
  ir_text: Annotation<string>,
  published: Annotation<boolean>,
});
type BoardState = typeof Board.State;

function research() {
  calls.research++;
  console.log("  [research] 決算を調べる（本当は重い LLM 呼び出し）");
  return { facts: "売上 +20%、利益 -5%" };
}

function writeIr(board: BoardState) {
  calls.write_ir++;
  console.log(`  [write_ir] 事実 '${board.facts}' から IR 文を書く`);
  return { ir_text: `${board.company}は${board.facts}。成長投資の年です。` };
}

function publish(board: BoardState) {
  calls.publish++;
  if (networkDown) {
    console.log("  [publish]  💥 通信エラー！");
    throw new Error("network down");
  }
  console.log(`  [publish]  公開: ${board.ir_text}`);
  return { published: true };
}

// checkpointer を渡す = 毎工程セーブが有効になる
const graph = new StateGraph(Board)
  .addNode("research", research)
  .addNode("write_ir", writeIr)
  .addNode("publish", publish)
  .addEdge(START, "research")
  .addEdge("research", "write_ir")
  .addEdge("write_ir", "publish")
  .addEdge("publish", END)
  .compile({ checkpointer: new MemorySaver() });

const config = { configurable: { thread_id: "game-1" } };

console.log("=== 1. 実行 → publish で落ちる ===");
try {
  await graph.invoke({ company: "ACME" }, config);
} catch {
  /* 想定内 */
}
const saved = await graph.getState(config);
console.log(`  セーブの中身: facts='${saved.values.facts}'`);
console.log(`  次にやる工程: ${JSON.stringify(saved.next)}`);

console.log("\n=== 2. 通信が直ったので再開（入力に null を渡す = 続きから）===");
networkDown = false;
await graph.invoke(null, config);
console.log(`  実行回数: ${JSON.stringify(calls)}`);
console.log("  → research と write_ir は1回ずつ。セーブがあるので再実行されていない");

console.log("\n=== 3. セーブの履歴（新しい順）===");
const history = [];
for await (const snap of graph.getStateHistory(config)) history.push(snap);
for (const snap of history) {
  const ir = (snap.values.ir_text ?? "-").slice(0, 18);
  console.log(`  step=${String(snap.metadata?.step).padStart(2)}  次=${JSON.stringify(snap.next).padEnd(16)}  ir_text=${ir}`);
}

console.log("\n=== 4. タイムトラベル: research 直後のセーブに戻り、事実を書き換えて別ルート ===");
const afterResearch = history.find((s) => s.next.length === 1 && s.next[0] === "write_ir")!;
const forked = await graph.updateState(afterResearch.config, { facts: "売上 +50%、利益 +30%" });
const result = await graph.invoke(null, forked);
console.log(`  別ルートの結果: ${result.ir_text}`);
console.log(`  実行回数: ${JSON.stringify(calls)}`);
console.log("  → research は呼ばれず、write_ir から先だけやり直された。元のルートの履歴も残っている");
