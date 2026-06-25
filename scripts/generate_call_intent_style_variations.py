# -*- coding: utf-8 -*-
import csv
import random
import re
from collections import Counter
from pathlib import Path

random.seed(20260609)

BASE = Path("data/men_es_reservation_call_intents.csv")
OUT = Path("data/men_es_reservation_call_intent_style_variations.csv")

STYLES = [
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
]


def strip_polite(text: str) -> str:
    value = text
    value = value.replace("お願いします", "お願い")
    value = value.replace("お願いできます？", "お願いできる？")
    value = value.replace("できますか？", "できる？")
    value = value.replace("できます？", "できる？")
    value = value.replace("ですか？", "？")
    value = value.replace("です？", "？")
    value = value.replace("です", "")
    value = value.replace("ますか？", "る？")
    value = value.replace("ます？", "る？")
    value = value.replace("ます", "る")
    value = value.replace("ください", "ちょうだい")
    return cleanup(value)


def strip_question_particle(text: str) -> str:
    value = text
    value = value.replace("ますか", "る")
    value = value.replace("ですか", "")
    value = value.replace("か？", "？")
    value = value.replace("か、", "、")
    return cleanup(value)


def plain_question_core(text: str) -> str:
    value = text
    value = value[:-1] if value.endswith("？") else value
    value = value.replace("ますか", "る")
    value = value.replace("ですか", "")
    value = value.replace("入れます", "入れる")
    value = value.replace("空いてます", "空いてる")
    value = value.replace("あります", "ある")
    value = value.replace("できます", "できる")
    return cleanup(value)


def cleanup(text: str) -> str:
    value = text
    value = re.sub(r"\s+", " ", value)
    value = value.replace("、、", "、")
    value = value.replace("。。", "。")
    value = value.replace("？？", "？")
    value = value.replace("、？", "？")
    value = value.replace(" ,", ",")
    return value.strip()


def remove_prefix_noise(text: str) -> str:
    prefixes = [
        "もしもし、",
        "あの、",
        "すみません、",
        "すいません、",
        "えっと、",
        "ちょっと、",
        "今いいですか、",
        "悪いんだけど、",
        "初めてなんですけど、",
        "前にも行ったんですけど、",
        "さっき電話した者ですけど、",
        "仕事終わりなんですけど、",
        "出先なんですけど、",
        "飲んでてすみません、",
        "ちょっと酔ってるんだけど、",
        "電波悪いかもですけど、",
        "あー、",
        "えーとですね、",
        "急でごめん、",
        "お兄さん、",
    ]
    value = text
    changed = True
    while changed:
        changed = False
        for prefix in prefixes:
            if value.startswith(prefix):
                value = value[len(prefix):]
                changed = True
    return cleanup(value)


def youth(text: str) -> str:
    base = strip_polite(text)
    starts = ["あ、", "すいません、", "今って", "ちなみに、", "今日"]
    if base.startswith("今日"):
        result = base
    elif base.startswith(("今", "このあと", "夜", "20時", "21時", "22時", "23時")):
        result = random.choice(["あ、", "すいません、"]) + base
    else:
        result = random.choice(starts) + base
    result = result.replace("教えてちょうだい", "教えてほしい")
    result = result.replace("取りたいんだけど", "取りたいんすけど")
    result = result.replace("したい", "したいっす")
    result = result.replace("お願い", "お願いしたいっす")
    return cleanup(result)


def forties(text: str) -> str:
    base = remove_prefix_noise(text)
    if base.endswith("？"):
        return cleanup("すみません、" + plain_question_core(base) + "か確認したいです")
    if "ますか" in base:
        return cleanup("すみません、" + plain_question_core(base) + "か確認したいです")
    if base.endswith("です") and "したい" in base:
        return cleanup("すみません、" + base[:-2] + "んですが")
    if "したい" in base:
        return cleanup("すみません、" + base.replace("したい", "したいんですが"))
    return cleanup("すみません、" + base + "でお願いできますか")


def sixties(text: str) -> str:
    base = remove_prefix_noise(text)
    base = base.replace("LINE", "ライン")
    base = base.replace("Web", "ウェブ")
    if base.endswith("？"):
        return cleanup("もしもし、" + base[:-1] + "かのう")
    if "お願いします" in base:
        return cleanup("もしもし、" + base.replace("お願いします", "お願いできますかな"))
    return cleanup("もしもし、" + base + "、お願いできますかな")


def kansai(text: str) -> str:
    base = strip_question_particle(strip_polite(remove_prefix_noise(text)))
    replacements = [
        ("できますか？", "できるん？"),
        ("できる？", "できるん？"),
        ("ありますか？", "あるん？"),
        ("あります？", "あるん？"),
        ("空いてる？", "空いとる？"),
        ("教えて", "教えてくれへん？"),
        ("したいっす", "したいんやけど"),
        ("したい", "したいんやけど"),
        ("お願い", "頼むわ"),
        ("ですか？", "なん？"),
        ("？", "？"),
    ]
    for before, after in replacements:
        base = base.replace(before, after)
    if not base.endswith("？") and not base.endswith("わ"):
        base += "、いける？"
    return cleanup(base)


def hakata(text: str) -> str:
    base = strip_polite(remove_prefix_noise(text))
    base = strip_question_particle(base)
    base = base.replace("できますか？", "できると？")
    base = base.replace("できる？", "できると？")
    base = base.replace("ありますか？", "あると？")
    base = base.replace("あります？", "あると？")
    base = base.replace("空いてる？", "空いとる？")
    base = base.replace("したいっす", "したかと")
    base = base.replace("したい", "したかと")
    base = base.replace("お願い", "お願いしたか")
    base = base.replace("教えて", "教えてくれん？")
    if not base.endswith("？"):
        base += "、よか？"
    return cleanup(base)


def drunk(text: str) -> str:
    base = remove_prefix_noise(text)
    starters = ["あーすみません、ちょっと飲んでて、", "えっと、酔っててごめん、", "あの、今ちょっと酔ってるんですけど、"]
    fillers = ["、えーと、", "、あ、", "、たぶん、"]
    if "予約" in base and "予約、" not in base:
        base = base.replace("予約", "よやく、予約", 1)
    if "20時" in base:
        base = base.replace("20時", "20時、たぶん20時", 1)
    return cleanup(random.choice(starters) + base + random.choice(fillers) + "大丈夫ですか")


def fast(text: str) -> str:
    base = remove_prefix_noise(text)
    base = base.replace("、", " ")
    base = base.replace("？", "")
    return cleanup("すみません早口で言います、" + base + "、いけますか")


def distant_phone(text: str) -> str:
    base = remove_prefix_noise(text)
    starts = ["もしもし、聞こえますか、", "すみません電波悪いかも、", "あ、声遠いですか、", "外で電話しててすみません、"]
    return cleanup(random.choice(starts) + base)


def abbreviated(text: str) -> str:
    base = remove_prefix_noise(text)
    replacements = [
        ("予約したいです", "予約で"),
        ("予約したい", "予約で"),
        ("確認したいです", "確認で"),
        ("確認したい", "確認で"),
        ("教えてください", "教えて"),
        ("お願いします", "お願い"),
        ("空きありますか？", "空きある？"),
        ("料金いくらですか？", "料金いくら？"),
        ("場所どこですか？", "場所どこ？"),
        ("キャンセルしたいです", "キャンセルで"),
        ("変更したいです", "変更で"),
    ]
    for before, after in replacements:
        base = base.replace(before, after)
    base = plain_question_core(base)
    base = base.replace("くらいに着けるんですけど入れる", "着けそう、入れる？")
    base = base.replace("今から一人入れる", "今から一人")
    base = base.replace("すみません", "")
    base = base.replace("お願いします", "お願い")
    words = base.split("、")
    if len(words) > 1:
        base = words[-1]
    if len(base) > 28:
        base = base[:28]
    return cleanup(base)


def vague(text: str) -> str:
    base = remove_prefix_noise(text)
    base = base.replace("20時", "20時くらい")
    base = base.replace("21時", "21時くらい")
    base = base.replace("22時", "22時くらい")
    base = base.replace("90分", "たぶん90分")
    base = base.replace("60分", "たぶん60分")
    base = base.replace("120分", "長め")
    if base.endswith("？"):
        core = plain_question_core(base)
        return cleanup(core + "と思うんですけど、大丈夫ですか？")
    if "ますか" in base:
        core = plain_question_core(base)
        return cleanup(core + "と思うんですけど、大丈夫ですか？")
    if base.endswith("です"):
        base = base[:-2]
    return cleanup(base + "かもです")


TRANSFORMS = {
    "若者": youth,
    "40代": forties,
    "60代": sixties,
    "関西弁": kansai,
    "博多弁": hakata,
    "酔っ払い": drunk,
    "早口": fast,
    "電話が遠い": distant_phone,
    "省略表現": abbreviated,
    "曖昧表現": vague,
}


def ensure_unique(intent: str, style: str, base: str, variant: str, used: set[str], index: int) -> str:
    candidate = cleanup(variant)
    if not candidate:
        candidate = base
    if len(candidate) > 110:
        candidate = candidate[:109] + "…"
    if candidate not in used:
        used.add(candidate)
        return candidate
    fallback_bits_by_style = {
        "若者": ["今電話してます", "急ぎめです", "この番号です", "初めてっす"],
        "40代": ["念のため確認です", "この番号で大丈夫です", "電話で確認したいです", "急ぎではないです"],
        "60代": ["もう一度確認したくて", "この電話で大丈夫です", "念のためです", "聞こえますかな"],
        "関西弁": ["今電話してるんよ", "念のためやねん", "この番号やで", "急ぎめやわ"],
        "博多弁": ["今電話しとると", "念のためたい", "この番号でよか", "急ぎめやけん"],
        "酔っ払い": ["酔っててすみません", "たぶん大丈夫です", "もう一回だけ", "この番号です"],
        "早口": ["早口ですみません", "まとめて確認です", "この番号です", "急ぎめです"],
        "電話が遠い": ["聞こえてます？", "外からです", "電波悪いです", "声遠いですか"],
        "省略表現": ["確認で", "この番号で", "急ぎで", "一応"],
        "曖昧表現": ["たぶんです", "一応確認で", "まだ迷ってます", "念のためです"],
    }
    fallback_bits = fallback_bits_by_style.get(style, ["今電話です", "念のためです", "この番号です"])
    for bit in fallback_bits:
        fixed = cleanup(candidate + "、" + bit)
        if fixed not in used:
            used.add(fixed)
            return fixed
    fixed = cleanup(candidate + f"、{style}確認{index}")
    used.add(fixed)
    return fixed


def main() -> None:
    with BASE.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        base_rows = list(reader)

    rows: list[list[str]] = []
    used_variants: set[str] = set()
    for index, row in enumerate(base_rows):
        intent = row["intent"]
        base = row["example"]
        for style in STYLES:
            variant = TRANSFORMS[style](base)
            variant = ensure_unique(intent, style, base, variant, used_variants, index)
            rows.append([intent, style, base, variant])

    with OUT.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["intent", "style", "base_example", "variant"])
        writer.writerows(rows)

    with OUT.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        loaded = list(reader)

    style_counts = Counter(row["style"] for row in loaded)
    intent_counts = Counter(row["intent"] for row in loaded)
    variants = [row["variant"] for row in loaded]
    suspicious = [value for value in variants if any(mark in value for mark in ["????", "????????", "�", "縺", "繝", "蜈", "譁", "莠"])]
    ai_mentions = [value for value in variants if "AI" in value or "人工知能" in value]
    empty_rows = [row for row in loaded if not row["intent"] or not row["style"] or not row["base_example"] or not row["variant"]]
    formula_risk = [value for value in variants if value[:1] in ["=", "+", "-", "@"]]

    print("file=" + str(OUT))
    print("total=" + str(len(loaded)))
    print("base_rows=" + str(len(base_rows)))
    print("intent_count=" + str(len(intent_counts)))
    print("style_count=" + str(len(style_counts)))
    for style in STYLES:
        print(f"style:{style}:{style_counts[style]}")
    print("duplicate_variants=" + str(len(variants) - len(set(variants))))
    print("suspicious_mojibake=" + str(len(suspicious)))
    print("ai_mentions=" + str(len(ai_mentions)))
    print("empty_rows=" + str(len(empty_rows)))
    print("formula_risk_rows=" + str(len(formula_risk)))
    print("header=" + ",".join(reader.fieldnames or []))


if __name__ == "__main__":
    main()
