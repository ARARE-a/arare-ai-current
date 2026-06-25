export const courses = [
  { id: "course-60", name: "60分コース", durationMin: 60, price: 12000 },
  { id: "course-90", name: "90分コース", durationMin: 90, price: 17000 },
  { id: "course-120", name: "120分コース", durationMin: 120, price: 22000 }
];

export const therapists = [
  { id: "therapist-1", displayName: "美咲", status: "出勤中", nominationFee: 2000, utilization: 72, nominations: 18 },
  { id: "therapist-2", displayName: "玲奈", status: "出勤予定", nominationFee: 3000, utilization: 86, nominations: 31 },
  { id: "therapist-3", displayName: "葵", status: "出勤中", nominationFee: 1000, utilization: 61, nominations: 9 }
];

export const customers = [
  { id: "customer-1", name: "山田 太郎", phone: "090-1111-2222", lineId: "line_yamada", visits: 4, memo: "玲奈指名が多い", ng: false },
  { id: "customer-2", name: "佐藤 健", phone: "080-3333-4444", lineId: "line_sato", visits: 1, memo: "初回クーポン案内済み", ng: false },
  { id: "customer-3", name: "鈴木 誠", phone: "070-5555-6666", lineId: "-", visits: 0, memo: "Webチャットから流入", ng: false },
  { id: "customer-4", name: "非表示顧客", phone: "090-9999-0000", lineId: "-", visits: 2, memo: "スタッフ確認必須", ng: true }
];

export const reservations = [
  {
    id: "res-1",
    time: "15:00",
    end: "16:30",
    customer: "山田 太郎",
    phone: "090-1111-2222",
    course: "90分コース",
    therapist: "玲奈",
    room: "Room A",
    status: "確定",
    source: "LINE",
    amount: 17000
  },
  {
    id: "res-2",
    time: "18:30",
    end: "19:30",
    customer: "佐藤 健",
    phone: "080-3333-4444",
    course: "60分コース",
    therapist: "美咲",
    room: "Room B",
    status: "仮予約",
    source: "Webチャット",
    amount: 12000
  },
  {
    id: "res-3",
    time: "20:00",
    end: "22:00",
    customer: "鈴木 誠",
    phone: "070-5555-6666",
    course: "120分コース",
    therapist: "葵",
    room: "Room C",
    status: "確定",
    source: "電話",
    amount: 22000
  }
];

export const conversations = [
  { channel: "LINE", customer: "山田 太郎", summary: "90分コース、玲奈指名で予約確定", status: "AI完結", time: "14:12" },
  { channel: "Webチャット", customer: "佐藤 健", summary: "初回来店、60分コースの仮予約", status: "確認待ち", time: "14:31" },
  { channel: "電話", customer: "鈴木 誠", summary: "120分コース、注意事項説明済み", status: "AI完結", time: "15:04" }
];

export const notifications = [
  { type: "予約確定", target: "山田 太郎", channel: "LINE", status: "送信済", time: "14:13" },
  { type: "当日リマインド", target: "佐藤 健", channel: "Webチャット", status: "予約中", time: "17:30" },
  { type: "セラピスト予約通知", target: "葵", channel: "LINE", status: "送信済", time: "15:05" }
];
