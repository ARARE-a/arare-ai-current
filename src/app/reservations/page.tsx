"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Ban, CalendarDays, CheckCircle2, Clock3, Edit3, Plus, Save, SearchCheck } from "lucide-react";
import {
  ActionButton,
  AdminPanel,
  AdminShell,
  DataTable,
  EmptyState,
  Field,
  RefreshButton,
  SelectField,
  StatusPill,
  TableCell,
  TableHeader,
  TextareaField,
  ToggleRow,
  adminUserFacingError,
  formatDateTime,
  formatYen
} from "@/components/AdminUi";

type ApiResult<T> = { data?: T; error?: string };
type Course = { id: string; name: string; durationMin: number; price: number; isActive?: boolean };
type Therapist = { id: string; displayName: string; status: string; nominationFee?: number };
type Room = { id: string; name: string; isActive?: boolean };
type Reservation = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: "TENTATIVE" | "CONFIRMED" | "VISITED" | "CANCELLED" | "NO_SHOW";
  source: "PHONE" | "LINE" | "WEB_CHAT" | "ADMIN";
  nominated: boolean;
  firstVisit: boolean;
  note?: string | null;
  customer: { id: string; name: string; phone: string };
  course: Course;
  therapist?: { id: string; displayName: string } | null;
  room?: { id: string; name: string } | null;
};
type Availability = { therapists: Therapist[]; rooms: Room[]; blockedSlots: unknown[] };
type AvailabilitySlot = Availability & { startsAt: string; endsAt: string };
type SlotSuggestion = {
  startsAt: string;
  label: string;
  therapistCount: number;
  roomCount: number;
  therapistNames: string;
  roomNames: string;
};

const emptyForm = {
  id: "",
  customerName: "",
  customerPhone: "",
  startsAt: "",
  courseId: "",
  therapistId: "",
  roomId: "",
  status: "TENTATIVE",
  source: "ADMIN",
  nominated: false,
  firstVisit: false,
  note: ""
};

const statusOptions = [
  { label: "仮予約", value: "TENTATIVE" },
  { label: "確定", value: "CONFIRMED" },
  { label: "来店済み", value: "VISITED" },
  { label: "キャンセル", value: "CANCELLED" },
  { label: "無断キャンセル", value: "NO_SHOW" }
];

const sourceOptions = [
  { label: "管理画面", value: "ADMIN" },
  { label: "電話", value: "PHONE" },
  { label: "LINE", value: "LINE" },
  { label: "Webチャット", value: "WEB_CHAT" }
];

export default function ReservationsPage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [therapists, setTherapists] = useState<Therapist[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [filter, setFilter] = useState("ACTIVE");
  const [message, setMessage] = useState("予約情報を読み込み中");
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [slotSuggestions, setSlotSuggestions] = useState<SlotSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [slotSearching, setSlotSearching] = useState(false);
  const [slotSearchAttempted, setSlotSearchAttempted] = useState(false);

  async function requestJson<T>(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const payload = (await response.json().catch(() => ({}))) as ApiResult<T>;
    if (!response.ok) throw new Error(payload.error || `API error ${response.status}`);
    return payload.data as T;
  }

  async function requestJsonWithTimeout<T>(url: string, init?: RequestInit, timeoutMs = 15000) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await requestJson<T>(url, { ...init, signal: controller.signal });
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function requestAdminJson<T>(label: string, url: string) {
    try {
      return await requestJson<T>(url);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${label}: ${detail}`);
    }
  }

  async function load(nextMessage = "予約情報を取得しました") {
    setLoading(true);
    try {
      const [reservationData, courseData, therapistData, roomData] = await Promise.all([
        requestAdminJson<Reservation[]>("予約一覧", "/api/reservations"),
        requestAdminJson<Course[]>("コース", "/api/courses"),
        requestAdminJson<Therapist[]>("セラピスト", "/api/therapists"),
        requestAdminJson<Room[]>("部屋", "/api/rooms")
      ]);
      const activeCourses = (courseData ?? []).filter((item) => item.isActive !== false);
      const activeTherapists = (therapistData ?? []).filter((item) => item.status !== "INACTIVE");
      const activeRooms = (roomData ?? []).filter((item) => item.isActive !== false);
      setReservations(reservationData ?? []);
      setCourses(activeCourses);
      setTherapists(activeTherapists);
      setRooms(activeRooms);
      setMessage(nextMessage);
      setForm((current) => ({
        ...current,
        courseId: activeCourses.some((item) => item.id === current.courseId) ? current.courseId : activeCourses[0]?.id || "",
        therapistId: current.therapistId && activeTherapists.some((item) => item.id === current.therapistId) ? current.therapistId : "",
        roomId: current.roomId && activeRooms.some((item) => item.id === current.roomId) ? current.roomId : ""
      }));
    } catch (error) {
      setMessage(adminUserFacingError(error, "予約情報の取得に失敗しました"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const selectedReservation = useMemo(() => reservations.find((item) => item.id === form.id) ?? null, [reservations, form.id]);
  const activeReservations = useMemo(() => reservations.filter(isUpcomingActiveReservation), [reservations]);
  const activeTentativeReservations = useMemo(() => activeReservations.filter((item) => item.status === "TENTATIVE"), [activeReservations]);
  const activeConfirmedReservations = useMemo(() => activeReservations.filter((item) => item.status === "CONFIRMED"), [activeReservations]);
  const filtered = useMemo(() => {
    if (filter === "ACTIVE") return activeReservations;
    if (filter === "ALL") return reservations;
    return reservations.filter((item) => item.status === filter);
  }, [reservations, activeReservations, filter]);
  const availabilityReady = Boolean(availability && availability.therapists.length > 0 && availability.rooms.length > 0);
  const showEmptySlotSearchResult = slotSearchAttempted && !slotSearching && slotSuggestions.length === 0 && !availabilityReady;
  const selectedCourse = useMemo(() => courses.find((item) => item.id === form.courseId) ?? null, [courses, form.courseId]);
  const courseOptions = useMemo(
    () => [
      { label: "コースを選択", value: "" },
      ...courses.map((item) => ({ label: `${item.name} / ${item.durationMin}分 / ${formatYen(item.price)}`, value: item.id }))
    ],
    [courses]
  );
  const selectedTherapist = useMemo(() => therapists.find((item) => item.id === form.therapistId) ?? null, [therapists, form.therapistId]);
  const selectedRoom = useMemo(() => rooms.find((item) => item.id === form.roomId) ?? null, [rooms, form.roomId]);
  const missingCreateFields = [
    !form.customerName.trim() ? "顧客名" : null,
    !form.customerPhone.trim() ? "電話番号" : null,
    !form.startsAt ? "日時" : null,
    !form.courseId ? "コース" : null
  ].filter(Boolean);
  const availabilityNeedsShift = Boolean(availability && availability.therapists.length === 0);
  const availabilityNeedsRoom = Boolean(availability && availability.rooms.length === 0);
  const editableStatusOptions =
    form.status === "CONFIRMED" ? statusOptions : statusOptions.filter((item) => item.value !== "CONFIRMED");

  function updateSlotForm(next: Partial<typeof emptyForm>) {
    setAvailability(null);
    setSaveError(null);
    setSlotSuggestions([]);
    setSlotSearchAttempted(false);
    setForm((current) => ({ ...current, ...next }));
  }

  function resetFormForNewReservation() {
    setAvailability(null);
    setSaveError(null);
    setSlotSuggestions([]);
    setSlotSearchAttempted(false);
    setForm({ ...emptyForm, courseId: courses[0]?.id || "" });
  }

  function toLocalInputValue(date: Date) {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function slotLabel(value: string) {
    const date = new Date(value);
    return date.toLocaleString("ja-JP", {
      month: "numeric",
      day: "numeric",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function buildSlotCandidates() {
    const base = form.startsAt ? new Date(form.startsAt) : new Date();
    const start = Number.isNaN(base.getTime()) ? new Date() : new Date(base);
    if (form.startsAt) {
      start.setHours(12, 0, 0, 0);
    } else {
      const minute = start.getMinutes() <= 30 ? 30 : 60;
      start.setMinutes(minute === 60 ? 0 : 30, 0, 0);
      if (minute === 60) start.setHours(start.getHours() + 1);
      if (start.getHours() < 12) start.setHours(12, 0, 0, 0);
    }

    return Array.from({ length: 34 }, (_, index) => {
      const candidate = new Date(start);
      candidate.setMinutes(start.getMinutes() + index * 30);
      return candidate;
    }).filter((candidate) => {
      const hour = candidate.getHours();
      return hour >= 12 || hour < 5;
    });
  }

  async function findAvailableSlots() {
    if (!form.courseId) {
      setMessage("空き時間検索にはコースが必要です");
      return;
    }
    setSlotSearching(true);
    setSlotSearchAttempted(true);
    setAvailability(null);
    setSaveError(null);
    setSlotSuggestions([]);
    try {
      const candidates = buildSlotCandidates();
      const slots = await requestJsonWithTimeout<AvailabilitySlot[]>("/api/reservations/availability-slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startsAtList: candidates.map((candidate) => candidate.toISOString()),
          courseId: form.courseId,
          therapistId: form.therapistId || undefined,
          roomId: form.roomId || undefined,
          limit: 6
        })
      }, 10000);
      const found: SlotSuggestion[] = slots.map((data) => {
        const startsAt = toLocalInputValue(new Date(data.startsAt));
        return {
          startsAt,
          label: slotLabel(startsAt),
          therapistCount: data.therapists.length,
          roomCount: data.rooms.length,
          therapistNames: data.therapists.slice(0, 2).map((item) => item.displayName).join("、"),
          roomNames: data.rooms.slice(0, 2).map((item) => item.name).join("、")
        };
      });
      setSlotSuggestions(found);
      if (found.length === 0 && form.startsAt) {
        const currentAvailability = await requestJson<Availability>("/api/reservations", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startsAt: new Date(form.startsAt).toISOString(),
            courseId: form.courseId,
            therapistId: form.therapistId || undefined,
            roomId: form.roomId || undefined
          })
        });
        setAvailability(currentAvailability);
      }
      setMessage(found.length > 0 ? `空き候補を${found.length}件見つけました` : "空き候補が見つかりません。別の日付またはシフトを確認してください。");
    } catch (error) {
      setMessage(adminUserFacingError(error, "空き時間検索に失敗しました"));
    } finally {
      setSlotSearching(false);
    }
  }

  function chooseSlot(slot: SlotSuggestion) {
    setSaveError(null);
    setForm((current) => ({ ...current, startsAt: slot.startsAt }));
    setAvailability({
      therapists: Array.from({ length: slot.therapistCount }, (_, index) => ({
        id: `suggested-therapist-${index}`,
        displayName: index === 0 ? slot.therapistNames || "候補あり" : "候補あり",
        status: "ACTIVE"
      })),
      rooms: Array.from({ length: slot.roomCount }, (_, index) => ({
        id: `suggested-room-${index}`,
        name: index === 0 ? slot.roomNames || "候補あり" : "候補あり"
      })),
      blockedSlots: []
    });
    setMessage(`${slot.label} を選択しました。内容を確認して作成できます。`);
  }

  function availabilityStatusMessage(data: Availability) {
    const therapistNames = data.therapists.slice(0, 2).map((item) => item.displayName).join("、");
    const roomNames = data.rooms.slice(0, 2).map((item) => item.name).join("、");
    if (data.therapists.length === 0 && data.rooms.length === 0) {
      return "作成できません。この日時は出勤セラピストと空き部屋がありません。シフト登録、部屋設定、または別日時を確認してください。";
    }
    if (data.therapists.length === 0) {
      return "作成できません。この日時は部屋は空いていますが、出勤セラピストがいません。シフト登録または別日時を選んでください。";
    }
    if (data.rooms.length === 0) {
      return "作成できません。この日時は対応できるセラピストはいますが、空き部屋がありません。部屋設定または別日時を選んでください。";
    }
    return `作成できます。候補: ${therapistNames || "自動割当"} / ${roomNames || "自動割当"}`;
  }

  function slotSearchEmptyMessage() {
    if (availability && availability.therapists.length === 0 && availability.rooms.length > 0) {
      return "候補なし: 部屋は空いていますが、出勤セラピストがいません。シフト登録または別日時を選んでください。";
    }
    if (availability && availability.therapists.length > 0 && availability.rooms.length === 0) {
      return "候補なし: 対応できるセラピストはいますが、空き部屋がありません。部屋設定または別日時を選んでください。";
    }
    if (availability && availability.therapists.length === 0 && availability.rooms.length === 0) {
      return "候補なし: 出勤セラピストと空き部屋がありません。シフト登録、部屋設定、または別日時を確認してください。";
    }
    return "空き候補が見つかりません。指定セラピストまたは部屋を「自動割当」に戻すか、別の日付・時間で探してください。";
  }

  async function checkAvailability(showSuccess = true) {
    if (!form.startsAt || !form.courseId) {
      setMessage("空き確認には日時とコースが必要です");
      return null;
    }
    try {
      setSaveError(null);
      const data = await requestJson<Availability>("/api/reservations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startsAt: new Date(form.startsAt).toISOString(),
          courseId: form.courseId,
          therapistId: form.therapistId || undefined,
          roomId: form.roomId || undefined,
          excludeReservationId: form.id || undefined
        })
      });
      setAvailability(data);
      if (data.therapists.length > 0 && data.rooms.length > 0) {
        setSlotSuggestions([]);
        setSlotSearchAttempted(false);
      }
      if (showSuccess) {
        setMessage(availabilityStatusMessage(data));
      }
      return data;
    } catch (error) {
      setAvailability(null);
      setMessage(adminUserFacingError(error, "空き確認に失敗しました"));
      return null;
    }
  }

  async function save() {
    setSaveError(null);
    if (!form.startsAt || !form.courseId) {
      setMessage("日時とコースを入力してください");
      return;
    }
    if (!form.id && (!form.customerName.trim() || !form.customerPhone.trim())) {
      setMessage("新規作成には顧客名と電話番号が必要です");
      return;
    }

    setSaving(true);
    try {
      if (form.id) {
        const changedSlot = selectedReservation
          ? form.startsAt !== toDatetimeLocal(selectedReservation.startsAt) ||
            form.courseId !== selectedReservation.course.id ||
            form.therapistId !== (selectedReservation.therapist?.id ?? "") ||
            form.roomId !== (selectedReservation.room?.id ?? "")
          : true;
        if (changedSlot) {
          const available = await checkAvailability(false);
          if (!available || available.therapists.length === 0 || available.rooms.length === 0) {
            setMessage("空き確認で利用可能枠が見つからないため、編集を中止しました");
            return;
          }
        }
        await requestJson<Reservation>(`/api/reservations/${form.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startsAt: new Date(form.startsAt).toISOString(),
            endsAt: calculateEndsAt(form.startsAt, form.courseId, courses),
            courseId: form.courseId,
            therapistId: form.therapistId || null,
            roomId: form.roomId || null,
            status: form.status,
            source: form.source,
            nominated: form.nominated,
            firstVisit: form.firstVisit,
            note: form.note || null
          })
        });
        resetFormForNewReservation();
        setAvailability(null);
        await load("予約を更新しました");
        return;
      }

      const available = await checkAvailability(false);
      if (!available || available.therapists.length === 0 || available.rooms.length === 0) {
        setMessage(available ? availabilityStatusMessage(available) : "空き確認に失敗しました。日時とコースを確認してください。");
        return;
      }

      await requestJson<Reservation>("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: { name: form.customerName, phone: form.customerPhone },
          startsAt: new Date(form.startsAt).toISOString(),
          courseId: form.courseId,
          therapistId: form.therapistId || undefined,
          roomId: form.roomId || undefined,
          nominated: form.nominated,
          firstVisit: form.firstVisit,
          note: form.note || undefined,
          source: form.source,
          status: "TENTATIVE",
          attentionConfirmed: true,
          actorType: "ADMIN"
        })
      });
      resetFormForNewReservation();
      setAvailability(null);
      await load("予約を作成しました");
    } catch (error) {
      const nextMessage = adminUserFacingError(error, "予約の保存に失敗しました");
      setAvailability(null);
      setSaveError(nextMessage);
      setMessage(nextMessage);
    } finally {
      setSaving(false);
    }
  }

  async function cancelReservation(id: string) {
    setSaving(true);
    try {
      await requestJson<Reservation>(`/api/reservations/${id}`, { method: "DELETE" });
      await load("予約をキャンセルしました");
    } catch (error) {
      setMessage(adminUserFacingError(error, "予約キャンセルに失敗しました"));
    } finally {
      setSaving(false);
    }
  }

  async function approveReservation(id: string) {
    setSaving(true);
    try {
      await requestJson<Reservation>(`/api/reservations/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorType: "ADMIN" })
      });
      await load("予約を確定しました。通知状態を確認してください");
    } catch (error) {
      setMessage(adminUserFacingError(error, "予約確定に失敗しました"));
    } finally {
      setSaving(false);
    }
  }

  function edit(item: Reservation) {
    setForm({
      id: item.id,
      customerName: item.customer.name,
      customerPhone: item.customer.phone,
      startsAt: toDatetimeLocal(item.startsAt),
      courseId: item.course.id,
      therapistId: item.therapist?.id ?? "",
      roomId: item.room?.id ?? "",
      status: item.status,
      source: item.source,
      nominated: item.nominated,
      firstVisit: item.firstVisit,
      note: item.note ?? ""
    });
    setAvailability(null);
    setSaveError(null);
    setMessage("編集対象をフォームへ読み込みました");
  }

  const todaySales = useMemo(() => {
    const today = new Date().toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });
    return reservations
      .filter((item) => isRevenueReservation(item) && new Date(item.startsAt).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) === today)
      .reduce((sum, item) => sum + amountFor(item), 0);
  }, [reservations]);

  return (
    <AdminShell
      active="reservations"
      title="予約作成/編集"
      subtitle="管理画面から予約を作成し、既存予約の日時・コース・担当・部屋・状態を編集します。予約判定は既存APIへ委ねます。"
      message={message}
      metrics={[
        { label: "今後有効", value: `${activeReservations.length}件`, tone: "green" },
        { label: "今後仮予約", value: `${activeTentativeReservations.length}件`, tone: "amber" },
        { label: "今後確定", value: `${activeConfirmedReservations.length}件`, tone: "green" },
        { label: "本日売上見込", value: formatYen(todaySales), caption: "表示予約から算出" }
      ]}
      actions={<RefreshButton onClick={() => void load()} loading={loading} />}
    >
      <section className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
        <AdminPanel title={form.id ? "予約を編集" : "予約を作成"} icon={<CalendarDays size={20} />}>
          <div className="mb-4 rounded-2xl border border-[#dfe8ee] bg-[#f8fbfc] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-black text-slate-950">作成前チェック</div>
                <div className="mt-1 text-xs font-bold leading-5 text-slate-500">
                  先に「空き時間を探す」または「空き確認」で、出勤セラピストと空き部屋を確認します。
                </div>
              </div>
              <div className={`rounded-full px-3 py-1 text-xs font-black ${availabilityReady ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                {availabilityReady ? "作成可能" : "未確認"}
              </div>
            </div>
            <div className="mt-3 grid gap-2 text-xs font-bold text-slate-700 md:grid-cols-3">
              <div className="rounded-xl bg-white p-2">
                入力: {missingCreateFields.length === 0 ? "OK" : `${missingCreateFields.join("・")}が未入力`}
              </div>
              <div className="rounded-xl bg-white p-2">
                コース: {selectedCourse ? `${selectedCourse.name} / ${selectedCourse.durationMin}分` : "未選択"}
              </div>
              <div className="rounded-xl bg-white p-2">
                指定: {selectedTherapist?.displayName ?? "セラピスト自動"} / {selectedRoom?.name ?? "部屋自動"}
              </div>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="顧客名" value={form.customerName} onChange={(value) => setForm({ ...form, customerName: value })} disabled={Boolean(form.id)} required />
            <Field label="電話番号" value={form.customerPhone} onChange={(value) => setForm({ ...form, customerPhone: value })} disabled={Boolean(form.id)} required />
            <Field label="日時" value={form.startsAt} onChange={(value) => updateSlotForm({ startsAt: value })} type="datetime-local" required />
            <SelectField label="コース" value={form.courseId} onChange={(value) => updateSlotForm({ courseId: value })} options={courseOptions} required />
            <SelectField label="セラピスト" value={form.therapistId} onChange={(value) => updateSlotForm({ therapistId: value })} options={[{ label: "自動割当", value: "" }, ...therapists.map((item) => ({ label: item.displayName, value: item.id }))]} />
            <SelectField label="部屋" value={form.roomId} onChange={(value) => updateSlotForm({ roomId: value })} options={[{ label: "自動割当", value: "" }, ...rooms.map((item) => ({ label: item.name, value: item.id }))]} />
            <SelectField label="状態" value={form.status} onChange={(value) => setForm({ ...form, status: value })} options={form.id ? editableStatusOptions : statusOptions.slice(0, 1)} />
            <SelectField label="受付経路" value={form.source} onChange={(value) => setForm({ ...form, source: value })} options={sourceOptions} />
            <TextareaField label="メモ" value={form.note} onChange={(value) => setForm({ ...form, note: value })} rows={4} />
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <ToggleRow label="指名あり" checked={form.nominated} onChange={(checked) => setForm({ ...form, nominated: checked })} caption="作成・編集時に予約へ反映します。" />
            <ToggleRow label="初回来店" checked={form.firstVisit} onChange={(checked) => setForm({ ...form, firstVisit: checked })} caption="作成・編集時に予約へ反映します。" />
          </div>
          {form.id ? <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-800">編集時の顧客名・電話番号は既存PATCH APIの対象外です。受付経路・指名/初回フラグは更新できます。</p> : null}
          {availability && !saveError ? (
            <div className={`mt-3 rounded-xl border p-3 text-sm font-bold leading-6 ${availabilityReady ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"}`}>
              <div className="text-base font-black">{availabilityReady ? "作成できます" : "作成できません"}</div>
              <div>{availabilityStatusMessage(availability)}</div>
              <div className="mt-1 text-xs">
                セラピスト {availability.therapists.length}名 / 部屋 {availability.rooms.length}室 / ブロック {availability.blockedSlots.length}件
              </div>
              {!availabilityReady ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {availabilityNeedsShift ? (
                    <Link href="/therapist" className="rounded-xl bg-red-900 px-3 py-2 text-xs font-black text-white">
                      シフト確認へ
                    </Link>
                  ) : null}
                  {availabilityNeedsRoom ? (
                    <Link href="/setup" className="rounded-xl bg-red-900 px-3 py-2 text-xs font-black text-white">
                      部屋設定へ
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void findAvailableSlots()}
                    className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-black text-red-900 disabled:opacity-50"
                    disabled={saving || slotSearching || !form.courseId}
                  >
                    別日時を探す
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-[#dfe8ee] bg-[#f8fbfc] p-3 text-xs font-bold leading-5 text-slate-600">
              日時とコースを選んで「空き確認」を押すと、作成できるか先に確認できます。作成ボタンでも空き確認してから保存します。
            </div>
          )}
          {saveError ? (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold leading-6 text-red-900">
              <div className="text-base font-black">作成できません</div>
              <div>{saveError}</div>
              <div className="mt-1 text-xs">
                予約は保存されていません。日時・電話番号・既存予約を確認してください。
              </div>
            </div>
          ) : null}
          <div className="mt-3 rounded-xl border border-[#dfe8ee] bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-black text-slate-950">空き時間を先に探す</div>
                <div className="mt-1 text-xs font-bold leading-5 text-slate-500">コースを選んで押すと、予約できる候補だけを表示します。</div>
              </div>
              <ActionButton onClick={() => void findAvailableSlots()} label="空き時間を探す" icon={<Clock3 size={16} />} tone="secondary" disabled={saving || slotSearching || !form.courseId} />
            </div>
            {slotSearching ? <div className="mt-3 rounded-xl bg-[#f8fbfc] p-3 text-xs font-bold text-slate-600">空き候補を確認中です...</div> : null}
            {slotSuggestions.length > 0 ? (
              <div className="mt-3 grid gap-2">
                {slotSuggestions.map((slot) => (
                  <button
                    key={slot.startsAt}
                    type="button"
                    onClick={() => chooseSlot(slot)}
                    className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-left text-sm font-black text-emerald-950 transition hover:border-emerald-400"
                  >
                    <div>{slot.label}</div>
                    <div className="mt-1 text-xs font-bold text-emerald-800">
                      セラピスト {slot.therapistCount}名 / 部屋 {slot.roomCount}室
                    </div>
                    <div className="mt-1 truncate text-xs font-bold text-emerald-700">
                      {slot.therapistNames || "自動割当"} / {slot.roomNames || "自動割当"}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
            {showEmptySlotSearchResult ? (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-900">
                {slotSearchEmptyMessage()}
                <div className="mt-3 flex flex-wrap gap-2">
                  {availabilityNeedsShift ? (
                    <Link href="/therapist" className="rounded-xl bg-amber-900 px-3 py-2 text-xs font-black text-white">
                      シフト確認へ
                    </Link>
                  ) : null}
                  {availabilityNeedsRoom ? (
                    <Link href="/setup" className="rounded-xl bg-amber-900 px-3 py-2 text-xs font-black text-white">
                      部屋設定へ
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <ActionButton onClick={() => void save()} label={form.id ? "更新" : "空き確認して作成"} icon={form.id ? <Save size={16} /> : <Plus size={16} />} disabled={saving} />
            <ActionButton onClick={() => void checkAvailability()} label="空き確認" icon={<SearchCheck size={16} />} tone="secondary" disabled={saving || !form.startsAt || !form.courseId} />
            {form.id ? <ActionButton onClick={resetFormForNewReservation} label="新規入力に戻す" icon={<Edit3 size={16} />} tone="secondary" /> : null}
          </div>
        </AdminPanel>

        <AdminPanel
          title="予約一覧"
          icon={<CalendarDays size={20} />}
          action={
            <select value={filter} onChange={(event) => setFilter(event.target.value)} className="min-h-10 rounded-xl border border-[#cbd8e3] bg-white px-3 text-sm font-black">
              <option value="ACTIVE">今後のみ</option>
              <option value="ALL">すべて</option>
              {statusOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          }
        >
          {filtered.length === 0 ? (
            <EmptyState text="表示対象の予約はありません。" />
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {filtered.map((item) => (
                  <article key={item.id} className="rounded-2xl border border-[#dfe8ee] bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-black text-slate-500">{formatDateTime(item.startsAt)}</div>
                        <h3 className="mt-1 truncate text-base font-black text-slate-950">{item.customer.name}</h3>
                        <div className="mt-1 text-xs font-bold text-slate-500">{item.customer.phone}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <StatusPill text={statusLabel(item.status)} tone={statusTone(item.status)} />
                        <div className="mt-1 text-xs font-bold text-slate-500">{sourceLabel(item.source)}</div>
                      </div>
                    </div>
                    <dl className="mt-3 grid gap-2 text-sm font-bold text-slate-700">
                      <div>
                        <dt className="text-xs text-slate-500">終了</dt>
                        <dd>{formatDateTime(item.endsAt)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">コース</dt>
                        <dd>{item.course.name} / {formatYen(item.course.price)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">担当/部屋</dt>
                        <dd>{item.therapist?.displayName ?? "未割当"} / {item.room?.name ?? "部屋未割当"}</dd>
                      </div>
                    </dl>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      {item.status === "TENTATIVE" ? <ActionButton onClick={() => void approveReservation(item.id)} label="確定" icon={<CheckCircle2 size={16} />} disabled={saving} /> : null}
                      <ActionButton onClick={() => edit(item)} label="編集" icon={<Edit3 size={16} />} tone="secondary" />
                      {item.status !== "CANCELLED" ? <ActionButton onClick={() => void cancelReservation(item.id)} label="取消" icon={<Ban size={16} />} tone="danger" disabled={saving} /> : null}
                    </div>
                  </article>
                ))}
              </div>
              <div className="hidden md:block">
                <DataTable>
                  <table className="min-w-[900px] w-full border-collapse">
                    <TableHeader>
                      <tr>
                        <th className="px-3 py-3 text-left">日時</th>
                        <th className="px-3 py-3 text-left">顧客</th>
                        <th className="px-3 py-3 text-left">コース</th>
                        <th className="px-3 py-3 text-left">担当/部屋</th>
                        <th className="px-3 py-3 text-left">状態</th>
                        <th className="px-3 py-3 text-right">操作</th>
                      </tr>
                    </TableHeader>
                    <tbody>
                      {filtered.map((item) => (
                        <tr key={item.id}>
                          <TableCell>
                            <div className="font-black text-slate-900">{formatDateTime(item.startsAt)}</div>
                            <div className="mt-1 text-xs text-slate-500">終了 {formatDateTime(item.endsAt)}</div>
                          </TableCell>
                          <TableCell>
                            <div className="font-black text-slate-900">{item.customer.name}</div>
                            <div className="mt-1 text-xs text-slate-500">{item.customer.phone}</div>
                          </TableCell>
                          <TableCell>
                            <div>{item.course.name}</div>
                            <div className="mt-1 text-xs text-slate-500">{formatYen(item.course.price)}</div>
                          </TableCell>
                          <TableCell>
                            <div>{item.therapist?.displayName ?? "未割当"}</div>
                            <div className="mt-1 text-xs text-slate-500">{item.room?.name ?? "部屋未割当"}</div>
                          </TableCell>
                          <TableCell>
                            <StatusPill text={statusLabel(item.status)} tone={statusTone(item.status)} />
                            <div className="mt-1 text-xs font-bold text-slate-500">{sourceLabel(item.source)}</div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              {item.status === "TENTATIVE" ? <ActionButton onClick={() => void approveReservation(item.id)} label="確定" icon={<CheckCircle2 size={16} />} disabled={saving} /> : null}
                              <ActionButton onClick={() => edit(item)} label="編集" icon={<Edit3 size={16} />} tone="secondary" />
                              {item.status !== "CANCELLED" ? <ActionButton onClick={() => void cancelReservation(item.id)} label="取消" icon={<Ban size={16} />} tone="danger" disabled={saving} /> : null}
                            </div>
                          </TableCell>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </DataTable>
              </div>
            </>
          )}
        </AdminPanel>
      </section>
    </AdminShell>
  );
}

function calculateEndsAt(startsAt: string, courseId: string, courses: Course[]) {
  const course = courses.find((item) => item.id === courseId);
  const start = new Date(startsAt);
  const duration = course?.durationMin ?? 90;
  return new Date(start.getTime() + duration * 60 * 1000).toISOString();
}

function toDatetimeLocal(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function amountFor(item: Reservation) {
  return item.course.price + (item.nominated ? item.therapist ? 0 : 0 : 0);
}

function isUpcomingActiveReservation(item: Reservation) {
  if (item.status !== "TENTATIVE" && item.status !== "CONFIRMED") return false;
  const endsAt = Date.parse(item.endsAt);
  if (Number.isNaN(endsAt)) return false;
  return endsAt >= Date.now();
}

function isRevenueReservation(item: Reservation) {
  return item.status === "TENTATIVE" || item.status === "CONFIRMED" || item.status === "VISITED";
}

function statusLabel(status: Reservation["status"]) {
  const found = statusOptions.find((item) => item.value === status);
  return found?.label ?? status;
}

function sourceLabel(source: Reservation["source"]) {
  return sourceOptions.find((item) => item.value === source)?.label ?? source;
}

function statusTone(status: Reservation["status"]) {
  if (status === "CONFIRMED" || status === "VISITED") return "green";
  if (status === "TENTATIVE") return "amber";
  if (status === "CANCELLED" || status === "NO_SHOW") return "red";
  return "slate";
}
