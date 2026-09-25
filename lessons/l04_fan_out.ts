/**
 * Lesson 4: 各エージェントに配る（Send）と「1人だけ失敗」からの再開
 *
 * 学ぶこと
 * - 1つの工程から、N 人のエージェントに同時に仕事を配る（fan-out）
 * - 配るときに「その人専用の情報」だけを渡せる → 他人の秘密は見えない
 * - 全員の答えは書き込みルール（追記）で1か所に集まる（fan-in）
 * - 5人中1人だけ失敗しても、再開時はその1人だけやり直す（他4人の LLM 代は払い直さない）
 *
 * 実行: npx tsx lessons/l04_fan_out.ts
 */
import { Annotation, END, MemorySaver, Send, START, StateGraph } from "@langchain/langgraph";

// 投資家ごとに「見える情報」が違う（= observe の設計）
const PRIVATE_INFO: Record<string, string> = {
  value_fund: "決算書: 利益 -5%",
  momentum_bot: "株価: 3日連続上昇",
  sns_retail: "SNS: 『ACME 神』がトレンド入り",
  short_seller: "過去IR: 去年は『利益最優先』と言っていた",
  pension: "格付け: A 維持",
};
const calls: Record<string, number> = Object.fromEntries(Object.keys(PRIVATE_INFO).map((n) => [n, 0]));
const flaky = new Set(["sns_retail"]); // この人だけ1回目に失敗させる

const Board = Annotation.Root({
  ir_text: Annotation<string>,
  // 全員の答えが集まる場所（追記ルール）
  votes: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  summary: Annotation<string>,
});
type BoardState = typeof Board.State;

/** 1人の投資家に渡す封筒。Board 全体ではなく、これだけが渡る */
type InvestorInput = { name: string; ir_text: string; private: string };

/** 配る: 投資家の数だけ Send を作る。封筒の中身は人ごとに違う */
function distribute(board: BoardState) {
  return Object.entries(PRIVATE_INFO).map(
    ([name, info]) => new Send("investor", { name, ir_text: board.ir_text, private: info }),
  );
}

async function investor(env: InvestorInput) {
  const { name } = env;
  calls[name]++;
  if (flaky.has(name)) {
    flaky.delete(name);
    console.log(`  [investor] ${name.padEnd(12)} 💥 タイムアウト`);
    throw new Error(`timeout: ${name}`);
  }
  // 本当はここで LLM に「IR 文 + 自分だけの情報」を渡して判断させる
  const vote = /上昇|神|A 維持/.test(env.private) ? "buy" : "sell";
  console.log(`  [investor] ${name.padEnd(12)} 見えている情報='${env.private}' → ${vote}`);
  return { votes: [`${name}:${vote}`] };
}

function tally(board: BoardState) {
  const buys = board.votes.filter((v) => v.endsWith("buy")).length;
  return { summary: `買い ${buys} / 売り ${board.votes.length - buys}` };
}

const graph = new StateGraph(Board)
  .addNode("investor", investor)
  .addNode("tally", tally)
  .addConditionalEdges(START, distribute, ["investor"]) // START から N 人に配る
  .addEdge("investor", "tally") // 全員終わったら集計
  .addEdge("tally", END)
  .compile({ checkpointer: new MemorySaver() });

const config = { configurable: { thread_id: "turn-1" } };
console.log("=== 1回目: 5人に配る → 1人失敗 ===");
try {
  await graph.invoke({ ir_text: "ACME は成長投資の年です" }, config);
} catch {
  /* 想定内 */
}

console.log("\n=== 再開 ===");
const result = await graph.invoke(null, config);
console.log(`\n  集計: ${result.summary}  ${JSON.stringify(result.votes)}`);
console.log(`  実行回数: ${JSON.stringify(calls)}`);
console.log("  → 失敗した sns_retail だけ2回。他の4人は1回で済んでいる");
