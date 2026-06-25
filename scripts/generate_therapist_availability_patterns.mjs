import { writeFileSync } from "node:fs";

const styles = [
  "標準",
  "若者",
  "40代",
  "60代",
  "関西弁",
  "博多弁",
  "酔っ払い",
  "早口",
  "電話が遠い",
  "省略表現",
  "曖昧表現",
  "丁寧",
  "タメ口",
  "初回客",
  "常連"
];

const templates = {
  標準: [
    "{when}誰が空いてますか",
    "{when}空いてるセラピストさんいますか",
    "{when}出勤してる方を教えてください",
    "{when}対応できる人はいますか",
    "{when}誰が入れますか"
  ],
  若者: [
    "{when}誰いけます？",
    "{when}空いてる子います？",
    "{when}誰います？",
    "{when}おすすめの子います？",
    "{when}入れる子いる？"
  ],
  "40代": [
    "{when}空いている方はいらっしゃいますか",
    "{when}担当できる方を確認したいです",
    "{when}出勤中の方を教えてもらえますか",
    "{when}今対応可能な方はいますか",
    "{when}どなたが空いていますか"
  ],
  "60代": [
    "もしもし、{when}どなたか空いてますかな",
    "{when}入れる方はおられますか",
    "{when}出ている方を教えてもらえますかね",
    "{when}お願いできる人はいますかね",
    "{when}どなたが対応できますか"
  ],
  関西弁: [
    "{when}誰空いてるん？",
    "{when}空いてる子おる？",
    "{when}誰おるん？",
    "{when}いける子いてる？",
    "{when}おすすめ誰なん？"
  ],
  博多弁: [
    "{when}誰が空いとーと？",
    "{when}空いとる子おる？",
    "{when}誰がおると？",
    "{when}お願いできる子おる？",
    "{when}おすすめは誰ね？"
  ],
  酔っ払い: [
    "{when}えーっと誰空いてる？",
    "{when}今さ、誰かいる？",
    "{when}空いてる子、いるっけ",
    "{when}誰でもいいんだけど誰いる？",
    "{when}あのー入れる子いる？"
  ],
  早口: [
    "{when}誰空いてますかすぐ知りたいです",
    "{when}空いてる人いますか今確認できますか",
    "{when}出勤してる人と空き教えてください",
    "{when}誰いるかだけ先に教えてください",
    "{when}対応できる人いますか"
  ],
  電話が遠い: [
    "もしもし、聞こえますか、{when}誰空いてますか",
    "すみません、{when}空いてる方いますか",
    "電波悪いかも、{when}誰いますか",
    "聞こえてたら、{when}出勤の方教えてください",
    "あの、{when}対応できる方いますか"
  ],
  省略表現: [
    "{when}誰いる？",
    "{when}空き誰？",
    "{when}出勤誰？",
    "{when}いける人？",
    "{when}空いてる子？"
  ],
  曖昧表現: [
    "{when}誰か空いてたりします？",
    "{when}行けそうな方います？",
    "{when}お願いできそうな人います？",
    "{when}空いてるかもな人います？",
    "{when}誰かいける感じですか"
  ],
  丁寧: [
    "{when}空いているセラピストさんを教えていただけますか",
    "{when}対応可能な方を確認していただけますか",
    "{when}出勤されている方を教えてください",
    "{when}どなたが空いているか確認できますか",
    "{when}お願いできる方はいらっしゃいますか"
  ],
  タメ口: [
    "{when}誰空いてる",
    "{when}誰いる",
    "{when}空いてる人いる",
    "{when}今いける子いる",
    "{when}おすすめ誰"
  ],
  初回客: [
    "初めてなんですけど、{when}誰が空いてますか",
    "初回なんですが、{when}空いてる方いますか",
    "初めてで分からないんですけど、{when}誰いますか",
    "初めて利用します、{when}出勤の方を教えてください",
    "初めてなんで、{when}おすすめの方いますか"
  ],
  常連: [
    "いつもの感じで、{when}誰空いてる？",
    "前にも行ったんだけど、{when}誰いる？",
    "またお願いしたいんだけど、{when}空いてる子いる？",
    "この前みたいに、{when}誰かいける？",
    "常連なんだけど、{when}出てる子教えて"
  ]
};

const whens = [
  "今日",
  "今",
  "今から",
  "この後",
  "夜",
  "20時くらい",
  "21時くらい",
  "22時くらい",
  "深夜",
  "明日",
  "週末",
  "これから",
  "すぐ",
  "ラスト枠で",
  ""
];

const suffixes = [
  "",
  "。",
  "？",
  "お願いします",
  "教えて",
  "確認したいです",
  "だけ知りたいです",
  "先に聞きたいです",
  "空きだけ見たいです",
  "予約するかはあとで決めます"
];

function render(template, when, suffix) {
  return `${template.replace("{when}", when)}${suffix}`.replace(/\s+/g, " ").trim();
}

const rows = [];
const seen = new Set();

outer:
for (const style of styles) {
  for (const template of templates[style]) {
    for (const when of whens) {
      for (const suffix of suffixes) {
        const example = render(template, when, suffix);
        if (!example || seen.has(example)) continue;
        seen.add(example);
        rows.push({
          intent: "セラピスト空き確認",
          style,
          example
        });
        if (rows.length >= 300) break outer;
      }
    }
  }
}

const escapeCsv = (value) => `"${String(value).replaceAll('"', '""')}"`;
const csv = [
  ["intent", "style", "example"].map(escapeCsv).join(","),
  ...rows.map((row) => [row.intent, row.style, row.example].map(escapeCsv).join(","))
].join("\n");

writeFileSync("data/men_es_therapist_availability_patterns.csv", `${csv}\n`, "utf8");

console.log(JSON.stringify({ rows: rows.length, unique: seen.size }, null, 2));
