/**
 * Lesson 5: 人の承認待ちで止める（interrupt）と、再開時の落とし穴
 *
 * 学ぶこと
 * - 工程の途中で「人間の OK 待ち」で止まり、後日その続きから再開できる
 * - 落とし穴: 再開すると、止まった工程を【頭から】やり直す
 *   → interrupt より前に LLM 呼び出しや DB 書き込みがあると、もう一度走る
 * - 対策: 「重い処理・外への書き込み」と「承認待ち」を別の工程に分ける
 *
 * 実行: npx tsx lessons/l05_human_approval.ts
 */
import { Annotation, Command, END, interrupt, MemorySaver, START, StateGraph } from "@langchain/langgraph";

const llmCalls = { bad: 0, good: 0 };

const Board = Annotation.Root({
  ir_text: Annotation<string>,
  approved: Annotation<boolean>,
});
type BoardState = typeof Board.State;

// --- ダメな例: 1つの工程に「LLM 呼び出し」と「承認待ち」が同居 ---------------
function draftAndApprove() {
  llmCalls.bad++;
  console.log(`    [draft_and_approve] LLM で IR 文を生成（${llmCalls.bad}回目）`);
  const text = "AAPL は過去最高の成長を遂げます";
  const answer = interrupt({ 確認してください: text }); // ← ここで止まる
  return { ir_text: text, approved: answer === "ok" };
}

function buildBad() {
  return new StateGraph(Board)
    .addNode("draft_and_approve", draftAndApprove)
    .addEdge(START, "draft_and_approve")
    .addEdge("draft_and_approve", END)
    .compile({ checkpointer: new MemorySaver() });
}

// --- 良い例: 工程を分ける。LLM 呼び出しは前の工程で終わってセーブ済み ---------
function draft() {
  llmCalls.good++;
  console.log(`    [draft]   LLM で IR 文を生成（${llmCalls.good}回目）`);
  return { ir_text: "AAPL は過去最高の成長を遂げます" };
}

function approve(board: BoardState) {
  const answer = interrupt({ 確認してください: board.ir_text });
  console.log(`    [approve] 人間の回答: ${answer}`);
  return { approved: answer === "ok" };
}

function buildGood() {
  return new StateGraph(Board)
    .addNode("draft", draft)
    .addNode("approve", approve)
    .addEdge(START, "draft")
    .addEdge("draft", "approve")
    .addEdge("approve", END)
    .compile({ checkpointer: new MemorySaver() });
}

/** ダメな例・良い例のどちらのグラフでも受け取れるように、使うメソッドだけの型にしておく */
type ApprovalGraph = {
  invoke(input: unknown, config: object): Promise<BoardState>;
  getState(config: object): Promise<{ tasks: { interrupts: { value?: unknown }[] }[] }>;
};

async function run(graph: ApprovalGraph, label: string, key: "bad" | "good") {
  const config = { configurable: { thread_id: label } };
  console.log(`=== ${label} ===`);
  console.log("  1. 実行 → 承認待ちで止まる");
  await graph.invoke({}, config);
  // 止まった理由はセーブデータに残っている
  const saved = await graph.getState(config);
  console.log(`     止まった理由: ${JSON.stringify(saved.tasks[0]?.interrupts[0]?.value)}`);
  console.log("  2. （数時間後）人間が ok と答えて再開");
  const result = await graph.invoke(new Command({ resume: "ok" }), config);
  console.log(`     承認=${result.approved}  LLM 呼び出し回数=${llmCalls[key]}\n`);
}

await run(buildBad(), "ダメな例（1工程に同居）", "bad");
await run(buildGood(), "良い例（工程を分ける）", "good");
console.log("→ ダメな例は再開時に工程を頭からやり直すので LLM 代を2回払っている");
