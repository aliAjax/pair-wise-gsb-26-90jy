// 临床假设证据台：领域模型与业务规则
//
// 规则：
// 1. 每个个案始终只有一个当前假设版本，记录假设与判断依据；
// 2. 会谈后只追加证据（支持事实 / 相反事实），证据挂在登记时的当前版本上，署名后不可改写；
// 3. 当前版本的相反事实累计到 CONTRADICT_LIMIT 条时，原假设不能直接确认，
//    须填清修订原因并另存为新版本，旧版本保留可查；
// 4. 个案转介后，接手人只能追加证据与版本，不能改写前任记录（全部记录只增不改）；
// 5. 重新打开页面时 ensureConsistency 校正当前版本指针与证据链，保证三者对齐。

export const CONTRADICT_LIMIT = 2;
export const STORAGE_KEY = "hxwl-12-evidence-board-v1";

export type EvidenceKind = "support" | "contradict";
export type VersionStatus = "active" | "confirmed" | "superseded";

export interface Evidence {
  id: string;
  versionId: string; // 登记时所属的假设版本
  kind: EvidenceKind;
  fact: string;
  sessionDate: string; // 会谈日期 YYYY-MM-DD
  author: string; // 登记人（署名保留，记录不可改写）
  createdAt: string;
}

export interface HypothesisVersion {
  id: string;
  versionNo: number;
  hypothesis: string; // 假设
  rationale: string; // 判断依据
  revisionReason: string | null; // 修订原因（v2 起必填）
  status: VersionStatus;
  createdBy: string;
  createdAt: string;
}

export interface TransferRecord {
  id: string;
  from: string;
  to: string;
  note: string;
  at: string;
}

export interface CaseFile {
  id: string;
  clientCode: string; // 来访者代号
  theme: string; // 咨询主题
  risk: string; // 风险等级
  owner: string; // 当前负责人：仅负责人可登记证据 / 修订 / 确认 / 转介
  currentVersionId: string;
  versions: HypothesisVersion[];
  evidence: Evidence[];
  transfers: TransferRecord[];
}

export interface Store {
  schemaVersion: 1;
  currentUser: string;
  cases: CaseFile[];
}

export const USERS = [
  { name: "林岚", role: "咨询师" },
  { name: "周航", role: "咨询师" },
  { name: "苏晴", role: "督导" },
];

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const nowIso = () => new Date().toISOString();

// ---------- 派生查询 ----------

export function activeVersion(c: CaseFile): HypothesisVersion {
  return c.versions.find((v) => v.id === c.currentVersionId) ?? c.versions[c.versions.length - 1];
}

export function evidenceOf(c: CaseFile, versionId: string): Evidence[] {
  return c.evidence.filter((e) => e.versionId === versionId);
}

export function countKind(c: CaseFile, versionId: string, kind: EvidenceKind): number {
  return c.evidence.filter((e) => e.versionId === versionId && e.kind === kind).length;
}

export function contradictCount(c: CaseFile, versionId: string): number {
  return countKind(c, versionId, "contradict");
}

/** 当前版本相反事实是否已达上限（达到后原假设不能直接确认） */
export function isBlocked(c: CaseFile): boolean {
  return contradictCount(c, activeVersion(c).id) >= CONTRADICT_LIMIT;
}

// ---------- 变更（全部只增不改，返回新对象） ----------

export interface EvidenceInput {
  kind: EvidenceKind;
  fact: string;
  sessionDate: string;
  author: string;
}

export function addEvidence(c: CaseFile, input: EvidenceInput): CaseFile {
  const ev: Evidence = {
    id: uid(),
    versionId: c.currentVersionId,
    kind: input.kind,
    fact: input.fact.trim(),
    sessionDate: input.sessionDate,
    author: input.author,
    createdAt: nowIso(),
  };
  return { ...c, evidence: [...c.evidence, ev] };
}

export interface RevisionInput {
  hypothesis: string;
  rationale: string;
  revisionReason: string;
  author: string;
}

/** 另存新版本：旧版本归档为 superseded，证据链随旧版本保留 */
export function reviseHypothesis(c: CaseFile, input: RevisionInput): CaseFile {
  const nextNo = Math.max(...c.versions.map((v) => v.versionNo)) + 1;
  const next: HypothesisVersion = {
    id: uid(),
    versionNo: nextNo,
    hypothesis: input.hypothesis.trim(),
    rationale: input.rationale.trim(),
    revisionReason: input.revisionReason.trim(),
    status: "active",
    createdBy: input.author,
    createdAt: nowIso(),
  };
  const versions = c.versions.map((v) =>
    v.id === c.currentVersionId ? { ...v, status: "superseded" as VersionStatus } : v
  );
  return { ...c, versions: [...versions, next], currentVersionId: next.id };
}

/** 确认当前假设：相反事实达上限时禁止 */
export function confirmHypothesis(c: CaseFile): CaseFile {
  if (isBlocked(c)) return c;
  const versions = c.versions.map((v) =>
    v.id === c.currentVersionId && v.status === "active"
      ? { ...v, status: "confirmed" as VersionStatus }
      : v
  );
  return { ...c, versions };
}

export interface TransferInput {
  to: string;
  note: string;
}

/** 转介：追加一条转介记录并更换负责人，历史记录保持原署名 */
export function transferCase(c: CaseFile, input: TransferInput): CaseFile {
  const record: TransferRecord = {
    id: uid(),
    from: c.owner,
    to: input.to,
    note: input.note.trim(),
    at: nowIso(),
  };
  return { ...c, owner: input.to, transfers: [...c.transfers, record] };
}

// ---------- 重开一致性校正：当前假设、证据链、版本三者对齐 ----------

export function ensureConsistency(store: Store): { store: Store; repairs: string[] } {
  const repairs: string[] = [];
  const cases = store.cases
    .map((c): CaseFile | null => {
      if (c.versions.length === 0) {
        repairs.push(`${c.clientCode}: 缺少假设版本，已移除该个案`);
        return null;
      }
      const sorted = [...c.versions].sort((a, b) => a.versionNo - b.versionNo);
      const current = sorted[sorted.length - 1];
      // 有且仅有一个当前版本：最高版本号为当前，其余一律归档
      const versions = sorted.map((v) => {
        const shouldBe: VersionStatus =
          v.id === current.id ? (v.status === "superseded" ? "active" : v.status) : "superseded";
        return v.status === shouldBe ? v : { ...v, status: shouldBe };
      });
      if (c.currentVersionId !== current.id) {
        repairs.push(`${c.clientCode}: 当前版本指针已校正为 v${current.versionNo}`);
      }
      // 证据链对齐：丢弃失去版本对应关系的孤儿证据
      const ids = new Set(versions.map((v) => v.id));
      const evidence = c.evidence.filter((e) => {
        const ok = ids.has(e.versionId);
        if (!ok) repairs.push(`${c.clientCode}: 移除 1 条失去版本对应关系的证据`);
        return ok;
      });
      return { ...c, versions, currentVersionId: current.id, evidence };
    })
    .filter((c): c is CaseFile => c !== null);
  return { store: { ...store, cases }, repairs };
}

// ---------- 本地持久化 ----------

export function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedStore();
    const parsed = JSON.parse(raw) as Store;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.cases)) return seedStore();
    const { store, repairs } = ensureConsistency(parsed);
    if (repairs.length > 0) console.warn("[假设证据台] 重开一致性校正:", repairs);
    return store;
  } catch (err) {
    console.warn("[假设证据台] 本地数据读取失败，已载入演示数据", err);
    return seedStore();
  }
}

export function saveStore(store: Store): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (err) {
    console.warn("[假设证据台] 本地保存失败", err);
  }
}

// ---------- 演示数据 ----------

export function seedStore(): Store {
  const cases: CaseFile[] = [
    {
      id: "case-c042",
      clientCode: "C-042",
      theme: "焦虑",
      risk: "中风险",
      owner: "林岚",
      currentVersionId: "c042-v1",
      versions: [
        {
          id: "c042-v1",
          versionNo: 1,
          hypothesis: "焦虑由完美主义驱动的自我要求维持，睡前灾难化反刍是核心环节。",
          rationale:
            "首次会谈：来访者反复回想白天工作失误至凌晨；SAS 粗分 58，睡眠潜伏期超过 90 分钟。",
          revisionReason: null,
          status: "active",
          createdBy: "林岚",
          createdAt: "2026-09-03T09:30:00.000Z",
        },
      ],
      evidence: [
        {
          id: "c042-e1",
          versionId: "c042-v1",
          kind: "support",
          fact: "会谈中来访者自己发现：“必须做到最好”的念头出现时，睡前反刍明显加重。",
          sessionDate: "2026-09-10",
          author: "林岚",
          createdAt: "2026-09-10T13:00:00.000Z",
        },
        {
          id: "c042-e2",
          versionId: "c042-v1",
          kind: "contradict",
          fact: "来访者报告本周两次允许自己“做得一般”，焦虑不升反降，与完美主义维持假设不完全吻合。",
          sessionDate: "2026-09-24",
          author: "林岚",
          createdAt: "2026-09-24T13:00:00.000Z",
        },
      ],
      transfers: [],
    },
    {
      id: "case-c203",
      clientCode: "C-203",
      theme: "职业压力",
      risk: "关注",
      owner: "林岚",
      currentVersionId: "c203-v1",
      versions: [
        {
          id: "c203-v1",
          versionNo: 1,
          hypothesis: "职业倦怠主要源于工作边界不清导致的持续透支。",
          rationale: "连续三周加班至凌晨，难以拒绝临时任务；MBI 情感耗竭分量表得分偏高。",
          revisionReason: null,
          status: "active",
          createdBy: "林岚",
          createdAt: "2026-09-01T09:00:00.000Z",
        },
      ],
      evidence: [
        {
          id: "c203-e1",
          versionId: "c203-v1",
          kind: "support",
          fact: "执行“下周边界练习”一周后，来访者报告晚间恢复感提升。",
          sessionDate: "2026-09-08",
          author: "林岚",
          createdAt: "2026-09-08T13:00:00.000Z",
        },
        {
          id: "c203-e2",
          versionId: "c203-v1",
          kind: "contradict",
          fact: "边界练习执行良好，但疲惫感未如期改善。",
          sessionDate: "2026-09-15",
          author: "林岚",
          createdAt: "2026-09-15T13:00:00.000Z",
        },
        {
          id: "c203-e3",
          versionId: "c203-v1",
          kind: "contradict",
          fact: "来访者提到疲惫加重主要出现在照顾生病家人之后，与工作边界关系不大。",
          sessionDate: "2026-09-25",
          author: "林岚",
          createdAt: "2026-09-25T13:00:00.000Z",
        },
      ],
      transfers: [],
    },
    {
      id: "case-c119",
      clientCode: "C-119",
      theme: "亲密关系",
      risk: "稳定",
      owner: "周航",
      currentVersionId: "c119-v2",
      versions: [
        {
          id: "c119-v1",
          versionNo: 1,
          hypothesis: "亲密关系中的沟通退缩由回避型依恋模式驱动。",
          rationale: "来访者描述冲突时倾向沉默、离开现场；早年照料者回应不稳定。",
          revisionReason: null,
          status: "superseded",
          createdBy: "林岚",
          createdAt: "2026-08-20T09:00:00.000Z",
        },
        {
          id: "c119-v2",
          versionNo: 2,
          hypothesis: "沟通退缩主要出现在被指责的高唤醒情境，属于情境性防御反应。",
          rationale: "平静对话中来访者能表达需求；退缩集中出现在伴侣提高音量时。",
          revisionReason: "两条相反事实显示来访者在安全情境下能主动沟通，回避并非稳定的依恋特质。",
          status: "active",
          createdBy: "周航",
          createdAt: "2026-09-06T09:00:00.000Z",
        },
      ],
      evidence: [
        {
          id: "c119-e1",
          versionId: "c119-v1",
          kind: "support",
          fact: "伴侣提高音量时，来访者当即沉默并回避眼神。",
          sessionDate: "2026-08-27",
          author: "林岚",
          createdAt: "2026-08-27T13:00:00.000Z",
        },
        {
          id: "c119-e2",
          versionId: "c119-v1",
          kind: "contradict",
          fact: "来访者在安全感高的朋友面前能流畅表达不满。",
          sessionDate: "2026-09-02",
          author: "林岚",
          createdAt: "2026-09-02T13:00:00.000Z",
        },
        {
          id: "c119-e3",
          versionId: "c119-v1",
          kind: "contradict",
          fact: "与伴侣平静对话时，来访者能主动提出需求，未见退缩。",
          sessionDate: "2026-09-04",
          author: "林岚",
          createdAt: "2026-09-04T13:00:00.000Z",
        },
        {
          id: "c119-e4",
          versionId: "c119-v2",
          kind: "support",
          fact: "角色扮演中，来访者在音量受控的练习里成功表达了一次需求。",
          sessionDate: "2026-09-22",
          author: "周航",
          createdAt: "2026-09-22T13:00:00.000Z",
        },
      ],
      transfers: [
        {
          id: "c119-t1",
          from: "林岚",
          to: "周航",
          note: "督导建议由擅长伴侣议题的咨询师接手，继续验证修订后假设。",
          at: "2026-09-05T09:00:00.000Z",
        },
      ],
    },
  ];
  return { schemaVersion: 1, currentUser: "林岚", cases };
}
