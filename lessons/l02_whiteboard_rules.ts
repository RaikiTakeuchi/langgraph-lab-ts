/**
 * Lesson 2: ホワイトボードの書き込みルール（reducer）と並列実行
 *
 * 学ぶこと
 * - 並列に動いた2つの工程が、同じ項目に同時に書いたらどうなるか
 *   - ルール無し（上書き）→ エラーで止まる。「たまたま後に書いた方が勝つ」は起きない
 *   - ルール有り（追記）  → 決まった順番でまとめられる。何回やっても同じ結果
 *
 * 実行: npx tsx lessons/l02_whiteboard_rules.ts
 */
import { Annotation, END, InvalidUpdateError, START, StateGraph } from "@langchain/langgraph";

const finished: string[] = []; // 実際に終わった順番の記録
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- ルール無し: opinions は「上書き」扱い -----------------------------------
const BoardOverwrite = Annotation.Root({
  opinions: Annotation<string[]>,
});

// --- ルール有り: opinions は「追記」扱い（配列を足し合わせる）----------------
const BoardAppend = Annotation.Root({
  opinions: Annotation<string[]>({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),
});

/** analyst_a と analyst_b を並列に走らせ、両方が opinions に書き込む工程表 */
function build(board: typeof BoardOverwrite | typeof BoardAppend) {
  const analystA = async () => {
    await sleep(Math.random() * 100); // 終わる順番をわざとバラつかせる
    finished.push("A");
    return { opinions: ["A: 買い"] };
  };
  const analystB = async () => {
    await sleep(Math.random() * 100);
    finished.push("B");
    return { opinions: ["B: 売り"] };
  };
  return (
    new StateGraph(board as typeof BoardAppend)
      .addNode("analyst_a", analystA)
      .addNode("analyst_b", analystB)
      // START から2本の矢印 = 2つの工程が同じラウンドで並列に動く
      .addEdge(START, "analyst_a")
      .addEdge(START, "analyst_b")
      .addEdge("analyst_a", END)
      .addEdge("analyst_b", END)
      .compile()
  );
}

console.log("=== ルール無し（上書き）で2人が同時に書く ===");
try {
  await build(BoardOverwrite).invoke({ opinions: [] });
} catch (e) {
  if (!(e instanceof InvalidUpdateError)) throw e;
  console.log(`  エラーで止まった: ${e.message.split("\n")[0]}`);
  console.log("  → どちらを残すか決められないので、LangGraph は勝手に選ばず止める");
}

console.log("\n=== ルール有り（追記）で5回実行 ===");
const graph = build(BoardAppend);
for (let i = 1; i <= 5; i++) {
  finished.length = 0;
  const result = await graph.invoke({ opinions: [] });
  console.log(`  ${i}回目: 終わった順 ${JSON.stringify(finished)} → ボード ${JSON.stringify(result.opinions)}`);
}
console.log("  → 終わる順番は毎回バラバラなのに、結果の順番は毎回同じ");
