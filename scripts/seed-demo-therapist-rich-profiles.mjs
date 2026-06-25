import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

loadEnv(".env.production.local");
loadEnv(".env.local");
loadEnv(".env");

const prisma = new PrismaClient();

const profiles = [
  {
    displayName: "美咲",
    profile: [
      "性格: 落ち着いていて聞き上手。初めてのお客様にも説明が丁寧で、会話は短めでも安心感を出せるタイプ",
      "身長: 158cm目安",
      "バスト: Cカップ目安",
      "ヒップ: 86cm目安",
      "顔: 清楚系でやわらかい雰囲気。派手さより上品さ寄り",
      "似てる雰囲気: 芸能人名は未登録。透明感のあるきれいめ清楚系",
      "タイプ: 落ち着き重視、初回向き、静かに癒やされたい方向け",
      "得意施術: フェザータッチ、ディープリンパ、ゆっくり圧を合わせるリンパ周りの案内",
      "SM傾向: 強いSMではなく、やさしく主導するソフトS寄りの案内が合いやすい",
      "対応範囲: 登録コースと登録オプションの範囲。可否の断定はせず、担当と店舗確認で案内",
      "人気傾向: 初回、落ち着いた接客希望、会話少なめ希望のお客様に選ばれやすい"
    ].join("｜"),
    specialties: ["初回向き", "清楚系", "フェザータッチ", "ディープリンパ", "落ち着いた接客"],
    nominationFee: 2000
  },
  {
    displayName: "清澄せいら",
    profile: [
      "性格: 明るくて反応がよく、距離感を詰めるのが上手。褒め上手で会話も自然に広げやすいタイプ",
      "身長: 162cm目安",
      "バスト: Dカップ目安",
      "ヒップ: 88cm目安",
      "顔: きれいめお姉さん系で華やか。笑顔が出やすい雰囲気",
      "似てる雰囲気: 芸能人名は未登録。明るいきれいめお姉さん系",
      "タイプ: 距離感近め、会話あり、夜帯にゆったり楽しみたい方向け",
      "得意施術: ディープリンパ、鼠径部リンパ重点、ホイップ、ゆったり密着感のあるリラクゼーション案内",
      "SM傾向: 強いSMではなく、甘めにリードするソフトS寄り。痛み系や強い要求は店舗確認",
      "対応範囲: 登録コースと登録オプションの範囲。可否の断定はせず、担当と店舗確認で案内",
      "人気傾向: 夜帯、会話も楽しみたい方、リピート候補として選ばれやすい"
    ].join("｜"),
    specialties: ["会話得意", "きれいめ", "ディープリンパ", "鼠径部リンパ重点", "ホイップ"],
    nominationFee: 5000
  }
];

try {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const result = [];
  for (const item of profiles) {
    const updated = await prisma.therapist.updateMany({
      where: {
        displayName: item.displayName
      },
      data: {
        profile: item.profile,
        specialties: item.specialties,
        nominationFee: item.nominationFee,
        status: "ACTIVE",
        acceptsNomination: true
      }
    });
    result.push({ displayName: item.displayName, updated: updated.count });
  }

  console.log(JSON.stringify({ ok: true, result }, null, 2));
} finally {
  await prisma.$disconnect();
}

function loadEnv(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
