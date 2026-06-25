# -*- coding: utf-8 -*-
import csv
from pathlib import Path

OUT = Path("data/phone_ai_free_talk_recovery.csv")

CATEGORIES = {
    "user_confused": {
        "expected": "現在の不足情報を1つだけ案内して予約導線へ戻す",
        "forbidden": "customer_name/selected_therapist/requested_datetimeへ保存しない",
        "priority": 90,
        "bases": [
            "何を言えばいい？",
            "なにを言えばいいですか",
            "次は何を言えばいい？",
            "どうすればいい？",
            "どうしたら予約できますか",
            "流れを教えて",
            "予約の流れが分からない",
            "初めてで分からないです",
            "何から伝えればいい？",
            "どこまで言えばいいですか",
            "今なに待ちですか",
            "何を確認してますか",
            "このあと何を言うの？",
            "やり方が分からない"
        ],
        "modifiers": [
            "",
            "すみません、",
            "あの、",
            "初めてなんですけど、",
            "電話だと分からなくて、"
        ]
    },
    "audio_trouble": {
        "expected": "聞こえている旨または聞き返し後に直前の質問へ戻す",
        "forbidden": "customer_name/selected_therapist/requested_datetimeへ保存しない",
        "priority": 90,
        "bases": [
            "聞こえてます？",
            "聞こえますか",
            "もしもし聞こえてますか",
            "声届いてますか",
            "声遠いですか",
            "電波悪いかも",
            "もう一回お願いします",
            "もう一度言ってください",
            "今の聞き取れなかったです",
            "ゆっくりお願いします",
            "早口ですみません",
            "外がうるさいです",
            "途中で切れました？",
            "なんて言いました？"
        ],
        "modifiers": [
            "",
            "すみません、",
            "もしもし、",
            "外からで、",
            "電波が悪くて、"
        ]
    },
    "hold_or_thinking": {
        "expected": "保留扱いにして予約確定やSMS送信へ進まない",
        "forbidden": "予約確定/SMS送信/customer_name/selected_therapistへ進めない",
        "priority": 88,
        "bases": [
            "ちょっと待って",
            "少し待ってください",
            "一旦考えます",
            "いったん考えたいです",
            "まだ迷ってます",
            "ちょっと悩んでます",
            "決めきれてないです",
            "保留でお願いします",
            "あとで決めます",
            "今確認してます",
            "メモします",
            "友達に確認します",
            "予定確認します",
            "少し時間ください"
        ],
        "modifiers": [
            "",
            "すみません、",
            "あの、",
            "まだ、",
            "一回、"
        ]
    },
    "casual_ack": {
        "expected": "相づちとして扱い直前の不足情報へ戻す",
        "forbidden": "予約確定/SMS送信/requested_datetime/customer_nameへ保存しない",
        "priority": 82,
        "bases": [
            "ありがとう",
            "ありがとうございます",
            "助かります",
            "了解です",
            "りょうかい",
            "はいはい",
            "うん",
            "そうなんですね",
            "なるほど",
            "分かりました",
            "大丈夫そうです",
            "そういうことですね",
            "いいですね",
            "助かった"
        ],
        "modifiers": [
            "",
            "あ、",
            "はい、",
            "すみません、",
            "なるほど、"
        ]
    },
    "complaint_light": {
        "expected": "謝意を示し保持済み情報を壊さず現在の不足情報へ戻す",
        "forbidden": "customer_name/selected_therapist/requested_datetimeを上書きしない",
        "priority": 92,
        "bases": [
            "さっき言ったと思うけど",
            "さっき言いました",
            "もう言いましたよ",
            "もう伝えました",
            "先ほど伝えたと思います",
            "何回言えばいいですか",
            "同じこと言ってます",
            "さっきの内容で合ってます",
            "もう名前言いました",
            "電話番号も言いました",
            "それさっき確認しました",
            "さっき聞かれました",
            "まだ同じ質問ですか",
            "聞いてましたか"
        ],
        "modifiers": [
            "",
            "すみません、",
            "いや、",
            "あの、",
            "失礼ですけど、"
        ]
    }
}

TAILS = ["", "お願いします", "大丈夫ですか", "確認してください", "ゆっくりで大丈夫です"]


def build_rows():
    rows = []
    for category, spec in CATEGORIES.items():
        seen = set()
        for base in spec["bases"]:
            for modifier in spec["modifiers"]:
                for tail in TAILS:
                    utterance = (modifier + base + ("、" + tail if tail else "")).strip("、")
                    if utterance in seen:
                        continue
                    seen.add(utterance)
                    rows.append({
                        "category": category,
                        "utterance": utterance,
                        "expected_action": spec["expected"],
                        "forbidden_action": spec["forbidden"],
                        "priority": spec["priority"],
                    })
                    if len([row for row in rows if row["category"] == category]) >= 70:
                        break
                if len([row for row in rows if row["category"] == category]) >= 70:
                    break
            if len([row for row in rows if row["category"] == category]) >= 70:
                break
    return rows


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    rows = build_rows()
    if len(rows) != 350:
        raise SystemExit(f"expected 350 rows, got {len(rows)}")
    with OUT.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["category", "utterance", "expected_action", "forbidden_action", "priority"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {OUT} ({len(rows)} rows)")


if __name__ == "__main__":
    main()
