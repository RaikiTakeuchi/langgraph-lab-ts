/**
 * Lesson 7: 工程表の入れ子（サブグラフ）
 *
 * 学ぶこと
 * - compile した graph は、別の graph の工程（ノード）としてそのまま入れられる
 *   → 「ゲーム全体 ⊃ フェーズ ⊃ ターン」のような入れ子の構造を作れる
 * - 落とし穴: 子の graph は「親から受け取った分も含めた自分のボード全体」を親に返す
 *   → 追記ルール（reducer）の項目を親子で共有すると、同じ内容が何度も足される
 * - 対策: 子の graph を関数で包み、親子で受け渡すものを絞る
 *
 * 実行: npx tsx lessons/l07_nested.ts
 */
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

// 3階層で共有するボード
const Board = Annotation.Root({
  phase: Annotation<number>,
  turn: Annotation<number>,
  log: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
});
type S = typeof Board.State;

// ── 一番内側: 1ターン（判断 → 反映）──────────────────────────
// ※ 工程名とボードの項目名を同じにするとエラーになる（"turn" という工程は作れない）
const turnGraph = new StateGraph(Board)
  .addNode("decide", (s: S) => ({ log: [`    フェーズ${s.phase} ターン${s.turn}: 投資家が判断`] }))
  .addNode("apply", (s: S) => ({ log: [`    フェーズ${s.phase} ターン${s.turn}: DB に反映`] }))
  .addEdge(START, "decide")
  .addEdge("decide", "apply")
  .addEdge("apply", END)
  .compile();

const TURNS_PER_PHASE = 2;
const PHASES = 2;

// =============================================================================
// ダメな例: 子の graph をそのまま工程として入れる
// =============================================================================
function buildBad() {
  const phaseGraph = new StateGraph(Board)
    .addNode("start_phase", (s: S) => ({ log: [`  フェーズ${s.phase} 開始`], turn: 1 }))
    .addNode("run_turn", turnGraph) // ← 1ターンの graph をそのまま入れる
    .addNode("next_turn", (s: S) => ({ turn: s.turn + 1 }))
    .addNode("earnings", (s: S) => ({ log: [`  フェーズ${s.phase} 決算発表`] }))
    .addEdge(START, "start_phase")
    .addEdge("start_phase", "run_turn")
    .addConditionalEdges("run_turn", (s: S) => (s.turn < TURNS_PER_PHASE ? "next_turn" : "earnings"), [
      "next_turn",
      "earnings",
    ])
    .addEdge("next_turn", "run_turn")
    .addEdge("earnings", END)
    .compile();

  return new StateGraph(Board)
    .addNode("run_phase", phaseGraph) // ← 1フェーズの graph をそのまま入れる
    .addNode("next_phase", (s: S) => ({ phase: s.phase + 1 }))
    .addEdge(START, "run_phase")
    .addConditionalEdges("run_phase", (s: S) => (s.phase < PHASES ? "next_phase" : END), ["next_phase", END])
    .addEdge("next_phase", "run_phase")
    .compile();
}

// =============================================================================
// 良い例: 子の graph を関数で包み、受け渡すものを絞る
// =============================================================================
function buildGood() {
  const phaseGraph = new StateGraph(Board)
    .addNode("start_phase", (s: S) => ({ log: [`  フェーズ${s.phase} 開始`], turn: 1 }))
    .addNode("run_turn", async (s: S) => {
      // 渡すのは phase と turn だけ。log は渡さない（子は空のログから始まる）
      const child = await turnGraph.invoke({ phase: s.phase, turn: s.turn });
      // 返すのは「子が新しく書いたログ」だけ
      return { log: child.log };
    })
    .addNode("next_turn", (s: S) => ({ turn: s.turn + 1 }))
    .addNode("earnings", (s: S) => ({ log: [`  フェーズ${s.phase} 決算発表`] }))
    .addEdge(START, "start_phase")
    .addEdge("start_phase", "run_turn")
    .addConditionalEdges("run_turn", (s: S) => (s.turn < TURNS_PER_PHASE ? "next_turn" : "earnings"), [
      "next_turn",
      "earnings",
    ])
    .addEdge("next_turn", "run_turn")
    .addEdge("earnings", END)
    .compile();

  return new StateGraph(Board)
    .addNode("run_phase", async (s: S) => {
      const child = await phaseGraph.invoke({ phase: s.phase });
      return { log: child.log };
    })
    .addNode("next_phase", (s: S) => ({ phase: s.phase + 1 }))
    .addEdge(START, "run_phase")
    .addConditionalEdges("run_phase", (s: S) => (s.phase < PHASES ? "next_phase" : END), ["next_phase", END])
    .addEdge("next_phase", "run_phase")
    .compile();
}

// 期待する行数: フェーズごとに「開始 + ターン×(判断+反映) + 決算」
const expected = PHASES * (1 + TURNS_PER_PHASE * 2 + 1);

console.log("=== ダメな例（子の graph をそのまま入れる）===");
const bad = await buildBad().invoke({ phase: 1 });
console.log(`  ログ ${bad.log.length} 行（本来は ${expected} 行）。先頭10行:`);
console.log(bad.log.slice(0, 10).join("\n"));
console.log("  → 子が「親のログも含めたボード全体」を返し、親がそれを追記するので重複していく\n");

console.log("=== 良い例（関数で包んで受け渡しを絞る）===");
const good = await buildGood().invoke({ phase: 1 });
console.log(`  ログ ${good.log.length} 行（本来は ${expected} 行）`);
console.log("ゲーム開始\n" + good.log.join("\n") + "\nゲーム終了");
