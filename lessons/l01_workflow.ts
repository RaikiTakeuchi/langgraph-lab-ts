/**
 * Lesson 1: 工程表（ノードと矢印）とループ
 *
 * 学ぶこと
 * - 処理を「工程（ノード）」と「矢印（エッジ）」で書く
 * - 全工程が読み書きする「ホワイトボード（state）」
 * - 矢印は戻ってもいい = ループ。「LLM に聞く → チェック → ダメなら聞き直す」
 *
 * 実行: npx tsx lessons/l01_workflow.ts
 */
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { askInvestor, type Decision } from "../llm.ts";

// --- ホワイトボード（state）: 全工程が読み書きする1枚の紙 -----------------
const Board = Annotation.Root({
  investor: Annotation<string>,
  attempt: Annotation<number>, // 何回目の質問か
  decision: Annotation<Decision>, // LLM の答え
  error: Annotation<string>, // チェックに落ちた理由（次の質問に添える）
  final: Annotation<string>, // 最終結果
});
type BoardState = typeof Board.State;

// --- 工程（ノード）: ボードを受け取り、「書き換えたい項目だけ」返す ----------
async function decide(board: BoardState) {
  const attempt = (board.attempt ?? 0) + 1;
  let prompt = `あなたは投資家 ${board.investor}。株を buy/sell/hold するか決めて。`;
  if (board.error) prompt += `\n前回の答えはルール違反でした: ${board.error}`;
  const d = await askInvestor(board.investor, prompt, attempt, true);
  console.log(`  [decide]   ${attempt}回目の答え: ${d.action} ${d.amount}株`);
  return { attempt, decision: d };
}

function validate(board: BoardState) {
  const d = board.decision;
  if (!["buy", "sell", "hold"].includes(d.action)) return { error: `action が不正: ${d.action}` };
  if (d.amount < 0 || d.amount > 100) return { error: `amount は 0〜100: ${d.amount}` };
  console.log("  [validate] OK");
  return { error: "" };
}

function giveUp() {
  console.log("  [give_up]  3回ダメだったので棄権扱い");
  return { final: "hold 0株（棄権）" };
}

function accept(board: BoardState) {
  return { final: `${board.decision.action} ${board.decision.amount}株` };
}

// --- 矢印の分岐: チェック結果を見て次の工程を決める -------------------------
function afterValidate(board: BoardState) {
  if (!board.error) return "accept";
  console.log(`  [validate] NG: ${board.error}`);
  if (board.attempt >= 3) return "give_up";
  return "decide"; // ← 戻る矢印。これがループ
}

// --- 工程表を組み立てる ----------------------------------------------------
const graph = new StateGraph(Board)
  .addNode("decide", decide)
  .addNode("validate", validate)
  .addNode("accept", accept)
  .addNode("give_up", giveUp)
  .addEdge(START, "decide")
  .addEdge("decide", "validate")
  .addConditionalEdges("validate", afterValidate, ["decide", "accept", "give_up"])
  .addEdge("accept", END)
  .addEdge("give_up", END)
  .compile();

console.log("=== 工程表の形（mermaid。Notion や GitHub に貼ると図になる）===");
console.log((await graph.getGraphAsync()).drawMermaid());

console.log("=== 実行 ===");
const result = await graph.invoke({ investor: "value_fund" });
console.log(`\n最終結果: ${result.final}  （${result.attempt}回聞いた）`);
