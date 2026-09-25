/**
 * LLM の呼び出し口。
 *
 * ANTHROPIC_API_KEY があれば本物の Claude、無ければ「ダミー LLM」を使う。
 * ダミーは API 料金ゼロで LangGraph の仕組みだけを試すためのもの。
 * わざと間違った答えを返すことがあり、ルールチェック（validate）の動きを確認できる。
 */
import { createHash } from "node:crypto";
import { z } from "zod";

/** 投資家の判断。LLM にはこの形で答えさせる。 */
export const DecisionSchema = z.object({
  investor: z.string(),
  action: z.string().describe("buy / sell / hold のどれか"),
  amount: z.number().int().describe("株数。0〜100"),
  reason: z.string(),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const USE_CLAUDE = Boolean(process.env.ANTHROPIC_API_KEY);

/** 文字列から 0〜1 の疑似乱数を作る（同じ質問には毎回同じ答え = 再現できる） */
function seeded(seed: string): () => number {
  let counter = 0;
  return () => {
    const h = createHash("sha256").update(`${seed}-${counter++}`).digest();
    return h.readUInt32BE(0) / 0xffffffff;
  };
}

/**
 * 投資家に判断を聞く。本物なら Claude、無ければダミー。
 * forceFirstInvalid=true だと、ダミーは1回目に必ずルール違反を返す（ループの確認用）。
 */
export async function askInvestor(
  investor: string,
  prompt: string,
  attempt: number,
  forceFirstInvalid = false,
): Promise<Decision> {
  if (USE_CLAUDE) {
    const { ChatAnthropic } = await import("@langchain/anthropic");
    const llm = new ChatAnthropic({ model: "claude-haiku-4-5", maxTokens: 300 });
    return llm.withStructuredOutput(DecisionSchema).invoke(prompt);
  }

  // --- ダミー LLM ---
  // 1回目はときどき（約3割）わざとルール違反（amount が 100 超え）を返す
  const rand = seeded(`${investor}-${attempt}-${prompt}`);
  if (attempt === 1 && (forceFirstInvalid || rand() < 0.3)) {
    return { investor, action: "buy", amount: 999, reason: "(ダミー) 全力買い！" };
  }
  const action = ["buy", "sell", "hold"][Math.floor(rand() * 3)];
  return { investor, action, amount: 1 + Math.floor(rand() * 50), reason: `(ダミー) ${action} が妥当` };
}
