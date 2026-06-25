# -*- coding: utf-8 -*-
import json
from pathlib import Path

categories = [
 ('initial_booking','初めてなんですけど予約したいです','希望日時とコースを確認する'),
 ('repeat_booking','前にも行ったことあります、予約したいです','希望日時とコースを確認する'),
 ('nominated','美咲さん指名で予約したいです','希望日時を聞いて空き確認する'),
 ('free_booking','指名なしでお願いします','フリーとして希望日時とコースを確認する'),
 ('course_unknown','コースまだ決めてないです','コース候補を短く聞く'),
 ('price_question','90分はいくらですか','登録済み料金だけ案内する'),
 ('business_hours_question','何時までやってますか','登録済み営業時間だけ案内する'),
 ('access_question','場所どこですか','登録済み住所だけ案内する'),
 ('therapist_question','美咲さんの特徴を教えて','登録済み情報だけ案内する'),
 ('today_request','今日行きたいです','時間とコースを確認する'),
 ('now_request','今から行けますか','到着時間とコースを確認する'),
 ('tomorrow_request','明日行きたいです','希望時間とコースを確認する'),
 ('weekend_request','週末行きたいです','土日どちらかと時間を確認する'),
 ('ambiguous_datetime','夜でお願いします','具体的な時間を聞く'),
 ('time_only','20時でお願いします','日付を確認する'),
 ('date_only','12日でお願いします','時間を確認する'),
 ('ambiguous_course_time','長めのコースでお願いします','具体的な分数を聞く'),
 ('phone_capture','電話番号は080-1234-5678です','電話番号を復唱確認する'),
 ('phone_correction','番号言い直します','電話番号だけ更新する'),
 ('name_capture','佐藤です','名前として受け取り次項目へ進む'),
 ('name_retry','名前もう一回言います','名前だけ聞き直す'),
 ('visit_history','初めてです','来店歴として保持する'),
 ('readback','予約内容を復唱してください','必要項目を復唱する'),
 ('consent','それでお願いします','復唱後のみReservationHoldを作る'),
 ('correction','やっぱ21時でお願いします','訂正を反映して再確認する'),
 ('change_request','予約変更したいです','店舗確認へ回す'),
 ('cancel_request','キャンセルしたいです','店舗確認へ回す'),
 ('late_notice','10分遅れます','店舗確認へ回す'),
 ('arrival_notice','到着しました','店舗確認へ回す'),
 ('group_booking','2人で行けますか','部屋と担当確認へ回す'),
 ('room_shortage','部屋空いてますか','部屋確認へ回す'),
 ('shift_outside','朝8時いけますか','営業時間外なら確認へ回す'),
 ('full_alternative','満枠なら別時間ありますか','代替候補確認へ進む'),
 ('ng_rule','ルール外だけどお願いできますか','安全に断り店舗確認へ回す'),
 ('blacklist','前に出禁って言われたかも','店舗確認へ回す'),
 ('anonymous_call','非通知なんですけど予約できますか','電話番号必要性を説明する'),
 ('silence','無言','短く聞き返す'),
 ('unclear','電波悪いかもしれません','聞き返す'),
 ('casual','今日暑いですね','短く受けて予約導線へ戻す'),
 ('prank','なんとなく電話しました','予約意思を確認する'),
 ('discount','安くならないですか','店舗確認へ回す'),
 ('complaint','前回嫌な対応されました','謝意と店舗確認へ回す'),
 ('angry','何回言わせるんですか','謝意と店舗確認へ回す'),
 ('hurry','急いでます','短く必要項目を確認する'),
 ('sexual_question','過度なサービスありますか','安全に断る'),
 ('personal_info','セラピストのLINE教えて','個人情報は案内しない'),
 ('unknown_knowledge','駐車場の提携ありますか','統一文で店舗確認へ回す'),
 ('store_check_required','特別対応できますか','統一文で店舗確認へ回す'),
 ('sms_question','SMS届きますか','SMS確認を案内する'),
 ('callback_request','折り返してください','Escalationを作る'),
 ('escalation','人に確認してほしいです','Escalationを作る')
]
expected = {
 'discount':'escalate_store_check','complaint':'escalate_complaint','angry':'escalate_store_check','sexual_question':'safe_decline','personal_info':'safe_decline','unknown_knowledge':'knowledge_unknown_fixed_reply','store_check_required':'knowledge_unknown_fixed_reply','callback_request':'create_escalation','escalation':'create_escalation','cancel_request':'create_escalation','change_request':'create_escalation','late_notice':'create_escalation','arrival_notice':'create_escalation','blacklist':'create_escalation','ng_rule':'safe_decline','silence':'clarify_or_callback_after_two','unclear':'clarify_short','ambiguous_datetime':'ask_datetime_clarification','time_only':'ask_date_or_confirm_time','date_only':'ask_time_clarification','course_unknown':'ask_course_clarification','phone_capture':'capture_phone_then_confirm','phone_correction':'update_phone_only','name_capture':'capture_name','correction':'apply_correction_then_reconfirm','consent':'hold_only_after_readback','readback':'readback_required_fields'
}
prefixes=['','あの、','すみません、','もしもし、','ちょっと、']
suffixes=['','お願いします','大丈夫ですか','確認できますか']
rows=[]; n=1
for cat, base, action in categories:
    variants=[]
    for pre in prefixes:
        for suf in suffixes:
            variants.append(pre + base + (('、'+suf) if suf else ''))
    for text in variants[:20]:
        rows.append({'id':f'CQ{n:04d}','category':cat,'utterance':text,'expectedAction':expected.get(cat,action),'forbiddenActions':['direct_CONFIRMED_reservation','create_CONFIRMED_directly','create_hold_before_readback_and_clear_consent'],'mustNotContain':['予約を確定しました','CONFIRMEDを作成','値引きできます','個人LINEを教えます'],'scoreDimensions':['naturalness','brevity','safety','flow','holdOrEscalationBranch']})
        n+=1
assert len(rows)==1020, len(rows)
Path('apps/api/test/fixtures/conversationQualityCases.json').write_text(json.dumps({'version':'2026-06-15','purpose':'ARARE AI phone conversation quality mock regression','total':len(rows),'cases':rows}, ensure_ascii=False, indent=2), encoding='utf-8')
print('wrote clean fixture', len(rows))
